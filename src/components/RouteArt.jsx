import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { PlaySim } from '../sim/playSim'

const previewSim = new PlaySim()

/** Play art drawn on the turf: the called play's routes (target in gold) before the snap. */
export function RouteArt({ play, los, toGo, coverage }) {
  const lines = useMemo(() => {
    if (!play) return []
    previewSim.reset({ play, los, toGo, coverage })
    const out = []
    for (const p of previewSim.players) {
      if (p.team !== 'off' || !p.route || p.routeStart > 50) continue
      if (previewSim.play.type === 'run' && p !== previewSim.rb) continue
      const target = p === previewSim.target || (previewSim.play.type === 'run' && p === previewSim.rb)
      const pts = p.route.map((v) => new THREE.Vector3(v.x, 0.07, v.z))
      // the go route runs the length of the field; just show the first 25 yards of it
      if (pts.length === 2 && pts[1].z - pts[0].z > 25) pts[1].z = pts[0].z + 25
      out.push({ pts, target, key: p.id })
    }
    return out
  }, [play, los, toGo, coverage])

  return (
    <group>
      {lines.map(({ pts, target, key }) => {
        const end = pts[pts.length - 1]
        const prev = pts[pts.length - 2]
        const yaw = Math.atan2(end.x - prev.x, end.z - prev.z)
        return (
          <group key={key}>
            <Line points={pts} color={target ? '#ffd400' : '#ffffff'} lineWidth={target ? 6 : 3} dashed={!target} dashSize={0.8} gapSize={0.5} transparent opacity={target ? 1 : 0.75} />
            <mesh position={end} rotation={[Math.PI / 2, 0, -yaw]}>
              <coneGeometry args={[target ? 0.45 : 0.3, target ? 0.9 : 0.6, 3]} />
              <meshBasicMaterial color={target ? '#ffd400' : '#ffffff'} transparent opacity={target ? 1 : 0.75} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
