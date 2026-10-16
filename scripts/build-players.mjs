// Builds real lineups (jersey numbers and names) for the test build's "real branding" mode.
//
//   node scripts/build-players.mjs <cacheDir> [lastSeason=2026]
//
// Needs src/data/moments.json (scripts/build-moments.mjs) and the pbp files that script cached.
// For every moment it picks the 11 players each team actually used most in that game, using nflverse
// play-by-play (who was targeted, ran, passed, tackled, sacked, broke up passes) and weekly rosters
// (numbers, names, positions). It also builds a current lineup per team from the latest season.
// Data: nflverse (https://github.com/nflverse/nflverse-data), CC BY 4.0. Writes src/data/players.json.
import { createReadStream, existsSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { parse } from 'csv-parse'

const [cacheDir, lastArg = '2026'] = process.argv.slice(2)
if (!cacheDir) {
  console.error('usage: node scripts/build-players.mjs <cacheDir> [lastSeason]')
  process.exit(1)
}
const LAST = +lastArg
const { moments } = JSON.parse(readFileSync('src/data/moments.json', 'utf8'))

// pbp and roster files use different codes for some franchises; map both onto the game's abbreviations
const TEAM = { OAK: 'LV', SD: 'LAC', STL: 'LAR', LA: 'LAR', SL: 'LAR', JAC: 'JAX', WSH: 'WAS', ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU' }
const team = (t) => TEAM[t] ?? t

const GROUP = {
  QB: 'QB', RB: 'RB', FB: 'RB', HB: 'RB', WR: 'WR', TE: 'TE',
  T: 'OL', OT: 'OL', G: 'OL', OG: 'OL', C: 'OL', OL: 'OL',
  DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', EDGE: 'DL',
  LB: 'LB', OLB: 'LB', ILB: 'LB', MLB: 'LB',
  CB: 'CB', DB: 'CB', SS: 'S', FS: 'S', S: 'S', SAF: 'S',
}

async function download(url, file) {
  if (existsSync(file)) return file
  const res = await fetch(url)
  if (!res.ok) return null
  await pipeline(res.body, createWriteStream(file))
  return file
}

const num = (v) => (v === '' || v === 'NA' || v == null ? null : Number(v))

/** Weekly roster for a season: gsis id -> entries by week, and team -> week -> active players. */
async function loadRoster(season) {
  const file = await download(
    `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${season}.csv`,
    `${cacheDir}/roster_weekly_${season}.csv`,
  )
  const byId = new Map()
  const byTeamWeek = new Map()
  if (!file) return { byId, byTeamWeek }
  for await (const r of createReadStream(file).pipe(parse({ columns: true, relax_quotes: true, skip_records_with_error: true }))) {
    const n = num(r.jersey_number)
    if (!r.gsis_id || n == null || !r.full_name) continue
    const e = {
      id: r.gsis_id,
      team: team(r.team),
      week: num(r.week) ?? 0,
      n,
      name: r.full_name,
      group: GROUP[r.depth_chart_position] ?? GROUP[r.position] ?? null,
      pos: r.depth_chart_position || r.position,
      exp: num(r.years_exp) ?? 0,
      active: r.status === 'ACT',
    }
    if (!byId.has(e.id)) byId.set(e.id, [])
    byId.get(e.id).push(e)
    const k = `${e.team}|${e.week}`
    if (!byTeamWeek.has(k)) byTeamWeek.set(k, [])
    if (e.active) byTeamWeek.get(k).push(e)
  }
  for (const list of byId.values()) list.sort((a, b) => a.week - b.week)
  return { byId, byTeamWeek }
}

/** The roster entry for a player as of a week (latest entry at or before it). */
function asOf(roster, id, week) {
  const list = roster.byId.get(id)
  if (!list) return null
  let best = list[0]
  for (const e of list) if (e.week <= week) best = e
  return best
}

/** Active players for a team in the nearest roster week at or before `week`. */
function pool(roster, t, week) {
  for (let w = week; w >= 0; w--) {
    const p = roster.byTeamWeek.get(`${t}|${w}`)
    if (p?.length) return p
  }
  for (let w = week + 1; w <= 23; w++) {
    const p = roster.byTeamWeek.get(`${t}|${w}`)
    if (p?.length) return p
  }
  return []
}

const DEF_COLS = [
  ['solo_tackle_1_player_id', 1], ['solo_tackle_2_player_id', 1], ['assist_tackle_1_player_id', 0.5], ['assist_tackle_2_player_id', 0.5],
  ['assist_tackle_3_player_id', 0.5], ['assist_tackle_4_player_id', 0.5], ['tackle_with_assist_1_player_id', 0.5], ['tackle_with_assist_2_player_id', 0.5],
  ['sack_player_id', 3], ['half_sack_1_player_id', 1.5], ['half_sack_2_player_id', 1.5], ['qb_hit_1_player_id', 1.5], ['qb_hit_2_player_id', 1.5],
  ['tackle_for_loss_1_player_id', 1], ['pass_defense_1_player_id', 2], ['pass_defense_2_player_id', 2], ['interception_player_id', 3],
]

function bump(map, id, k, v = 1) {
  if (!id || id === 'NA') return
  if (!map.has(id)) map.set(id, { pass: 0, tgt: 0, rush: 0, def: 0, drive: 0 })
  map.get(id)[k] += v
}

/** Pick the 11 on each side. usage: id -> counts; resolve: id -> roster entry; fill: active pool. */
function lineup(usage, resolve, fillOff, fillDef, drivePasser) {
  const used = new Set()
  const ranked = (group, key, from = usage) =>
    [...from.entries()]
      .map(([id, u]) => [resolve(id), u])
      .filter(([e, u]) => e && e.group === group && u[key] > 0 && !used.has(e.id))
      .sort((a, b) => b[1][key] - a[1][key])
      .map(([e]) => e)
  const take = (list, n, group, fill) => {
    const out = list.slice(0, n)
    for (const e of fill.filter((f) => f.group === group).sort((a, b) => b.exp - a.exp || a.n - b.n)) {
      if (out.length >= n) break
      if (!used.has(e.id) && !out.some((o) => o.id === e.id)) out.push(e)
    }
    out.forEach((e) => used.add(e.id))
    return out
  }
  const qbs = drivePasser && resolve(drivePasser)?.group === 'QB' ? [resolve(drivePasser)] : ranked('QB', 'pass')
  const [qb] = take(qbs, 1, 'QB', fillOff)
  const [rb] = take(ranked('RB', 'rush'), 1, 'RB', fillOff)
  const [te] = take(ranked('TE', 'tgt'), 1, 'TE', fillOff)
  const [x, z, slot] = take(ranked('WR', 'tgt'), 3, 'WR', fillOff)
  // linemen: the center first (the sim snaps from player #1), then the others
  const ol = fillOff.filter((e) => e.group === 'OL').sort((a, b) => (b.pos === 'C') - (a.pos === 'C') || b.exp - a.exp || a.n - b.n)
  const line = take(ol, 5, 'OL', [])
  const dl = take(ranked('DL', 'def'), 4, 'DL', fillDef)
  const lb = take(ranked('LB', 'def'), 3, 'LB', fillDef)
  const cb = take(ranked('CB', 'def'), 2, 'CB', fillDef)
  const s = take(ranked('S', 'def'), 2, 'S', fillDef)
  const fs = s.find((e) => e.pos === 'FS') ?? s[1]
  const ss = s.find((e) => e !== fs) ?? s[0]
  const p = (e) => (e ? [e.n, e.name] : null)
  return {
    off: [qb, rb, te, x, z, slot, ...line].map(p),
    def: [...dl, lb[0], lb[1], lb[2], cb[0], cb[1], ss, fs].map(p),
  }
}

// moments grouped by season and game
const want = new Map()
for (const m of moments) {
  if (!want.has(m.season)) want.set(m.season, new Map())
  const g = want.get(m.season)
  if (!g.has(m.id)) g.set(m.id, [])
  g.get(m.id).push(m)
}
const seasons = [...new Set([...want.keys(), LAST])].sort()

const out = { source: 'nflverse play-by-play and weekly rosters (CC BY 4.0)', season: LAST, slots: { off: ['qb', 'rb', 'te', 'x', 'z', 'slot', 'C', 'OL1', 'OL2', 'OL3', 'OL4'], def: ['DL0', 'DL1', 'DL2', 'DL3', 'MLB', 'SLB', 'WLB', 'CBX', 'CBZ', 'SS', 'FS'] }, moments: {}, teams: {} }
let missing = 0

for (const season of seasons) {
  const file = `${cacheDir}/pbp_${season}.csv.gz`
  if (!existsSync(file)) {
    console.log(`  ${season}: no pbp file, skipping`)
    continue
  }
  const roster = await loadRoster(season)
  const games = want.get(season) ?? new Map()
  const gameUse = new Map() // `${game}|${team}` -> usage
  const driveOf = new Map() // `${game}|${team}|${secs}` -> fixed_drive
  const drivePass = new Map() // `${game}|${team}|${drive}` -> usage of passers
  const seasonUse = new Map() // team -> usage (latest season only)
  let maxWeek = 0
  const parser = createReadStream(file).pipe(createGunzip()).pipe(parse({ columns: true, relax_quotes: true, skip_records_with_error: true }))
  for await (const r of parser) {
    if (r.season_type === 'PRE' || !r.posteam) continue
    const isWanted = games.has(r.game_id)
    const isLatest = season === LAST
    if (!isWanted && !isLatest) continue
    const off = team(r.posteam)
    const def = team(r.defteam)
    maxWeek = Math.max(maxWeek, num(r.week) ?? 0)
    const targets = []
    if (isWanted) {
      if (!gameUse.has(`${r.game_id}|${off}`)) gameUse.set(`${r.game_id}|${off}`, new Map())
      if (!gameUse.has(`${r.game_id}|${def}`)) gameUse.set(`${r.game_id}|${def}`, new Map())
      targets.push([gameUse.get(`${r.game_id}|${off}`), gameUse.get(`${r.game_id}|${def}`)])
      const k = `${r.game_id}|${off}|${num(r.game_seconds_remaining)}`
      if (!driveOf.has(k)) driveOf.set(k, r.fixed_drive)
      if (r.passer_player_id && r.passer_player_id !== 'NA') {
        const dk = `${r.game_id}|${off}|${r.fixed_drive}`
        if (!drivePass.has(dk)) drivePass.set(dk, new Map())
        bump(drivePass.get(dk), r.passer_player_id, 'pass')
      }
    }
    if (isLatest) {
      if (!seasonUse.has(off)) seasonUse.set(off, new Map())
      if (!seasonUse.has(def)) seasonUse.set(def, new Map())
      targets.push([seasonUse.get(off), seasonUse.get(def)])
    }
    for (const [o, d] of targets) {
      bump(o, r.passer_player_id, 'pass')
      bump(o, r.receiver_player_id, 'tgt')
      bump(o, r.rusher_player_id, 'rush')
      for (const [c, w] of DEF_COLS) bump(d, r[c], 'def', w)
    }
  }

  for (const [gid, ms] of games) {
    for (const m of ms) {
      const resolve = (id) => asOf(roster, id, m.week)
      const drive = driveOf.get(`${gid}|${m.off}|${m.clock}`)
      const passers = drivePass.get(`${gid}|${m.off}|${drive}`)
      const drivePasser = passers ? [...passers.entries()].sort((a, b) => b[1].pass - a[1].pass)[0][0] : null
      // offense usage from the offense's map, defense usage from the defense's map
      const use = new Map([...(gameUse.get(`${gid}|${m.off}`) ?? new Map())])
      const resolveOff = (id) => {
        const e = resolve(id)
        return e && ['QB', 'RB', 'TE', 'WR', 'OL'].includes(e.group) ? e : null
      }
      const offPart = lineup(use, resolveOff, pool(roster, m.off, m.week), [], drivePasser)
      const defUse = gameUse.get(`${gid}|${m.def}`) ?? new Map()
      const resolveDef = (id) => {
        const e = resolve(id)
        return e && ['DL', 'LB', 'CB', 'S'].includes(e.group) ? e : null
      }
      const defPart = lineup(defUse, resolveDef, [], pool(roster, m.def, m.week), null)
      const entry = { off: offPart.off, def: defPart.def }
      missing += [...entry.off, ...entry.def].filter((x) => !x).length
      out.moments[`${m.id}|${m.off}|${m.clock}`] = entry
    }
  }

  if (season === LAST) {
    for (const [t, use] of seasonUse) {
      // only players still on the team in the latest roster week
      const latest = pool(roster, t, maxWeek)
      const onTeam = new Set(latest.map((e) => e.id))
      const resolve = (id) => (onTeam.has(id) ? asOf(roster, id, maxWeek) : null)
      const l = lineup(use, resolve, latest, latest, null)
      out.teams[t] = l
      missing += [...l.off, ...l.def].filter((x) => !x).length
    }
  }
  console.log(`  ${season}: ${games.size} moment games${season === LAST ? `, ${seasonUse.size} current teams (through week ${maxWeek})` : ''}`)
}

writeFileSync('src/data/players.json', JSON.stringify(out))
console.log(`\n${Object.keys(out.moments).length} moment lineups, ${Object.keys(out.teams).length} team lineups, ${missing} empty slots`)
