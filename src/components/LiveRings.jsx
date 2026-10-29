import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

export const openTone = (open) => (open > 0.4 ? '#2ecc71' : open > -0.4 ? '#ffd400' : '#ff4d4d')

/**
 * Live QB: a ring at each read's feet, green / yellow / red for open / tight / covered.
 * Tap a ring to throw it there (the same as the on-screen buttons or keys 1-3).
 */
export function LiveRings({ sim, enabled }) {
  const refs = useRef([])
  useFrame(() => {
    const c = enabled && !(import.meta.env.DEV && window.__cam) ? sim.controls() : null
    for (let i = 0; i < 3; i++) {
      const g = refs.current[i]
      if (!g) continue
      const r = c?.mode === 'qb' ? c.reads[i] : null
      g.visible = !!r
      if (!r) continue
      g.position.set(r.pos.x, 0.06, r.pos.z)
      g.userData.key = r.key
      g.children[0].material.color.set(openTone(r.open))
      g.scale.setScalar(r.key === c.queued ? 1.35 : 1 + 0.06 * Math.sin(performance.now() / 160 + i))
    }
  })
  const tap = (i) => (e) => {
    const g = refs.current[i]
    if (!g?.visible || !g.userData.key) return
    e.stopPropagation()
    sim.input({ type: 'throw', key: g.userData.key })
  }
  return [0, 1, 2].map((i) => (
    <group key={i} ref={(el) => (refs.current[i] = el)} visible={false}>
      <mesh rotation-x={-Math.PI / 2} renderOrder={2}>
        <ringGeometry args={[0.85, 1.25, 36]} />
        <meshBasicMaterial transparent opacity={0.92} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.5} onPointerDown={tap(i)}>
        <circleGeometry args={[2.4, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  ))
}
