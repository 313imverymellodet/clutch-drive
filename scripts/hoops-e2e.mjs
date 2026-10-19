// Plays a Clutch Hoops game in headless Chrome through the real UI, with a screenshot per step.
//   npm run dev (other terminal), then  node scripts/hoops-e2e.mjs [outDir] [width] [height] [mode=practice]
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const [outDir = 'captures/hoops', w = '1100', h = '720', mode = 'practice'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const BASE = process.env.BASE ?? 'http://localhost:5173'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
await page.setViewport({ width: +w, height: +h, isMobile: +w < 600, hasTouch: +w < 600 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let n = 0
const shot = (name) => page.screenshot({ path: `${outDir}/${String(n++).padStart(2, '0')}-${name}.png` })
const click = (t) => page.evaluate((t) => { const el = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t) && !b.disabled); el?.click(); return !!el }, t)
const press = (sel, text) => page.evaluate((sel, text) => { const el = [...document.querySelectorAll(sel)].find((b) => !text || b.textContent.includes(text)); if (!el || el.disabled) return false; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true }, sel, text)
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ') ?? '', sel)

await page.goto(`${BASE}/hoops?mode=${mode}`, { waitUntil: 'networkidle2' })
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Take the floor|Share/.test(b.textContent)), { timeout: 30000 })
await sleep(1500)
await shot('intro')
await click('Take the floor')
await sleep(1200)
const sets = ['pnr', 'floppy', 'hammer', 'iso', 'horns', 'spain', 'post']
const covs = ['man', 'switch', 'drop', 'hedge', 'zone']
for (let i = 0; i < 24; i++) {
  if (await page.evaluate(() => !!document.querySelector('.modal'))) break
  const stage = await page.evaluate(() => (document.querySelector('.set-cards') ? 'call' : document.querySelector('.covs') ? 'defcall' : document.querySelector('.ft-card') ? 'ft' : document.querySelector('.actions') ? 'result' : 'other'))
  if (stage === 'call') {
    if (i < 2) await shot(`call-${i}`)
    const idx = i % sets.length
    await page.evaluate((idx) => document.querySelectorAll('.set-card')[idx].click(), idx)
    await sleep(200)
    await click('Run ')
    await sleep(1600)
    // take over once: on the 2nd offensive trip, shoot it ourselves with the meter
    if (i % 4 === 2) {
      const pressed = await press('.lc-btn', 'Shoot')
      await sleep(560)
      await shot(`meter-${i}`)
      await press('.lc-btn.release')
      console.log(`  took the shot ourselves: ${pressed}`)
    } else if (i < 3) await shot(`live-${i}`)
  } else if (stage === 'defcall') {
    if (i < 3) await shot(`defcall-${i}`)
    await page.evaluate((c) => { const b = [...document.querySelectorAll('.cov')].find((x) => x.textContent.toLowerCase().includes(c)); b?.click() }, covs[i % covs.length])
    await click('Lock it in')
    if (i % 2 === 1) {
      // play defense: contest right as their shooter rises
      const rising = await page.waitForSelector('.lc-hint.alert', { timeout: 12000 }).then(() => true, () => false)
      if (rising) {
        await shot(`contest-${i}`)
        console.log(`  contested: ${await press('.lc-btn', 'Contest')}`)
      }
    } else {
      await sleep(1500)
      if (i < 3) await shot(`def-live-${i}`)
    }
  } else if (stage === 'ft') {
    await shot(`ft-${i}`)
    for (let k = 0; k < 3; k++) {
      if (!(await page.evaluate(() => !!document.querySelector('.ft-card')))) break
      await click('Shoot free throw')
      await sleep(1100)
    }
  } else if (stage === 'other') {
    await sleep(800)
    continue
  }
  // wait for the possession to finish
  await page.waitForFunction(() => document.querySelector('.actions') || document.querySelector('.modal') || document.querySelector('.ft-card'), { timeout: 40000 }).catch(() => {})
  await sleep(500)
  const bug = await text('.bug')
  const banner = await text('.banner')
  console.log(`${i} ${stage}: ${banner} | ${bug}`)
  if (i === 0) await shot('result-0')
  if (await page.evaluate(() => !!document.querySelector('.ft-card'))) continue
  if (!(await click('Next possession')) && !(await click('Overtime'))) await click('See result')
  await sleep(800)
}
await sleep(800)
await shot('game-over')
console.log('modal:', await text('.modal'))
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no page errors')
await browser.close()
