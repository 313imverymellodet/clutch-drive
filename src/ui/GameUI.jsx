import { useEffect, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import { COVERAGES, PLAYS } from '../sim/playSim'
import { FAMILIES } from '../sim/playbook'
import { isMuted, onMuteChange, setMuted, sfx, unlock } from '../game/sound'
import { downAndDistance, fmtBallOn, fmtClock, QUARTER_LABEL } from '../game/drive'
import { TeamLogo } from '../game/real'
import { trackEvent } from '../analytics'

// ------------------------------------------------------------------ scorebug
export function Scorebug({ drive, offense, defense, clock, running }) {
  const late = clock <= 30
  return (
    <div className="bug" role="status" aria-label="Scoreboard">
      <div className="bug-row">
        <span className="bug-team" style={{ background: offense.endzone, color: offense.text }}>
          <TeamLogo abbr={offense.abbr} size={18} className="bug-logo" />
          {offense.abbr}
          <span className="bug-poss" role="img" aria-label="Your ball">●</span>
        </span>
        <span className="bug-score">{drive.scoreOff}</span>
        <span className={`bug-clock${late ? ' late' : ''}${running ? ' running' : ''}`}>
          <small>{QUARTER_LABEL}</small> {fmtClock(clock)}
        </span>
        <span className="bug-score">{drive.scoreDef}</span>
        <span className="bug-team" style={{ background: defense.endzone, color: defense.text }}>
          <TeamLogo abbr={defense.abbr} size={18} className="bug-logo" />
          {defense.abbr}
        </span>
      </div>
      <div className="bug-sub">
        <span>{downAndDistance(drive)} · {fmtBallOn(drive.ballOn)}</span>
        <span className="bug-tos" role="img" aria-label={`${drive.timeouts} timeouts left`}>
          {[0, 1, 2].map((i) => (
            <i key={i} className={i < drive.timeouts ? 'on' : ''} />
          ))}
        </span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ play cards
const PLAY_META = {
  out: { tag: 'Stops clock', tone: 'blue' },
  dig: { tag: 'Chunk gain', tone: 'green' },
  deep: { tag: 'Boom or bust', tone: 'red' },
  run: { tag: 'Clock runs', tone: 'amber' },
}

/** Tiny chalkboard diagram: offense moves up. */
function RouteIcon({ id }) {
  const paths = {
    out: 'M40 40 V22 H58',
    dig: 'M52 40 V12 H18',
    deep: 'M14 40 V4',
    run: 'M36 46 L30 36 V8',
  }
  return (
    <svg viewBox="0 0 64 50" className="route-icon" aria-hidden="true">
      <line x1="2" y1="40" x2="62" y2="40" className="los" />
      {[22, 28, 34, 40].map((x) => (
        <circle key={x} cx={x - 1} cy="43" r="2.4" className="o" />
      ))}
      <path d={paths[id]} className="route" markerEnd="url(#arrow)" />
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="arrowhead" />
        </marker>
      </defs>
    </svg>
  )
}

/**
 * Mouse: hovering a card draws its routes on the field, click snaps it.
 * Touch: first tap previews ("tap again to snap"), second tap snaps. Keys 1-4 snap directly.
 */
export function PlayCards({ onCall, onPreview, disabled }) {
  const [armed, setArmed] = useState(null)
  const pointer = useRef('mouse')
  const plays = Object.values(PLAYS)
  useEffect(() => {
    const onKey = (e) => {
      if (disabled || e.metaKey || e.ctrlKey || e.altKey) return
      const i = Number(e.key) - 1
      if (plays[i]) onCall(plays[i].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="plays" onMouseLeave={() => pointer.current === 'mouse' && onPreview?.(null)}>
      {plays.map((p, i) => {
        const meta = PLAY_META[p.id]
        const isArmed = armed === p.id
        return (
          <button
            key={p.id}
            className={`play${isArmed ? ' armed' : ''}`}
            disabled={disabled}
            onPointerDown={(e) => (pointer.current = e.pointerType)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && onPreview?.(p.id)}
            onClick={() => {
              if (pointer.current !== 'mouse' && !isArmed) {
                setArmed(p.id)
                onPreview?.(p.id)
                sfx.click()
                return
              }
              onCall(p.id)
            }}
          >
            <span className="kbd" aria-hidden="true">{i + 1}</span>
            <RouteIcon id={p.id} />
            <span className="play-text">
              <strong>{p.label}</strong>
              <span>{isArmed ? 'Tap again to snap it' : p.detail}</span>
            </span>
            <span className={`tag ${meta.tone}`}>{meta.tag}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Where the ball is on the field, the line to gain, and both end zones. */
export function FieldBar({ drive, offense, defense }) {
  const pct = (yd) => `${Math.max(0, Math.min(100, yd))}%`
  const line = Math.min(100, drive.ballOn + drive.toGo)
  return (
    <div className="fieldbar" aria-label={`Ball on the ${drive.ballOn < 50 ? 'own ' + drive.ballOn : 'opponent ' + (100 - drive.ballOn)}`}>
      <span className="fb-ez" style={{ background: offense.endzone }} />
      <div className="fb-field">
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => (
          <i key={y} className="fb-yd" style={{ left: pct(y) }} />
        ))}
        <span className="fb-redzone" />
        {line < 100 && <span className="fb-line" style={{ left: pct(line) }} />}
        <span className="fb-ball" style={{ left: pct(drive.ballOn) }}>🏈</span>
      </div>
      <span className="fb-ez" style={{ background: defense.endzone }} />
    </div>
  )
}

/** The look the defense is showing, plus one line from the coach. */
export function DefenseRead({ shown, tip, keyOn = null }) {
  const c = COVERAGES[shown]
  return (
    <div className="read">
      <span className="read-chips">
        <span className={`read-chip ${shown}`}>
          <b>D</b> {c.short}
        </span>
        {keyOn && keyOn.s >= 0.5 && (
          <span className={`key-chip${keyOn.s >= 1 ? ' hot' : ''}`} title="The defense is anticipating this play">
            👀 Keying: {FAMILIES[keyOn.family]?.label ?? PLAYS[keyOn.play]?.label}
          </span>
        )}
      </span>
      <span className="read-tip">🧢 {tip}</span>
    </div>
  )
}

export { MuteButton } from './MuteButton'

// ------------------------------------------------------------------ result banner
export function headlineFor(result) {
  if (!result) return null
  if (result.kind === 'touchdown') return { big: 'TOUCHDOWN!', tone: 'td' }
  if (result.kind === 'interception') return { big: 'INTERCEPTED!', tone: 'bad' }
  if (result.kind === 'sack') return { big: 'SACKED!', tone: 'bad' }
  if (result.kind === 'incomplete') return { big: 'INCOMPLETE', tone: 'bad' }
  if (result.kind === 'spike') return { big: 'SPIKED', tone: 'ok' }
  if (result.how === 'blast' && result.gain >= 3) return { big: 'QB BLAST!', tone: result.first ? 'good' : 'ok' }
  if (result.first) return { big: 'FIRST DOWN!', tone: 'good' }
  if (result.gain <= 0) return { big: 'STUFFED!', tone: 'bad' }
  if (result.kind === 'out') return { big: `+${result.gain} · OUT OF BOUNDS`, tone: 'ok' }
  return { big: `+${result.gain} YARDS`, tone: 'ok' }
}

export function ResultBanner({ result, message }) {
  const h = headlineFor(result)
  useEffect(() => {
    if (result?.kind !== 'touchdown') return
    const colors = ['#ffd400', '#ffffff', '#ff5a36', '#2f6cff']
    confetti({ particleCount: 140, spread: 80, origin: { y: 0.55 }, colors, disableForReducedMotion: true })
    setTimeout(() => confetti({ particleCount: 90, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors, disableForReducedMotion: true }), 250)
    setTimeout(() => confetti({ particleCount: 90, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors, disableForReducedMotion: true }), 400)
    try {
      navigator.vibrate?.([60, 40, 120])
    } catch {
      /* not supported */
    }
  }, [result])
  if (!h) return null
  return (
    <div className={`banner ${h.tone}`} key={h.big + message}>
      <div className="banner-big">{h.big}</div>
      {message && <div className="banner-sub">{message}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ drive strip
export function DriveStrip({ plays }) {
  if (!plays.length) return null
  return (
    <div className="strip" aria-label="Drive so far">
      {plays.map((p, i) => (
        <span key={i} title={p.playId}>{p.emoji}</span>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ share
export function ShareButton({ text, label = 'Share result', event = null }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const sent = (method) => event && trackEvent('share', { mode: event, method })
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text })
        sent('native')
        return
      }
    } catch {
      /* fall back to the clipboard */
    }
    try {
      await navigator.clipboard.writeText(text)
      sent('clipboard')
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      sent('prompt')
      window.prompt('Copy your result:', text)
    }
  }
  return (
    <button className="btn primary" onClick={share}>
      {copied ? 'Copied! Paste it anywhere' : label}
    </button>
  )
}

export function Countdown() {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const now = new Date()
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  const s = Math.floor((next - now) / 1000)
  const p = (n) => String(n).padStart(2, '0')
  return <span className="mono">{p(Math.floor(s / 3600))}:{p(Math.floor((s % 3600) / 60))}:{p(s % 60)}</span>
}

// ------------------------------------------------------------------ win probability
/**
 * Live win-probability meter. `p` is the current probability for the team shown; `last` is the value
 * before the most recent play, so the swing can be shown as a chip.
 */
export function WinProbMeter({ p, last = null, team, label = 'WIN PROB' }) {
  const pctNow = Math.round(p * 100)
  const delta = last == null ? 0 : Math.round((p - last) * 100)
  // use the team color, unless it's too dark (or white) to read on the dark meter: then its accent color
  const lum = (hex) => {
    const n = parseInt((hex ?? '#ffd400').slice(1), 16)
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  }
  const base = team?.endzone ?? '#ffd400'
  const color = lum(base) < 60 || lum(base) > 240 ? (lum(team?.stripe) >= 60 && lum(team?.stripe) <= 240 ? team.stripe : '#ffd400') : base
  return (
    <div className="wpm" role="meter" aria-valuenow={pctNow} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} ${pctNow}%`}>
      <span className="wpm-label">{label}</span>
      <span className="wpm-track">
        <span className="wpm-fill" style={{ width: `${Math.max(2, pctNow)}%`, background: color }} />
      </span>
      <span className="wpm-num">{pctNow}%</span>
      {delta !== 0 && <span className={`wpm-delta ${delta > 0 ? 'up' : 'down'}`} key={`${last}-${p}`}>{delta > 0 ? `+${delta}` : delta}</span>}
    </div>
  )
}

/** Win-probability trail across the drive (start + after each play). */
export function wpTrail(d) {
  return [d.wp0 ?? 0.2, ...d.plays.map((p) => p.wp).filter((x) => x != null)]
}

export function WPChart({ trail, invert = false, width = 260, height = 70 }) {
  const pts = trail.map((p) => (invert ? 1 - p : p))
  if (pts.length < 2) return null
  const x = (i) => 6 + (i / (pts.length - 1)) * (width - 12)
  const y = (p) => 6 + (1 - p) * (height - 12)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  const area = `${path} L${x(pts.length - 1)},${height - 6} L${x(0)},${height - 6} Z`
  return (
    <svg className="wpchart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Win probability went from ${Math.round(pts[0] * 100)}% to ${Math.round(pts.at(-1) * 100)}%`}>
      <line x1="6" x2={width - 6} y1={y(0.5)} y2={y(0.5)} className="wpchart-mid" />
      <path d={area} className="wpchart-area" />
      <path d={path} className="wpchart-line" />
      {pts.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p)} r={i === pts.length - 1 ? 3.5 : 2} className="wpchart-dot" />
      ))}
      <text x="8" y="14" className="wpchart-txt">{Math.round(pts[0] * 100)}%</text>
      <text x={width - 8} y="14" textAnchor="end" className="wpchart-txt">{Math.round(pts.at(-1) * 100)}%</text>
    </svg>
  )
}
