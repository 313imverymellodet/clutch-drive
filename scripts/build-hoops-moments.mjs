// Builds the real-moment Daily for Clutch Hoops and its win-probability model from NBA play-by-play.
//
//   node scripts/build-hoops-moments.mjs <cacheDir> [firstSeason=2022] [lastSeason=2026]
//
// Data: sportsdataverse hoopR NBA play-by-play (ESPN-sourced), from the sportsdataverse-data `espn_nba_pbp`
// release that hoopR's load_nba_pbp() reads (https://github.com/sportsdataverse/hoopR-nba-data). A season is
// named by the year it ends (2026 = 2025-26). ESPN's own per-play home win probability comes from ESPN's
// public game summary API and is only used to compare against and to show on the end card.
// Only team- and situation-level columns are read: no player names or play descriptions.
// Writes src/data/hoopsMoments.json and src/data/hoopsWpModel.json.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { parse } from 'csv-parse'

const [cacheDir, firstArg = '2022', lastArg = '2026'] = process.argv.slice(2)
if (!cacheDir) {
  console.error('usage: node scripts/build-hoops-moments.mjs <cacheDir> [firstSeason] [lastSeason]')
  process.exit(1)
}
mkdirSync(`${cacheDir}/espn-wp`, { recursive: true })
const SEASONS = []
for (let y = +firstArg; y <= +lastArg; y++) SEASONS.push(y)

// ESPN abbreviations -> src/hoops/teams.js
const TEAM = { GS: 'GSW', NY: 'NYK', NO: 'NOP', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' }
const NBA = new Set('ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split(' '))
const team = (t) => TEAM[t] ?? t

async function download(season) {
  const file = `${cacheDir}/nba_pbp_${season}.csv`
  if (existsSync(file)) return file
  const url = `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_pbp/play_by_play_${season}.csv`
  const res = await fetch(url)
  if (!res.ok) {
    console.log(`  ${season}: not available (${res.status})`)
    return null
  }
  await pipeline(res.body, createWriteStream(`${file}.part`))
  renameSync(`${file}.part`, file)
  return file
}

const num = (v) => (v === '' || v === 'NA' || v == null ? null : Number(v))

// ------------------------------------------------------------------ possession from event types
const isTurnover = (t) => /Turnover|^Traveling$|^Offensive Charge$/.test(t) && t !== 'No Turnover'
const ftOf = (t) => {
  const m = /^Free Throw - (?:Flagrant |Clear Path )?(\d) of (\d)$/.exec(t)
  return m ? { i: +m[1], n: +m[2] } : null
}

/** Who has the ball after each event (team id or null), from team_id + event type only. */
function possessionAfter(e, before, other) {
  const t = e.type
  const T = e.team
  if (!T) return before
  if (t === 'Defensive Rebound' || t === 'Offensive Rebound') return T
  if (isTurnover(t)) return other(T)
  if (t.startsWith('Free Throw')) {
    const ft = ftOf(t)
    if (!ft) return before // technical: no change
    if (ft.i < ft.n) return T
    return e.scoring ? other(T) : T // a missed last free throw is a live ball (the rebound decides)
  }
  if (e.shooting) return e.scoring ? other(T) : T
  return before
}

const timeoutsLeft = (used, usedQ4, usedLate) => Math.max(0, Math.min(7 - used, 4 - usedQ4, 2 - usedLate))

// ------------------------------------------------------------------ read play-by-play
const games = [] // { id, season, post, date, home, away, homeId, awayId, final:[h,a], groups:[...] }
for (const season of SEASONS) {
  const file = await download(season)
  if (!file) continue
  const byGame = new Map()
  const parser = createReadStream(file).pipe(parse({ columns: true, relax_quotes: true, skip_records_with_error: true }))
  for await (const r of parser) {
    if (r.season_type !== '2' && r.season_type !== '3') continue
    let g = byGame.get(r.game_id)
    if (!g) {
      byGame.set(r.game_id, (g = { id: r.game_id, season, post: r.season_type === '3', date: r.game_date, home: team(r.home_team_abbrev), away: team(r.away_team_abbrev), homeId: r.home_team_id, awayId: r.away_team_id, last: -1, final: null, plays: [] }))
    }
    const n = num(r.game_play_number) ?? num(r.sequence_number)
    const hs = num(r.home_score)
    const as = num(r.away_score)
    if (n > g.last && hs != null && as != null) (g.last = n), (g.final = [hs, as])
    const qtr = num(r.qtr)
    const isTimeout = /timeout/i.test(r.type_text) && !/official/i.test(r.type_text)
    if (qtr < 4 && !isTimeout) continue
    g.plays.push({
      n,
      seq: r.sequence_number,
      qtr,
      secs: num(r.end_game_seconds_remaining),
      type: r.type_text.replace(/\s+/g, ' ').trim(),
      team: r.team_id || null,
      scoring: r.scoring_play === 'true' || r.scoring_play === 'TRUE',
      shooting: r.shooting_play === 'true' || r.shooting_play === 'TRUE',
      value: num(r.score_value) ?? 0,
      hs,
      as,
      timeout: isTimeout,
    })
  }
  let kept = 0
  for (const g of byGame.values()) {
    if (!NBA.has(g.home) || !NBA.has(g.away) || !g.final || g.final[0] === g.final[1]) continue
    g.plays.sort((a, b) => a.n - b.n)
    g.groups = buildGroups(g)
    delete g.plays
    games.push(g)
    kept++
  }
  console.log(`  ${season}: ${kept} games`)
}

/**
 * Walk a game and collapse events that share a clock reading (a make + and-one, a foul + free throws,
 * a timeout) into one state: score, clock, who has the ball and timeouts left, after everything at that time.
 */
function buildGroups(g) {
  const other = (id) => (id === g.homeId ? g.awayId : g.homeId)
  const used = { [g.homeId]: [0, 0, 0], [g.awayId]: [0, 0, 0] } // game, 4th quarter, after 3:00 of the 4th
  let poss = null
  let hs = 0
  let as = 0
  const groups = []
  let cur = null
  for (const e of g.plays) {
    if (e.timeout) {
      const u = used[e.team]
      if (u) {
        u[0]++
        if (e.qtr === 4) u[1]++
        if (e.qtr === 4 && e.secs != null && e.secs < 180) u[2]++
      }
    }
    if (e.qtr < 4) continue
    if (e.hs != null) (hs = e.hs), (as = e.as)
    poss = possessionAfter(e, poss, other)
    if (e.qtr !== 4 || e.secs == null) continue
    if (!cur || cur.secs !== e.secs) groups.push((cur = { secs: e.secs, events: [] }))
    cur.events.push(e)
    cur.seq = e.seq
    cur.hs = hs
    cur.as = as
    cur.poss = poss === g.homeId ? 'home' : poss === g.awayId ? 'away' : null
    const late = (id) => (e.secs < 180 ? used[id][2] : 0)
    cur.homeTO = timeoutsLeft(used[g.homeId][0], used[g.homeId][1], late(g.homeId))
    cur.awayTO = timeoutsLeft(used[g.awayId][0], used[g.awayId][1], late(g.awayId))
  }
  return groups
}

// ------------------------------------------------------------------ ESPN win probability (cached per game)
async function espnWp(gameId) {
  const file = `${cacheDir}/espn-wp/${gameId}.json`
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`)
      if (!res.ok) throw new Error(res.status)
      const j = await res.json()
      const out = {}
      for (const w of j.winprobability ?? []) out[w.playId.slice(String(gameId).length)] = w.homeWinPercentage
      writeFileSync(file, JSON.stringify(out))
      return out
    } catch {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  return {}
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const k = i++
      out[k] = await fn(items[k])
    }
  }))
  return out
}

// ------------------------------------------------------------------ real endings
const OUTCOME_ORDER = ['three', 'two', 'ft', 'miss', 'turnover', 'time']
function possessionResult(g, groups, start, side) {
  const s0 = side === 'home' ? groups[start].hs : groups[start].as
  let j = start + 1
  while (j < groups.length && groups[j].poss !== (side === 'home' ? 'away' : 'home')) j++
  const span = groups.slice(start + 1, Math.min(groups.length, j + 1))
  const endScore = side === 'home' ? (groups[Math.min(j, groups.length - 1)]?.hs ?? s0) : (groups[Math.min(j, groups.length - 1)]?.as ?? s0)
  const myId = side === 'home' ? g.homeId : g.awayId
  const evs = span.flatMap((x) => x.events).filter((e) => e.team === myId)
  const fg = evs.find((e) => e.scoring && e.shooting && !e.type.startsWith('Free Throw'))
  const points = endScore - s0
  let how
  if (fg) how = fg.value === 3 ? 'three' : 'two'
  else if (points > 0) how = 'ft'
  else if (j >= groups.length) how = 'time'
  else if (evs.some((e) => isTurnover(e.type))) how = 'turnover'
  else how = 'miss'
  return { how, points }
}

const moments = []
for (const g of games) {
  const gr = g.groups
  for (let i = 1; i < gr.length; i++) {
    const s = gr[i]
    if (!s.poss || s.poss === gr[i - 1].poss || s.secs < 25 || s.secs > 90) continue
    const off = s.poss
    const diff = off === 'home' ? s.hs - s.as : s.as - s.hs
    if (diff < -5 || diff > -1) continue
    const res = possessionResult(g, gr, i, off)
    const offHome = off === 'home'
    moments.push({
      id: g.id,
      season: g.season,
      post: g.post,
      date: g.date,
      home: g.home,
      off: offHome ? g.home : g.away,
      def: offHome ? g.away : g.home,
      scoreOff: offHome ? s.hs : s.as,
      scoreDef: offHome ? s.as : s.hs,
      clock: +s.secs.toFixed(1),
      timeouts: offHome ? s.homeTO : s.awayTO,
      defTimeouts: offHome ? s.awayTO : s.homeTO,
      seq: s.seq,
      result: res.how,
      points: res.points,
      won: (offHome ? g.final[0] > g.final[1] : g.final[1] > g.final[0]) ? 1 : 0,
      final: offHome ? g.final : [g.final[1], g.final[0]],
    })
    break // one moment per game: the first time the trailing team has it in the window
  }
}
console.log(`\n${moments.length} real endings in ${games.length} games; fetching ESPN win probability for them…`)
await mapLimit(moments, 8, async (m) => {
  const wp = await espnWp(m.id)
  const home = wp[m.seq]
  m.wp = home == null ? null : +(m.off === m.home ? home : 1 - home).toFixed(3)
})
for (const m of moments) delete m.seq

// ------------------------------------------------------------------ win-probability model (logistic regression)
// Rows: every clock reading in the last 6:00 of the 4th, from the home team's point of view.
// Every feature flips sign when you swap sides (home = +1 for the home team, -1 for the road team),
// so p(you) + p(them) = 1.
export function features([secs, diff, poss, to, oto, home = 1]) {
  const m = secs / 60
  const s = Math.sqrt(m + 0.05)
  return [diff / s, diff, poss / s, poss, (to - oto), (to - oto) / s, (diff * diff * diff) / (s * s * s * 100), home, diff / (s * s), poss / (s * s)]
}
const NAMES = ['diff_per_root_min', 'diff', 'poss_per_root_min', 'poss', 'timeout_edge', 'timeout_edge_per_root_min', 'diff_cubed_scaled', 'home', 'diff_per_min', 'poss_per_min']

const rows = [] // { x: [secs, diff, poss, to, oto], y, game, seq }
games.forEach((g, gi) => {
  const y = g.final[0] > g.final[1] ? 1 : 0
  for (const s of g.groups) {
    const diff = s.hs - s.as
    if (s.secs > 360 || s.secs <= 0 || Math.abs(diff) > 15 || !s.poss) continue
    rows.push({ x: [s.secs, diff, s.poss === 'home' ? 1 : -1, s.homeTO, s.awayTO], y, gi, seq: s.seq })
  }
})

function fitLogistic(X, yv, l2 = 1e-3, iters = 30) {
  const k = X[0].length
  let w = new Array(k).fill(0)
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0)
    const H = Array.from({ length: k }, () => new Array(k).fill(0))
    for (let i = 0; i < X.length; i++) {
      const x = X[i]
      let z = 0
      for (let j = 0; j < k; j++) z += w[j] * x[j]
      const p = 1 / (1 + Math.exp(-z))
      const e = p - yv[i]
      const s = p * (1 - p)
      for (let a = 0; a < k; a++) {
        g[a] += e * x[a]
        const sa = s * x[a]
        for (let b = a; b < k; b++) H[a][b] += sa * x[b]
      }
    }
    for (let a = 0; a < k; a++) {
      g[a] += l2 * w[a]
      H[a][a] += l2
      for (let b = 0; b < a; b++) H[a][b] = H[b][a]
    }
    const step = solve(H, g)
    let maxStep = 0
    for (let j = 0; j < k; j++) {
      w[j] -= step[j]
      maxStep = Math.max(maxStep, Math.abs(step[j]))
    }
    if (maxStep < 1e-7) break
  }
  return w
}

function solve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    const d = M[c][c] || 1e-12
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / d
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12))
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const predict = (w, x) => sigmoid(w.reduce((s, wj, j) => s + wj * x[j], 0))

// hold out every 5th game for validation
const train = rows.filter((r) => r.gi % 5 !== 0)
const test = rows.filter((r) => r.gi % 5 === 0)
const w = fitLogistic(train.map((r) => features(r.x)), train.map((r) => r.y))
const logloss = (rs, f) => -rs.reduce((s, r) => {
  const p = Math.min(1 - 1e-6, Math.max(1e-6, f(r)))
  return s + (r.y ? Math.log(p) : Math.log(1 - p))
}, 0) / rs.length
const base = test.reduce((s, r) => s + r.y, 0) / test.length
console.log(`\nWP model: ${train.length} train / ${test.length} test rows (last 6:00 of the 4th); home win rate ${(100 * base).toFixed(1)}%`)

// ESPN's own numbers on a sample of held-out games (one summary request per game, cached)
const testGames = [...new Set(test.map((r) => r.gi))].filter((_, i) => i % 2 === 0)
const espn = new Map()
await mapLimit(testGames, 8, async (gi) => espn.set(gi, await espnWp(games[gi].id)))
const both = test.filter((r) => espn.get(r.gi)?.[r.seq] != null)
const ours = (r) => predict(w, features(r.x))
const theirs = (r) => espn.get(r.gi)[r.seq]
const report = {
  testRows: test.length,
  ours: +logloss(test, ours).toFixed(4),
  constant: +logloss(test, () => base).toFixed(4),
  espnRows: both.length,
  espnGames: testGames.length,
  oursOnEspnRows: +logloss(both, ours).toFixed(4),
  espn: +logloss(both, theirs).toFixed(4),
}
// the hard part: one-possession games in the last 1:30
const close = both.filter((r) => r.x[0] <= 90 && Math.abs(r.x[1]) <= 5)
report.closeRows = close.length
report.oursClose = +logloss(close, ours).toFixed(4)
report.espnClose = +logloss(close, theirs).toFixed(4)
console.log(`  log loss  ours ${report.ours}  constant ${report.constant}`)
console.log(`  on ${both.length} rows from ${testGames.length} held-out games with ESPN numbers: ours ${report.oursOnEspnRows}  ESPN ${report.espn}`)
console.log(`  one-possession games, last 1:30 (${close.length} rows): ours ${report.oursClose}  ESPN ${report.espnClose}`)
function calibration(rs, f) {
  const buckets = Array.from({ length: 10 }, () => ({ n: 0, pred: 0, actual: 0 }))
  for (const r of rs) {
    const p = f(r)
    const b = buckets[Math.min(9, Math.floor(p * 10))]
    b.n++
    b.pred += p
    b.actual += r.y
  }
  return buckets.filter((b) => b.n > 30).map((b) => `${Math.round((100 * b.pred) / b.n)}%->${Math.round((100 * b.actual) / b.n)}%`).join('  ')
}
console.log('  calibration, ours (predicted -> actual):', calibration(test, ours))
console.log('  same rows as ESPN, ours:', calibration(both, ours))
console.log('  same rows as ESPN, ESPN:', calibration(both, theirs))

// ------------------------------------------------------------------ write outputs
mkdirSync('src/data', { recursive: true })
writeFileSync(
  'src/data/hoopsWpModel.json',
  JSON.stringify({ source: 'sportsdataverse hoopR NBA play-by-play (ESPN)', seasons: [SEASONS[0], SEASONS.at(-1)], rows: rows.length, logLoss: report, names: NAMES, w: w.map((x) => +x.toFixed(6)) }, null, 1),
)
moments.sort((a, b) => (a.date < b.date ? -1 : 1))
writeFileSync('src/data/hoopsMoments.json', JSON.stringify({ source: 'sportsdataverse hoopR NBA play-by-play (ESPN)', count: moments.length, moments }))
const results = {}
for (const m of moments) results[m.result] = (results[m.result] ?? 0) + 1
const withWp = moments.filter((m) => m.wp != null)
const gap = withWp.reduce((s, m) => s + Math.abs(m.wp - predict(w, features([m.clock, m.scoreOff - m.scoreDef, 1, m.timeouts, m.defTimeouts, m.off === m.home ? 1 : -1]))), 0) / withWp.length
console.log(`\n${moments.length} real endings (${withWp.length} with ESPN win probability). How the possession ended:`, JSON.stringify(Object.fromEntries(OUTCOME_ORDER.map((k) => [k, results[k] ?? 0]))))
console.log(`trailing teams won ${moments.filter((m) => m.won === 1).length} of them; our model is within ${(100 * gap).toFixed(1)} points of ESPN at the moment starts on average`)
