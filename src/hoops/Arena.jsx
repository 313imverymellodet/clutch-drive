import { useMemo } from 'react'
import * as THREE from 'three'
import { SKIN_TONES } from '../three/characters'
import { Crowd, seatRng, waveAt } from '../three/crowd'
import { Ribbon } from '../three/boards'

/*
 * The arena around the half court (units are feet). Fans are the shared instanced chibis (src/three/crowd.jsx):
 * home fans everywhere, a pocket of traveling fans in the far corner, a distraction zone behind the basket,
 * both benches on the near sideline. LED ribbon boards scroll messages that react to the game.
 */

const ROWS = 9
const RISE = 1.7
const DEPTH = 2.3
const BASE_Z = -12 // first baseline row
const SIDE_X = 33 // first sideline row

function seatLayout(home, away) {
  const fans = []
  const shirts = [home.jersey, home.jersey, home.trim, '#f4f4f4', home.jersey, '#2a2a2a', home.trim, '#f4f4f4']
  const awayShirts = [away.jersey, away.trim, away.jersey, '#f4f4f4']
  let k = 0
  const r = seatRng()
  const add = (x, y, z, yaw, seated = false) => {
    if (r() < 0.06) return // an empty seat here and there
    // a pocket of traveling fans in the far corner (where the camera sees them); the rows behind the basket are
    // the distraction zone
    const visitor = !seated && ((z <= BASE_Z && x > 23) || (x > SIDE_X - 1 && z < 6)) && r() < 0.85
    const zone = z <= BASE_Z && Math.abs(x) < 22 ? 1 : 0
    fans.push({
      x, y, z, yaw,
      shirt: visitor ? awayShirts[k++ % awayShirts.length] : shirts[k++ % shirts.length],
      skin: SKIN_TONES[Math.floor(r() * SKIN_TONES.length)],
      phase: r(), side: visitor ? 0 : 1, zone, wave: waveAt(x, z - 20),
      sign: !seated && r() < 0.05, scale: seated ? 0.85 : 0.9 + r() * 0.2,
    })
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

/** Both benches on the near sideline past half court: subs standing in warmups, reacting with their team. */
function benchLayout(home, away) {
  const out = []
  const r = seatRng(99)
  for (const [team, z0, side] of [[home, 30, 1], [away, 40, 0]]) {
    for (let i = 0; i < 5; i++) {
      out.push({ x: -25.6, y: 0, z: z0 + i * 1.8, yaw: Math.PI / 2, shirt: team.jersey, skin: SKIN_TONES[(i * 3 + side) % SKIN_TONES.length], phase: r(), side, zone: 0, wave: 0, sign: false, scale: 1.25 })
    }
  }
  return out
}

/**
 * mood: crowd targets for both sides ({ home, away, groan, distract, lights }, see src/three/crowd.jsx).
 * board: the LED message ('', 'DEFENSE', 'THREE', ...).
 */
export function Arena({ home, away, mood, board = '' }) {
  const fans = useMemo(() => seatLayout(home, away), [home, away])
  const bench = useMemo(() => benchLayout(home, away), [home, away])
  // the benches react like their own fans, only bigger
  const benchMood = useMemo(() => ({ ...mood, groan: 0, distract: 0, lights: 0 }), [mood])

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
      <Crowd fans={fans} mood={mood} signColor="#ffffff" signAlt={home.trim} />
      <Crowd fans={bench} mood={benchMood} />
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
