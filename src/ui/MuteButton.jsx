import { useEffect, useState } from 'react'
import { isMuted, onMuteChange, setMuted, sfx, unlock } from '../game/sound'

/** Sound on/off. Kept in its own module so the app shell doesn't pull in the game engines. */
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
        if (m) sfx.check() // just unmuted: a quick crowd pop so you know it's working
      }}
    >
      {m ? '🔇' : '🔊'}
    </button>
  )
}
