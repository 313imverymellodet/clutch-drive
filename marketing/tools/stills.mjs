// Grabs candidate hero frames from both games (practice mode, no logos) for the social images.
import { launch, openGame, click, step, sleep } from './director.mjs'
import { mkdirSync } from 'node:fs'
const out = process.argv[2]
mkdirSync(out, { recursive: true })
const browser = await launch()

for (const [w, h, tag] of [[1080, 1350, 'portrait'], [1600, 900, 'land'], [1080, 1920, 'story']]) {
  // ---- hoops: a Floppy three, caught at the catch, the rise and with the ball in the air
  {
    const page = await openGame(browser, '/hoops?mode=practice&cam=22,40,10,5', { width: w, height: h, dpr: 2 })
    await click(page, 'Take the floor')
    await sleep(500)
    await page.evaluate(() => [...document.querySelectorAll('.set-card')].find((c) => /Floppy/.test(c.textContent)).click())
    await sleep(150)
    await click(page, 'Run ')
    await sleep(300)
    await page.hideUI()
    let shots = 0
    for (let i = 0; i < 200 && shots < 4; i++) {
      await step(page, 1 / 30)
      const s = await page.evaluate(() => ({ state: window.__hoops.sim.ball.state, t: window.__hoops.sim.t, gather: !!window.__hoops.sim.ball.holder?.gatherAt }))
      if ((s.gather && shots === 0) || (s.state === 'shot' && shots < 3 && i % 4 === 0) || (s.state === 'swish' && shots === 3)) {
        await page.screenshot({ path: `${out}/hoops-${tag}-${shots}.png` })
        shots++
      }
    }
    await page.close()
  }
  // ---- football: Deep Shot, the throw and the catch, broadcast and replay camera
  {
    const page = await openGame(browser, '/play?mode=practice', { width: w, height: h, dpr: 2 })
    await click(page, 'Take the field')
    await sleep(500)
    await page.evaluate(async () => {
      for (const tab of [...document.querySelectorAll('.pb-tab')]) {
        tab.click()
        await new Promise((r) => setTimeout(r, 60))
        const c = [...document.querySelectorAll('.pb-card')].find((b) => b.querySelector('strong')?.textContent.trim() === 'Deep Shot')
        if (c) return c.click()
      }
    })
    await sleep(150)
    await click(page, 'Snap it')
    await sleep(200)
    await page.hideUI()
    let shots = 0
    for (let i = 0; i < 160 && shots < 4; i++) {
      await step(page, 1 / 30)
      const s = await page.evaluate(() => ({ b: window.__sim.ball.state, t: window.__sim.t, phase: window.__sim.phase }))
      if (s.b === 'air' && shots < 2 && i % 6 === 0) {
        await page.screenshot({ path: `${out}/nfl-${tag}-${shots}.png` })
        shots++
      }
      if (shots >= 2 && s.b === 'held' && s.phase === 'live') {
        await page.evaluate(() => (window.__sim.camMode = 'close'))
        await step(page, 0.6)
        await page.screenshot({ path: `${out}/nfl-${tag}-${shots}.png` })
        shots++
        await step(page, 0.4)
        await page.screenshot({ path: `${out}/nfl-${tag}-${shots}.png` })
        shots++
      }
    }
    await page.close()
  }
}
await browser.close()
console.log('done')
