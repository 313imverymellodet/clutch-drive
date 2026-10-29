import { useEffect, useRef } from 'react'
import { reducedMotion } from '../game/settings'

const PALETTE = ['#ffd400', '#ffffff', '#ff7a1a', '#2ee6a8', '#7c6cff']

/** A short confetti burst from both bottom corners (skipped with reduced motion). */
export function Confetti({ colors = PALETTE, count = 160, duration = 3200 }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    if (!c || reducedMotion()) return
    const g = c.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = (c.width = innerWidth * dpr)
    const H = (c.height = innerHeight * dpr)
    // pieces shoot up and inward from both bottom corners, then flutter down
    const bits = Array.from({ length: count }, (_, i) => {
      const dir = i % 2 === 0 ? 1 : -1
      return {
        x: dir > 0 ? W * 0.04 : W * 0.96, y: H * 1.02,
        vx: dir * (0.0003 + Math.random() * 0.0007) * H, vy: -(0.0016 + Math.random() * 0.0012) * H,
        w: (6 + Math.random() * 6) * dpr, h: (10 + Math.random() * 8) * dpr,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        color: colors[i % colors.length], wobble: Math.random() * 6,
      }
    })
    let raf
    const t0 = performance.now()
    let last = t0
    const frame = (now) => {
      const dt = Math.min(32, now - last)
      last = now
      const age = now - t0
      g.clearRect(0, 0, W, H)
      g.globalAlpha = age > duration - 600 ? Math.max(0, (duration - age) / 600) : 1
      for (const b of bits) {
        b.vy += 0.0000032 * H * dt
        b.vy = Math.min(b.vy, 0.00045 * H) // flutter: terminal velocity
        b.vx *= 0.992
        b.x += b.vx * dt + Math.sin(age / 180 + b.wobble) * 0.4 * dpr
        b.y += b.vy * dt
        b.r += b.vr
        g.save()
        g.translate(b.x, b.y)
        g.rotate(b.r)
        g.scale(1, Math.cos(age / 120 + b.wobble))
        g.fillStyle = b.color
        g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h)
        g.restore()
      }
      if (age < duration) raf = requestAnimationFrame(frame)
      else g.clearRect(0, 0, W, H)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [colors, count, duration])
  return <canvas ref={ref} className="confetti" aria-hidden="true" />
}
