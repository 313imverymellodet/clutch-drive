import { useEffect, useRef, useState } from 'react'
import { isMuted, onMuteChange, setMuted, sfx, unlock } from '../game/sound'
import { FOOTBALL_CAMERAS, HOOPS_CAMERAS, reducedMotion, setSetting, useSettings } from '../game/settings'

/** Gear button + a small sheet: sound, volume, haptics, camera angle for this sport, reduced motion. */
export function SettingsButton({ sport = 'football' }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => wrap.current && !wrap.current.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="settings-wrap" ref={wrap}>
      <button className="icon-btn" aria-label="Settings" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        ⚙️
      </button>
      {open && <SettingsSheet sport={sport} />}
    </div>
  )
}

function SettingsSheet({ sport }) {
  const s = useSettings()
  const [muted, setM] = useState(isMuted())
  useEffect(() => onMuteChange(setM), [])
  const cams = sport === 'hoops' ? HOOPS_CAMERAS : FOOTBALL_CAMERAS
  const camKey = sport === 'hoops' ? 'hoopsCamera' : 'camera'
  const canBuzz = typeof navigator !== 'undefined' && 'vibrate' in navigator
  return (
    <div className="settings-sheet" role="dialog" aria-label="Settings">
      <div className="settings-title">Settings</div>
      <label className="set-row">
        <span>Sound</span>
        <input
          type="checkbox"
          checked={!muted}
          onChange={(e) => {
            unlock()
            setMuted(!e.target.checked)
            if (e.target.checked) sfx.check()
          }}
        />
      </label>
      <label className="set-row">
        <span>Volume</span>
        <input type="range" min="0.1" max="1" step="0.05" value={s.volume} disabled={muted} onChange={(e) => setSetting('volume', +e.target.value)} onPointerUp={() => sfx.check()} />
      </label>
      <label className="set-row">
        <span>
          Haptics{!canBuzz && <small> (not on this device)</small>}
        </span>
        <input type="checkbox" checked={s.haptics} disabled={!canBuzz} onChange={(e) => setSetting('haptics', e.target.checked)} />
      </label>
      <div className="set-row col">
        <span>Camera</span>
        <div className="seg" role="radiogroup" aria-label="Camera">
          {cams.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={s[camKey] === k} className={s[camKey] === k ? 'on' : ''} onClick={() => setSetting(camKey, k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="set-row">
        <span>
          Reduced motion<small>No celebration cam or confetti</small>
        </span>
        <input type="checkbox" checked={reducedMotion()} onChange={(e) => setSetting('reducedMotion', e.target.checked)} />
      </label>
    </div>
  )
}
