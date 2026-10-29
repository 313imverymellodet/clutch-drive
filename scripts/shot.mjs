// Dev tool: one screenshot of a page, optionally from a fixed camera (window.__cam, dev builds only).
//   node scripts/shot.mjs <url> <out.png> ['{"pos":[x,y,z],"look":[x,y,z],"fov":50}' | -] [waitMs] [w] [h]
import puppeteer from 'puppeteer-core'
const [url, out, camJson, wait = '2500', w = '1280', h = '720'] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
await page.setViewport({ width: +w, height: +h })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(url, { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 2500))
if (camJson && camJson !== '-') await page.evaluate((c) => { window.__cam = JSON.parse(c) }, camJson)
await new Promise((r) => setTimeout(r, +wait))
await page.screenshot({ path: out })
console.log(errors.length ? errors.slice(0, 3).join('\n') : 'ok')
await browser.close()
