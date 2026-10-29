import { useEffect } from 'react'
import confetti from 'canvas-confetti'
import { reducedMotion } from '../game/settings'

const PALETTE = ['#ffd400', '#ffffff', '#ff5a36', '#2f6cff']

/** Three confetti bursts (center, then both sides). Skipped with reduced motion (system or Settings). */
export function celebrate(colors = PALETTE) {
  if (reducedMotion()) return
  confetti({ particleCount: 140, spread: 80, origin: { y: 0.55 }, colors })
  setTimeout(() => confetti({ particleCount: 90, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors }), 250)
  setTimeout(() => confetti({ particleCount: 90, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors }), 400)
}

/** Fires the bursts once when it mounts (the win screens). */
export function Confetti({ colors }) {
  useEffect(() => celebrate(colors), []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
