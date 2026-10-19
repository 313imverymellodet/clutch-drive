import { useEffect, useRef, useState } from 'react'
import { BEATS, COVERAGES, COVERAGE_IDS, FAMILY_LABEL, HOOP, SETS, SET_IDS } from './sets'
import { NBA_TEAMS } from './teams'
import { fmtClock } from './game'
import { TeamLogo } from '../game/real'

const READ_COLORS = ['#ffd400', '#ffffff', '#8fd3ff', '#c9a7ff']
export const openTone = (open) => (open > 5.5 ? '#2ecc71' : open > 3 ? '#ffd400' : '#ff4d4d')
const lastName = (name) => (name ? name.split(' ').slice(1).join(' ') || name : null)
const haptic = (ms = 12) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not supported */
  }
}

// ------------------------------------------------------------------ scorebug
export function HoopsBug({ g, you, them, shotClock = null }) {
  const late = g.clock <= 24
  return (
    <div className="bug hbug" role="status" aria-label="Scoreboard">
      <div className="bug-row">
        <span className="bug-team" style={{ background: you.jersey, color: '#fff' }}>
          <TeamLogo abbr={you.abbr} league="nba" size={18} className="bug-logo" />
          {you.abbr}
          {g.poss === 'you' && <span className="bug-poss" aria-label="Your ball">●</span>}
        </span>
        <span className="bug-score">{g.scoreYou}</span>
        <span className={`bug-clock${late ? ' late' : ''}`}>
          <small>{g.ot ? 'OT' : '4TH'}</small> {fmtClock(g.clock)}
          {shotClock != null && shotClock < g.clock && <span className="shot-clock">{Math.ceil(shotClock)}</span>}
        </span>
        <span className="bug-score">{g.scoreThem}</span>
        <span className="bug-team" style={{ background: them.jersey, color: '#fff' }}>
          <TeamLogo abbr={them.abbr} league="nba" size={18} className="bug-logo" />
          {them.abbr}
          {g.poss === 'them' && <span className="bug-poss" aria-label="Their ball">●</span>}
        </span>
      </div>
      <div className="bug-sub">
        <span>{g.poss === 'you' ? 'Your ball' : 'Their ball'}{g.inbound > 0 ? ' · backcourt' : ' · frontcourt'}</span>
        {g.log.length > 0 && <span className="bug-strip" aria-label="Possessions so far">{g.log.slice(-8).map((p) => p.emoji).join('')}</span>}
        <span className="bug-tos" aria-label={`${g.timeouts} timeouts left`}>
          {[0, 1].map((i) => (
            <i key={i} className={i < g.timeouts ? 'on' : ''} />
          ))}
        </span>
      </div>
    </div>
  )
}

export function PossessionStrip({ log }) {
  if (!log.length) return null
  return (
    <div className="drive-strip" aria-label="Possessions so far">
      {log.map((p, i) => (
        <span key={i}>{p.emoji}</span>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ set diagrams
/** Half-court chalkboard: each player's path, reads colored in order, screens as bars. */
export function SetDiagram({ id, className = 'set-icon' }) {
  const set = SETS[id]
  const X = (x) => 40 + x * 1.45
  const Y = (z) => 6 + z * 1.2
  const order = set.reads.map(([k]) => k)
  return (
    <svg viewBox="0 0 80 46" className={className} aria-hidden="true">
      <rect x="3.5" y="5" width="73" height="40" rx="2" className="ct" />
      <path d={`M${X(-22)} ${Y(0)} V${Y(14.2)} A ${23.75 * 1.45} ${23.75 * 1.2} 0 0 0 ${X(22)} ${Y(14.2)} V${Y(0)}`} className="ct" />
      <rect x={X(-8)} y={Y(0)} width={16 * 1.45} height={19 * 1.2} className="ct" />
      <circle cx={X(HOOP.x)} cy={Y(HOOP.z)} r="1.5" className="rim" />
      {Object.entries(set.paths).map(([k, path]) => {
        const i = order.indexOf(k)
        const color = k === set.handler ? '#ffffff' : i >= 0 ? READ_COLORS[i] : 'rgba(255,255,255,0.35)'
        const pts = path.map(([, x, z]) => `${X(x).toFixed(1)},${Y(z).toFixed(1)}`)
        const [lx, ly] = pts[pts.length - 1].split(',').map(Number)
        return (
          <g key={k}>
            {pts.length > 1 && <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={k === set.handler ? 1.8 : 1.4} strokeLinecap="round" strokeDasharray={k === set.handler ? '3 1.6' : undefined} />}
            <circle cx={pts[0].split(',')[0]} cy={pts[0].split(',')[1]} r="2" fill={color} opacity="0.9" />
            {pts.length > 1 && <circle cx={lx} cy={ly} r="1.1" fill={color} />}
          </g>
        )
      })}
      {set.screens.map((s, i) => {
        const p = set.paths[s.by]
        const w = p.find(([t]) => t >= s.from) ?? p[p.length - 1]
        return <rect key={i} x={X(w[1]) - 2.5} y={Y(w[2]) - 0.6} width="5" height="1.6" fill="#ff8a3d" />
      })}
    </svg>
  )
}

export function SetPicker({ onCall, shown, canTimeout, timeoutOn, setTimeoutOn, scout, hot = null }) {
  const [sel, setSel] = useState(null)
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.target.closest?.('select, input')) return
      const i = Number(e.key) - 1
      if (SET_IDS[i]) setSel(SET_IDS[i])
      else if (e.key === 'Enter' && sel) (e.preventDefault(), onCall(sel))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="sheet hsheet">
      <div className="sheet-head">
        <span className="sheet-title">Call a set</span>
        <span className="look-chip">They’re showing: <b>{COVERAGES[shown]?.short}</b></span>
      </div>
      {scout && <div className="scout-line">🧢 {scout}</div>}
      {hot && <div className="scout-line hot-line">🔥 Heating up: {Object.keys(hot).join(', ')}. Get him the ball.</div>}
      <div className="set-cards">
        {SET_IDS.map((id, i) => (
          <button key={id} className={`set-card${sel === id ? ' on' : ''}${BEATS[id].includes(shown) ? ' good' : ''}`} onClick={() => (sel === id ? onCall(id) : setSel(id))}>
            <span className="kbd" aria-hidden="true">{i + 1}</span>
            {BEATS[id].includes(shown) && <span className="good-mark" title={`Good against ${COVERAGES[shown].short} (if that's really what they're in)`}>✓</span>}
            <SetDiagram id={id} />
            <strong>{SETS[id].label}</strong>
            <span className="tag green">Beats {BEATS[id].map((c) => COVERAGES[c].short).join(' / ')}</span>
          </button>
        ))}
      </div>
      {sel && <p className="pb-desc set-desc">{FAMILY_LABEL[SETS[sel].family]}: {SETS[sel].desc}</p>}
      <div className="call-row">
        {canTimeout && (
          <label className={`to-toggle${timeoutOn ? ' on' : ''}`}>
            <input type="checkbox" checked={timeoutOn} onChange={(e) => setTimeoutOn(e.target.checked)} />
            Timeout: advance the ball (saves ~4s)
          </label>
        )}
        <button className="btn primary big snap" disabled={!sel} onClick={() => onCall(sel)}>
          {sel ? `Run ${SETS[sel].label}` : 'Pick a set'}
        </button>
      </div>
    </div>
  )
}

export function CoveragePicker({ onLock, onFoul, canFoul, tip, theirSets = [] }) {
  const [call, setCall] = useState('man')
  // scouting: the set they've run most, and which coverages it hurts
  const counts = {}
  for (const id of theirSets) counts[id] = (counts[id] ?? 0) + 1
  const fav = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  const favSet = fav && fav[1] >= 2 ? fav[0] : null
  return (
    <div className="sheet hsheet defpick">
      <div className="sheet-head">
        <span className="sheet-title">Get a stop</span>
      </div>
      {tip && <div className="scout-line">🧢 {tip}</div>}
      {favSet && <div className="scout-line">📋 They keep running {SETS[favSet].label} ({fav[1]}×). It hurts {BEATS[favSet].map((c) => COVERAGES[c].short).join(' and ')}.</div>}
      <div className="covs">
        {COVERAGE_IDS.map((c) => (
          <button key={c} className={`cov${call === c ? ' on' : ''}`} onClick={() => setCall(c)}>
            <strong>{COVERAGES[c].name}{favSet && BEATS[favSet].includes(c) ? ' ⚠️' : ''}</strong>
            <span>{COVERAGES[c].blurb}</span>
          </button>
        ))}
      </div>
      <p className="fine def-help">During their play: <b>Contest</b> (C) right as the shooter rises, <b>Double</b> (X) to trap the ball, <b>Foul</b> (F) to stop the clock.</p>
      <div className="call-row">
        {canFoul && (
          <button className="btn danger" onClick={onFoul} title="Stop the clock: they shoot two free throws">
            Foul now ⏱
          </button>
        )}
        <button className="btn primary big lock" onClick={() => onLock(call)}>Lock it in</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ live controls
/**
 * Your possession, live: pass (buttons, rings, 1-4), shoot (tap to rise, tap again at the top to release),
 * drive (D), stepback (S). Do nothing and your guys run the set themselves.
 */
export function HoopsControls({ sim, onFoul, firstTime = false }) {
  const [c, setC] = useState(null)
  useEffect(() => {
    const id = setInterval(() => setC(sim.controls()), 60)
    return () => clearInterval(id)
  }, [sim])
  const send = (cmd) => {
    if (sim.input(cmd)) haptic()
    setC(sim.controls())
  }
  const shoot = () => {
    const now = sim.controls()
    if (now?.mode === 'shooting') send({ type: 'release' })
    else send({ type: 'shoot' })
  }
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const now = sim.controls()
      if (!now) return
      const k = e.key.toLowerCase()
      if (now.mode === 'defense') {
        if (k === 'f') (onFoul ? onFoul() : send({ type: 'foul' }))
        else if (k === 'c' || k === ' ') send({ type: 'contest' })
        else if (k === 'x') send({ type: 'double' })
        else return
      } else if (k === ' ' || k === 'enter') shoot()
      else if (now.mode === 'offense' && /^[1-4]$/.test(k)) send({ type: 'pass', key: now.mates[+k - 1].key })
      else if (now.mode === 'offense' && k === 'd') send({ type: 'drive' })
      else if (now.mode === 'offense' && k === 's') send({ type: 'stepback' })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!c) return null
  if (c.mode === 'defense') {
    return (
      <div className="live-controls" role="group" aria-label="Defense controls">
        <div className={`lc-hint${c.shooting ? ' alert' : ''}`}>
          {c.shooting ? 'HE’S RISING. CONTEST NOW!' : c.trapped ? 'Trapped! Watch the open man.' : 'Contest when he rises. Too early and he blows by you.'}
        </div>
        <div className="lc-row">
          <button className={`lc-btn big${c.shooting ? ' pulse' : ''}`} disabled={!c.canContest} onPointerDown={() => send({ type: 'contest' })}>✋ Contest <kbd>C</kbd></button>
          <button className="lc-btn" disabled={!c.canDouble} onPointerDown={() => send({ type: 'double' })}>Double <kbd>X</kbd></button>
          <button className="lc-btn" onPointerDown={() => send({ type: 'foul' })}>Foul ⏱ <kbd>F</kbd></button>
        </div>
      </div>
    )
  }
  if (c.mode === 'passing') return null
  if (c.mode === 'shooting') {
    const m = c.meter
    return (
      <div className="live-controls shooting" role="group" aria-label="Shot meter">
        <div className="meter" aria-label="Release timing">
          <span className="meter-good" style={{ left: `${m.good[0] * 100}%`, width: `${(m.good[1] - m.good[0]) * 100}%` }} />
          <span className="meter-green" style={{ left: `${m.green[0] * 100}%`, width: `${(m.green[1] - m.green[0]) * 100}%` }} />
          <span className="meter-fill" style={{ width: `${m.progress * 100}%` }} />
        </div>
        <button className="lc-btn big release" disabled={c.released} onPointerDown={shoot}>
          {c.released ? 'In the air…' : 'RELEASE at the top! (Space)'}
        </button>
      </div>
    )
  }
  return (
    <div className="live-controls qb" role="group" aria-label="Offense controls">
      <div className="lc-hint">
        {c.manual
          ? `${c.holder.hot ? '🔥 ' : ''}${lastName(c.holder.name) ?? `#${c.holder.number}`} has it. Shot clock ${Math.ceil(c.shotClock)}.`
          : firstTime
            ? 'Shoot: tap once to rise, tap again when the bar hits green. Or tap a teammate to pass.'
            : 'Tap a teammate to pass, or take over. Do nothing and they run the set.'}
      </div>
      <div className="lc-reads four">
        {c.mates.map((m, i) => (
          <button key={m.key} className="lc-read" style={{ '--tone': openTone(m.open) }} onPointerDown={() => send({ type: 'pass', key: m.key })}>
            <span className="lc-n">{i + 1}</span>
            <span className="lc-name">{m.hot ? '🔥' : ''}{lastName(m.name) ?? m.key}</span>
            <span className="lc-dot" />
          </button>
        ))}
      </div>
      <div className="lc-row">
        <button className="lc-btn" onPointerDown={() => send({ type: 'drive' })} disabled={c.layup}>Drive <kbd>D</kbd></button>
        <button className="lc-btn" onPointerDown={() => send({ type: 'stepback' })}>Stepback <kbd>S</kbd></button>
        <button className="lc-btn big" onPointerDown={shoot} style={{ '--tone': openTone(c.self) }}>
          {c.layup ? 'Layup' : c.three ? 'Shoot 3' : 'Shoot'} <kbd>Space</kbd>
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ free throws
/** Two (or three) free throws: stop the marker in the green. Your touch decides it, plus a little luck. */
export function FreeThrows({ n = 2, rng, onDone, title = 'Free throws' }) {
  const [shot, setShot] = useState(0)
  const [results, setResults] = useState([])
  const [pos, setPos] = useState(0)
  const [locked, setLocked] = useState(false)
  const start = useRef(performance.now())
  useEffect(() => {
    let raf
    const tick = () => {
      if (!locked) {
        const t = (performance.now() - start.current) / 1000
        setPos(0.5 + 0.5 * Math.sin(t * (2.6 + shot * 0.5)))
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [locked, shot])
  const shoot = () => {
    if (locked) return
    setLocked(true)
    const err = Math.abs(pos - 0.5)
    const p = err < 0.06 ? 0.95 : err < 0.15 ? 0.8 : err < 0.28 ? 0.55 : 0.25
    const made = rng() < p
    haptic(made ? 30 : 12)
    const next = [...results, made]
    setResults(next)
    setTimeout(() => {
      if (next.length >= n) onDone(next.filter(Boolean).length)
      else {
        setShot((s) => s + 1)
        start.current = performance.now()
        setLocked(false)
      }
    }, 900)
  }
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === ' ' || e.key === 'Enter') (e.preventDefault(), shoot())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="sheet ft-card" role="group" aria-label="Free throws">
      <div className="sheet-head">
        <span className="sheet-title">🎯 {title}</span>
        <span className="ft-dots">
          {Array.from({ length: n }, (_, i) => (
            <i key={i} className={results[i] == null ? '' : results[i] ? 'made' : 'missed'} />
          ))}
        </span>
      </div>
      <div className="ft-meter">
        <span className="ft-green" />
        <span className="ft-mark" style={{ left: `${pos * 100}%` }} />
      </div>
      <button className="btn primary big" onClick={shoot} disabled={locked}>
        {locked ? (results.at(-1) ? 'Swish! ✅' : 'Clank ❌') : `Shoot free throw ${shot + 1} (Space)`}
      </button>
    </div>
  )
}

export function NbaTeamSelect({ label, value, onChange }) {
  return (
    <label className="team-select">
      <span>{label}</span>
      <span className="ts-row">
        <TeamLogo abbr={value} league="nba" size={28} />
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {NBA_TEAMS.map((t) => (
            <option key={t.abbr} value={t.abbr}>{t.city} {t.name}</option>
          ))}
        </select>
      </span>
    </label>
  )
}

export function hoopsHeadline(team, r, offReb) {
  if (!r) return null
  const mine = team === 'you'
  if (r.kind === 'make' || r.kind === 'and1') {
    const big = r.kind === 'and1' ? 'AND ONE!' : r.shot?.buzzer ? 'BUZZER BEATER!' : r.points === 3 ? (mine ? 'BANG! THREE!' : 'THEY HIT A THREE') : mine ? 'BUCKET!' : 'THEY SCORE'
    return { big, tone: mine ? (r.points === 3 || r.shot?.buzzer ? 'td' : 'good') : 'bad' }
  }
  if (r.kind === 'miss') return { big: offReb ? (mine ? 'OFFENSIVE BOARD!' : 'THEY GRAB THE BOARD') : mine ? 'NO GOOD' : 'STOP!', tone: offReb ? (mine ? 'ok' : 'bad') : mine ? 'bad' : 'good' }
  if (r.kind === 'steal') return { big: mine ? 'STOLEN!' : 'PICKED HIS POCKET!', tone: mine ? 'bad' : 'good' }
  if (r.kind === 'shotclock') return { big: 'SHOT CLOCK!', tone: mine ? 'bad' : 'good' }
  if (r.kind === 'clock') return { big: 'TIME!', tone: 'ok' }
  if (r.kind === 'fouled' || r.kind === 'foulDrawn' || r.kind === 'ft') return { big: 'TO THE LINE', tone: 'ok' }
  return { big: r.kind.toUpperCase(), tone: 'ok' }
}
