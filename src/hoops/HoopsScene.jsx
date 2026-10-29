import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { HOOPS_MODEL_URL, SKIN_TONES, buildHoopsCharacter, handWorld, hoopsLook } from '../three/characters'
import { FIXED_DT, RIM_HEIGHT } from './sim'
import { HOOP } from './sets'
import { hoopsUniform, numberStyle } from './teams'
import { nbaLogoUrl } from '../game/real'
import { Arena } from './Arena'

// Units are feet. Half court: x -25..25, z 0 (baseline the offense attacks) .. 47 (half court).
const COURT_W = 50
const COURT_L = 60 // show a bit past half court
const PX = 12 // canvas pixels per foot
const openTone = (open) => (open > 5.5 ? '#2ecc71' : open > 3 ? '#ffd400' : '#ff4d4d')

function drawCourt(home, logo) {
  const w = COURT_W * PX
  const h = COURT_L * PX
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  // canvas: x right = court +x, y down = court +z
  const X = (x) => (x + 25) * PX
  const Z = (z) => z * PX
  // hardwood planks
  g.fillStyle = home.wood
  g.fillRect(0, 0, w, h)
  for (let i = 0; i < w / (0.6 * PX); i++) {
    g.fillStyle = `rgba(${i % 3 ? '90,50,15' : '255,235,200'},${0.04 + ((i * 37) % 7) * 0.008})`
    g.fillRect(i * 0.6 * PX, 0, 0.6 * PX - 1, h)
  }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = 'rgba(80,40,10,0.08)'
    g.fillRect(((i * 97) % 83) * 0.6 * PX, ((i * 211) % 61) * PX, 0.6 * PX - 1, 1)
  }
  // painted key
  g.fillStyle = home.paint
  g.globalAlpha = 0.85
  g.fillRect(X(-8), Z(0), 16 * PX, 19 * PX)
  g.globalAlpha = 1
  g.strokeStyle = '#ffffff'
  g.lineWidth = 0.17 * PX
  const line = (pts) => {
    g.beginPath()
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))))
    g.stroke()
  }
  line([[-25, 0.1], [25, 0.1]])
  line([[-24.9, 0], [-24.9, 47]])
  line([[24.9, 0], [24.9, 47]])
  line([[-25, 47], [25, 47]])
  line([[-8, 0], [-8, 19], [8, 19], [8, 0]])
  // free-throw circle, restricted arc, three-point line
  g.beginPath()
  g.arc(X(0), Z(19), 6 * PX, 0, Math.PI * 2)
  g.stroke()
  g.beginPath()
  g.arc(X(HOOP.x), Z(HOOP.z), 4 * PX, 0, Math.PI)
  g.stroke()
  const a = Math.asin(22 / 23.75)
  line([[-22, 0], [-22, 14.2]])
  line([[22, 0], [22, 14.2]])
  g.beginPath()
  g.arc(X(0), Z(HOOP.z), 23.75 * PX, Math.PI / 2 - a, Math.PI / 2 + a)
  g.stroke()
  // center circle with the logo (real-branding builds) or the city name
  g.save()
  g.beginPath()
  g.arc(X(0), Z(47), 6 * PX, 0, Math.PI * 2)
  g.fillStyle = home.paint
  g.globalAlpha = 0.85
  g.fill()
  g.globalAlpha = 1
  g.stroke()
  g.restore()
  if (logo) {
    const r = 4.6 * PX
    g.save()
    g.translate(X(0), Z(47) - 0.5 * PX)
    g.drawImage(logo, -r, -r * 0.9, r * 2, r * 2)
    g.restore()
  }
  // baseline team name
  g.save()
  g.font = `900 ${2.6 * PX}px "Arial Black", Arial, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = home.paint
  g.translate(X(0), Z(23.5))
  g.globalAlpha = 0.18
  g.fillText(home.name.toUpperCase(), 0, 0)
  g.restore()
  return c
}

function Court({ home }) {
  const [logo, setLogo] = useState(null)
  useEffect(() => {
    setLogo(null)
    const url = nbaLogoUrl(home.abbr)
    if (!url) return
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => setLogo(im)
    im.src = url
    return () => {
      im.onload = null
    }
  }, [home.abbr])
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(drawCourt(home, logo))
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [home, logo])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.03, 20]}>
        <planeGeometry args={[90, 110]} />
        <meshLambertMaterial color="#2a2d36" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 26]}>
        <planeGeometry args={[COURT_W + 8, COURT_L + 10]} />
        <meshLambertMaterial color={home.jersey} />
      </mesh>
      {/* the canvas's top edge (z = 0 in drawCourt) lands on the baseline */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, COURT_L / 2]}>
        <planeGeometry args={[COURT_W, COURT_L]} />
        <meshLambertMaterial map={texture} />
      </mesh>
    </group>
  )
}

function Hoop({ netRef }) {
  return (
    <group>
      {/* stanchion */}
      <mesh position={[0, 6, -4.5]}>
        <boxGeometry args={[1.2, 12, 1.2]} />
        <meshLambertMaterial color="#2b2f38" />
      </mesh>
      <mesh position={[0, 12, -2]}>
        <boxGeometry args={[0.6, 0.6, 5.5]} />
        <meshLambertMaterial color="#2b2f38" />
      </mesh>
      <mesh position={[0, 1.5, -4.5]}>
        <boxGeometry args={[5, 3, 4]} />
        <meshLambertMaterial color="#353a46" />
      </mesh>
      {/* backboard */}
      <mesh position={[0, 11.5, 4]}>
        <boxGeometry args={[6, 3.5, 0.15]} />
        <meshPhongMaterial color="#e8f4ff" transparent opacity={0.55} shininess={80} />
      </mesh>
      <mesh position={[0, 11.5, 4]}>
        <boxGeometry args={[6.1, 3.6, 0.1]} />
        <meshBasicMaterial color="#ffffff" wireframe />
      </mesh>
      <mesh position={[0, 10.9, 4.09]}>
        <planeGeometry args={[2, 1.5]} />
        <meshBasicMaterial color="#ffffff" wireframe />
      </mesh>
      {/* rim + net */}
      <mesh position={[HOOP.x, RIM_HEIGHT, HOOP.z]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.75, 0.07, 6, 20]} />
        <meshLambertMaterial color="#ff5a1f" emissive="#802000" />
      </mesh>
      <mesh position={[HOOP.x, RIM_HEIGHT, 4.25]}>
        <boxGeometry args={[0.3, 0.15, 0.5]} />
        <meshLambertMaterial color="#ff5a1f" />
      </mesh>
      <mesh ref={netRef} position={[HOOP.x, RIM_HEIGHT - 0.8, HOOP.z]}>
        <cylinderGeometry args={[0.72, 0.45, 1.6, 12, 3, true]} />
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.85} />
      </mesh>
    </group>
  )
}

/** Open-man rings under your teammates (tap to pass), like the football read rings. */
function PassRings({ sim, enabled, onPass }) {
  const refs = useRef([])
  useFrame(() => {
    const c = enabled ? sim.controls() : null
    for (let i = 0; i < 4; i++) {
      const g = refs.current[i]
      if (!g) continue
      const m = c?.mode === 'offense' ? c.mates[i] : null
      g.visible = !!m
      if (!m) continue
      g.position.set(m.pos.x, 0.08, m.pos.z)
      g.userData.key = m.key
      g.children[0].material.color.set(openTone(m.open))
      g.scale.setScalar(1 + 0.05 * Math.sin(performance.now() / 170 + i))
    }
  })
  return [0, 1, 2, 3].map((i) => (
    <group key={i} ref={(el) => (refs.current[i] = el)} visible={false}>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[2.1, 2.9, 32]} />
        <meshBasicMaterial transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <mesh
        rotation-x={-Math.PI / 2}
        position-y={2}
        onPointerDown={(e) => {
          const g = refs.current[i]
          if (!g?.visible) return
          e.stopPropagation()
          onPass(g.userData.key)
        }}
      >
        <circleGeometry args={[4, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  ))
}

const focus = new THREE.Vector3(0, 0, 16)
// camera: height, distance (z), look-at z, look-at height. ?cam=h,d,z,y overrides it in dev for tuning.
const CAM = (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('cam')?.split(',').map(Number)) || [34, 56, 10, 4]
const camGoal = new THREE.Vector3()
const ballHand = new THREE.Vector3()

/**
 * Draws a HoopsSim: 10 players, the ball, the court. `version` rebuilds the characters (new teams/roster).
 * offense/defense: NBA team objects; offenseAway: the offense wears white.
 */
export default function HoopsScene({ sim, version, offense, defense, offenseAway, home, onStatus, onEvent, controls = false, onPass, tension = 0, board: boardHint = '', distract = false }) {
  const gltf = useGLTF(HOOPS_MODEL_URL)
  const { camera, size } = useThree()
  const ballRef = useRef()
  const netRef = useRef()
  const shadowRefs = useRef([])
  const lastStatus = useRef('')
  const acc = useRef(0)
  const [reaction, setReaction] = useState(null) // { home, away, groan } for a few seconds after a big play
  const [moment, setMoment] = useState('') // big-play LED message for a few seconds
  const homeIsOffense = offense === home
  const markerRef = useRef()
  const lastBounce = useRef(1)
  const lastSqueak = useRef(0)
  const prevVel = useRef([])

  const actors = useMemo(
    () =>
      sim.players.map((p, i) => {
        const team = p.team === 'off' ? offense : defense
        const away = p.team === 'off' ? offenseAway : !offenseAway
        const a = buildHoopsCharacter(gltf, hoopsUniform(team, { away, hair: i * 5 + (p.team === 'off' ? 0 : 3) }), SKIN_TONES[(i * 7 + 2) % SKIN_TONES.length], p.number, numberStyle(team, away), hoopsLook(p.slot ?? p.key, p.number, team.abbr))
        const grow = { PG: 0.93, SG: 0.97, SF: 1, PF: 1.05, C: 1.09 }[p.key] ?? { dPG: 0.93, dSG: 0.97, dSF: 1, dPF: 1.05, dC: 1.09 }[p.key] ?? 1
        a.root.scale.multiplyScalar(grow)
        return a
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gltf, offense, defense, offenseAway, version],
  )

  useEffect(() => {
    lastStatus.current = ''
    acc.current = 0
    setReaction(null)
  }, [version, sim])
  useEffect(() => {
    if (!reaction) return
    const id = setTimeout(() => (setMoment(''), setReaction(null)), 3800)
    return () => clearTimeout(id)
  }, [reaction])
  // both sides of the building: the home crowd hums with the tension, the visitors' pocket a little less;
  // a big play sends one side up and the other into its hands. Late and close, the phone lights come out.
  const mood = useMemo(
    () => ({
      home: reaction?.home ?? tension,
      away: reaction?.away ?? tension * 0.6,
      groan: reaction?.groan ?? 0,
      distract: distract ? 1 : 0,
      lights: tension >= 0.25 ? 1 : 0,
    }),
    [reaction, tension, distract],
  )

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20) * sim.timeScale
    acc.current += dt
    while (acc.current >= FIXED_DT) {
      sim.step(FIXED_DT)
      acc.current -= FIXED_DT
    }
    sim.players.forEach((p, i) => {
      const a = actors[i]
      if (!a) return
      a.root.position.copy(p.pos)
      a.root.rotation.y = p.yaw
      a.animator.play(p.anim, { timeScale: p.anim === 'Run' ? 1.25 : 1, randomStart: p.anim === 'Run' || p.anim === 'Idle' || p.anim === 'Defend' })
      a.animator.update(rawDt * sim.timeScale)
      const sh = shadowRefs.current[i]
      if (sh) sh.position.set(p.pos.x, 0.03, p.pos.z)
    })

    // ball: dribbled, cradled for a shot, or flying
    const b = sim.ball
    const ball = ballRef.current
    if (ball) {
      if (b.state === 'held' && b.holder) {
        const i = sim.players.indexOf(b.holder)
        handWorld(actors[i].hand, ballHand)
        const p = b.holder
        if (p.anim === 'Dribble' || p.anim === 'Run') {
          const bounce = Math.abs(Math.sin(sim.t * (p.anim === 'Run' ? 9 : 7)))
          ball.position.set(ballHand.x, 0.6 + (ballHand.y - 0.6) * bounce, ballHand.z)
          // the ball hits the floor: thump
          if (bounce < 0.12 && lastBounce.current >= 0.12 && sim.timeScale < 2) onEvent?.({ type: 'dribble', loud: sim.phase === 'live' })
          lastBounce.current = bounce
        } else ball.position.copy(ballHand)
        b.pos.copy(ball.position)
      } else ball.position.copy(b.pos)
      ball.rotation.x += rawDt * (b.state === 'shot' ? -12 : 4)
    }
    // sneakers squeak on hard cuts
    if (sim.phase === 'live' && sim.timeScale < 2) {
      sim.players.forEach((p, i) => {
        const pv = (prevVel.current[i] ??= new THREE.Vector3())
        const turn = pv.distanceTo(p.vel) / Math.max(rawDt, 1 / 120)
        if (turn > 70 && p.vel.length() > 7 && performance.now() - lastSqueak.current > 450) {
          lastSqueak.current = performance.now()
          onEvent?.({ type: 'squeak' })
        }
        pv.copy(p.vel)
      })
    }
    // a marker over the ball handler you control
    if (markerRef.current) {
      const B = sim.ball.state === 'held' ? sim.ball.holder : null
      markerRef.current.visible = !!(controls && B && B.team === 'off') && !(import.meta.env.DEV && window.__cam)
      if (B) {
        markerRef.current.position.set(B.pos.x, 9.6 + Math.sin(performance.now() / 180) * 0.25, B.pos.z)
        markerRef.current.rotation.y += rawDt * 3
      }
    }
    if (netRef.current) {
      const swish = b.state === 'swish' ? Math.max(0, 1 - (sim.t - b.t0) * 2) : 0
      netRef.current.scale.set(1 - swish * 0.25, 1 + swish * 0.5, 1 - swish * 0.25)
    }

    updateCamera(sim, camera, size, rawDt)

    if (sim.events.length) {
      const evs = sim.events.splice(0)
      if (onEvent) evs.forEach(onEvent)
    }
    const status = `${sim.seed}|${sim.phase}|${sim.message ?? ''}`
    if (status !== lastStatus.current) {
      lastStatus.current = status
      onStatus?.({ phase: sim.phase, message: sim.message, result: sim.result })
      // the home crowd goes off for home buckets and home stops
      const r = sim.result
      if (r && sim.phase === 'dead') {
        const scored = r.points > 0
        const stop = ['miss', 'steal', 'shotclock', 'clock'].includes(r.kind)
        const homeGood = (scored && homeIsOffense) || (stop && !homeIsOffense)
        const awayGood = (scored && !homeIsOffense) || (stop && homeIsOffense)
        if (homeGood) {
          setReaction({ home: 1, away: 0, groan: 0 })
          setMoment(scored ? (r.points === 3 ? 'THREE' : 'BUCKET') : 'STOP')
        } else if (awayGood) {
          // the visitors' corner goes off; the home crowd holds its head (harder when they scored)
          setReaction({ home: 0.05, away: 1, groan: scored ? 1 : 0.6 })
        }
      }
    }
  })

  return (
    <>
      <color attach="background" args={['#0f1117']} />
      <fog attach="fog" args={['#0f1117', 90, 200]} />
      <hemisphereLight args={['#fff6e8', '#3a3020', 1.6]} />
      <directionalLight position={[10, 40, 30]} intensity={1.8} />
      <pointLight position={[0, 30, 10]} intensity={300} distance={90} />
      <Court home={home} />
      <Hoop netRef={netRef} />
      <Arena home={home} away={home === offense ? defense : offense} mood={mood} board={moment || boardHint} />
      <mesh ref={markerRef} visible={false}>
        <octahedronGeometry args={[0.7, 0]} />
        <meshBasicMaterial color="#ffd400" toneMapped={false} />
      </mesh>
      {actors.map((a) => (
        <primitive key={a.root.uuid} object={a.root} />
      ))}
      {actors.map((a, i) => (
        <mesh key={`s${version}-${i}`} ref={(el) => (shadowRefs.current[i] = el)} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[1.6, 16]} />
          <meshBasicMaterial color="#000" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ))}
      <mesh ref={ballRef}>
        <sphereGeometry args={[0.55, 14, 10]} />
        <meshToonMaterial color="#e8702a" />
      </mesh>
      <PassRings sim={sim} enabled={controls} onPass={onPass} />
    </>
  )
}

function updateCamera(sim, camera, size, rawDt) {
  // capture mode: the recorder flies the camera itself ({ pos, look, fov })
  if (import.meta.env.DEV && window.__cam) {
    const c = window.__cam
    if (c.fov && camera.fov !== c.fov) {
      camera.fov = c.fov
      camera.updateProjectionMatrix()
    }
    camera.position.set(...c.pos)
    camera.lookAt(...c.look)
    return
  }
  const aspect = size.width / size.height
  const fov = aspect < 1 ? 62 : 46
  if (camera.fov !== fov) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
  // broadcast: high above half court looking down at the floor, drifting with the ball; portrait pulls back
  const pull = THREE.MathUtils.clamp(1.4 / aspect, 1, 1.75)
  const b = sim.ball
  const bz = Math.min(32, b.pos.z)
  const [H, D, LZ, LY] = CAM
  focus.lerp(camGoal.set(b.pos.x * 0.3, 0, LZ + bz * 0.2), Math.min(1, rawDt * 2))
  camGoal.set(focus.x * 0.5, H * pull, D + (pull - 1) * 30)
  camera.position.lerp(camGoal, Math.min(1, rawDt * 2.5))
  camera.lookAt(focus.x, LY, focus.z)
}

useGLTF.preload(HOOPS_MODEL_URL)
