// Spam test: how does a play do after you've called it k times in a row? (the defense adapts)
// Usage: npm run dev (other terminal), then  node scripts/spam.mjs [seeds=60]
import puppeteer from 'puppeteer-core'

const seeds = +(process.argv[2] ?? 60)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto('http://localhost:5173/play?mode=practice', { waitUntil: 'networkidle0' })
await page.waitForFunction(() => typeof window.__sim === 'object', { timeout: 20000 })
const out = await page.evaluate(async (seeds) => {
  const { makeScenario, newDrive, defenseFor } = await import('/src/game/drive.js')
  const s = window.__sim
  const rows = []
  for (const play of ['out', 'dig', 'deep', 'run']) {
    const line = []
    for (let k = 0; k <= 4; k++) {
      let yards = 0
      let good = 0
      let bad = 0
      const covs = {}
      for (let seed = 1; seed <= seeds; seed++) {
        const d = newDrive(makeScenario(`spam-${seed}`))
        d.ballOn = 30
        d.plays = Array.from({ length: k }, () => ({ playId: play, kind: 'tackle', gain: 5, first: false }))
        const cov = defenseFor(d)
        covs[cov.call] = (covs[cov.call] ?? 0) + 1
        s.reset({ play, seed: seed * 7 + k, los: -20, toGo: 10, coverage: cov, situation: { clock: 90 } })
        s.snap()
        let g = 0
        while (s.phase === 'live' && g++ < 1200) s.step(1 / 60)
        const r = s.result ?? { kind: 'x', gain: 0 }
        const gain = r.kind === 'incomplete' || r.kind === 'interception' ? 0 : r.gain
        yards += gain
        if (gain >= 5 || r.first || r.kind === 'touchdown') good++
        if (r.kind === 'interception' || r.kind === 'sack' || gain <= 0) bad++
      }
      const top = Object.entries(covs).sort((a, b) => b[1] - a[1])[0][0]
      line.push(`${k}x: ${(yards / seeds).toFixed(1).padStart(4)} yds ${String(Math.round((100 * good) / seeds)).padStart(3)}% win ${String(Math.round((100 * bad) / seeds)).padStart(3)}% bad (${top})`)
    }
    rows.push(`${play.padEnd(5)} ${line.join(' | ')}`)
  }
  // the flip side: after 3 straight of one play, the defense keys on it, so a different call should hit
  rows.push('', 'Switching it up after 3 straight calls of the first play:')
  for (const [spam, call] of [['run', 'dig'], ['run', 'deep'], ['dig', 'out'], ['out', 'dig'], ['deep', 'run'], ['dig', 'run']]) {
    let good = 0
    let yards = 0
    let base = 0
    for (let seed = 1; seed <= seeds; seed++) {
      for (const hist of [3, 0]) {
        const d = newDrive(makeScenario(`spam-${seed}`))
        d.ballOn = 30
        d.plays = Array.from({ length: hist }, () => ({ playId: spam, kind: 'tackle', gain: 5, first: false }))
        s.reset({ play: call, seed: seed * 13, los: -20, toGo: 10, coverage: defenseFor(d), situation: { clock: 90 } })
        s.snap()
        let g = 0
        while (s.phase === 'live' && g++ < 1200) s.step(1 / 60)
        const r = s.result ?? { kind: 'x', gain: 0 }
        const gain = r.kind === 'incomplete' || r.kind === 'interception' ? 0 : r.gain
        const win = gain >= 5 || r.first || r.kind === 'touchdown'
        if (hist) (yards += gain), (good += win)
        else base += win
      }
    }
    rows.push(`${spam} x3 -> ${call.padEnd(4)}: ${(yards / seeds).toFixed(1).padStart(4)} yds, ${Math.round((100 * good) / seeds)}% win (vs ${Math.round((100 * base) / seeds)}% with no history)`)
  }
  return rows.join('\n')
}, seeds)
console.log('Same play called again after k straight calls of it:\n' + out)
await browser.close()
