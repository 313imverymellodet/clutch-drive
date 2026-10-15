// Balance table: every play call against every defensive coverage, many seeds each (sim only, no rendering).
// Usage: npm run dev (other terminal), then  node scripts/outcomes.mjs [seeds=40] [ballOn=25]
// 'blitz*' = a disguised blitz (shows Cover 1, sends six), so the offense doesn't keep extra blockers in.
import puppeteer from 'puppeteer-core'

const seeds = +(process.argv[2] ?? 40)
const ballOn = +(process.argv[3] ?? 25)
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto('http://localhost:5173/play?mode=practice', { waitUntil: 'networkidle0' })
await page.waitForFunction(() => typeof window.__sim === 'object', { timeout: 20000 })
const table = await page.evaluate(
  ({ seeds, ballOn }) => {
    const s = window.__sim
    const plays = ['out', 'dig', 'deep', 'run']
    const covs = ['cover1', 'cover2', 'cover3', 'blitz', 'prevent', 'blitz*']
    const rows = []
    for (const play of plays) {
      for (const cov of covs) {
        const res = { yards: 0, comp: 0, inc: 0, int: 0, sack: 0, first: 0, td: 0, big: 0, n: 0, time: 0 }
        for (let seed = 1; seed <= seeds; seed++) {
          s.reset({ play, seed, los: ballOn - 50, toGo: 10, coverage: cov === 'blitz*' ? { call: 'blitz', shown: 'cover1' } : { call: cov, shown: cov }, situation: { clock: 90 } })
          s.snap()
          let g = 0
          while (s.phase === 'live' && g++ < 1200) s.step(1 / 60)
          const r = s.result ?? { kind: 'timeout', gain: 0 }
          res.n++
          res.time += r.elapsed ?? 0
          if (r.kind === 'incomplete') res.inc++
          else if (r.kind === 'interception') res.int++
          else if (r.kind === 'sack') (res.sack++, (res.yards += r.gain))
          else {
            res.comp++
            res.yards += r.gain
            if (r.first) res.first++
            if (r.kind === 'touchdown') res.td++
            if (r.gain >= 20) res.big++
          }
        }
        const pct = (k) => `${Math.round((100 * res[k]) / res.n)}%`.padStart(4)
        rows.push(
          `${play.padEnd(5)} ${cov.padEnd(8)} avg ${(res.yards / res.n).toFixed(1).padStart(5)}  done ${pct('comp')}  inc ${pct('inc')}  int ${pct('int')}  sack ${pct('sack')}  1st ${pct('first')}  20+ ${pct('big')}  td ${pct('td')}  ${(res.time / res.n).toFixed(1)}s`,
        )
      }
      rows.push('')
    }
    return rows.join('\n')
  },
  { seeds, ballOn },
)
console.log(table)
await browser.close()
