import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Low-poly bowl around the field. Units are yards; field spans x ±26.7, z ±60.
const ROWS = 14
const ROW_DEPTH = 1.25
const ROW_RISE = 0.8
const SIDE_X = 34 // first row of sideline stands
const END_Z = 66 // first row of end-zone stands

/** Stepped seating as one merged geometry (cheap: a single draw call). */
function useSeatingGeometry() {
  return useMemo(() => {
    const parts = []
    for (let i = 0; i < ROWS; i++) {
      const h = 1.6 + i * ROW_RISE
      for (const sx of [-1, 1]) {
        const g = new THREE.BoxGeometry(ROW_DEPTH, h, 128)
        g.translate(sx * (SIDE_X + i * ROW_DEPTH), h / 2, 0)
        parts.push(g)
      }
      for (const sz of [-1, 1]) {
        const g = new THREE.BoxGeometry(2 * SIDE_X, h, ROW_DEPTH)
        g.translate(0, h / 2, sz * (END_Z + i * ROW_DEPTH))
        parts.push(g)
      }
    }
    return mergeGeometries(parts)
  }, [])
}

/** Fans: one InstancedMesh. Bounce happens in the vertex shader, so cheering costs nothing on the CPU. */
function Crowd({ home, away, excited }) {
  const ref = useRef()
  const uniforms = useRef({ uTime: { value: 0 }, uExcite: { value: 0 } })

  const seats = useMemo(() => {
    const out = []
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < ROWS; i++) {
      const y = 1.6 + i * ROW_RISE + 0.35
      for (const sx of [-1, 1]) {
        for (let z = -62; z <= 62; z += 0.95) if (rnd() > 0.12) out.push([sx * (SIDE_X + i * ROW_DEPTH), y, z + rnd() * 0.3, rnd()])
      }
      for (const sz of [-1, 1]) {
        for (let x = -33; x <= 33; x += 0.95) if (rnd() > 0.12) out.push([x + rnd() * 0.3, y, sz * (END_Z + i * ROW_DEPTH), rnd()])
      }
    }
    return out
  }, [])

  const geometry = useMemo(() => new THREE.CapsuleGeometry(0.24, 0.32, 2, 6), [])
  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial()
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms.current)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uExcite;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float ph = float(gl_InstanceID) * 1.731;
          transformed.y += uExcite * abs(sin(uTime * 9.0 + ph)) * 0.55 + 0.04 * sin(uTime * 2.0 + ph);`,
        )
    }
    return m
  }, [])

  useLayoutEffect(() => {
    const mesh = ref.current
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    const homeCols = [home.jersey, home.stripe, home.jersey, home.helmet]
    const awayCols = [away.jersey, away.stripe]
    seats.forEach(([x, y, z, r], i) => {
      m.makeTranslation(x, y, z)
      mesh.setMatrixAt(i, m)
      // ~70% home fans, a few neutral shirts
      const pool = r < 0.7 ? homeCols : r < 0.93 ? awayCols : ['#e8e4da', '#3b3b3b']
      c.set(pool[Math.floor((r * 997) % pool.length)])
      mesh.setColorAt(i, c)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
  }, [seats, home, away])

  useFrame((state, dt) => {
    const u = uniforms.current
    u.uTime.value = state.clock.elapsedTime
    u.uExcite.value = THREE.MathUtils.damp(u.uExcite.value, excited ? 1 : 0, 3, dt)
  })

  return <instancedMesh ref={ref} args={[geometry, material, seats.length]} />
}

function Goalpost({ z }) {
  const dir = Math.sign(z)
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 1.5, dir * 1.2]}>
        <cylinderGeometry args={[0.14, 0.14, 3, 8]} />
        <meshToonMaterial color="#ffd21f" />
      </mesh>
      <mesh position={[0, 3.2, dir * 0.6]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.1, 0.1, 1.2, 6]} />
        <meshToonMaterial color="#ffd21f" />
      </mesh>
      <mesh position={[0, 3.33, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.09, 0.09, 6.2, 8]} />
        <meshToonMaterial color="#ffd21f" />
      </mesh>
      {[-3.08, 3.08].map((x) => (
        <mesh key={x} position={[x, 3.33 + 4.5, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 9, 6]} />
          <meshToonMaterial color="#ffd21f" />
        </mesh>
      ))}
    </group>
  )
}

function LightTower({ x, z }) {
  return (
    <group position={[x, 0, z]} rotation-y={Math.atan2(-x, -z)}>
      <mesh position={[0, 16, 0]}>
        <cylinderGeometry args={[0.35, 0.6, 32, 6]} />
        <meshLambertMaterial color="#9aa3ad" />
      </mesh>
      <mesh position={[0, 32.5, 0.4]}>
        <boxGeometry args={[6, 3, 0.6]} />
        <meshLambertMaterial color="#596270" />
      </mesh>
      <mesh position={[0, 32.5, 0.75]}>
        <planeGeometry args={[5.4, 2.4]} />
        <meshBasicMaterial color="#fffbe6" />
      </mesh>
    </group>
  )
}

function Sky() {
  const geom = useMemo(() => {
    const g = new THREE.SphereGeometry(450, 16, 12)
    const top = new THREE.Color('#5fb4ff')
    const bottom = new THREE.Color('#dff1ff')
    const colors = []
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const t = THREE.MathUtils.clamp(p.getY(i) / 300, 0, 1)
      const c = bottom.clone().lerp(top, t)
      colors.push(c.r, c.g, c.b)
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return g
  }, [])
  return (
    <mesh geometry={geom}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  )
}

export function Stadium({ home, away, excited = false }) {
  const seating = useSeatingGeometry()
  return (
    <group>
      <Sky />
      <mesh geometry={seating}>
        <meshLambertMaterial color="#8d96a3" />
      </mesh>
      {/* padded walls in the home team's color */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * (SIDE_X - 0.8), 0.7, 0]}>
          <boxGeometry args={[0.4, 1.4, 128]} />
          <meshLambertMaterial color={home.endzone} />
        </mesh>
      ))}
      {[-1, 1].map((sz) => (
        <mesh key={sz} position={[0, 0.7, sz * (END_Z - 0.8)]}>
          <boxGeometry args={[2 * SIDE_X, 1.4, 0.4]} />
          <meshLambertMaterial color={sz > 0 ? away.endzone : home.endzone} />
        </mesh>
      ))}
      <Crowd home={home} away={away} excited={excited} />
      <Goalpost z={-60} />
      <Goalpost z={60} />
      {[[-48, -75], [48, -75], [-48, 75], [48, 75]].map(([x, z]) => (
        <LightTower key={`${x}${z}`} x={x} z={z} />
      ))}
    </group>
  )
}
