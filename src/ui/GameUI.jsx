import { useEffect, useState } from 'react'
import confetti from 'canvas-confetti'
import { PLAYS } from '../sim/playSim'
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

export function PlayCards({ onCall, disabled }) {
  return (
    <div className="plays">
      {Object.values(PLAYS).map((p) => {
        const meta = PLAY_META[p.id]
        return (
          <button key={p.id} className="play" onClick={() => onCall(p.id)} disabled={disabled}>
            <RouteIcon id={p.id} />
            <span className="play-text">
              <strong>{p.label}</strong>
              <span>{p.detail}</span>
            </span>
            <span className={`tag ${meta.tone}`}>{meta.tag}</span>
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ result banner
export function headlineFor(result) {
  if (!result) return null
  if (result.kind === 'touchdown') return { big: 'TOUCHDOWN!', tone: 'td' }
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
