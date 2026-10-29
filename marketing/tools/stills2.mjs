// Hero frames for the social images: a made Floppy three from behind the shooter, and a deep TD throw.
import { launch, openGame, step, setCam, hoopsScripted, footballScripted } from './director.mjs'
import { mkdirSync } from 'node:fs'
const out = process.argv[2]
mkdirSync(out, { recursive: true })
const browser = await launch()
const sizes = [[1080, 1350, 'portrait'], [1080, 1920, 'story'], [1600, 900, 'land']]

for (const [w, h, tag] of sizes) {
  const page = await openGame(browser, '/hoops?mode=practice', { width: w, height: h, dpr: 2 })
  const info = await hoopsScripted(page, 'Floppy', 'three')
  await page.hideUI()
  // run to the release, framing the shooter from behind and below as he rises
  for (let i = 0; i < 400; i++) {
    const s = await page.evaluate(() => {
      const sim = window.__hoops.sim
      const B = sim.ball.holder ?? sim.shot?.shooter
      return { state: sim.ball.state, gather: !!B?.gatherAt, p: B ? [B.pos.x, B.pos.z] : null, t: sim.t }
    })
    if (s.p) {
      const [x, z] = s.p
      const dx = x - 0, dz = z - 5.25
      const len = Math.hypot(dx, dz)
      const back = [x + (dx / len) * 13 + 3, 6.5, z + (dz / len) * 13]
      await setCam(page, back, [x * 0.35, 8.5, 9], w > h ? 44 : 52)
    }
    if (s.gather) {
      await step(page, 0.42)
      await page.screenshot({ path: `${out}/hoops-rise-${tag}.png` })
      await step(page, 0.38)
      await page.screenshot({ path: `${out}/hoops-air-${tag}.png` })
      break
    }
    await step(page, 1 / 30)
  }
  await page.close()

  const fp = await openGame(browser, '/play?mode=practice', { width: w, height: h, dpr: 2 })
  const td = await footballScripted(fp, 'Deep Shot', 'deep', 5)
  await fp.hideUI()
  let shots = 0
  for (let i = 0; i < 400 && shots < 2; i++) {
    await step(fp, 1 / 30)
    const b = await fp.evaluate(() => ({ s: window.__sim.ball.state, phase: window.__sim.phase, t: window.__sim.t }))
    // behind the QB, looking downfield, until the ball is out; then the replay camera for the catch
    if (shots === 0) {
      const q = await fp.evaluate(() => [window.__sim.qb.pos.x, window.__sim.qb.pos.z, window.__sim.ball.pos.x, window.__sim.ball.pos.z])
      await setCam(fp, [q[0] + 1.6, 3.1, q[1] - 6.5], [q[0] * 0.4, 1.2, q[1] + 14], w > h ? 42 : 56)
    }
    if (shots === 0 && b.s === 'air') {
      await step(fp, 0.3)
      await fp.screenshot({ path: `${out}/nfl-throw-${tag}.png` })
      shots++
      await fp.evaluate(() => { delete window.__cam; window.__sim.camMode = 'close' })
    } else if (shots === 1 && b.phase !== 'live') {
      await step(fp, 0.5)
      await fp.screenshot({ path: `${out}/nfl-td-${tag}.png` })
      shots++
    }
  }
  console.log(tag, 'hoops seed', info?.seed, 'football TD seed', td?.seed, td?.message)
  await fp.close()
}
await browser.close()
