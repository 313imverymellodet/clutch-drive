// Motion-graphics overlay injected into the game page during capture. Everything is a pure function of the
// video time t and the cue times the director has seen so far, so every frame is deterministic.
// window.__mg(t, cues) draws one frame. Config comes from window.__mgConfig.
;(() => {
  const C = window.__mgConfig
  const W = 1080
  const H = 1920
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x))
  // a cue that hasn't happened yet is Infinity: treat the ramp as not started
  const lin = (t, a, b) => (!isFinite(a) || !isFinite(b) ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)))
  const easeOut = (x) => 1 - Math.pow(1 - x, 3)
  const easeIn = (x) => x * x * x
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
  const back = (x) => {
    const c1 = 1.9
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
  }
  const rnd = (() => {
    let a = 20261022
    return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296)
  })()

  const css = `
  #mg { position: fixed; inset: 0; z-index: 99999; pointer-events: none; font-family: -apple-system, 'SF Pro Display', system-ui, sans-serif; color: #fff; overflow: hidden; }
  #mg * { box-sizing: border-box; }
  .mg-disp { font-family: 'Archivo Black', 'Arial Black', sans-serif; }
  #mg-title { position: absolute; inset: 0; background: ${C.bg}; }
  #mg-title .band { position: absolute; left: -10%; width: 120%; height: 120px; background: repeating-linear-gradient(90deg, ${C.accent} 0 90px, #14161c 90px 180px); transform: rotate(-8deg); opacity: .95; }
  #mg-title .lines { position: absolute; left: 70px; top: 560px; }
  #mg-title .line { font-family: 'Archivo Black'; font-size: 128px; line-height: .92; color: #fff; text-shadow: 8px 8px 0 #000; transform-origin: left center; white-space: nowrap; }
  #mg-title .line.hot { color: ${C.accent}; }
  #mg-title .chip { position: absolute; left: 74px; top: 440px; padding: 12px 22px; border-radius: 999px; background: rgba(255,255,255,.1); border: 2px solid rgba(255,255,255,.25); font-weight: 900; letter-spacing: .16em; font-size: 26px; }
  #mg-title .brand { position: absolute; left: 74px; bottom: 470px; display: flex; gap: 16px; align-items: center; font-family: 'Archivo Black'; font-size: 40px; letter-spacing: .05em; }
  #mg-title .brand i { font-style: normal; width: 76px; height: 76px; border-radius: 20px; display: grid; place-items: center; background: ${C.accent}; font-size: 48px; box-shadow: 0 6px 0 #000; }
  .mg-lower { position: absolute; left: 60px; top: 300px; display: flex; align-items: center; gap: 16px; padding: 20px 30px 20px 22px; border-radius: 22px; background: #14161c; border: 3px solid ${C.accent}; box-shadow: 0 10px 0 rgba(0,0,0,.4); font-family: 'Archivo Black'; font-size: 52px; white-space: nowrap; }
  .mg-lower b { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 16px; background: ${C.accent}; color: #14161c; font-size: 36px; }
  #mg-card { position: absolute; right: 60px; top: 430px; width: 400px; padding: 18px; border-radius: 26px; background: #fff; color: #14161c; box-shadow: 0 12px 0 rgba(0,0,0,.35), 0 0 0 4px #14161c; }
  #mg-card svg { display: block; width: 100%; border-radius: 14px; background: ${C.chalk}; }
  #mg-card .t { font-family: 'Archivo Black'; font-size: 34px; margin-top: 12px; }
  #mg-card .s { font-weight: 800; font-size: 20px; color: #1f9d55; margin-top: 2px; letter-spacing: .04em; }
  #mg-meter { position: absolute; right: 90px; top: 520px; width: 70px; height: 520px; border-radius: 35px; background: rgba(15,17,23,.82); border: 4px solid #fff; overflow: hidden; }
  #mg-meter .green { position: absolute; left: 0; right: 0; background: #2ecc71; }
  #mg-meter .good { position: absolute; left: 0; right: 0; background: rgba(255,212,0,.5); }
  #mg-meter .fill { position: absolute; left: 6px; right: 6px; bottom: 6px; border-radius: 26px; background: linear-gradient(0deg, ${C.accent}, #fff); }
  .mg-stamp { position: absolute; font-family: 'Archivo Black'; padding: 14px 24px; border-radius: 16px; color: #14161c; background: #2ecc71; box-shadow: 0 8px 0 #14161c, 0 0 0 5px #14161c; font-size: 42px; white-space: nowrap; }
  #mg-big { position: absolute; left: 0; right: 0; top: 640px; text-align: center; font-family: 'Archivo Black'; font-size: ${C.bigSize ?? 230}px; line-height: .9; color: ${C.accent}; -webkit-text-stroke: 10px #14161c; paint-order: stroke fill; text-shadow: 0 16px 0 #14161c, 0 30px 60px rgba(0,0,0,.6); }
  #mg-flash { position: absolute; inset: 0; background: #fff; }
  .mg-conf { position: absolute; width: 22px; height: 12px; border-radius: 3px; }
  #mg-wp { position: absolute; left: 60px; top: 1120px; width: 620px; padding: 26px 30px; border-radius: 28px; background: rgba(15,17,23,.88); border: 3px solid rgba(255,255,255,.2); }
  #mg-wp .lab { font-weight: 900; letter-spacing: .2em; font-size: 24px; opacity: .8; }
  #mg-wp .num { font-family: 'Archivo Black'; font-size: 84px; line-height: 1; margin: 8px 0 14px; white-space: nowrap; }
  #mg-wp .bar { position: relative; height: 26px; border-radius: 13px; background: rgba(255,255,255,.15); overflow: hidden; }
  #mg-wp .bar i { position: absolute; inset: 0 auto 0 0; border-radius: 13px; background: linear-gradient(90deg, ${C.accent}, #2ecc71); }
  #mg-score { position: absolute; left: 60px; top: 960px; display: flex; align-items: stretch; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 0 rgba(0,0,0,.4), 0 0 0 4px #14161c; font-family: 'Archivo Black'; font-size: 48px; }
  #mg-score span { padding: 14px 22px; }
  #mg-score .a { background: ${C.teamA}; color: #fff; }
  #mg-score .n { background: #14161c; color: #fff; min-width: 120px; text-align: center; }
  #mg-score .b { background: ${C.teamB}; color: #fff; }
  #mg-end { position: absolute; inset: 0; background: ${C.bg}; }
  #mg-end .glow { position: absolute; width: 1400px; height: 1400px; left: -160px; top: 300px; border-radius: 50%; background: radial-gradient(circle, ${C.accent}55, transparent 62%); }
  #mg-end .rings { position: absolute; left: 540px; top: 760px; width: 0; height: 0; }
  #mg-end .rings i { position: absolute; border: 4px solid ${C.accent}44; border-radius: 50%; }
  #mg-end .icon { position: absolute; left: 50%; top: 430px; width: 220px; height: 220px; margin-left: -110px; border-radius: 56px; background: ${C.accent}; display: grid; place-items: center; font-size: 140px; box-shadow: 0 16px 0 #000, 0 0 0 8px #000; }
  #mg-end .name { position: absolute; left: 0; right: 0; top: 720px; text-align: center; font-family: 'Archivo Black'; font-size: 120px; line-height: .92; text-shadow: 8px 8px 0 #000; }
  #mg-end .name span { display: block; color: ${C.accent}; }
  #mg-end .tag { position: absolute; left: 90px; right: 90px; top: 990px; text-align: center; font-weight: 800; font-size: 40px; line-height: 1.3; color: rgba(255,255,255,.9); }
  #mg-end .btn { position: absolute; left: 50%; top: 1150px; transform: translateX(-50%); font-family: 'Archivo Black'; font-size: 58px; color: #14161c; background: ${C.accent}; padding: 30px 60px; border-radius: 28px; box-shadow: 0 12px 0 #000, 0 0 0 6px #000; white-space: nowrap; }
  #mg-end .url { position: absolute; left: 0; right: 0; top: 1330px; text-align: center; font-weight: 900; font-size: 40px; color: #fff; }
  #mg-end .url small { display: block; font-size: 26px; letter-spacing: .2em; opacity: .65; margin-bottom: 8px; }
  #mg-end .share { position: absolute; left: 50%; top: 1460px; transform: translateX(-50%) rotate(-3deg); background: #fff; color: #14161c; border-radius: 20px; padding: 16px 26px; font-weight: 900; font-size: 30px; box-shadow: 0 8px 0 #000, 0 0 0 4px #000; white-space: nowrap; text-align: center; }
  #mg-end .share div { font-size: 44px; letter-spacing: 3px; }
  `
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'mg'
  root.innerHTML = `
    <div id="mg-flash" style="opacity:0"></div>
    <div id="mg-score" style="opacity:0"><span class="a">${C.score[0]}</span><span class="n" id="mg-sa">${C.score[1]}</span><span class="n" id="mg-sb">${C.score[2]}</span><span class="b">${C.score[3]}</span></div>
    <div id="mg-wp" style="opacity:0"><div class="lab">WIN PROBABILITY</div><div class="num" id="mg-wpn">0%</div><div class="bar"><i id="mg-wpb"></i></div></div>
    <div id="mg-card" style="opacity:0">${C.card.svg}<div class="t">${C.card.title}</div><div class="s">${C.card.sub}</div></div>
    ${C.meter ? '<div id="mg-meter" style="opacity:0"><div class="good"></div><div class="green"></div><div class="fill"></div></div>' : ''}
    <div class="mg-stamp" id="mg-stamp" style="opacity:0">${C.stamp}</div>
    <div class="mg-stamp" id="mg-stamp2" style="opacity:0;background:#ffd400">${C.stamp2}</div>
    <div class="mg-lower" id="mg-lower" style="opacity:0"><b></b><span></span></div>
    <div id="mg-conf"></div>
    <div id="mg-big" style="opacity:0">${C.big}</div>
    <div id="mg-title">
      <div class="band" style="top:200px"></div><div class="band" style="top:1500px"></div>
      <div class="chip" id="mg-chip">${C.chip}</div>
      <div class="lines">${C.lines.map((l, i) => `<div class="line${i === C.lines.length - 1 ? ' hot' : ''}">${l}</div>`).join('')}</div>
      <div class="brand"><i>${C.icon}</i>${C.brand}</div>
    </div>
    <div id="mg-end" style="opacity:0">
      <div class="glow"></div><div class="rings">${[0, 1, 2, 3].map(() => '<i></i>').join('')}</div>
      <div class="icon">${C.icon}</div>
      <div class="name">CLUTCH<span>${C.brandWord}</span></div>
      <div class="tag">${C.endTag}</div>
      <div class="btn">PLAY FREE ▶</div>
      <div class="url"><small>NO DOWNLOAD · PHONE OR COMPUTER</small>${C.url}</div>
      <div class="share"><span>${C.share[0]}</span><div>${C.share[1]}</div></div>
    </div>`
  document.body.appendChild(root)
  const $ = (id) => document.getElementById(id)
  // confetti particles
  const COLORS = [C.accent, '#ffffff', '#2ecc71', '#ffd400', '#ff4d6d', '#4dabff']
  const conf = Array.from({ length: 110 }, () => {
    const d = document.createElement('div')
    d.className = 'mg-conf'
    d.style.background = COLORS[Math.floor(rnd() * COLORS.length)]
    $('mg-conf').appendChild(d)
    return { d, x: W / 2 + (rnd() - 0.5) * 200, y: 820, vx: (rnd() - 0.5) * 1900, vy: -900 - rnd() * 1300, r: rnd() * 360, vr: (rnd() - 0.5) * 900 }
  })
  const LOWER = C.captions
  const set = (el, props) => Object.assign(el.style, props)

  window.__mg = (t, cues) => {
    // ---- title card: three lines punch in, then a diagonal wipe reveals the game
    const title = $('mg-title')
    const wipe = easeInOut(lin(t, C.titleOut, C.titleOut + 0.42))
    title.style.clipPath = `polygon(${wipe * 140}% 0, 140% 0, 140% 100%, ${wipe * 140 - 40}% 100%)`
    title.style.display = wipe >= 1 ? 'none' : ''
    ;[...title.querySelectorAll('.line')].forEach((el, i) => {
      const a = 0.12 + i * 0.42
      const p = lin(t, a, a + 0.22)
      const shake = t > a && t < a + 0.3 ? Math.sin(t * 90) * 10 * (1 - lin(t, a, a + 0.3)) : 0
      set(el, { opacity: p > 0 ? 1 : 0, transform: `translateX(${shake}px) scale(${1.6 - 0.6 * back(p)}) rotate(${-4 * (1 - p)}deg)` })
    })
    set($('mg-chip'), { opacity: lin(t, 0, 0.25), transform: `translateY(${(1 - easeOut(lin(t, 0, 0.3))) * -30}px)` })
    title.querySelectorAll('.band').forEach((b, i) => (b.style.transform = `rotate(-8deg) translateX(${(i ? -1 : 1) * ((t * 160) % 180)}px)`))

    // ---- lower-third captions
    const cap = LOWER.find(([s, e]) => t >= resolve(s, cues) && t < resolve(e, cues))
    const low = $('mg-lower')
    if (cap) {
      const [s, e, icon, text] = cap
      const s0 = resolve(s, cues)
      const e0 = resolve(e, cues)
      const pin = easeOut(lin(t, s0, s0 + 0.25))
      const pout = easeIn(lin(t, e0 - 0.2, e0))
      low.querySelector('b').textContent = icon
      low.querySelector('span').textContent = text
      set(low, { opacity: 1 - pout, transform: `translateX(${(1 - pin) * -700}px)` })
    } else low.style.opacity = 0

    // ---- play/set card (while they call it)
    const cs = resolve(C.cardIn, cues)
    const ce = resolve(C.cardOut, cues)
    const cin = back(lin(t, cs, cs + 0.35))
    const cout = easeIn(lin(t, ce - 0.25, ce))
    set($('mg-card'), { opacity: t >= cs && t < ce ? 1 : 0, transform: `translateX(${(1 - cin) * 600 + cout * 700}px) rotate(${4 - 4 * cin}deg)` })

    // ---- shot meter (hoops): rises with the gather, stamps at the release
    if (C.meter) {
      const m = $('mg-meter')
      const on = cues.gather != null && (cues.release == null || t < cues.release + 0.8)
      set(m, { opacity: on ? 1 : 0, transform: `scale(${on ? 1 : 0.8})` })
      if (cues.gather != null) {
        const span = cues.meterSpan ?? 1.6
        const prog = clamp((Math.min(t, cues.release ?? t) - cues.gather) / span)
        m.querySelector('.fill').style.height = `${prog * 100}%`
        m.querySelector('.green').style.cssText = `bottom:${(cues.green ?? 0.55) * 100}%;height:9%`
        m.querySelector('.good').style.cssText = `bottom:${((cues.green ?? 0.55) - 0.07) * 100}%;height:23%`
      }
    }
    const st = $('mg-stamp')
    const sAt = resolve(C.stampAt, cues)
    if (sAt != null && t >= sAt) {
      const p = back(lin(t, sAt, sAt + 0.3))
      set(st, { opacity: t < sAt + C.stampHold ? 1 : 1 - lin(t, sAt + C.stampHold, sAt + C.stampHold + 0.3), left: C.stampPos[0] + 'px', top: C.stampPos[1] + 'px', transform: `scale(${2 - p}) rotate(${-8 + 3 * p}deg)` })
    } else st.style.opacity = 0

    // ---- impact: flash, big word, confetti, screen shake
    const hit = cues.impact
    const big = $('mg-big')
    if (hit != null && t >= hit) {
      const p = lin(t, hit, hit + 0.28)
      set($('mg-flash'), { opacity: 0.85 * (1 - lin(t, hit, hit + 0.18)) })
      set(big, { opacity: 1 - lin(t, hit + 1.0, hit + 1.3), transform: `scale(${2.6 - 1.6 * back(p)}) rotate(${-6 + 2 * Math.sin(t * 3)}deg)` })
      const dt = t - hit
      conf.forEach((c) => {
        const x = c.x + c.vx * dt * 0.5
        const y = c.y + c.vy * dt + 1500 * dt * dt
        set(c.d, { opacity: dt < 2.8 ? 1 : 0, transform: `translate(${x}px, ${y}px) rotate(${c.r + c.vr * dt}deg)` })
      })
      const sk = dt < 0.45 ? (1 - dt / 0.45) * 22 : 0
      document.body.style.transform = sk ? `translate(${Math.sin(t * 97) * sk}px, ${Math.cos(t * 83) * sk}px)` : ''
    } else {
      big.style.opacity = 0
      $('mg-flash').style.opacity = 0
      conf.forEach((c) => (c.d.style.opacity = 0))
    }

    // ---- scoreboard flip + win probability count-up
    if (hit != null && t >= hit + 0.9) {
      const p = easeOut(lin(t, hit + 0.9, hit + 1.25))
      set($('mg-score'), { opacity: 1, transform: `translateX(${(1 - p) * -700}px)` })
      const flip = lin(t, hit + 1.4, hit + 1.6)
      $(C.scoreFlip[0]).textContent = flip > 0.5 ? C.scoreFlip[1] : C.scoreFlip[2]
      $(C.scoreFlip[0]).style.transform = `scaleY(${Math.abs(1 - 2 * flip) || 0.05})`
      const q = easeOut(lin(t, hit + 1.3, hit + 1.6))
      set($('mg-wp'), { opacity: 1, transform: `translateX(${(1 - q) * -760}px)` })
      const k = easeInOut(lin(t, hit + 1.6, hit + 2.6))
      const v = Math.round(C.wp[0] + (C.wp[1] - C.wp[0]) * k)
      $('mg-wpn').textContent = `${C.wp[0]}% ➜ ${v}%`
      $('mg-wpb').style.width = `${v}%`
      const s2 = $('mg-stamp2')
      const sp = back(lin(t, hit + 2.7, hit + 3))
      set(s2, { opacity: t >= hit + 2.7 ? 1 : 0, left: '470px', top: '1420px', transform: `scale(${2 - sp}) rotate(${6 - 2 * sp}deg)` })
    } else {
      $('mg-score').style.opacity = 0
      $('mg-wp').style.opacity = 0
      $('mg-stamp2').style.opacity = 0
    }

    // ---- end card
    const es = cues.end
    const end = $('mg-end')
    if (es != null && t >= es) {
      const p = easeInOut(lin(t, es, es + 0.45))
      end.style.opacity = 1
      end.style.clipPath = `circle(${p * 150}% at 50% 60%)`
      const el = (sel, a, from = 60) => {
        const q = back(lin(t, es + a, es + a + 0.35))
        const x = end.querySelector(sel)
        x.style.opacity = lin(t, es + a, es + a + 0.15)
        x.style.translate = `0 ${(1 - q) * from}px`
      }
      el('.icon', 0.25, -120)
      end.querySelector('.icon').style.rotate = `${Math.sin((t - es) * 3) * 6}deg`
      el('.name', 0.4)
      el('.tag', 0.6)
      el('.btn', 0.8)
      end.querySelector('.btn').style.scale = `${1 + 0.04 * Math.sin((t - es) * 7)}`
      el('.url', 0.95)
      el('.share', 1.15)
      ;[...end.querySelectorAll('.rings i')].forEach((r, i) => {
        const s = ((t - es) * 260 + i * 260) % 1040
        set(r, { width: s + 'px', height: s + 'px', left: -s / 2 + 'px', top: -s / 2 + 'px', opacity: 1 - s / 1040 })
      })
    } else end.style.opacity = 0
  }

  // a cue spec is a number (seconds) or [cueName, offset]
  function resolve(spec, cues) {
    if (spec == null) return null
    if (typeof spec === 'number') return spec
    const base = cues[spec[0]]
    return base == null ? Infinity : base + spec[1]
  }
})()
