// Headless screenshots of the Characters viewer for each clip.
// Usage: node scripts/capture-viewer.mjs [outDir] [width] [height]
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const [outDir = 'captures/viewer', w = '900', h = '700'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage()
await page.setViewport({ width: +w, height: +h })
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
const click = (text) =>
  page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)?.click(), text)
await click('Characters')
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => document.querySelector('.toggle input').click())
for (const [clip, wait] of [['Run', 500], ['Throw', 420], ['Catch', 250], ['Dive', 900], ['Celebrate', 350], ['Stance', 400]]) {
  await click(clip)
  await new Promise((r) => setTimeout(r, wait))
  await page.screenshot({ path: `${outDir}/${clip}.png` })
}
await browser.close()
