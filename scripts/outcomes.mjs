// Balance table: every playbook play against every defensive coverage, many seeds (sim only).
// Usage: npm run dev (other terminal), then  node scripts/outcomes.mjs [seeds=24] [--write]
//   --write saves src/sim/counters.json (what stops each concept family + the play x coverage matrix),
//   which the AI coordinators use. 'Win' = first down, touchdown, or 5+ yards.
import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const seeds = +(args.find((a) => /^\d+$/.test(a)) ?? 24)
const write = args.includes('--write')
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto('http://localhost:5173/play?mode=practice', { waitUntil: 'networkidle0' })
await page.waitForFunction(() => typeof window.__sim === 'object', { timeout: 20000 })
const data = await page.evaluate(async (seeds) => {
  const { PLAYS, COVERAGE_IDS } = await import('/src/sim/playSim.js')
  const s = window.__sim
  const matrix = {}
  for (const play of Object.keys(PLAYS)) {
    matrix[play] = {}
    for (const cov of COVERAGE_IDS) {
      const r = { n: 0, win: 0, yds: 0, inc: 0, int: 0, sack: 0, td: 0, scr: 0 }
      for (let seed = 1; seed <= seeds; seed++) {
        s.reset({ play, seed, los: -25, toGo: 10, coverage: { call: cov, shown: cov }, situation: { clock: 90 } })
        s.snap()
        let g = 0
        while (s.phase === 'live' && g++ < 1500) s.step(1 / 60)
        const x = s.result ?? { kind: 'timeout', gain: 0 }
        const gain = x.kind === 'incomplete' || x.kind === 'interception' ? 0 : x.gain
        r.n++
        r.yds += gain
        if (gain >= 5 || x.first || x.kind === 'touchdown') r.win++
        if (x.kind === 'incomplete') r.inc++
        if (x.kind === 'interception') r.int++
        if (x.kind === 'sack') r.sack++
        if (x.kind === 'touchdown') r.td++
        if (x.how === 'scramble') r.scr++
      }
      matrix[play][cov] = { win: +(r.win / r.n).toFixed(3), yds: +(r.yds / r.n).toFixed(2), inc: r.inc / r.n, int: r.int / r.n, sack: r.sack / r.n, td: r.td / r.n, scr: r.scr / r.n }
    }
  }
  const families = {}
  for (const [play, row] of Object.entries(matrix)) (families[PLAYS[play].family] ??= []).push(row)
  const counters = {}
  for (const [fam, rows] of Object.entries(families)) {
    const stop = {}
    for (const cov of COVERAGE_IDS) stop[cov] = 1 - rows.reduce((a, r) => a + r[cov].win, 0) / rows.length
    const vals = Object.values(stop)
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    counters[fam] = Object.fromEntries(Object.entries(stop).map(([c, v]) => [c, +(((v - lo) / (hi - lo || 1)) ** 2).toFixed(2)]).filter(([, v]) => v > 0.15))
  }
  return { matrix, counters, families: Object.fromEntries(Object.entries(PLAYS).map(([k, p]) => [k, p.family])), covs: COVERAGE_IDS }
}, seeds)

const pct = (x) => `${Math.round(x * 100)}`.padStart(3)
console.log(`win% (yds) per play vs coverage, ${seeds} seeds each`)
console.log('play'.padEnd(10) + data.covs.map((c) => c.padStart(12)).join(''))
for (const [play, row] of Object.entries(data.matrix)) {
  console.log(play.padEnd(10) + data.covs.map((c) => `${pct(row[c].win)}% ${row[c].yds.toFixed(1).padStart(5)}`.padStart(12)).join(''))
}
const tot = { int: 0, sack: 0, scr: 0, n: 0 }
for (const row of Object.values(data.matrix)) for (const c of data.covs) (tot.int += row[c].int), (tot.sack += row[c].sack), (tot.scr += row[c].scr), tot.n++
console.log(`\noverall: INT ${(100 * tot.int / tot.n).toFixed(1)}%  sack ${(100 * tot.sack / tot.n).toFixed(1)}%  scramble ${(100 * tot.scr / tot.n).toFixed(1)}%`)
console.log('\ncounters (what stops each family):', JSON.stringify(data.counters))
if (write) {
  writeFileSync('src/sim/counters.json', JSON.stringify({ generated: new Date().toISOString().slice(0, 10), seeds, counters: data.counters, matrix: data.matrix }, null, 1))
  console.log('wrote src/sim/counters.json')
}
await browser.close()
