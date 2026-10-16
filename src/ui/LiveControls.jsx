import { useEffect, useState } from 'react'
import { openTone } from '../components/LiveRings'

/** "Amon-Ra St. Brown" -> "St. Brown": last names fit three across on a phone. */
const lastName = (name) => name.split(' ').slice(1).join(' ') || name

const haptic = (ms = 12) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not supported */
  }
}

/**
 * "You're the QB now": during the play, throw to a read (buttons, rings on the field, or 1-3), pump fake,
 * throw it away or take off. After the catch: juke, spin, get to the sideline, or get down.
 * Do nothing and the QB works the progression himself.
 */
export function LiveControls({ sim }) {
  const [c, setC] = useState(null)
  useEffect(() => {
    const id = setInterval(() => setC(sim.controls()), 90)
    return () => clearInterval(id)
  }, [sim])

  const send = (cmd) => {
    if (sim.input(cmd)) haptic()
    setC(sim.controls())
  }

  // keyboard: 1-3 throw, Q pump, X throw away, S scramble / sideline, arrows juke, Up spin, Down get down
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const now = sim.controls()
      if (!now) return
      const k = e.key
      if (now.mode === 'qb') {
        const r = now.reads.find((x) => String(x.n) === k)
        if (r) send({ type: 'throw', key: r.key })
        else if (k === 'q' || k === 'Q') send({ type: 'pump' })
        else if (k === 'x' || k === 'X') send({ type: 'away' })
        else if (k === 's' || k === 'S') send({ type: 'scramble' })
        else return
      } else {
        if (k === 'ArrowLeft') send({ type: 'juke', dir: 1 }) // screen-left is world +x from the broadcast camera
        else if (k === 'ArrowRight') send({ type: 'juke', dir: -1 })
        else if (k === 'ArrowUp') send({ type: 'spin' })
        else if (k === 'ArrowDown') send({ type: 'slide' })
        else if (k === 's' || k === 'S') send({ type: 'sideline' })
        else return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!c) return null
  if (c.mode === 'qb') {
    return (
      <div className="live-controls qb" role="group" aria-label="Quarterback controls">
        <div className="lc-hint">{c.manual ? (c.queued ? 'Ball’s coming out…' : 'Your call. Don’t hold it too long!') : 'Tap a receiver to throw. Do nothing and your QB reads it.'}</div>
        <div className="lc-reads">
          {c.reads.map((r) => (
            <button key={r.key} className={`lc-read${c.queued === r.key ? ' on' : ''}`} style={{ '--tone': openTone(r.open) }} onPointerDown={() => send({ type: 'throw', key: r.key })}>
              <span className="lc-n">{r.n}</span>
              <span className="lc-name">{r.name ? lastName(r.name) : `#${r.number}`}</span>
              <span className="lc-dot" aria-label={r.open > 0.4 ? 'open' : r.open > -0.4 ? 'tight' : 'covered'} />
            </button>
          ))}
        </div>
        <div className="lc-row">
          <button className="lc-btn" disabled={!c.ready || c.pumping} onPointerDown={() => send({ type: 'pump' })}>Pump fake <kbd>Q</kbd></button>
          <button className="lc-btn" disabled={!c.ready} onPointerDown={() => send({ type: 'away' })}>Throw away <kbd>X</kbd></button>
          <button className="lc-btn" onPointerDown={() => send({ type: 'scramble' })}>Scramble <kbd>S</kbd></button>
        </div>
      </div>
    )
  }
  return (
    <div className="live-controls run" role="group" aria-label="Ball carrier controls">
      <div className="lc-hint">{c.name} has it!</div>
      <div className="lc-row">
        <button className="lc-btn big" disabled={c.cooldown > 0} onPointerDown={() => send({ type: 'juke', dir: 1 })}>◀ Juke</button>
        <button className="lc-btn big" disabled={c.cooldown > 0} onPointerDown={() => send({ type: 'spin' })}>Spin ↑</button>
        <button className="lc-btn big" disabled={c.cooldown > 0} onPointerDown={() => send({ type: 'juke', dir: -1 })}>Juke ▶</button>
      </div>
      <div className="lc-row">
        <button className={`lc-btn${c.sideline ? ' on' : ''}`} onPointerDown={() => send({ type: 'sideline' })}>⏱ Get out of bounds <kbd>S</kbd></button>
        <button className="lc-btn" onPointerDown={() => send({ type: 'slide' })}>Get down ↓</button>
      </div>
    </div>
  )
}
