// Renders the HTML design templates in marketing/templates to PNGs in marketing/out.
//   node marketing/tools/render-images.mjs [only=social|service]
import { launch } from './director.mjs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const only = process.argv[2]
const SIZES = { portrait: [1080, 1350], story: [1080, 1920], land: [1600, 900] }
const jobs = []
if (!only || only === 'social') {
  for (const game of ['hoops', 'football']) for (const size of Object.keys(SIZES)) jobs.push({ tpl: 'social.html', q: `game=${game}&size=${size}`, size: SIZES[size], out: `${game === 'hoops' ? 'clutch-hoops' : 'clutch-drive'}-${size}.png` })
}
if (!only || only === 'service') {
  for (const size of ['portrait', 'story']) jobs.push({ tpl: 'service.html', q: `size=${size}`, size: SIZES[size], out: `web-dev-services-${size}.png` })
}
const browser = await launch()
for (const j of jobs) {
  const page = await browser.newPage()
  await page.setViewport({ width: j.size[0], height: j.size[1], deviceScaleFactor: 1 })
  await page.goto(`${pathToFileURL(resolve('marketing/templates', j.tpl)).href}?${j.q}`, { waitUntil: 'load' })
  await page.evaluate(() => window.ready)
  await page.screenshot({ path: `marketing/out/${j.out}` })
  await page.close()
  console.log('wrote', j.out)
}
await browser.close()
