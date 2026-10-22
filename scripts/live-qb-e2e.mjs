// Exercises the live QB controls in headless Chrome against the dev server: tap-to-throw, pump fake,
// throw away, scramble + get down, juke / spin / sideline after the catch, spike, and that an instant
// replay re-runs the same taps.
//   npm run dev (other terminal), then  node scripts/live-qb-e2e.mjs [outDir] [width] [height]
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const [outDir = 'captures/live-qb', w = '1100', h = '720'] = process.argv.slice(2)
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
const fail = (msg) => {
  console.log('FAIL:', msg)
  failures++
}
let failures = 0

const click = async (text) => {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s+/g, ' ').includes(t) && !b.disabled)
    el?.click()
    return !!el
  }, text)
  if (!ok) throw new Error(`no button "${text}"`)
}
// the live controls listen for pointerdown (instant on touch), so press them the same way
const press = async (selector, text = null) =>
  page.evaluate(
    (s, t) => {
      const el = [...document.querySelectorAll(s)].find((b) => !t || b.textContent.includes(t))
      if (!el || el.disabled) return false
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      return true
    },
    selector,
    text,
  )
const advance = (s) => page.evaluate((s) => window.__advance(s), s)
const sim = (fn) => page.evaluate(fn)
const toWhistle = () => page.evaluate(() => { let g = 0; while (window.__sim.phase === 'live' && g++ < 900) window.__advance(1 / 60) })
const toOver = async () => {
  await page.evaluate(() => { let g = 0; while (window.__sim.phase !== 'over' && g++ < 300) window.__advance(1 / 60) })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Next play|See result/.test(b.textContent)) || document.querySelector('.modal'), { timeout: 20000 })
  await sleep(250)
}
const banner = () => page.evaluate(() => document.querySelector('.banner-sub')?.textContent ?? '')
const bug = () => page.evaluate(() => document.querySelector('.bug')?.innerText.replace(/\s+/g, ' '))
const pick = async (name) => {
  await page.evaluate(async (name) => {
    for (const tab of [null, ...document.querySelectorAll('.pb-tab')]) {
      tab?.click()
      await new Promise((r) => setTimeout(r, 60))
      const card = [...document.querySelectorAll('.pb-card')].find((b) => b.querySelector('strong')?.textContent.trim() === name)
      if (card) return card.click()
    }
  }, name)
  await sleep(200)
  await click('Snap it')
  await sleep(150)
}
const next = async () => {
  const label = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Next play|See result/.test(b.textContent))?.textContent)
  if (!label || label.includes('See')) return false
  await click('Next play')
  await sleep(400)
  return true
}

await page.goto(`${BASE}/play?mode=daily`, { waitUntil: 'networkidle0' })
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Take the field/.test(b.textContent)), { timeout: 30000 })
await click('Take the field')
await sleep(800)

// 1. tap-to-throw to the 2nd read, then juke after the catch
await pick('Levels')
await advance(0.3)
await sleep(250)
await shot('qb-controls')
const reads = await sim(() => window.__sim.controls()?.reads.map((r) => r.key))
if (!reads?.length) fail('no QB controls after the snap')
const want = reads?.[1]
await page.evaluate((k) => {
  const btn = [...document.querySelectorAll('.lc-read')][1]
  btn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  return k
}, want)
await advance(1 / 30)
const target1 = await sim(() => window.__sim.target?.key ?? window.__sim.wantThrow?.key)
if (target1 !== want) fail(`threw to ${target1}, wanted ${want}`)
// run until the catch (or not)
await page.evaluate(() => { let g = 0; while (window.__sim.phase === 'live' && !window.__sim.carrier && g++ < 300) window.__advance(1 / 60) })
const caught = await sim(() => !!window.__sim.carrier && window.__sim.phase === 'live')
if (caught) {
  await advance(0.2)
  await sleep(250)
  await shot('run-controls')
  const ok = await press('.lc-btn', 'Juke')
  if (!ok) fail('juke button missing after the catch')
  await advance(1 / 30)
  const msg = await sim(() => window.__sim.message)
  if (!/Juke|JUKED/.test(msg)) fail(`juke message was "${msg}"`)
}
await toWhistle()
await toOver()
const play1 = await banner()
console.log('1 throw to read 2', caught ? '+ juke' : '(incomplete)', '->', play1, '|', await bug())

// replay must re-run the same taps
await click('Replay')
await sleep(150)
await page.evaluate(() => { let g = 0; while (window.__sim.phase !== 'over' && g++ < 2000) window.__advance(1 / 60) })
await sleep(300)
const again = await sim(() => window.__sim.message)
console.log('  replay ->', again)
if (!play1.startsWith(again.split(' — ')[0].slice(0, 12))) fail(`replay differs: "${again}" vs "${play1}"`)

// spike right after a completion in bounds (the clock is running)
if (await next()) {
  await sleep(300)
  const before = await bug()
  const spikeable = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Spike it/.test(b.textContent)))
  if (spikeable) {
    await click('Spike it')
    await sleep(100)
    await toWhistle()
    await toOver()
    console.log('2 spike ->', await banner(), '|', before, '=>', await bug())
    await shot('after-spike')
  } else fail('no spike button with the clock running')
}


// steps 3-5 need the drive to still be going (today's real moment decides how long it lasts)
await (async () => {
  // 3. pump fake, then throw it away
  if (!(await next())) return console.log('  (the drive ended on downs: later steps skipped)')
  await pick('Smash')
  await advance(0.85)
  await sleep(250) // the controls refresh about ten times a second
  if (!(await press('.lc-btn', 'Pump'))) fail('pump button not available')
  await advance(1 / 30)
  console.log('3 pump ->', await sim(() => window.__sim.message))
  await advance(0.45)
  await sleep(250)
  if (!(await press('.lc-btn', 'Throw away'))) fail('throw away not available')
  await toWhistle()
  await toOver()
  console.log('  throw away ->', await banner(), '|', await bug())

  // 4. scramble, then get out of bounds
  if (!(await next())) return console.log('  (the drive ended on downs: later steps skipped)')
  await pick('Mesh')
  await advance(0.5) // quick game: take off before he gets it out
  await sleep(250)
  if (!(await press('.lc-btn', 'Scramble'))) fail('scramble not available')
  await advance(0.4)
  await sleep(200)
  if (!(await press('.lc-btn', 'out of bounds'))) fail('sideline button missing on a scramble')
  await toWhistle()
  await toOver()
  console.log('4 scramble + sideline ->', await banner(), '|', await bug())

  // 5. run play, spin, then get down
  if (!(await next())) return console.log('  (the drive ended on downs: later steps skipped)')
  await pick('Outside Zone')
  await page.evaluate(() => { let g = 0; while (window.__sim.phase === 'live' && !window.__sim.controls() && g++ < 200) window.__advance(1 / 60) })
  await sleep(250)
  const runLive = await sim(() => window.__sim.phase === 'live')
  if (!(await press('.lc-btn', 'Spin')) && runLive) fail('spin button missing on a run')
  await advance(1 / 30)
  console.log('5 spin ->', await sim(() => window.__sim.message))
  await advance(0.3)
  await sleep(250)
  await press('.lc-btn', 'Get down')
  await toWhistle()
  await toOver()
  console.log('5 run + spin + get down ->', await banner(), '|', await bug())

})()
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors')
console.log(failures ? `${failures} FAILURE(S)` : 'all live-QB checks passed')
await browser.close()
process.exit(failures ? 1 : 0)
