import { useEffect, useState } from 'react'
import { FAMILIES, PLAYBOOK, POS_LABEL, eligibleFor, playsByFamily } from '../sim/playbook'
import { COVERAGES, COVERAGE_IDS } from '../sim/playSim'
import { bestMatchup } from '../sim/aiOffense'
import { load, save } from '../game/storage'
import { sfx } from '../game/sound'
import { shortName } from '../game/real'

const READ_COLORS = ['#ffd400', '#ffffff', '#8fd3ff']
const CURATED = { out: 'Stops clock', blast: 'Power!', run: 'Clock runs', outside: 'Get the edge', draw: 'Vs. soft zones' }

/** Name a route from its shape (so the progression reads like a real call sheet). */
export function routeName(key, pts) {
  if (!pts) return 'Block'
  const first = pts[0]
  const last = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  const depth = last[1]
  const dx = last[0] - prev[0]
  const dz = last[1] - prev[1]
  const inward = Math.sign(dx) === -Math.sign(first[0] || 1)
  if (key === 'rb' && pts.length >= 4 && last[1] > 10) return 'Wheel'
  if (key === 'rb' && depth <= 2.5) return dx === 0 || Math.abs(dx) < 3 ? 'Check-down' : 'Flat'
  if (pts.length === 2) return depth >= 20 ? (Math.abs(first[0]) < 10 ? 'Seam' : 'Go') : 'Check-down'
  if (dz < -0.3) return depth < 8 ? 'Hitch' : inward ? 'Curl' : 'Comeback'
  if (Math.abs(dz) < Math.abs(dx) * 0.35) {
    if (depth < 4.2) return inward ? 'Drag' : 'Flat'
    if (depth < 8) return inward ? 'In' : 'Out'
    return inward ? 'Dig' : 'Out'
  }
  if (depth >= 15) return inward ? (Math.abs(dx) > 10 ? 'Cross' : 'Post') : 'Corner'
  if (depth < 8) return inward ? 'Slant' : 'Flat'
  return inward ? 'Cross' : 'Sail'
}

export function playTag(id) {
  if (CURATED[id]) return CURATED[id]
  const best = bestMatchup(id)
  return best ? `Beats ${best.name}` : PLAYBOOK[id].tag
}

const TAG_TONE = (id) => (id === 'out' ? 'blue' : PLAYBOOK[id].family === 'run' ? 'amber' : PLAYBOOK[id].family === 'deep' ? 'red' : 'green')

/** Mini play diagram drawn from the playbook's route data. */
export function PlayDiagram({ id, reads, flip = false, className = 'route-icon' }) {
  const p = PLAYBOOK[id]
  const fx = (x) => (flip ? -x : x)
  const X = (x) => 32 + fx(x) * 1.25
  const Y = (z) => 38 - z * 1.45
  const paths = []
  if (p.run) {
    paths.push({ d: p.run.path, color: READ_COLORS[0], w: 3.4 })
  } else {
    for (const k of eligibleFor(id)) {
      const i = reads.indexOf(k)
      paths.push({ d: p.routes[k], color: i >= 0 ? READ_COLORS[i] : 'rgba(255,255,255,0.35)', w: i === 0 ? 3.2 : i > 0 ? 2.4 : 1.6 })
    }
    paths.sort((a, b) => a.w - b.w)
  }
  return (
    <svg viewBox="0 0 64 50" className={className} aria-hidden="true">
      <line x1="2" y1="38" x2="62" y2="38" className="los" />
      {[-3.2, -1.6, 0, 1.6, 3.2].map((x) => (
        <circle key={x} cx={X(x)} cy="40" r="1.6" className="o" />
      ))}
      {paths.map((r, i) => {
        const pts = r.d.map(([x, z]) => `${X(x).toFixed(1)},${Math.max(2, Math.min(48, Y(z))).toFixed(1)}`)
        const [lx, ly] = pts[pts.length - 1].split(',').map(Number)
        const [px, py] = pts[pts.length - 2].split(',').map(Number)
        const ang = Math.atan2(ly - py, lx - px)
        const a1 = [lx - 3 * Math.cos(ang - 0.5), ly - 3 * Math.sin(ang - 0.5)]
        const a2 = [lx - 3 * Math.cos(ang + 0.5), ly - 3 * Math.sin(ang + 0.5)]
        return (
          <g key={i}>
            <polyline points={pts.join(' ')} fill="none" stroke={r.color} strokeWidth={r.w} strokeLinecap="round" strokeLinejoin="round" />
            <polygon points={`${lx},${ly} ${a1.join(',')} ${a2.join(',')}`} fill={r.color} />
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Offensive play caller: concept tabs, play cards, flip, and the read progression.
 * Mouse: hover previews on the field; click selects, click again (or SNAP) runs it.
 * Touch: tap selects + previews, tap again (or SNAP) runs it. Keys: 1-6 select, Enter snaps, F flips.
 */
export function Playbook({ onSnap, onPreview, disabled, compactHint, names = null }) {
  const [fam, setFam] = useState(() => load('cd.pb.fam', 'quick'))
  const [sel, setSel] = useState(null)
  const [flip, setFlip] = useState(false)
  const [reads, setReads] = useState([])
  const ids = playsByFamily(fam)

  const select = (id) => {
    setSel(id)
    setReads(PLAYBOOK[id].reads ?? [])
    sfx.click()
  }
  const snap = (id = sel) => {
    if (!id || disabled) return
    onSnap(id, PLAYBOOK[id].run ? null : (id === sel ? reads : PLAYBOOK[id].reads), id === sel ? flip : false)
  }
  useEffect(() => onPreview?.(sel ? { play: sel, reads, flip } : null), [sel, reads, flip]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => save('cd.pb.fam', fam), [fam])
  useEffect(() => {
    const onKey = (e) => {
      if (disabled || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('select, input')) return
      const i = Number(e.key) - 1
      if (ids[i]) select(ids[i])
      else if (e.key === 'Enter' && sel) (e.preventDefault(), snap())
      else if (e.key.toLowerCase() === 'f') setFlip((f) => !f)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const eligible = sel && !PLAYBOOK[sel].run ? eligibleFor(sel) : []
  const setSlot = (slot, key) => {
    const next = [...reads]
    const was = next.indexOf(key)
    if (was >= 0) next[was] = next[slot]
    next[slot] = key
    setReads(next.filter(Boolean))
  }

  return (
    <div className="playbook">
      <div className="pb-tabs" role="tablist">
        {Object.entries(FAMILIES).map(([k, f]) => (
          <button key={k} role="tab" aria-selected={fam === k} className={`pb-tab${fam === k && !sel ? ' on' : ''}`} onClick={() => (setFam(k), setSel(null))}>
            {f.label}
          </button>
        ))}
        <button className={`pb-flip${flip ? ' on' : ''}`} onClick={() => setFlip((f) => !f)} title="Run it to the other side (F)">
          ⇄ Flip
        </button>
      </div>
      {!sel && <div className="pb-cards">
        {ids.map((id, i) => {
          const p = PLAYBOOK[id]
          const on = sel === id
          return (
            <button
              key={id}
              className={`pb-card${on ? ' on' : ''}`}
              disabled={disabled}
              onClick={() => (on ? snap(id) : select(id))}
            >
              <span className="kbd" aria-hidden="true">{i + 1}</span>
              <PlayDiagram id={id} reads={on ? reads : p.reads ?? []} flip={on && flip} />
              <strong>{p.label}</strong>
              <span className={`tag ${TAG_TONE(id)}`}>{playTag(id)}</span>
            </button>
          )
        })}
      </div>}
      {sel && (
        <div className="pb-sel">
          <div className="pb-chosen">
            <PlayDiagram id={sel} reads={reads} flip={flip} />
            <div className="pb-chosen-text">
              <strong>{PLAYBOOK[sel].label}{flip ? ' ⇄' : ''}</strong>
              <span className={`tag ${TAG_TONE(sel)}`}>{playTag(sel)}</span>
              <span className="pb-desc">{PLAYBOOK[sel].desc}</span>
            </div>
            <button className="btn small" onClick={() => setSel(null)}>Change</button>
          </div>
          {eligible.length > 0 && (
            <div className="pb-reads">
              {['1st look', '2nd look', 'Check-down'].map((label, slot) => (
                <label key={label} className="pb-read" style={{ '--c': READ_COLORS[slot] }}>
                  <span>{label}</span>
                  <select value={reads[slot] ?? ''} onChange={(e) => setSlot(slot, e.target.value)}>
                    {eligible.map((k) => (
                      <option key={k} value={k}>{names?.[k] ? shortName(names[k]) : POS_LABEL[k]} · {routeName(k, PLAYBOOK[sel].routes[k])}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <button className="btn primary big snap" onClick={() => snap()} disabled={disabled}>
            Snap it{compactHint ? '' : ' ↵'}
          </button>
        </div>
      )}
      {!sel && <div className="pb-hint">{FAMILIES[fam].blurb} Tap a play to see it on the field.</div>}
    </div>
  )
}

/**
 * Defensive play caller: 8 coverages, an optional disguise (the shell they'll see), and a guess at what's coming.
 */
export function DefensePicker({ draft, setDraft, onLock, scoutLine, title }) {
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  return (
    <div className="sheet defpick">
      <div className="sheet-head">
        <span className="sheet-title">{title}</span>
      </div>
      {scoutLine && <div className="scout-line">🧢 {scoutLine}</div>}
      <div className="covs">
        {COVERAGE_IDS.map((c) => (
          <button key={c} className={`cov${draft.call === c ? ' on' : ''} ${c}`} onClick={() => set({ call: c, shown: draft.shown === c ? null : draft.shown })}>
            <strong>{COVERAGES[c].name}</strong>
            <span>{COVERAGES[c].blurb}</span>
          </button>
        ))}
      </div>
      <div className="defopts">
        <label className="team-select">
          <span>🎭 Show them</span>
          <select value={draft.shown ?? draft.call} onChange={(e) => set({ shown: e.target.value === draft.call ? null : e.target.value })}>
            {COVERAGE_IDS.map((c) => (
              <option key={c} value={c}>{c === draft.call ? `${COVERAGES[c].short} (no disguise)` : `${COVERAGES[c].short} (disguise)`}</option>
            ))}
          </select>
        </label>
        <div className="guess">
          <span className="guess-label">🔮 Guess what's coming (right: you jump it · wrong: a step slow)</span>
          <div className="chips">
            {[null, 'quick', 'mid', 'deep', 'run'].map((f) => (
              <button key={f ?? 'none'} className={`chip${draft.key === f ? ' on' : ''}`} onClick={() => set({ key: f })}>
                {f ? FAMILIES[f].label : 'No guess'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button className="btn primary big lock" onClick={onLock}>Lock it in</button>
    </div>
  )
}
