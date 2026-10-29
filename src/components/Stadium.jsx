import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SKIN_TONES } from '../three/characters'
import { Crowd, seatRng, waveAt } from '../three/crowd'
import { Jumbotron, Ribbon } from '../three/boards'

// Low-poly bowl around the field. Units are yards; field spans x ±26.7, z ±60.
const ROWS = 14
const ROW_DEPTH = 1.25
const ROW_RISE = 0.8
const SIDE_X = 34 // first row of sideline stands
const END_Z = 66 // first row of end-zone stands
const FAN_SCALE = 0.3 // the shared chibi fans are built in feet-ish units

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

/**
 * Every seat: home colors most of the bowl, a visitors' section in the far end-zone corner, signs here and there.
 * `wave` is the seat's position around the bowl so the wave can travel.
 */
function seatLayout(home, away) {
  const fans = []
  const r = seatRng(7)
  const homeShirts = [home.jersey, home.jersey, home.stripe, home.helmet, '#f4f4f4', home.jersey]
  const awayShirts = [away.jersey, away.stripe, away.jersey]
  let k = 0
  const add = (x, z, row, yaw) => {
    if (r() < 0.07) return
    const visitor = z > END_Z - 1 && x > 8 && r() < 0.85
    fans.push({
      x, y: 1.6 + row * ROW_RISE, z, yaw,
      shirt: visitor ? awayShirts[k++ % awayShirts.length] : r() < 0.06 ? '#3b3b3b' : homeShirts[k++ % homeShirts.length],
      skin: SKIN_TONES[Math.floor(r() * SKIN_TONES.length)],
      phase: r(), side: visitor ? 0 : 1, zone: 0, wave: waveAt(x, z),
      sign: r() < 0.03, scale: FAN_SCALE * (0.9 + r() * 0.2),
    })
  }
  for (let row = 0; row < ROWS; row++) {
    const off = (row % 2) * 0.5
    for (const sx of [-1, 1]) {
      for (let z = -62; z <= 62; z += 1.05) add(sx * (SIDE_X + row * ROW_DEPTH), z + off, row, sx > 0 ? -Math.PI / 2 : Math.PI / 2)
    }
    for (const sz of [-1, 1]) {
      for (let x = -32.5; x <= 32.5; x += 1.05) add(x + off, sz * (END_Z + row * ROW_DEPTH), row, sz > 0 ? Math.PI : 0)
    }
  }
  return fans
}

/** Both teams on their sidelines between the 30s: helmets on, standing, reacting with their own fans. */
function benchLayout(home, away) {
  const out = []
  const r = seatRng(31)
  for (const [team, sx, side] of [[home, -1, 1], [away, 1, 0]]) {
    for (let i = 0; i < 26; i++) {
      const z = -20 + i * 1.55 + r() * 0.5
      out.push({
        x: sx * (30.2 + (i % 3) * 0.7), y: 0, z, yaw: sx > 0 ? -Math.PI / 2 : Math.PI / 2,
        shirt: team.jersey, skin: team.helmet, phase: r(), side, zone: 0, wave: 0, sign: false, scale: 0.42,
      })
    }
  }
  return out
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

/** Orange pylons on the four corners of each end zone. */
function Pylons() {
  const spots = []
  for (const z of [50, 60, -50, -60]) for (const x of [-26.85, 26.85]) spots.push([x, z])
  return spots.map(([x, z]) => (
    <mesh key={`${x}${z}`} position={[x, 0.32, z]}>
      <boxGeometry args={[0.28, 0.64, 0.28]} />
      <meshToonMaterial color="#ff6a13" />
    </mesh>
  ))
}

const glowTexture = (() => {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,250,225,1)')
  grad.addColorStop(0.25, 'rgba(255,245,200,0.55)')
  grad.addColorStop(1, 'rgba(255,240,190,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
})()

function LightTower({ x, z, night }) {
  return (
    <group position={[x, 0, z]} rotation-y={Math.atan2(-x, -z)}>
      <mesh position={[0, 16, 0]}>
        <cylinderGeometry args={[0.35, 0.6, 32, 6]} />
        <meshLambertMaterial color={night ? '#4b525e' : '#9aa3ad'} />
      </mesh>
      <mesh position={[0, 32.5, 0.4]}>
        <boxGeometry args={[6, 3, 0.6]} />
        <meshLambertMaterial color="#596270" />
      </mesh>
      <mesh position={[0, 32.5, 0.75]}>
        <planeGeometry args={[5.4, 2.4]} />
        <meshBasicMaterial color="#fffbe6" toneMapped={false} />
      </mesh>
      {night && (
        <sprite position={[0, 32.5, 1.5]} scale={[26, 18, 1]}>
          <spriteMaterial map={glowTexture} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} fog={false} />
        </sprite>
      )}
    </group>
  )
}

const SKIES = {
  day: ['#5fb4ff', '#dff1ff'],
  night: ['#060a18', '#1d2a4a'],
}

function Sky({ night }) {
  const geom = useMemo(() => {
    const g = new THREE.SphereGeometry(450, 16, 12)
    const [topC, bottomC] = SKIES[night ? 'night' : 'day']
    const top = new THREE.Color(topC)
    const bottom = new THREE.Color(bottomC)
    const colors = []
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const t = THREE.MathUtils.clamp(p.getY(i) / 300, 0, 1)
      const c = bottom.clone().lerp(top, t)
      colors.push(c.r, c.g, c.b)
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return g
  }, [night])
  const stars = useMemo(() => {
    if (!night) return null
    const r = seatRng(5)
    const pts = []
    for (let i = 0; i < 500; i++) {
      const a = r() * Math.PI * 2
      const el = 0.25 + r() * 1.2
      pts.push(Math.cos(a) * Math.cos(el) * 420, Math.sin(el) * 420, Math.sin(a) * Math.cos(el) * 420)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [night])
  return (
    <>
      <mesh geometry={geom}>
        <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} />
      </mesh>
      {stars && (
        <points geometry={stars}>
          <pointsMaterial color="#cfd8ff" size={1.6} sizeAttenuation={false} fog={false} transparent opacity={0.8} depthWrite={false} />
        </points>
      )}
    </>
  )
}

const BOARD_TEXT = {
  TOUCHDOWN: 'TOUCHDOWN!',
  FIRST: 'FIRST DOWN!',
  PICK: 'INTERCEPTION!',
  SACK: 'SACK!',
  STOP: 'STOPPED!',
  DEFENSE: 'DEFENSE!',
  NOISE: 'MAKE SOME NOISE!',
}

/**
 * home/away: NFL team objects. mood: crowd targets ({ home, away, groan, wave, lights }, src/three/crowd.jsx).
 * board: what the video boards and ribbons say ('', 'TOUCHDOWN', 'DEFENSE', ...). night: lights-on look.
 */
export function Stadium({ home, away, mood, board = '', night = false }) {
  const seating = useSeatingGeometry()
  const fans = useMemo(() => seatLayout(home, away), [home, away])
  const bench = useMemo(() => benchLayout(home, away), [home, away])
  const benchMood = useMemo(() => ({ home: mood.home, away: mood.away, groan: 0, wave: 0, lights: 0 }), [mood.home, mood.away])
  const homeName = `${home.city} ${home.name}`.toUpperCase()
  const title = BOARD_TEXT[board] ?? home.name.toUpperCase()
  const hot = !!BOARD_TEXT[board]
  const sub = hot ? homeName : `${away.name.toUpperCase()} AT ${home.name.toUpperCase()}`
  const ribbon = hot ? `${title}   ${title}` : `LET’S GO ${home.name.toUpperCase()}`
  const top = 1.6 + ROWS * ROW_RISE
  return (
    <group>
      <Sky night={night} />
      <mesh geometry={seating}>
        <meshLambertMaterial color={night ? '#5d6572' : '#8d96a3'} />
      </mesh>
      {/* padded walls in the home team's color, with LED ribbons along the sidelines */}
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
      {[-1, 1].map((sx) => (
        <Ribbon key={sx} text={ribbon} color={hot ? '#ffd400' : '#ffffff'} bg={home.jersey} position={[sx * (SIDE_X - 1.05), 0.75, 0]} rotation={[0, -sx * Math.PI / 2, 0]} width={110} height={1.1} speed={hot ? 0.12 : 0.04} period={36} />
      ))}
      {/* facade ring above the top row */}
      {[-1, 1].map((sx) => (
        <mesh key={`f${sx}`} position={[sx * (SIDE_X + ROWS * ROW_DEPTH), top + 1.2, 0]}>
          <boxGeometry args={[0.6, 2.4, 128 + ROWS * ROW_DEPTH * 2]} />
          <meshLambertMaterial color={home.jersey} />
        </mesh>
      ))}
      <Crowd fans={fans} mood={mood} detail={0} signColor="#ffffff" signAlt={home.stripe} flashSize={0.55} lightSize={0.35} />
      <Crowd fans={bench} mood={benchMood} detail={0} />
      {/* team areas: a strip of sideline paint behind each bench */}
      {[-1, 1].map((sx) => (
        <mesh key={`ta${sx}`} position={[sx * 30.9, 0.015, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[3.2, 46]} />
          <meshLambertMaterial color={sx < 0 ? home.endzone : away.endzone} transparent opacity={0.55} />
        </mesh>
      ))}
      {/* video boards above both end zones */}
      {[-1, 1].map((sz) => (
        <Jumbotron key={sz} title={title} sub={sub} team={home} hot={hot} position={[0, top + 11, sz * (END_Z + ROWS * ROW_DEPTH + 2)]} rotation={[0, sz > 0 ? Math.PI : 0, 0]} width={34} />
      ))}
      <Goalpost z={-60} />
      <Goalpost z={60} />
      <Pylons />
      {[[-48, -75], [48, -75], [-48, 75], [48, 75]].map(([x, z]) => (
        <LightTower key={`${x}${z}`} x={x} z={z} night={night} />
      ))}
    </group>
  )
}

/** Real Monday and Thursday night games are played under the lights. */
export function isNightGame(moment) {
  if (!moment?.date) return false
  const day = new Date(`${moment.date}T12:00:00Z`).getUTCDay()
  return day === 1 || day === 4
}
