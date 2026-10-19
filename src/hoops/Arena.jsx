import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SKIN_TONES } from '../three/characters'

/*
 * The arena around the half court (units are feet). Fans are low-poly chibis drawn as instanced meshes:
 * one draw call for every body (shirt-colored, arms raise on big plays), one for every head (skin + hair),
 * one for signs. They bounce, clap and stand up in the vertex shader, driven by an `excite` level, so a
 * full arena costs almost nothing on the CPU. LED ribbon boards scroll messages that react to the game.
 */

const ROWS = 9
const RISE = 1.7
const DEPTH = 2.3
const BASE_Z = -12 // first baseline row
const SIDE_X = 33 // first sideline row
const SHOULDER_Y = 1.55
const HAIR = new THREE.Color('#1d1612')

/** A fan's body: tapered torso + two arms that hang at the sides (aArm = 1 so the shader can raise them). */
function bodyGeometry() {
  const torso = new THREE.CylinderGeometry(0.42, 0.55, 1.5, 6)
  torso.translate(0, 0.95, 0)
  const parts = [torso]
  for (const sx of [-1, 1]) {
    const arm = new THREE.BoxGeometry(0.22, 0.95, 0.22)
    arm.translate(sx * 0.58, SHOULDER_Y - 0.45, 0)
    parts.push(arm)
  }
  const flags = parts.map((g, i) => new Float32Array(g.attributes.position.count).fill(i === 0 ? 0 : 1))
  parts.forEach((g, i) => g.setAttribute('aArm', new THREE.BufferAttribute(flags[i], 1)))
  return mergeGeometries(parts)
}

/** A fan's head: skin-tinted ball with a darker hair cap (vertex colors x instance color). */
function headGeometry() {
  const head = new THREE.IcosahedronGeometry(0.5, 1)
  head.translate(0, 2.2, 0)
  const pos = head.attributes.position
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - 2.2
    const z = pos.getZ(i)
    // the top and back of the head are hair (stays dark whatever the skin tone)
    const hair = y > 0.18 || (y > -0.1 && z < -0.2)
    const c = hair ? HAIR : new THREE.Color(1, 1, 1)
    colors.set([c.r, c.g, c.b], i * 3)
  }
  head.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return head
}

function signGeometry() {
  const g = new THREE.PlaneGeometry(1.9, 1.1)
  g.translate(0, 3.4, 0.3)
  return g
}

const vertexHead = /* glsl */ `
  attribute float aPhase;
  attribute float aArm;
  uniform float uTime;
  uniform float uExcite;
`
// bounce and arm raise, applied in object space before the instance matrix
const vertexBody = /* glsl */ `
  #include <begin_vertex>
  float ph = aPhase * 6.2831;
  float lively = clamp(uExcite + aPhase * 0.15 - 0.05, 0.0, 1.0);
  float hop = abs(sin(uTime * mix(1.6, 8.5, lively) + ph)) * mix(0.04, 0.75, lively * lively);
  if (aArm > 0.5) {
    float sgn = transformed.x > 0.0 ? 1.0 : -1.0;
    float clap = 0.25 + 0.2 * sin(uTime * 7.0 + ph);
    float ang = sgn * mix(clap * step(0.18, uExcite), 2.5 + 0.35 * sin(uTime * 9.0 + ph), lively * lively);
    vec3 pivot = vec3(sgn * 0.58, ${SHOULDER_Y.toFixed(2)}, 0.0);
    vec3 d = transformed - pivot;
    float c = cos(ang);
    float s = sin(ang);
    transformed = pivot + vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
  }
  transformed.y += hop;
`

function crowdMaterial(base, uniforms, { vertexColors = false, side = THREE.FrontSide } = {}) {
  const m = new THREE.MeshLambertMaterial({ ...base, vertexColors, side })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uExcite = uniforms.uExcite
    shader.vertexShader = vertexHead + shader.vertexShader.replace('#include <begin_vertex>', vertexBody)
  }
  // body, head and sign meshes share one program shape but differ in attributes; keep their programs apart
  m.customProgramCacheKey = () => `crowd-${vertexColors}-${side}`
  return m
}

function seatLayout(home, away) {
  const fans = []
  const shirts = [home.jersey, home.jersey, home.trim, '#f4f4f4', home.jersey, '#2a2a2a', home.trim, away.jersey]
  let k = 0
  const r = (() => {
    let a = 1234567
    return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  })()
  const add = (x, y, z, yaw, seated = false) => {
    if (r() < 0.06) return // an empty seat here and there
    fans.push({ x, y, z, yaw, shirt: shirts[k++ % shirts.length], skin: SKIN_TONES[Math.floor(r() * SKIN_TONES.length)], phase: r(), sign: !seated && r() < 0.05, scale: seated ? 0.85 : 0.9 + r() * 0.2 })
  }
  for (let row = 0; row < ROWS; row++) {
    const y = 0.8 + row * RISE
    for (let i = 0; i < 40; i++) add(-39 + i * 2 + (row % 2), y, BASE_Z - row * DEPTH, 0)
    for (const sx of [-1, 1]) for (let i = 0; i < 28; i++) add(sx * (SIDE_X + row * DEPTH), y, -7 + i * 2.2 + (row % 2), sx > 0 ? -Math.PI / 2 : Math.PI / 2)
  }
  // courtside: one row of chairs along each sideline, right on the floor
  for (const sx of [-1, 1]) for (let i = 0; i < 18; i++) add(sx * 28.2, 0, 1 + i * 2.6, sx > 0 ? -Math.PI / 2 : Math.PI / 2, true)
  return fans
}

const shirtOf = (f) => f.shirt
const skinOf = (f) => f.skin

function useInstanced(ref, fans, colorOf) {
  useEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new THREE.Object3D()
    const col = new THREE.Color()
    const phases = new Float32Array(fans.length)
    fans.forEach((f, i) => {
      o.position.set(f.x, f.y, f.z)
      o.rotation.set(0, f.yaw, 0)
      o.scale.setScalar(f.scale)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      m.setColorAt(i, col.set(colorOf(f, i)))
      phases[i] = f.phase
    })
    m.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
    if (!m.geometry.attributes.aArm) m.geometry.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(m.geometry.attributes.position.count), 1))
    m.count = fans.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [ref, fans, colorOf])
}

/** Scrolling LED ribbon text (canvas texture). */
function useRibbon(text, color, bg) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 2048
    c.height = 96
    const t = new THREE.CanvasTexture(c)
    t.wrapS = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  useEffect(() => {
    const c = tex.image
    const g = c.getContext('2d')
    g.fillStyle = bg
    g.fillRect(0, 0, c.width, c.height)
    g.font = '900 64px "Arial Black", Impact, sans-serif'
    g.textBaseline = 'middle'
    g.fillStyle = color
    // a whole number of repeats across the canvas so the scroll wraps without a seam
    const word = `${text}   ★   `
    const w = g.measureText(word).width
    const n = Math.max(1, Math.floor(c.width / w))
    const step = c.width / n
    for (let i = 0; i < n; i++) g.fillText(word, i * step + (step - w) / 2, c.height / 2 + 4)
    // LED dot texture
    g.fillStyle = 'rgba(0,0,0,0.25)'
    for (let x = 0; x < c.width; x += 6) g.fillRect(x, 0, 2, c.height)
    tex.needsUpdate = true
  }, [tex, text, color, bg])
  return tex
}

function Ribbon({ text, color, bg, position, rotation, width, speed = 0.06 }) {
  const tex = useRibbon(text, color, bg)
  useFrame((_, dt) => {
    tex.offset.x = (tex.offset.x + dt * speed) % 1
  })
  tex.repeat.set(width / 70, 1)
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, 2.4]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  )
}

/** Camera flashes popping in the stands on big moments. */
function Flashes({ fans, active }) {
  const groups = useRef([])
  const sets = useMemo(() => {
    const out = [[], [], [], []]
    fans.forEach((f, i) => {
      if (f.y > 0 && i % 7 === 0) out[i % 4].push(f.x, f.y + 2.6, f.z)
    })
    return out.map((pts) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      return g
    })
  }, [fans])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    groups.current.forEach((p, i) => {
      if (!p) return
      const on = active.current > 0.4 && Math.sin(t * 23 + i * 2.1) > 0.75
      p.material.opacity = on ? 1 : 0
    })
  })
  return sets.map((g, i) => (
    <points key={i} ref={(el) => (groups.current[i] = el)} geometry={g}>
      <pointsMaterial color="#ffffff" size={1.4} sizeAttenuation transparent opacity={0} depthWrite={false} toneMapped={false} />
    </points>
  ))
}

/**
 * excite: 0 (murmur) .. 1 (eruption). board: the LED message ('', 'DEFENSE', 'THREE', ...).
 */
export function Arena({ home, away, excite = 0, board = '' }) {
  const fans = useMemo(() => seatLayout(home, away), [home, away])
  const bodies = useRef()
  const heads = useRef()
  const signs = useRef()
  const uniforms = useRef({ uTime: { value: 0 }, uExcite: { value: 0 } })
  const flashLevel = useRef(0)
  const bodyGeo = useMemo(bodyGeometry, [])
  const headGeo = useMemo(headGeometry, [])
  const signGeo = useMemo(signGeometry, [])
  const bodyMat = useMemo(() => crowdMaterial({}, uniforms.current), [])
  const headMat = useMemo(() => crowdMaterial({}, uniforms.current, { vertexColors: true }), [])
  const signMat = useMemo(() => crowdMaterial({}, uniforms.current, { side: THREE.DoubleSide }), [])
  const signFans = useMemo(() => fans.filter((f) => f.sign), [fans])

  const signOf = useMemo(() => (f, i) => (i % 2 ? home.trim : '#ffffff'), [home])
  useInstanced(bodies, fans, shirtOf)
  useInstanced(heads, fans, skinOf)
  useInstanced(signs, signFans, signOf)

  useFrame(({ clock }, dt) => {
    const u = uniforms.current
    u.uTime.value = clock.elapsedTime
    // ease toward the target so the crowd rises and settles instead of snapping
    u.uExcite.value += (excite - u.uExcite.value) * Math.min(1, dt * (excite > u.uExcite.value ? 6 : 1.2))
    flashLevel.current = u.uExcite.value
  })

  const msg = {
    DEFENSE: 'DE-FENSE!   DE-FENSE!',
    THREE: '3 ! ! !   FROM DOWNTOWN',
    BUCKET: 'BUCKET!',
    STOP: 'STOP!   LET’S GO ' + home.name.toUpperCase(),
    NOISE: 'MAKE SOME NOISE!',
  }[board] ?? `${home.city.toUpperCase()} ${home.name.toUpperCase()}`
  const hot = board === 'DEFENSE' || board === 'NOISE'

  return (
    <group>
      <instancedMesh ref={bodies} args={[bodyGeo, bodyMat, fans.length]} frustumCulled={false} />
      <instancedMesh ref={heads} args={[headGeo, headMat, fans.length]} frustumCulled={false} />
      <instancedMesh ref={signs} args={[signGeo, signMat, Math.max(1, signFans.length)]} frustumCulled={false} />
      <Flashes fans={fans} active={flashLevel} />
      {/* tiers */}
      {Array.from({ length: ROWS }, (_, row) => (
        <group key={row}>
          <mesh position={[0, row * RISE + 0.35, BASE_Z - row * DEPTH]}>
            <boxGeometry args={[84, 0.7, DEPTH]} />
            <meshLambertMaterial color={row % 2 ? '#1b1e26' : '#22262f'} />
          </mesh>
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * (SIDE_X + row * DEPTH), row * RISE + 0.35, 24]}>
              <boxGeometry args={[DEPTH, 0.7, 66]} />
              <meshLambertMaterial color={row % 2 ? '#1b1e26' : '#22262f'} />
            </mesh>
          ))}
        </group>
      ))}
      {/* courtside chairs */}
      {[-1, 1].map((sx) =>
        Array.from({ length: 18 }, (_, i) => (
          <mesh key={`${sx}-${i}`} position={[sx * 28.6, 0.6, 1 + i * 2.6]}>
            <boxGeometry args={[1.2, 1.2, 1.2]} />
            <meshLambertMaterial color="#2c2f38" />
          </mesh>
        )),
      )}
      {/* LED ribbons: baseline, under the first sideline rows */}
      <Ribbon text={msg} color={hot ? '#ffd400' : '#ffffff'} bg={home.jersey} position={[0, 1.3, -8.4]} rotation={[0, 0, 0]} width={60} speed={hot ? 0.16 : 0.05} />
      <Ribbon text={msg} color={hot ? '#ffd400' : '#ffffff'} bg={home.jersey} position={[-31.2, 1.3, 24]} rotation={[0, Math.PI / 2, 0]} width={64} speed={hot ? 0.16 : 0.05} />
      <Ribbon text={msg} color={hot ? '#ffd400' : '#ffffff'} bg={home.jersey} position={[31.2, 1.3, 24]} rotation={[0, -Math.PI / 2, 0]} width={64} speed={hot ? 0.16 : 0.05} />
      {/* rafters: a dark ceiling ring with banners in the home colors */}
      {[-24, -8, 8, 24].map((x, i) => (
        <mesh key={x} position={[x, 30, BASE_Z - 16]}>
          <planeGeometry args={[6, 9]} />
          <meshLambertMaterial color={i % 2 ? home.trim : home.jersey} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}
