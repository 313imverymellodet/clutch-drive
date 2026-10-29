import { launch, openGame, click, step, sleep } from './director.mjs'
import { mkdirSync } from 'node:fs'
const out = process.argv[2]
mkdirSync(out, { recursive: true })
const browser = await launch()
for (const cam of ['9,30,12,6', '7,22,10,7', '13,34,14,5']) {
  const page = await openGame(browser, `/hoops?mode=practice&cam=${cam}`, { width: 1080, height: 1350, dpr: 1 })
  await click(page, 'Take the floor')
  await sleep(500)
  await page.evaluate(() => [...document.querySelectorAll('.set-card')].find((c) => /Floppy/.test(c.textContent)).click())
  await sleep(150)
  await click(page, 'Run ')
  await sleep(300)
  await page.hideUI()
  for (let i = 0; i < 200; i++) {
    await step(page, 1 / 30)
    const st = await page.evaluate(() => window.__hoops.sim.ball.state)
    if (st === 'shot') { await step(page, 0.25); await page.screenshot({ path: `${out}/hoops-cam-${cam.replace(/,/g, '_')}.png` }); break }
  }
  await page.close()
}
// football close camera at the throw
const page = await openGame(browser, '/play?mode=practice', { width: 1080, height: 1350, dpr: 1 })
await click(page, 'Take the field')
await sleep(500)
await page.evaluate(async () => {
  for (const tab of [...document.querySelectorAll('.pb-tab')]) {
    tab.click(); await new Promise((r) => setTimeout(r, 60))
    const c = [...document.querySelectorAll('.pb-card')].find((b) => b.querySelector('strong')?.textContent.trim() === 'Deep Shot')
    if (c) return c.click()
  }
})
await sleep(150)
await click(page, 'Snap it')
await sleep(200)
await page.hideUI()
await page.evaluate(() => (window.__sim.camMode = 'close'))
let n = 0
for (let i = 0; i < 150 && n < 3; i++) {
  await step(page, 1 / 30)
  const b = await page.evaluate(() => window.__sim.ball.state)
  if ((i === 40 || (b === 'air' && n === 1) || (b === 'held' && n === 2 && i > 60)) ) { await page.screenshot({ path: `${out}/nfl-close-${n}.png` }); n++; await step(page, 0.3) }
  if (i === 41 && n === 1) n = 1
}
await browser.close()
