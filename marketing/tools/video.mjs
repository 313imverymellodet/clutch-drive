// Shoots a 1080x1920 promo video frame by frame: real gameplay (scripted outcome, directed camera, slow motion)
// under the motion-graphics overlay (overlay.js). Writes JPEG frames + cues.json for the audio mix.
//   node marketing/tools/video.mjs <hoops|football> <framesDir>
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { launch, openGame, click, sleep } from './director.mjs'

const [game = 'hoops', dir] = process.argv.slice(2)
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const FPS = 30
const FB_LOS = 10 // football: the opponent's 40
const W = 1080
const H = 1920

const chalk = (inner) => `<svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
const HOOPS_SVG = chalk(`
  <g fill="none" stroke="rgba(255,255,255,.4)" stroke-width="3"><rect x="10" y="10" width="380" height="230" rx="8"/><rect x="150" y="10" width="100" height="110"/><path d="M40 10 V90 A160 160 0 0 0 360 90 V10"/></g>
  <circle cx="200" cy="40" r="9" fill="none" stroke="#ff7a1a" stroke-width="4"/>
  <path d="M200 52 C 220 90, 250 120, 320 150" fill="none" stroke="#ffd400" stroke-width="7" stroke-linecap="round" stroke-dasharray="1 0"/>
  <polygon points="320,150 300,142 306,160" fill="#ffd400"/>
  <rect x="236" y="80" width="34" height="9" rx="3" fill="#ff8a3d"/><rect x="248" y="104" width="34" height="9" rx="3" fill="#ff8a3d"/>
  <path d="M200 225 L 215 200" stroke="#fff" stroke-width="5" stroke-dasharray="8 6" fill="none"/>
  <circle cx="200" cy="228" r="11" fill="#fff"/><circle cx="200" cy="52" r="11" fill="#ffd400"/><circle cx="70" cy="150" r="10" fill="#8fd3ff"/><circle cx="330" cy="40" r="10" fill="rgba(255,255,255,.5)"/>`)
const FOOTBALL_SVG = chalk(`
  <g stroke="rgba(255,255,255,.35)" stroke-width="2">${[50, 100, 150, 200].map((y) => `<line x1="10" x2="390" y1="${y}" y2="${y}"/>`).join('')}</g>
  <line x1="10" x2="390" y1="205" y2="205" stroke="#2f6cff" stroke-width="4"/>
  ${[160, 180, 200, 220, 240].map((x) => `<circle cx="${x}" cy="215" r="8" fill="#fff"/>`).join('')}
  <path d="M60 205 V 20" stroke="#ffd400" stroke-width="8" stroke-linecap="round"/><polygon points="60,10 50,30 70,30" fill="#ffd400"/>
  <path d="M340 205 V 110 H 200" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round"/><polygon points="190,110 206,101 206,119" fill="#fff"/>
  <path d="M290 205 V 165 H 360" stroke="#8fd3ff" stroke-width="6" fill="none" stroke-linecap="round"/><polygon points="370,165 354,156 354,174" fill="#8fd3ff"/>
  <circle cx="200" cy="238" r="9" fill="#ffd400"/>`)

const CONFIG = {
  hoops: {
    bg: '#0f1117', accent: '#ff7a1a', chalk: '#1d3b2a', icon: '🏀', brand: 'CLUTCH HOOPS', brandWord: 'HOOPS',
    chip: '4TH QTR · LAL 102 – 104 BOS', lines: ['DOWN 2.', '0:24 LEFT.', 'YOUR BALL.'],
    captions: [[2.2, 3.7, '📋', 'CALL THE SET'], [3.7, ['gather', 0], '👀', 'READ THE D'], [['gather', 0], ['release', 0.6], '🎯', 'TIME IT AT THE TOP']],
    card: { svg: HOOPS_SVG, title: 'FLOPPY', sub: 'BEATS MAN ✓' }, cardIn: 2.3, cardOut: 3.75,
    meter: true, stamp: 'PERFECT ✓', stampAt: ['release', 0], stampHold: 1.3, stampPos: [560, 1060],
    big: 'BANG!', score: ['LAL', '102', '104', 'BOS'], scoreFlip: ['mg-sa', '105', '102'], wp: [31, 82], stamp2: '🔥 HEATING UP',
    teamA: '#552583', teamB: '#007A33', titleOut: 1.75,
    endTag: 'A real NBA ending every day.<br>Call the set. Hit the shot.', url: 'clutch-drive.vercel.app/hoops',
    share: ['Clutch Hoops #8 · LAL 105–104 BOS ✅', '🟩🔒💦🔒🟩'],
  },
  football: {
    bg: '#0e1410', accent: '#ffd400', chalk: '#1e4d2b', icon: '🏈', brand: 'CLUTCH DRIVE', brandWord: 'DRIVE',
    chip: '4TH QTR · MIN 24 – 28 DEN', lines: ['DOWN 4.', '2:08 LEFT.', 'YOUR CALL.'],
    captions: [[2.2, 4.2, '📋', 'PICK THE PLAY'], [4.2, ['throw', 0], '👀', 'READ THE COVERAGE'], [['throw', 0], ['impact', 0], '🏃', 'GO GO GO']],
    card: { svg: FOOTBALL_SVG, title: 'DEEP SHOT', sub: 'BOOM OR BUST 💣' }, cardIn: 2.3, cardOut: 4.15,
    meter: false, stamp: 'LET IT FLY 🎯', stampAt: ['throw', 0.25], stampHold: 1.4, stampPos: [470, 1180], bigSize: 190,
    big: 'TOUCH<br>DOWN!', score: ['MIN', '24', '28', 'DEN'], scoreFlip: ['mg-sa', '31', '24'], wp: [25, 97], stamp2: 'YOU BEAT HISTORY 🔥',
    teamA: '#4F2683', teamB: '#FB4F14', titleOut: 1.75,
    endTag: 'A real NFL comeback every day.<br>Call the play. Win it late.', url: 'clutch-drive.vercel.app',
    share: ['Clutch Drive #8 · MIN 31–28 DEN ✅', '🟩🟨🟩⏱️🟩🏈'],
  },
}

const browser = await launch()
const page = await openGame(browser, game === 'hoops' ? '/hoops?mode=practice' : '/play?mode=practice', { width: W, height: H, dpr: 1 })
const cues = {}
const events = []
const ev = (type, t) => events.push({ type, t: +t.toFixed(3) })

// ---- setup: pick the set/play (the 3D preview shows), hide the game UI, inject the overlay
let scripted = null
if (game === 'hoops') {
  await click(page, 'Take the floor')
  await sleep(500)
  await page.evaluate(() => [...document.querySelectorAll('.set-card')].find((c) => c.textContent.includes('Floppy')).click())
} else {
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
  // line up at the opponent's 40 so the touchdown is a quick strike (the route preview follows the formation)
  await page.evaluate((los) => window.__sim.reset({ play: 'deep', seed: 1, los, toGo: 10, coverage: { call: 'cover3', shown: 'cover3' } }), FB_LOS)
}
await sleep(300)
await page.hideUI()
await page.evaluate((cfg) => (window.__mgConfig = cfg), CONFIG[game])
await page.addScriptTag({ content: readFileSync(new URL('./overlay.js', import.meta.url), 'utf8') })

// ---- camera state (smoothed in Node)
let cam = null
const lerp3 = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k)
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
async function aim(pos, look, k = 1, fov = 54) {
  cam = cam && k < 1 ? { pos: lerp3(cam.pos, pos, k), look: lerp3(cam.look, look, k) } : { pos, look }
  await page.evaluate((c) => (window.__cam = c), { ...cam, fov })
}

const RUN_AT = game === 'hoops' ? 2.0 : 4.2

let slow = 1
let f = 0
let endAt = Infinity
const MAX = 30 * 22
while (f < MAX) {
  const t = f / FPS
  if (t >= endAt + 3.4) break

  if (t >= RUN_AT && !cues.run) {
    cues.run = t
    ev('whistle', t)
    if (game === 'hoops') {
      await click(page, 'Run ')
      await sleep(120)
      scripted = await page.evaluate(() => {
        const sim = window.__hoops.sim
        const params = { set: 'floppy', coverage: { call: 'man', shown: 'man' }, shotClock: 24, gameClock: 40, user: true }
        const probe = new sim.constructor()
        for (let seed = 1; seed < 800; seed++) {
          probe.reset({ ...params, seed })
          probe.start()
          for (let i = 0; i < 60 * 26 && probe.phase !== 'over'; i++) probe.step(1 / 60)
          const r = probe.result
          if (r?.kind === 'make' && r.shot?.three) {
            sim.reset({ ...params, seed })
            sim.start()
            return { seed, by: r.shot.by, release: r.shot.release, gather: probe.shot.shooter.gatherAt }
          }
        }
        return null
      })
    } else {
      await click(page, 'Snap it')
      await sleep(120)
      scripted = await page.evaluate((los) => {
        const sim = window.__sim
        // the quickest touchdown: ball out early, short trip after the catch
        let best = null
        for (const play of ['deep', 'verts', 'postwheel']) {
          const params = { play, los, toGo: 10, coverage: { call: 'cover3', shown: 'cover3' }, situation: { clock: 90 } }
          const probe = new sim.constructor()
          for (let seed = 1; seed < 3000; seed++) {
            probe.reset({ ...params, seed })
            probe.snap()
            let thrown = null
            for (let i = 0; i < 60 * 14 && probe.phase === 'live'; i++) {
              probe.step(1 / 60)
              if (thrown == null && probe.ball.state === 'air') thrown = probe.t
            }
            if (probe.result?.kind === 'touchdown' && thrown != null) {
              const score = thrown + probe.result.elapsed
              if (!best || score < best.score) best = { seed, play, los, params, score, thrown, elapsed: probe.result.elapsed, message: probe.message }
            }
          }
          if (best) break
        }
        if (!best) return null
        sim.reset({ ...best.params, seed: best.seed })
        sim.snap()
        return best
      }, FB_LOS)
    }
    console.log('scripted', JSON.stringify(scripted))
  }

  // ---- read the play and set cues
  const s = await page.evaluate((game) => {
    if (game === 'hoops') {
      const sim = window.__hoops.sim
      const B = sim.ball.state === 'held' ? sim.ball.holder : null
      const sh = sim.shot?.shooter
      const P = B ?? sh
      return { phase: sim.phase, ball: sim.ball.state, bpos: [sim.ball.pos.x, sim.ball.pos.y, sim.ball.pos.z], holder: B?.key, caught: B?.caughtAt > 0, gather: !!(B?.gatherAt || sh), released: !!sim.shot, p: P ? [P.pos.x, P.pos.z] : null }
    }
    const sim = window.__sim
    const q = sim.qb
    const R = sim.carrier && sim.carrier !== q ? sim.carrier : sim.target
    return { phase: sim.phase, ball: sim.ball.state, bpos: [sim.ball.pos.x, sim.ball.pos.y, sim.ball.pos.z], q: [q.pos.x, q.pos.z], los: sim.los, carrier: sim.carrier && sim.carrier !== q, rpos: R ? [R.pos.x, R.pos.z] : null, result: sim.result?.kind }
  }, game)

  if (game === 'hoops' && cues.run) {
    if (s.caught && s.holder !== 'PG' && cues.catch == null) cues.catch = t
    if (s.gather && cues.gather == null) {
      cues.gather = t
      slow = 0.45
      if (scripted) cues.meterSpan = (scripted.release - scripted.gather) / slow / 0.92
      cues.green = 0.88
      ev('squeak', t)
    }
    if (s.released && cues.release == null) {
      cues.release = t
      ev('release', t)
    }
    if (s.ball === 'swish' && cues.impact == null) {
      cues.impact = t
      endAt = t + 3.6
      cues.end = endAt
      ev('swish', t)
      ev('roar', t + 0.1)
    }
  }
  if (game === 'football' && cues.run) {
    if (s.ball === 'air' && cues.throw == null) {
      cues.throw = t
      slow = 0.5
      ev('throw', t)
    }
    if (cues.throw != null && t > cues.throw + 0.6 && slow < 1) slow = Math.min(1, slow + 0.05)
    if (s.carrier && cues.catch == null) {
      cues.catch = t
      ev('catch', t)
    }
    if (s.result === 'touchdown' && cues.impact == null) {
      cues.impact = t
      endAt = t + 3.6
      cues.end = endAt
      ev('roar', t)
    }
  }
  if (cues.impact != null && t > cues.impact + 0.25) slow = Math.min(1, slow + 0.04)
  if (endAt !== Infinity && t === endAt) ev('end', t)

  // ---- direct the camera
  if (game === 'hoops') {
    if (!cues.run) {
      const k = ease(Math.min(1, t / RUN_AT))
      await aim(lerp3([-8, 48, 62], [3, 30, 46], k), [0, 3, 15])
    } else if (cues.catch == null) {
      await aim([s.bpos[0] * 0.4 + 4, 27, 43], [s.bpos[0] * 0.35, 2, 14], 0.08)
    } else if (s.p && cues.release == null) {
      const [x, z] = s.p
      const len = Math.hypot(x, z - 5.25) || 1
      const d = [x / len, (z - 5.25) / len]
      await aim([x + d[0] * 12.5 + 3, 6.5, z + d[1] * 12.5], [x * 0.35, 8.5, 9], cues.gather ? 0.12 : 0.1, 52)
    } else if (cues.impact == null || t < cues.impact + 0.5) {
      // follow the ball's flight
      // keep the ball and the rim both in frame
      const mid = lerp3([s.bpos[0], s.bpos[1], s.bpos[2]], [0, 10, 5.25], 0.55)
      await aim(cam.pos, lerp3(cam.look, mid, 0.2), 0.2, 54)
    } else {
      const a = 0.25 + (t - cues.impact) * 0.18
      await aim([Math.sin(a) * 34, 18, 12 + Math.cos(a) * 34], [0, 5, 9], 0.06, 54)
    }
  } else {
    if (!cues.run) {
      const los = s.los
      const k = ease(Math.min(1, t / RUN_AT))
      await aim(lerp3([0, 13, los - 24], [0, 7.5, los - 15], k), [0, 0, los + 14], 1, 56)
    } else if (cues.throw == null) {
      await aim([s.q[0] + 1.6, 4.4, s.q[1] - 7.5], [s.q[0] * 0.4, 1, s.q[1] + 16], 0.2, 56)
    } else if (cues.catch == null && s.rpos) {
      // chase the ball downfield, keeping the receiver in the shot
      const [bx, by, bz] = s.bpos
      const [rx, rz] = s.rpos
      const look = lerp3([bx, by, bz], [rx, 1.2, rz], 0.62)
      await aim([rx * 0.7 + 3.5, Math.max(4.6, by * 0.4 + 3.6), Math.max(bz - 9, rz - 10.5)], look, 0.22, 50)
    } else if (s.rpos) {
      const [rx, rz] = s.rpos
      await aim([rx + 4.5, 4, rz - 7.5], [rx, 1.4, rz + 3], 0.12, 52)
    }
  }

  // ---- step the game and draw the overlay
  await page.evaluate((dt) => window.__capture.step(dt), (1 / FPS) * slow)
  await page.evaluate((t, cues) => window.__mg(t, cues), t, cues)
  await page.screenshot({ path: `${dir}/frame_${String(f).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 })
  f++
}
writeFileSync(`${dir}/cues.json`, JSON.stringify({ fps: FPS, frames: f, duration: f / FPS, cues, events, scripted }, null, 1))
console.log(`${game}: ${f} frames (${(f / FPS).toFixed(1)}s)`, JSON.stringify(cues))
await browser.close()
