import puppeteer from 'puppeteer-core'
const B = process.argv[2] ?? 'https://clutch-drive.vercel.app'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal'] })
const p = await b.newPage(); await p.setViewport({ width: 1100, height: 720 })
await p.evaluateOnNewDocument(() => {
  window.__snd = []
  const t0 = performance.now()
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...a) {
    const d = this.buffer?.duration ?? 0
    // the synth uses a 2s white-noise buffer; recorded clips have other lengths
    window.__snd.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${Math.abs(d - 2) < 0.01 ? 'synth-noise' : 'CLIP ' + d.toFixed(1) + 's'}`)
    return orig.apply(this, a)
  }
  const fetchOrig = window.fetch
  window.fetch = (u, ...r) => { if (String(u).includes('/sounds/')) window.__snd.push('fetch ' + u); return fetchOrig(u, ...r) }
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const click = (t) => p.evaluate((t) => { const el = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t) && !x.disabled); el?.click(); return !!el }, t)
await p.goto(B + '/play?mode=practice', { waitUntil: 'networkidle2' })
await p.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Take the field/.test(b.textContent)), { timeout: 30000 })
await p.click('.intro .btn.primary')
await sleep(900)
for (const name of ['Dig', 'Outside Zone', 'Deep Shot']) {
  await p.evaluate(async (n) => { for (const tab of [null, ...document.querySelectorAll('.pb-tab')]) { tab?.click(); await new Promise((r) => setTimeout(r, 60)); const c = [...document.querySelectorAll('.pb-card')].find((x) => x.querySelector('strong')?.textContent.trim() === n); if (c) return c.click() } }, name)
  await sleep(200); await click('Snap it')
  await p.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Next play|See result/.test(b.textContent)) || document.querySelector('.modal'), { timeout: 30000 })
  await sleep(400)
  if (!(await click('Next play'))) break
  await sleep(600)
}
console.log((await p.evaluate(() => window.__snd)).join('\n'))
await b.close()
