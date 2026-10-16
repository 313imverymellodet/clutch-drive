// Plays a full drive in headless Chrome by clicking the real UI, saving a screenshot per step.
// Usage: npm run dev (other terminal), then  node scripts/e2e.mjs [outDir] [width] [height] [mode] [calls]
//   BASE=https://clutch-drive.vercel.app node scripts/e2e.mjs ...  tests a deployed build in real time
//   calls: comma list of play names to cycle (add |flip to flip), e.g. "Levels,Mesh|flip,QB Blast"; mode 'defense' calls coverages
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const [outDir = 'captures/e2e', w = '1100', h = '720', mode = 'daily', calls = 'Levels,Quick Out,Mesh|flip,Deep Shot,QB Blast,Smash,Outside Zone,Y-Cross'] = process.argv.slice(2)
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

const BASE = process.env.BASE ?? 'http://localhost:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
process.on('uncaughtException', async (e) => {
  console.log('TEST FAILED:', e.message.split('\n')[0])
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors')
  try {
    console.log('SCREEN:', (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, 600))
  } catch {
    /* page gone */
  }
  process.exit(1)
})
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

// pick a play in the playbook: find its tab, select the card, press Snap (plays can be 'Name' or 'Name|flip')
const callPlay = async (spec) => {
  const [name, flip] = spec.split('|')
  const ok = await page.evaluate(async (name) => {
    const find = () => [...document.querySelectorAll('.pb-card')].find((b) => b.querySelector('strong')?.textContent.trim() === name)
    for (const tab of [null, ...document.querySelectorAll('.pb-tab')]) {
      tab?.click()
      await new Promise((r) => setTimeout(r, 60))
      const card = find()
      if (card) {
        const wasOn = card.classList.contains('on') // tapping an already-selected card snaps it
        card.click()
        return wasOn ? 'snapped' : 'selected'
      }
    }
    return false
  }, name)
  if (!ok) throw new Error(`no play "${name}"`)
  if (ok === 'snapped') return
  await sleep(150)
  if (flip) await click('Flip')
  await sleep(250)
  await click('Snap it')
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
await sleep(1500)
await shot('landing')
await page.evaluate(() => window.scrollTo(0, 900))
await sleep(400)
await shot('landing-scrolled')

await page.goto(`${BASE}/play?mode=${mode}`, { waitUntil: 'networkidle0' })
await page.waitForFunction(() => !!document.querySelector('canvas') && [...document.querySelectorAll('button')].some((b) => /Take the field|Share/.test(b.textContent)), { timeout: 30000 })
const dev = await page.evaluate(() => typeof window.__advance === 'function')
await sleep(800)
await shot('intro')
await click('Take the field')
await sleep(1200)
await shot('call')
if (mode !== 'defense') {
  await page.evaluate(() => [...document.querySelectorAll('.pb-tab')].find((t) => /Intermediate/.test(t.textContent))?.click())
  await sleep(200)
  await page.evaluate(() => [...document.querySelectorAll('.pb-card')].find((b) => /Levels/.test(b.textContent))?.click())
  await sleep(700)
  await shot('call-preview') // play art + read progression for Levels
}

const list = calls.split(',')
for (let i = 0; i < 14; i++) {
  const over = await page.evaluate(() => !!document.querySelector('.modal'))
  if (over) break
  const call = list[i % list.length]
  if (mode === 'defense') {
    // call a coverage, maybe disguise it, maybe guess, then lock it in
    const cov = ['cover2', 'firezone', 'cover1', 'cover4', 'tampa2', 'blitz', 'cover3', 'prevent'][i % 8]
    await page.waitForSelector('.defpick', { timeout: 20000 })
    await page.evaluate((c) => document.querySelector(`.cov.${c}`)?.click(), cov)
    if (i % 3 === 1) await page.select('.defopts select', 'cover3')
    if (i % 2 === 0) await click(['Quick', 'Intermediate', 'Deep', 'Run'][i % 4])
    if (i === 0) await shot('defense-call')
    await click('Lock it in')
  } else await callPlay(call)
  await sleep(100)
  // run the play to the whistle at sim speed, let React catch up, then to the end
  if (dev) {
    await page.evaluate(() => { let g = 0; while (window.__sim.phase === 'live' && g++ < 900) window.__advance(1 / 60) })
    await sleep(300)
  } else {
    await page.waitForSelector('.banner', { timeout: 20000 }) // real time on a production build
  }
  await shot(`play${i + 1}-${call.replace(/\s/g, '')}-whistle`)
  if (dev) await page.evaluate(() => { let g = 0; while (window.__sim.phase !== 'over' && g++ < 300) window.__advance(1 / 60) })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Next play|See result/.test(b.textContent)) || document.querySelector('.modal'), { timeout: 20000 })
  await sleep(300)
  const state = await page.evaluate(() => ({ msg: (document.querySelector('.banner-sub')?.textContent ?? '') + ' ' + (document.querySelector('.reveal')?.textContent ?? ''), bug: document.querySelector('.bug')?.innerText.replace(/\s+/g, ' ') }))
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
