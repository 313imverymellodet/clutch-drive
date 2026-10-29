// Shared helpers for capturing the games frame by frame (dev server + ?capture mode, see src/capture.js).
import puppeteer from 'puppeteer-core'

export const BASE = process.env.CAPTURE_BASE ?? 'http://localhost:5180'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch() {
  return puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  })
}

/** Open a game page in capture mode at a size; game UI hidden unless keepUI. */
export async function openGame(browser, path, { width, height, dpr = 1, keepUI = [] } = {}) {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: dpr })
  await page.goto(`${BASE}${path}${path.includes('?') ? '&' : '?'}capture`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => window.__capture && [...document.querySelectorAll('button')].some((b) => /Take the field|Take the floor/.test(b.textContent)), { timeout: 30000 })
  await step(page, 0.5)
  await page.addStyleTag({ content: 'header.top{display:none!important}' })
  const hide = ['.hud-top', '.hud-bottom', '.banner', '.skip', '.replay-badge', '.modal-wrap'].filter((s) => !keepUI.includes(s))
  page.hideUI = () => page.addStyleTag({ content: `${hide.join(',')}{opacity:0!important;pointer-events:none!important}` })
  return page
}

export const click = (page, text) => page.evaluate((t) => { const el = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t) && !b.disabled); el?.click(); return !!el }, text)

/** Advance the 3D scene (sim, animations, crowd) by `seconds` in 1/fps steps. */
export async function step(page, seconds, fps = 30) {
  const n = Math.max(1, Math.round(seconds * fps))
  await page.evaluate((n, dt) => { for (let i = 0; i < n; i++) window.__capture.step(dt) }, n, 1 / fps)
}

/** Hoops: open practice, run a set, then swap in a seed where `want(result)` is true (a made three, ...). */
export async function hoopsScripted(page, set, want = 'three') {
  await click(page, 'Take the floor')
  await sleep(500)
  await page.evaluate((set) => [...document.querySelectorAll('.set-card')].find((c) => c.textContent.includes(set)).click(), set)
  await sleep(150)
  await click(page, 'Run ')
  await sleep(250)
  return page.evaluate((want) => {
    const sim = window.__hoops.sim
    const params = { set: sim.setId, coverage: { call: 'man', shown: 'man' }, shotClock: 24, gameClock: 40, user: true }
    const probe = new sim.constructor()
    for (let seed = 1; seed < 600; seed++) {
      probe.reset({ ...params, seed })
      probe.start()
      for (let i = 0; i < 60 * 26 && probe.phase !== 'over'; i++) probe.step(1 / 60)
      const r = probe.result
      const ok = want === 'three' ? r?.kind === 'make' && r.shot?.three : r?.kind === 'make'
      if (ok) {
        sim.reset({ ...params, seed })
        sim.start()
        return { seed, by: r.shot.by, release: r.shot.release, elapsed: r.elapsed }
      }
    }
    return null
  }, want)
}

/** Football: practice, call a play, then swap in a seed (and spot) that scores a touchdown. */
export async function footballScripted(page, play = 'Deep Shot', playId = 'deep', los = 5) {
  await click(page, 'Take the field')
  await sleep(500)
  await page.evaluate(async (name) => {
    for (const tab of [...document.querySelectorAll('.pb-tab')]) {
      tab.click()
      await new Promise((r) => setTimeout(r, 60))
      const c = [...document.querySelectorAll('.pb-card')].find((b) => b.querySelector('strong')?.textContent.trim() === name)
      if (c) return c.click()
    }
  }, play)
  await sleep(150)
  await click(page, 'Snap it')
  await sleep(200)
  return page.evaluate(({ playId, los }) => {
    const sim = window.__sim
    const params = { play: playId, los, toGo: 10, coverage: { call: 'cover3', shown: 'cover3' }, situation: { clock: 60 } }
    const probe = new sim.constructor()
    for (let seed = 1; seed < 800; seed++) {
      probe.reset({ ...params, seed })
      probe.snap()
      for (let i = 0; i < 60 * 12 && probe.phase === 'live'; i++) probe.step(1 / 60)
      if (probe.result?.kind === 'touchdown') {
        sim.reset({ ...params, seed })
        sim.snap()
        return { seed, elapsed: probe.result.elapsed, message: probe.message }
      }
    }
    return null
  }, { playId, los })
}

/** Point the camera (capture mode). */
export const setCam = (page, pos, look, fov) => page.evaluate((c) => (window.__cam = c), { pos, look, fov })
export const clearCam = (page) => page.evaluate(() => delete window.__cam)
