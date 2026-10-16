// Builds the real-moment Daily Drives and the win-probability model from nflverse play-by-play.
//
//   node scripts/build-moments.mjs <cacheDir> [firstSeason=2012] [lastSeason=2026]
//
// Data: nflverse play-by-play (https://github.com/nflverse/nflverse-data), licensed CC BY 4.0.
// Only team- and situation-level columns are read: no player names or play descriptions.
// Writes src/data/moments.json and src/data/wpModel.json.
import { createReadStream, existsSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { parse } from 'csv-parse'

const [cacheDir, firstArg = '2012', lastArg = '2026'] = process.argv.slice(2)
if (!cacheDir) {
  console.error('usage: node scripts/build-moments.mjs <cacheDir> [firstSeason] [lastSeason]')
  process.exit(1)
}
mkdirSync(cacheDir, { recursive: true })
const SEASONS = []
for (let y = +firstArg; y <= +lastArg; y++) SEASONS.push(y)

const COLS = [
  'game_id', 'season', 'week', 'season_type', 'game_date', 'home_team', 'away_team', 'posteam', 'defteam',
  'qtr', 'game_seconds_remaining', 'down', 'ydstogo', 'yardline_100', 'score_differential', 'posteam_score',
  'defteam_score', 'posteam_timeouts_remaining', 'defteam_timeouts_remaining', 'fixed_drive', 'fixed_drive_result',
  'play_type', 'wp', 'home_score', 'away_score',
]

// relocated franchises -> current abbreviations used by the game
const TEAM = { OAK: 'LV', SD: 'LAC', STL: 'LAR', LA: 'LAR', JAC: 'JAX', WSH: 'WAS' }
const team = (t) => TEAM[t] ?? t

async function download(season) {
  const file = `${cacheDir}/pbp_${season}.csv.gz`
  if (existsSync(file)) return file
  const url = `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`
  const res = await fetch(url)
  if (!res.ok) {
    console.log(`  ${season}: not available (${res.status})`)
    return null
  }
  await pipeline(res.body, createWriteStream(file))
  return file
}

const num = (v) => (v === '' || v === 'NA' || v == null ? null : Number(v))

const moments = []
const wpRows = [] // [features..., label, nflverseWp]
let games = 0

for (const season of SEASONS) {
  const file = await download(season)
  if (!file) continue
  const byGame = new Map()
  const parser = createReadStream(file).pipe(createGunzip()).pipe(parse({ columns: (h) => h, relax_quotes: true, skip_records_with_error: true }))
  for await (const r of parser) {
    if (r.season_type === 'PRE') continue
    const row = {}
    for (const c of COLS) row[c] = r[c]
    let g = byGame.get(row.game_id)
    if (!g) byGame.set(row.game_id, (g = []))
    g.push(row)
  }
  let seasonMoments = 0
  for (const [, plays] of byGame) {
    games++
    const last = plays[plays.length - 1]
    const homeFinal = num(last.home_score)
    const awayFinal = num(last.away_score)
    if (homeFinal == null || awayFinal == null) continue // game in progress
    const finalFor = (t) => (t === last.home_team ? homeFinal : awayFinal)
    const finalAgainst = (t) => (t === last.home_team ? awayFinal : homeFinal)
    const won = (t) => (finalFor(t) > finalAgainst(t) ? 1 : finalFor(t) < finalAgainst(t) ? 0 : 0.5)
    const seenDrive = new Set()
    for (const p of plays) {
      const qtr = num(p.qtr)
      const secs = num(p.game_seconds_remaining)
      const diff = num(p.score_differential)
      const yl = num(p.yardline_100)
      const down = num(p.down)
      const togo = num(p.ydstogo)
      const to = num(p.posteam_timeouts_remaining)
      const dto = num(p.defteam_timeouts_remaining)
      if (!p.posteam || qtr !== 4 || secs == null || diff == null || yl == null || down == null || togo == null || to == null) continue
      if (!['pass', 'run', 'qb_spike', 'qb_kneel'].includes(p.play_type)) continue
      const label = won(p.posteam)
      // win-probability training set: late 4th quarter, trailing by 3-8 (need more than a field goal or close to it)
      if (secs <= 330 && diff <= -3 && diff >= -8 && label !== 0.5) {
        wpRows.push([secs, yl, down, togo, to, dto ?? 3, diff, label, num(p.wp)])
      }
      // real moments: the first snap of a drive, trailing by 4-6 (a TD wins), 0:35-3:00 left, own 10-45 yard line
      const dkey = `${p.posteam}-${p.fixed_drive}`
      if (seenDrive.has(dkey)) continue
      seenDrive.add(dkey)
      if (down !== 1 || diff > -4 || diff < -6 || secs < 35 || secs > 180 || yl < 55 || yl > 90) continue
      const off = team(p.posteam)
      const def = team(p.defteam)
      moments.push({
        id: p.game_id,
        season: num(p.season),
        week: num(p.week),
        post: p.season_type === 'POST',
        date: p.game_date,
        home: team(p.home_team),
        off,
        def,
        scoreOff: num(p.posteam_score),
        scoreDef: num(p.defteam_score),
        clock: secs,
        ballOn: 100 - yl,
        timeouts: to,
        defTimeouts: dto ?? 3,
        wp: +(num(p.wp) ?? 0).toFixed(3),
        result: p.fixed_drive_result || 'Unknown',
        won: label,
        final: [finalFor(p.posteam), finalAgainst(p.posteam)],
      })
      seasonMoments++
    }
  }
  console.log(`  ${season}: ${byGame.size} games, ${seasonMoments} moments, ${wpRows.length} WP rows so far`)
}

// ------------------------------------------------------------------ win-probability model (logistic regression)
// Features describe a late-game "need to score" situation. Designed to evaluate cheaply in the browser.
export function features([secs, yl, down, togo, to, dto, diff]) {
  const m = secs / 60
  const y = yl / 100
  return [
    1,
    m,
    Math.sqrt(m),
    y,
    y * y,
    y * m,
    down === 2 ? 1 : 0,
    down === 3 ? 1 : 0,
    down === 4 ? 1 : 0,
    Math.log(Math.max(1, togo)),
    down === 4 ? Math.log(Math.max(1, togo)) : 0,
    to,
    to * (1 / (m + 0.25)),
    dto,
    diff,
    y < 0.1 ? 1 : 0, // goal-to-go territory
  ]
}
const NAMES = ['bias', 'min', 'sqrt_min', 'yds', 'yds2', 'yds_x_min', 'down2', 'down3', 'down4', 'log_togo', 'down4_log_togo', 'timeouts', 'timeouts_per_min', 'def_timeouts', 'score_diff', 'goal_to_go']

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

// hold out every 5th row for validation
const train = wpRows.filter((_, i) => i % 5 !== 0)
const test = wpRows.filter((_, i) => i % 5 === 0)
const w = fitLogistic(train.map(features), train.map((r) => r[7]))
const logloss = (rows, f) => -rows.reduce((s, r) => {
  const p = Math.min(1 - 1e-6, Math.max(1e-6, f(r)))
  return s + (r[7] ? Math.log(p) : Math.log(1 - p))
}, 0) / rows.length
const base = test.reduce((s, r) => s + r[7], 0) / test.length
console.log(`\nWP model: ${train.length} train / ${test.length} test rows; base win rate ${(100 * base).toFixed(1)}%`)
console.log(`  log loss  ours ${logloss(test, (r) => predict(w, features(r))).toFixed(4)}  nflverse wp ${logloss(test.filter((r) => r[8] != null), (r) => r[8]).toFixed(4)}  constant ${logloss(test, () => base).toFixed(4)}`)
// calibration by bucket
const buckets = Array.from({ length: 10 }, () => ({ n: 0, pred: 0, actual: 0 }))
for (const r of test) {
  const p = predict(w, features(r))
  const b = buckets[Math.min(9, Math.floor(p * 10))]
  b.n++
  b.pred += p
  b.actual += r[7]
}
console.log('  calibration (predicted -> actual):', buckets.filter((b) => b.n > 30).map((b) => `${Math.round((100 * b.pred) / b.n)}%->${Math.round((100 * b.actual) / b.n)}% (n=${b.n})`).join('  '))

// ------------------------------------------------------------------ write outputs
mkdirSync('src/data', { recursive: true })
writeFileSync(
  'src/data/wpModel.json',
  JSON.stringify({ source: 'nflverse play-by-play (CC BY 4.0)', seasons: [SEASONS[0], SEASONS.at(-1)], rows: wpRows.length, names: NAMES, w: w.map((x) => +x.toFixed(6)) }, null, 1),
)
moments.sort((a, b) => (a.date < b.date ? -1 : 1))
writeFileSync('src/data/moments.json', JSON.stringify({ source: 'nflverse play-by-play (CC BY 4.0)', count: moments.length, moments }))
const results = {}
for (const m of moments) results[m.result] = (results[m.result] ?? 0) + 1
console.log(`\n${moments.length} real moments from ${games} games. Real outcomes:`, JSON.stringify(results))
console.log(`teams won ${moments.filter((m) => m.won === 1).length} of them`)
