// Runs every play call across many seeds headlessly and prints the outcome spread (balance testing).
// Usage: npm run dev (in another terminal), then  node scripts/outcomes.mjs [seeds=25]
import puppeteer from 'puppeteer-core'

const seeds = +(process.argv[2] ?? 25)
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
await page.waitForFunction(() => typeof window.__advance === 'function', { timeout: 20000 })
const out = await page.evaluate((seeds) => {
  const s = window.__sim
  const res = {}
  for (const play of ['out', 'dig', 'deep', 'run']) {
    res[play] = []
    for (let seed = 1; seed <= seeds; seed++) {
      s.reset({ play, seed })
      s.snap()
      let guard = 0
      while (s.phase === 'live' && guard++ < 900) s.step(1 / 60) // sim only, no rendering
      const r = s.result ?? { kind: 'timeout' }
      res[play].push(r.kind === 'incomplete' ? 'INC' : r.kind === 'timeout' ? 'T/O' : `${r.kind === 'touchdown' ? 'TD' : r.gain}${r.kind === 'out' ? 'oob' : ''}`)
    }
  }
  return res
}, seeds)
for (const [play, r] of Object.entries(out)) console.log(play.padEnd(5), r.join(' '))
await browser.close()
