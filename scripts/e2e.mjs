// Plays a full drive in headless Chrome by clicking the real UI, saving a screenshot per step.
// Usage: npm run dev (other terminal), then  node scripts/e2e.mjs [outDir] [width] [height] [mode] [calls]
//   calls: comma list of play labels to cycle, e.g. "Dig,Quick Out,Deep Shot"
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const [outDir = 'captures/e2e', w = '1100', h = '720', mode = 'daily', calls = 'Dig,Quick Out,Dig,Deep Shot,HB Dive'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage()
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1, isMobile: +w < 600, hasTouch: +w < 600 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let n = 0
const shot = async (name) => page.screenshot({ path: `${outDir}/${String(n++).padStart(2, '0')}-${name}.png` })
const click = async (text) => {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button, a')].find((b) => b.textContent.replace(/\s+/g, ' ').trim().includes(t) && !b.disabled)
    el?.click()
    return !!el
  }, text)
  if (!ok) throw new Error(`no button "${text}"`)
}

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
await sleep(1500)
await shot('landing')
await page.evaluate(() => window.scrollTo(0, 900))
await sleep(400)
await shot('landing-scrolled')

await page.goto(`http://localhost:5173/play?mode=${mode}`, { waitUntil: 'networkidle0' })
await page.waitForFunction(() => typeof window.__advance === 'function', { timeout: 20000 })
await sleep(800)
await shot('intro')
await click('Take the field')
await sleep(1200)
await shot('call')

const list = calls.split(',')
for (let i = 0; i < 14; i++) {
  const over = await page.evaluate(() => !!document.querySelector('.modal'))
  if (over) break
  const call = list[i % list.length]
  await click(call)
  await sleep(100)
  // run the play to the whistle at sim speed, let React catch up, then to the end
  await page.evaluate(() => { let g = 0; while (window.__sim.phase === 'live' && g++ < 900) window.__advance(1 / 60) })
  await sleep(300)
  await shot(`play${i + 1}-${call.replace(/\s/g, '')}-whistle`)
  await page.evaluate(() => { let g = 0; while (window.__sim.phase !== 'over' && g++ < 300) window.__advance(1 / 60) })
  await sleep(300)
  const state = await page.evaluate(() => ({ msg: window.__sim.message, bug: document.querySelector('.bug')?.innerText.replace(/\s+/g, ' ') }))
  console.log(`play ${i + 1} ${call}:`, state.msg, '|', state.bug)
  if (i === 0) await shot('after-first-play')
  const next = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Next play|See result/.test(b.textContent))?.textContent)
  if (!next) break
  await click(next.includes('See') ? 'See result' : 'Next play')
  await sleep(i === 0 ? 2500 : 600) // first time: let the clock run so we can see the hurry-up state
  if (i === 0) await shot('hurry-up')
}
await sleep(600)
await shot('game-over')
console.log('modal:', await page.evaluate(() => document.querySelector('.modal')?.innerText.replace(/\n+/g, ' | ')))
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors')
await browser.close()
