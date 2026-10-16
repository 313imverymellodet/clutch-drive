import { useMemo } from 'react'
import * as THREE from 'three'
import { Html, Line } from '@react-three/drei'
import { PlaySim } from '../sim/playSim'

const previewSim = new PlaySim()
const COLORS = ['#ffd400', '#ffffff', '#8fd3ff']

/** Play art on the turf before the snap: routes in read-order colors with numbered badges; run path for runs. */
export function RouteArt({ play, reads, flip, los, toGo, coverage }) {
  const lines = useMemo(() => {
    if (!play) return []
    previewSim.reset({ play, los, toGo, coverage, reads, flip })
    const order = previewSim.reads?.map((r) => r.p) ?? []
    const out = []
    if (previewSim.play.type === 'run') {
      const carrier = previewSim.play.run.carrier === 'qb' ? previewSim.qb : previewSim.rb
      out.push({ pts: carrier.runPath.map((v) => new THREE.Vector3(v.x, 0.07, v.z)), color: COLORS[0], width: 7, num: null, key: 'run' })
      return out
    }
    for (const p of previewSim.players) {
      if (p.team !== 'off' || !p.route || p.routeStart > 50) continue
      const idx = order.indexOf(p)
      const pts = p.route.map((v) => new THREE.Vector3(v.x, 0.07, v.z))
      if (pts.length === 2 && pts[1].z - pts[0].z > 25) pts[1].z = pts[0].z + 25 // show the first 25 yards of a go
      out.push({ pts, color: idx >= 0 ? COLORS[idx] : '#ffffff', width: idx === 0 ? 7 : idx > 0 ? 4.5 : 2.5, dashed: idx < 0, num: idx >= 0 ? idx + 1 : null, key: p.id })
    }
    return out
  }, [play, reads, flip, los, toGo, coverage])

  return (
    <group>
      {lines.map(({ pts, color, width, dashed, num, key }) => {
        const end = pts[pts.length - 1]
        const prev = pts[pts.length - 2]
        const yaw = Math.atan2(end.x - prev.x, end.z - prev.z)
        return (
          <group key={key}>
            <Line points={pts} color={color} lineWidth={width} dashed={dashed} dashSize={0.8} gapSize={0.5} transparent opacity={dashed ? 0.55 : 1} />
            <mesh position={end} rotation={[Math.PI / 2, 0, -yaw]}>
              <coneGeometry args={[num === 1 ? 0.5 : 0.35, num === 1 ? 1 : 0.7, 3]} />
              <meshBasicMaterial color={color} transparent opacity={dashed ? 0.55 : 1} />
            </mesh>
            {num && (
              <Html position={[end.x, 1.4, end.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
                <div className="route-num" style={{ background: color }}>{num}</div>
              </Html>
            )}
          </group>
        )
      })}
    </group>
  )
}
