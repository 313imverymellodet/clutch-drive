// Plays complete head-to-head duels through the real match reducer + sim (no network), to check the rules.
// Usage: npm run dev (other terminal), then  node scripts/h2h-selfplay.mjs [duels=12]
import puppeteer from 'puppeteer-core'

const duels = +(process.argv[2] ?? 12)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto('http://localhost:5173/play?mode=practice', { waitUntil: 'networkidle0' })
await page.waitForFunction(() => typeof window.__sim === 'object', { timeout: 20000 })
const out = await page.evaluate(async (duels) => {
  const H = await import('/src/game/h2h.js')
  const s = window.__sim
  const lines = []
  const tally = { host: 0, guest: 0, draw: 0, tds: 0, ints: 0, sacks: 0, timeouts: 0, plays: 0 }
  for (let k = 1; k <= duels; k++) {
    let m = H.newMatch({ seed: 1000 + k, players: { host: { team: 'MIN' }, guest: { team: 'DEN' } }, first: k % 2 ? 'host' : 'guest' })
    let guard = 0
    const log = []
    while (m.phase !== 'over' && guard++ < 200) {
      const off = H.offenseRole(m)
      const def = H.defenseRole(m)
      if (m.phase === 'def-call') {
        // half the time let the shot clock expire (CPU picks), otherwise a human-ish pick with a guess
        if (k % 3 === 0) m = H.reduce(m, { type: 'expire' }, 'ref')
        else m = H.reduce(m, { type: 'def', call: H.COVERAGE_IDS[(m.n + k) % 5], shown: H.COVERAGE_IDS[(m.n * 2 + k) % 5], key: ['dig', 'run', null][m.n % 3] }, def)
      } else if (m.phase === 'off-call') {
        const view = H.viewFor(m, off)
        if (view.defCall.call !== null) return 'LEAK: offense can see the real call'
        if (m.drives[m.half].clockRunning && m.drives[m.half].timeouts && m.n % 4 === 2) {
          m = H.reduce(m, { type: 'timeout' }, off)
          tally.timeouts++
        }
        m = H.reduce(m, { type: 'off', play: ['dig', 'out', 'run', 'deep'][(m.n + k) % 4] }, off)
      } else if (m.phase === 'live') {
        const sn = m.snap
        s.reset({ play: sn.play, seed: sn.seed, los: sn.los, toGo: sn.toGo, coverage: sn.coverage, situation: { clock: sn.clock } })
        s.snap()
        let g = 0
        while (s.phase === 'live' && g++ < 1500) s.step(1 / 60)
        tally.plays++
        if (s.result.kind === 'interception') tally.ints++
        if (s.result.kind === 'sack') tally.sacks++
        log.push(s.result.kind[0])
        m = H.reduce(m, { type: 'result', snapId: sn.id, result: s.result, message: s.message }, 'ref')
      } else if (m.phase === 'result') m = H.reduce(m, { type: 'next' }, 'ref')
      else if (m.phase === 'half') m = H.reduce(m, { type: 'startHalf2' }, 'ref')
    }
    if (m.phase !== 'over') return `STUCK in ${m.phase} on duel ${k}`
    tally[m.winner]++
    tally.tds += m.summaries.filter((x) => x.td).length
    const [a, b] = m.summaries
    lines.push(`duel ${k}: ${m.order[0]} ${a.td ? 'TD' : 'no TD'} (${a.grid}) vs ${m.order[1]} ${b.td ? 'TD' : 'no TD'} (${b.grid}) -> ${m.winner}`)
  }
  lines.push(`\n${JSON.stringify(tally)}`)
  return lines.join('\n')
}, duels)
console.log(out)
await browser.close()
