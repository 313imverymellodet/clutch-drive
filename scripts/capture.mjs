// Headless screenshots of a play at fixed sim times (uses the dev-only window.__advance hook).
// Usage: npm run dev (in another terminal), then
//   node scripts/capture.mjs [outDir] [width] [height] [cam=broadcast|close] [play=dig|deep|run] [seed=1]
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const [outDir = 'captures', w = '1000', h = '700', cam = 'broadcast', play = 'dig', seed = '1'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage()
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.error('pageerror', e.message))
page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()))
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
await page.waitForFunction(() => typeof window.__advance === 'function', { timeout: 20000 })

const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` })
await page.evaluate((cam) => {
  window.__sim.camMode = cam
  window.__advance(3, 1 / 60, 0)
}, cam)
await shot('0-presnap')

await page.evaluate(({ play, seed }) => {
  const s = window.__sim
  s.reset({ play, seed: +seed })
  s.snap()
}, { play, seed })

// fixed beats, then the end of the play
const beats = [0.7, 1.4, 2.1, 2.9, 3.7]
let i = 1
for (const at of beats) {
  const info = await page.evaluate((at) => {
    const s = window.__sim
    while (s.t < at && s.phase === 'live') window.__advance(1 / 60)
    window.__advance(0.5, 1 / 60, 0)
    return { t: +s.t.toFixed(2), phase: s.phase, msg: s.message }
  }, at)
  console.log(`${i}-t${at}`, JSON.stringify(info))
  await shot(`${i++}-t${at}`)
  if (info.phase !== 'live') break
}
const end = await page.evaluate(() => {
  const s = window.__sim
  let guard = 0
  while (s.phase !== 'over' && guard++ < 1200) window.__advance(1 / 60)
  window.__advance(0.6)
  return { t: +s.t.toFixed(2), phase: s.phase, msg: s.message, result: s.result }
})
console.log('end', JSON.stringify(end))
await shot('9-end')
await browser.close()
