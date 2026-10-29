import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/*
 * Chibi fans for any venue, drawn as instanced meshes: one draw call for every body (shirt-colored, arms that
 * move), one for every head (skin + hair), one for signs. Everything they do happens in the vertex shader, driven
 * by a few uniforms, so a full stadium costs almost nothing on the CPU:
 *
 *   home / away  0..1  how loud each side is (each fan follows its own side): bounce, clap, arms up
 *   groan        0..1  home fans put their hands on their heads
 *   wave         0..1  a stadium wave runs around the bowl (fans stand up as the front passes them)
 *   distract     0..1  fans in the distraction zone (behind the basket) wave their arms side to side together
 *
 * A venue lays out its own seats and passes fans: { x, y, z, yaw, shirt, skin, phase, side (1 home, 0 away),
 * wave (0..1 position around the bowl), zone (1 = distraction zone), sign, scale }.
 */

export const SHOULDER_Y = 1.55
const HAIR = new THREE.Color('#1d1612')

/** A fan's body: tapered torso + two arms that hang at the sides (aArm = 1 so the shader can move them). */
function bodyGeometry() {
  const torso = new THREE.CylinderGeometry(0.42, 0.55, 1.5, 6)
  torso.translate(0, 0.95, 0)
  const parts = [torso]
  for (const sx of [-1, 1]) {
    const arm = new THREE.BoxGeometry(0.22, 0.95, 0.22)
    arm.translate(sx * 0.58, SHOULDER_Y - 0.45, 0)
    parts.push(arm)
  }
  parts.forEach((g, i) => g.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(i === 0 ? 0 : 1), 1)))
  return mergeGeometries(parts)
}

/** A fan's head: skin-tinted ball with a darker hair cap (vertex colors x instance color). */
function headGeometry(detail) {
  const head = new THREE.IcosahedronGeometry(0.5, detail)
  head.translate(0, 2.2, 0)
  const pos = head.attributes.position
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - 2.2
    const z = pos.getZ(i)
    // the top and back of the head are hair (stays dark whatever the skin tone)
    const c = y > 0.18 || (y > -0.1 && z < -0.2) ? HAIR : new THREE.Color(1, 1, 1)
    colors.set([c.r, c.g, c.b], i * 3)
  }
  head.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  head.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(pos.count), 1))
  return head
}

function signGeometry() {
  const g = new THREE.PlaneGeometry(1.9, 1.1)
  g.translate(0, 3.4, 0.3)
  g.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1))
  return g
}

const vertexHead = /* glsl */ `
  attribute float aPhase;
  attribute float aSide;
  attribute float aWave;
  attribute float aZone;
  attribute float aArm;
  uniform float uTime;
  uniform float uHome;
  uniform float uAway;
  uniform float uGroan;
  uniform float uWave;
  uniform float uDistract;
`
// applied in object space, before the instance matrix
const vertexBody = /* glsl */ `
  #include <begin_vertex>
  float ph = aPhase * 6.2831;
  float exc = mix(uAway, uHome, aSide);
  float groan = uGroan * aSide;
  // the wave: a front runs around the bowl; fans just behind it are up with their arms in the air
  float wd = fract(aWave - fract(uTime * 0.11));
  float wv = uWave * smoothstep(0.0, 0.012, wd) * (1.0 - smoothstep(0.03, 0.08, wd));
  float lively = clamp(exc + aPhase * 0.15 - 0.05, 0.0, 1.0);
  float hop = abs(sin(uTime * mix(1.6, 8.5, lively) + ph)) * mix(0.04, 0.75, lively * lively);
  hop = max(hop * (1.0 - groan * 0.8), wv * 1.15);
  float dz = uDistract * aZone;
  float sway = sin(uTime * 3.6 + aPhase * 0.5);
  if (aArm > 0.5) {
    float sgn = transformed.x > 0.0 ? 1.0 : -1.0;
    float clap = 0.25 + 0.2 * sin(uTime * 7.0 + ph);
    float up = 2.5 + 0.35 * sin(uTime * 9.0 + ph);
    float ang = sgn * mix(clap * step(0.18, exc), up, max(lively * lively, wv));
    ang = mix(ang, -sgn * 2.55, groan * (1.0 - wv));        // hands on heads
    ang = mix(ang, sgn * 2.7 + sway * 0.7, dz);              // arms up, swaying together
    vec3 pivot = vec3(sgn * 0.58, ${SHOULDER_Y.toFixed(2)}, 0.0);
    vec3 d = transformed - pivot;
    float c = cos(ang);
    float s = sin(ang);
    transformed = pivot + vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
  }
  // the whole fan leans with the sway, more at the top
  transformed.x += dz * sway * 0.35 * (transformed.y / 2.2);
  // a groan slumps the head forward a touch
  transformed.z += groan * 0.12 * step(1.8, transformed.y);
  transformed.y += hop;
`

function crowdMaterial(uniforms, { vertexColors = false, side = THREE.FrontSide } = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors, side })
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = vertexHead + shader.vertexShader.replace('#include <begin_vertex>', vertexBody)
  }
  // body, head and sign meshes share one program shape but differ in attributes; keep their programs apart
  m.customProgramCacheKey = () => `crowd2-${vertexColors}-${side}`
  return m
}

function useInstances(ref, fans, colorOf) {
  useEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new THREE.Object3D()
    const col = new THREE.Color()
    const attrs = { aPhase: new Float32Array(fans.length), aSide: new Float32Array(fans.length), aWave: new Float32Array(fans.length), aZone: new Float32Array(fans.length) }
    fans.forEach((f, i) => {
      o.position.set(f.x, f.y, f.z)
      o.rotation.set(0, f.yaw, 0)
      o.scale.setScalar(f.scale)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      m.setColorAt(i, col.set(colorOf(f, i)))
      attrs.aPhase[i] = f.phase
      attrs.aSide[i] = f.side ?? 1
      attrs.aWave[i] = f.wave ?? 0
      attrs.aZone[i] = f.zone ?? 0
    })
    for (const [k, v] of Object.entries(attrs)) m.geometry.setAttribute(k, new THREE.InstancedBufferAttribute(v, 1))
    m.count = fans.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [ref, fans, colorOf])
}

/** Camera flashes popping in the stands on big moments. */
function Flashes({ fans, level, size }) {
  const groups = useRef([])
  const sets = useMemo(() => {
    const out = [[], [], [], []]
    fans.forEach((f, i) => {
      if (f.y > 0 && i % 7 === 0) out[i % 4].push(f.x, f.y + 2.6 * f.scale, f.z)
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
      if (p) p.material.opacity = level.current > 0.4 && Math.sin(t * 23 + i * 2.1) > 0.75 ? 1 : 0
    })
  })
  return sets.map((g, i) => (
    <points key={i} ref={(el) => (groups.current[i] = el)} geometry={g}>
      <pointsMaterial color="#ffffff" size={size} sizeAttenuation transparent opacity={0} depthWrite={false} toneMapped={false} />
    </points>
  ))
}

/** Phone flashlights held up in the stands: a slow twinkle when the building gets tense (or at night). */
function PhoneLights({ fans, level, size }) {
  const ref = useRef()
  const geom = useMemo(() => {
    const pts = []
    fans.forEach((f, i) => {
      if (f.y > 0 && (i * 7919) % 5 === 0) pts.push(f.x + Math.sin(i) * 0.3 * f.scale, f.y + 3.0 * f.scale, f.z)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [fans])
  useFrame(({ clock }) => {
    const m = ref.current?.material
    if (m) m.opacity = level.current * (0.75 + 0.25 * Math.sin(clock.elapsedTime * 1.7))
  })
  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial color="#fff6d8" size={size} sizeAttenuation transparent opacity={0} depthWrite={false} toneMapped={false} />
    </points>
  )
}

const shirtOf = (f) => f.shirt
const skinOf = (f) => f.skin

const ease = (u, target, dt, up = 6, down = 1.2) => {
  u.value += (target - u.value) * Math.min(1, dt * (target > u.value ? up : down))
}

/**
 * fans: seat list (see top). mood: { home, away, groan, wave, distract, lights } targets, eased every frame.
 * detail: head subdivision (0 for far-away stadium fans). flashSize/lightSize: point sizes in venue units.
 */
export function Crowd({ fans, mood, detail = 1, signColor = '#ffffff', signAlt = '#ffd400', flashSize = 1.4, lightSize = 0.9 }) {
  const bodies = useRef()
  const heads = useRef()
  const signs = useRef()
  const uniforms = useRef({ uTime: { value: 0 }, uHome: { value: 0 }, uAway: { value: 0 }, uGroan: { value: 0 }, uWave: { value: 0 }, uDistract: { value: 0 } })
  const flashLevel = useRef(0)
  const lightLevel = useRef(0)
  const bodyGeo = useMemo(bodyGeometry, [])
  const headGeo = useMemo(() => headGeometry(detail), [detail])
  const signGeo = useMemo(signGeometry, [])
  const bodyMat = useMemo(() => crowdMaterial(uniforms.current), [])
  const headMat = useMemo(() => crowdMaterial(uniforms.current, { vertexColors: true }), [])
  const signMat = useMemo(() => crowdMaterial(uniforms.current, { side: THREE.DoubleSide }), [])
  const signFans = useMemo(() => fans.filter((f) => f.sign), [fans])
  const signOf = useMemo(() => (f, i) => (i % 2 ? signAlt : signColor), [signColor, signAlt])
  useInstances(bodies, fans, shirtOf)
  useInstances(heads, fans, skinOf)
  useInstances(signs, signFans, signOf)

  useFrame(({ clock }, dt) => {
    const u = uniforms.current
    u.uTime.value = clock.elapsedTime
    // ease toward the targets so the crowd rises and settles instead of snapping
    ease(u.uHome, mood.home ?? 0, dt)
    ease(u.uAway, mood.away ?? 0, dt)
    ease(u.uGroan, mood.groan ?? 0, dt, 5, 1.5)
    ease(u.uWave, mood.wave ?? 0, dt, 1.5, 1.5)
    ease(u.uDistract, mood.distract ?? 0, dt, 3, 2)
    flashLevel.current = Math.max(u.uHome.value, u.uAway.value)
    lightLevel.current += ((mood.lights ?? 0) - lightLevel.current) * Math.min(1, dt * 1.5)
  })

  return (
    <group>
      <instancedMesh ref={bodies} args={[bodyGeo, bodyMat, fans.length]} frustumCulled={false} />
      <instancedMesh ref={heads} args={[headGeo, headMat, fans.length]} frustumCulled={false} />
      <instancedMesh ref={signs} args={[signGeo, signMat, Math.max(1, signFans.length)]} frustumCulled={false} />
      <Flashes fans={fans} level={flashLevel} size={flashSize} />
      <PhoneLights fans={fans} level={lightLevel} size={lightSize} />
    </group>
  )
}

/** Deterministic little RNG for seat layouts. */
export function seatRng(seed = 1234567) {
  let a = seed
  return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
}

/** Position around the bowl (0..1) for the wave, from a seat's x/z. */
export const waveAt = (x, z) => (Math.atan2(z, x) + Math.PI) / (2 * Math.PI)
