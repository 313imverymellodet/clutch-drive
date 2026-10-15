import { useEffect, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import { COVERAGES, PLAYS } from '../sim/playSim'
import { isMuted, onMuteChange, setMuted, sfx, unlock } from '../game/sound'
import { downAndDistance, fmtBallOn, fmtClock, QUARTER_LABEL } from '../game/drive'

// ------------------------------------------------------------------ scorebug
export function Scorebug({ drive, offense, defense, clock, running }) {
  const late = clock <= 30
  return (
    <div className="bug" role="status" aria-label="Scoreboard">
      <div className="bug-row">
        <span className="bug-team" style={{ background: offense.endzone, color: offense.text }}>
          {offense.abbr}
          <span className="bug-poss" aria-label="Your ball">●</span>
        </span>
        <span className="bug-score">{drive.scoreOff}</span>
        <span className={`bug-clock${late ? ' late' : ''}${running ? ' running' : ''}`}>
          <small>{QUARTER_LABEL}</small> {fmtClock(clock)}
        </span>
        <span className="bug-score">{drive.scoreDef}</span>
        <span className="bug-team" style={{ background: defense.endzone, color: defense.text }}>{defense.abbr}</span>
      </div>
      <div className="bug-sub">
        <span>{downAndDistance(drive)} · {fmtBallOn(drive.ballOn)}</span>
        <span className="bug-tos" aria-label={`${drive.timeouts} timeouts left`}>
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
export function DefenseRead({ shown, tip }) {
  const c = COVERAGES[shown]
  return (
    <div className="read">
      <span className={`read-chip ${shown}`}>
        <b>D</b> {c.short}
      </span>
      <span className="read-tip">🧢 {tip}</span>
    </div>
  )
}

export function MuteButton() {
  const [m, setM] = useState(isMuted())
  useEffect(() => onMuteChange(setM), [])
  return (
    <button
      className="icon-btn"
      aria-label={m ? 'Unmute sound' : 'Mute sound'}
      onClick={() => {
        unlock()
        setMuted(!m)
      }}
    >
      {m ? '🔇' : '🔊'}
    </button>
  )
}

// ------------------------------------------------------------------ result banner
export function headlineFor(result) {
  if (!result) return null
  if (result.kind === 'touchdown') return { big: 'TOUCHDOWN!', tone: 'td' }
  if (result.kind === 'interception') return { big: 'INTERCEPTED!', tone: 'bad' }
  if (result.kind === 'sack') return { big: 'SACKED!', tone: 'bad' }
  if (result.kind === 'incomplete') return { big: 'INCOMPLETE', tone: 'bad' }
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
export function ShareButton({ text, label = 'Share result' }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text })
        return
      }
    } catch {
      /* fall back to the clipboard */
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
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
