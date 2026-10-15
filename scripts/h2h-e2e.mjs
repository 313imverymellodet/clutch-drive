// Two real browsers play a full head-to-head duel over the network (PeerJS), clicking the real UI.
// Checks both screens show the same result for every snap. Saves screenshots of each stage.
// Usage: npm run dev (other terminal), then  node scripts/h2h-e2e.mjs [outDir] [baseUrl]
//   TRANSPORT=relay|direct  force one network path (relay = what two devices on different networks rely on)
//   FLAKY=1                 host drops offline in the lobby, guest drops mid-game; both must recover
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const [outDir = 'captures/h2h', BASE = 'http://localhost:5173'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
})
// separate contexts = separate localStorage, like two different people
const ctxA = await browser.createBrowserContext()
const ctxB = await browser.createBrowserContext()
const host = await ctxA.newPage()
const guest = await ctxB.newPage()
await host.setViewport({ width: 1100, height: 720 })
await guest.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
const errors = []
if (process.env.TRANSPORT) {
  for (const p of [host, guest]) await p.evaluateOnNewDocument((t) => localStorage.setItem('cd.transport', t), process.env.TRANSPORT)
  console.log('forced transport:', process.env.TRANSPORT)
}
const FLAKY = !!process.env.FLAKY
for (const [name, p] of [['host', host], ['guest', guest]]) {
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  p.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(`${name} console: ${m.text()}`))
}
let shotN = 0
const shot = async (p, name) => p.screenshot({ path: `${outDir}/${String(shotN++).padStart(2, '0')}-${name}.png` })
const clickText = (p, text) =>
  p.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s+/g, ' ').includes(t) && !b.disabled)
    el?.click()
    return !!el
  }, text)

// --- host creates
await host.goto(`${BASE}/h2h`, { waitUntil: 'networkidle0' })
await host.select('.lobby select', 'MIN')
await clickText(host, 'Create a match')
await host.waitForFunction(() => /^[A-Z0-9]{5}$/.test(document.querySelector('.room-code')?.textContent ?? ''), { timeout: 20000 })
const code = await host.$eval('.room-code', (el) => el.textContent)
console.log('room code', code)
await shot(host, 'host-lobby')

if (FLAKY) {
  console.log('host goes offline for 7s (like a phone backgrounded while sharing the link)')
  await host.setOfflineMode(true)
  await sleep(7000)
  await host.setOfflineMode(false)
}
// --- guest joins through the invite link
await guest.goto(`${BASE}/h2h?room=${code}`, { waitUntil: 'networkidle0' })
await guest.select('.lobby select', 'DEN')
await shot(guest, 'guest-invite')
await clickText(guest, 'Join the duel')
await Promise.all([host.waitForSelector('.duel-strip', { timeout: 30000 }), guest.waitForSelector('.duel-strip', { timeout: 30000 })])
console.log('connected')
await sleep(1500)

const covs = ['cover2', 'blitz', 'cover3', 'cover1', 'prevent']
const plays = ['Dig', 'Quick Out', 'HB Dive', 'Deep Shot']
let defN = 0
let offN = 0
let mismatches = 0
let snaps = 0
const shots = new Set()
const deadline = Date.now() + 8 * 60 * 1000
while (Date.now() < deadline) {
  const over = await Promise.all([host, guest].map((p) => p.evaluate(() => /duel/i.test(document.querySelector('.modal h2')?.textContent ?? ''))))
  if (over[0] && over[1]) break
  for (const [name, p] of [['host', host], ['guest', guest]]) {
    const state = await p.evaluate(() => ({
      def: !!document.querySelector('.defpick'),
      off: !!document.querySelector('.plays'),
      half: /Drive 1 is done/.test(document.querySelector('.modal h2')?.textContent ?? ''),
    }))
    if (state.def) {
      const cov = covs[defN % covs.length]
      await p.evaluate((c) => document.querySelector(`.cov.${c}`)?.click(), cov)
      if (defN % 3 === 1) await p.select('.defopts select', 'cover3') // disguise it
      if (defN % 2 === 0) await clickText(p, ['Dig', 'HB Dive', 'Deep Shot'][defN % 3])
      if (!shots.has(`${name}-def`)) {
        await sleep(400)
        await shot(p, `${name}-defense-picker`)
        shots.add(`${name}-def`)
      }
      await clickText(p, 'Lock it in')
      defN++
      await sleep(400)
    } else if (state.off) {
      if (!shots.has(`${name}-off`)) {
        await sleep(500)
        await shot(p, `${name}-offense-call`)
        shots.add(`${name}-off`)
      }
      const play = plays[offN % plays.length]
      // touch screens arm on the first tap and snap on the second
      await clickText(p, play)
      await sleep(150)
      if (name === 'guest') await clickText(p, play)
      offN++
      // both screens should show the same result banner for this snap (unless the clock ran out before the snap)
      const settled = () => !!document.querySelector('.banner-sub') || !!document.querySelector('.modal')
      await Promise.all([host.waitForFunction(settled, { timeout: 30000 }), guest.waitForFunction(settled, { timeout: 30000 })])
      await sleep(600)
      const [a, b] = await Promise.all([host, guest].map((pp) => pp.evaluate(() => document.querySelector('.banner-sub')?.textContent ?? `[${document.querySelector('.modal h2')?.textContent}]`)))
      snaps++
      if (a !== b) mismatches++
      if (FLAKY && snaps === 3) {
        console.log('guest drops offline for 12s mid-game')
        await guest.setOfflineMode(true)
        await sleep(12000)
        const badge = await guest.evaluate(() => document.querySelector('.net')?.textContent)
        console.log('guest badge while offline:', badge)
        await guest.setOfflineMode(false)
      }
      console.log(`snap ${snaps}: ${name} called ${play} | host sees "${a}" | guest sees "${b}"${a === b ? '' : '  <-- MISMATCH'}`)
      if (snaps === 1) await Promise.all([shot(host, 'host-result'), shot(guest, 'guest-result')])
      await Promise.all([host.waitForSelector('.banner-sub', { hidden: true, timeout: 30000 }), guest.waitForSelector('.banner-sub', { hidden: true, timeout: 30000 })]).catch(() => {})
      await Promise.all([host, guest].map((pp) => pp.waitForFunction(() => !/Drive 1 is done/.test(document.querySelector('.modal h2')?.textContent ?? ''), { timeout: 30000 }).catch(() => {})))
    } else if (state.half && !shots.has('half')) {
      await shot(p, `${name}-halftime`)
      shots.add('half')
    }
  }
  await sleep(300)
}
await sleep(1200)
await Promise.all([shot(host, 'host-final'), shot(guest, 'guest-final')])
const finals = await Promise.all([host, guest].map((p) => p.evaluate(() => document.querySelector('.modal')?.innerText.replace(/\n+/g, ' | '))))
console.log('\nHOST  :', finals[0])
console.log('GUEST :', finals[1])
const badges = await Promise.all([host, guest].map((p) => p.evaluate(() => document.querySelector('.net')?.textContent ?? '(modal)')))
console.log(`\n${snaps} snaps, ${mismatches} mismatched results between the two screens; badges: host ${badges[0]}, guest ${badges[1]}`)
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors')
await browser.close()
