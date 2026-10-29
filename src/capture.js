import { advance } from '@react-three/fiber'

/*
 * Dev-only frame-by-frame capture (for marketing videos): open a game with ?capture and the 3D canvas stops
 * running on its own; window.__capture.step(dt) advances every animation, sim and shader by exactly dt seconds
 * and renders one frame, so a recorder can screenshot each one. Not included in production builds.
 */
export const CAPTURE = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('capture')

if (CAPTURE) {
  let t = 0
  window.__capture = {
    step(dt = 1 / 30) {
      t += dt
      advance(t)
      return t
    },
    get t() {
      return t
    },
  }
}

/** Canvas props for capture mode: manual frames, keep the drawing buffer for screenshots. */
export const captureCanvasProps = CAPTURE ? { frameloop: 'never', gl: { preserveDrawingBuffer: true } } : {}
