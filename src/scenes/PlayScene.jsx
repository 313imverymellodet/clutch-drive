import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { MODEL_URL, SKIN_TONES, buildCharacter, footballLook, handWorld } from '../three/characters'
import { Field } from '../components/Field'
import { Stadium } from '../components/Stadium'
import { BlobShadow, Football } from '../components/Props'
import { RouteArt } from '../components/RouteArt'
import { LiveRings } from '../components/LiveRings'
import { FIXED_DT, LOS } from '../sim/playSim'
import { getSettings, reducedMotion } from '../game/settings'

const focus = new THREE.Vector3(0, 0, LOS + 5)

const CALM = { home: 0.12, away: 0.08, groan: 0, wave: 0, board: '' }

/**
 * What the building is doing right now. The home crowd is for the home side (in Defense mode that's the defense):
 * it hums before the snap (and sometimes starts a wave), gets loud during the play, and after the whistle one
 * side goes off while the other holds its head. The video boards say what happened.
 */
function crowdFor(sim, homeIsDefense) {
  const homeD = homeIsDefense ? 'DEFENSE' : ''
  if (sim.phase === 'presnap') return { ...CALM, wave: sim.seed % 3 === 0 ? 1 : 0, board: homeD }
  if (sim.phase === 'live' || !sim.result) return { home: 0.3, away: 0.15, groan: 0, wave: 0, board: homeD }
  const r = sim.result
  if (r.kind === 'spike') return { ...CALM, board: '' }
  const homeGood = homeIsDefense ? !r.good : r.good
  const big = r.kind === 'touchdown' || r.kind === 'interception'
  if (homeGood) {
    const board = r.kind === 'touchdown' ? 'TOUCHDOWN' : r.kind === 'interception' ? 'PICK' : r.kind === 'sack' ? 'SACK' : r.first ? 'FIRST' : homeIsDefense ? 'STOP' : 'NOISE'
    return { home: big ? 1 : 0.75, away: 0.05, groan: 0, wave: 0, board }
  }
  return { home: 0.05, away: big ? 1 : 0.7, groan: big ? 1 : 0.55, wave: 0, board: '' }
}
const camGoal = new THREE.Vector3()
const ballHold = new THREE.Vector3()
const tmpTarget = new THREE.Vector3()

/**
 * Draws a PlaySim. `version` changes whenever the sim is reset so the 22 characters are rebuilt.
 * offense/defense are NFL team objects from src/data/nflTeams.js.
 */
export default function PlayScene({ sim, version, offense, defense, onStatus, onEvent, los = LOS, firstDown = null, preview = null, homeIsDefense = false, liveControls = false, night = false }) {
  const gltf = useGLTF(MODEL_URL)
  const { camera, size, gl, scene } = useThree()
  const ballRef = useRef()
  const shadowRefs = useRef([])
  const lastStatus = useRef('')
  const acc = useRef(0)
  const impact = useRef({ freeze: 0, shake: 0 }) // hit-stop and camera shake on big hits (cosmetic)
  const [crowd, setCrowd] = useState(CALM)
  const mood = useMemo(() => ({ ...crowd, lights: night ? 0.7 : 0 }), [crowd, night])

  // One rigged clone per player, dressed in its team's uniform with its jersey number.
  const actors = useMemo(
    () =>
      sim.players.map((p, i) => {
        const team = p.team === 'off' ? offense : defense
        return buildCharacter(gltf, team, SKIN_TONES[(i * 7 + 3) % SKIN_TONES.length], p.number, footballLook(p.role, p.number, team.abbr))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gltf, offense, defense, version],
  )

  useEffect(() => {
    focus.set(0, 0, sim.los + 5)
    acc.current = 0
    setCrowd(CALM)
  }, [version, sim])

  // a new snap (or presnap) resets the status latch so the UI hears about it
  useEffect(() => {
    lastStatus.current = ''
  }, [los, version])

  const tickRef = useRef()
  tickRef.current = (dt, rawDt) => {
    // a big hit freezes the frame for a blink: the sim just runs slower for ~0.1 s (results don't change)
    const hit = impact.current
    if (hit.freeze > 0) {
      hit.freeze -= rawDt
      dt *= 0.12
    }
    // fixed-step sim keeps plays repeatable (instant replay re-runs the same seed)
    acc.current += dt
    while (acc.current >= FIXED_DT) {
      sim.step(FIXED_DT)
      acc.current -= FIXED_DT
    }

    sim.players.forEach((p, i) => {
      const a = actors[i]
      a.root.position.copy(p.pos)
      a.root.rotation.y = p.yaw
      a.animator.play(p.anim, { timeScale: p.animScale, randomStart: p.anim === 'Run' || p.anim === 'Idle' })
      a.animator.update(dt)
      const sh = shadowRefs.current[i]
      if (sh) sh.position.set(p.pos.x, 0.02, p.pos.z)
    })

    // ball: in a glove, in the air, or bouncing on the turf
    const b = sim.ball
    if ((b.state === 'held' || b.state === 'dead') && b.holder) {
      handWorld(actors[sim.players.indexOf(b.holder)].hand, ballHold)
      b.pos.copy(ballHold)
      b.dir.set(Math.sin(b.holder.yaw), 0.3, Math.cos(b.holder.yaw)).normalize()
    }
    const ball = ballRef.current
    if (ball) {
      ball.position.copy(b.pos)
      ball.lookAt(tmpTarget.copy(b.pos).add(b.dir))
      if (b.state === 'air') ball.rotateZ(sim.t * 25)
      if (b.state === 'loose') ball.rotateX(sim.t * 9)
    }

    updateCamera(sim, camera, size, rawDt)
    if (hit.shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * hit.shake
      camera.position.y += (Math.random() - 0.5) * hit.shake * 0.6
      hit.shake *= Math.exp(-rawDt * 14)
    }

    // sim events (snap, catch, tackle, ...) go to the UI for sound and feedback
    if (sim.events.length) {
      const evs = sim.events.splice(0)
      if (!reducedMotion() && sim.timeScale < 2) {
        for (const e of evs) {
          if (e.type === 'sack' || e.type === 'brokenTackle' || e.type === 'interception') (hit.freeze = 0.1), (hit.shake = 0.5)
          else if (e.type === 'tackle') hit.shake = Math.max(hit.shake, 0.28)
        }
      }
      if (onEvent) evs.forEach(onEvent)
    }

    const status = `${sim.seed}|${sim.play.id}|${sim.phase}|${sim.message ?? ''}`
    if (status !== lastStatus.current) {
      lastStatus.current = status
      onStatus({ phase: sim.phase, message: sim.message, result: sim.result })
      setCrowd(crowdFor(sim, homeIsDefense))
    }
  }

  useFrame((_, rawDt) => tickRef.current(Math.min(rawDt, 1 / 20) * sim.timeScale, rawDt))

  // Dev hook: step the play and render synchronously (deterministic screenshots/tests).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    // simScale 0 lets the camera settle while the play stays frozen
    window.__advance = (seconds, step = 1 / 60, simScale = 1) => {
      for (let t = 0; t < seconds - 1e-6; t += step) tickRef.current(step * simScale, step)
      gl.render(scene, camera)
      return +sim.t.toFixed(3)
    }
    return () => delete window.__advance
  }, [gl, scene, camera, sim])

  return (
    <>
      {/* under the lights the sky goes dark but the field stays bright: cooler fill, warmer key */}
      <fog attach="fog" args={night ? ['#0e1528', 120, 430] : ['#cfe9ff', 110, 420]} />
      <hemisphereLight args={night ? ['#c3cfff', '#2f4a2c', 1.25] : ['#eef8ff', '#4a7d42', 1.5]} />
      <directionalLight position={[8, 14, -6]} intensity={night ? 2.5 : 2.1} color={night ? '#fff1d6' : '#ffffff'} />
      <Stadium home={homeIsDefense ? defense : offense} away={homeIsDefense ? offense : defense} mood={mood} board={crowd.board} night={night} />
      <Field home={offense} away={defense} midfield={homeIsDefense ? defense : offense} los={los} firstDown={firstDown} />
      {actors.map((a) => (
        <primitive key={a.root.uuid} object={a.root} />
      ))}
      {actors.map((a, i) => (
        <BlobShadow key={`s${version}-${i}`} ref={(el) => (shadowRefs.current[i] = el)} size={1.5} />
      ))}
      <Football ref={ballRef} />
      <LiveRings sim={sim} enabled={liveControls} />
      {preview && sim.phase === 'presnap' && (
        <RouteArt
          play={typeof preview === 'string' ? preview : preview.play}
          reads={preview.reads ?? null}
          flip={!!preview.flip}
          los={sim.los}
          toGo={sim.firstDown - sim.los}
          coverage={sim.coverage}
        />
      )}
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
  const b = sim.ball
  const aspect = size.width / size.height
  const fov = aspect < 1 ? 58 : 45
  if (camera.fov !== fov) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
  const view = getSettings().camera
  const c = sim.carrier
  if (sim.camMode !== 'close' && sim.result?.kind === 'touchdown' && c && (sim.phase === 'dead' || sim.phase === 'over') && !reducedMotion()) {
    // celebration cam: swing around the scorer while he celebrates
    const since = sim.t - (sim.deadTime ?? sim.t)
    const a = Math.PI * 0.85 + since * 0.55
    focus.lerp(tmpTarget.set(c.pos.x, 0, c.pos.z), Math.min(1, rawDt * 3))
    camGoal.set(focus.x + Math.sin(a) * 7.5, 3.4, focus.z + Math.cos(a) * 7.5)
    camera.position.lerp(camGoal, Math.min(1, rawDt * 2.2))
    camera.lookAt(focus.x, 1.1, focus.z)
    return
  }
  if (sim.camMode === 'close') {
    // replay-style close-up that rides with the ball
    focus.lerp(tmpTarget.set(b.pos.x, 0, b.pos.z), Math.min(1, rawDt * 4))
    camGoal.set(focus.x + 4.5, 3.2, focus.z - 5.5)
    camera.position.lerp(camGoal, Math.min(1, rawDt * 4))
    camera.lookAt(focus.x, 0.9, focus.z)
  } else {
    // broadcast: behind the offense; portrait screens pull back a little
    const pull = THREE.MathUtils.clamp(1.45 / aspect, 1, 1.5)
    // pre-snap, aim past the formation so it sits above the play-call card
    const presnap = sim.phase === 'presnap'
    // camera setting: broadcast, All-22 (high and back: see every route), field level (low and close)
    const [h, back, lookY] = { high: [presnap ? 25 : 22, presnap ? 14 : 12, 0], field: [presnap ? 6.5 : 5.5, presnap ? 15 : 12, 1.4] }[view] ?? [presnap ? 15 : 12, presnap ? 21 : 17, 0]
    focus.lerp(tmpTarget.set(b.pos.x * 0.5, 0, b.pos.z + (presnap ? -7 : 5)), Math.min(1, rawDt * 2.2))
    camGoal.set(focus.x * 0.4, h * pull, focus.z - back * pull)
    camera.position.lerp(camGoal, Math.min(1, rawDt * 2.5))
    camera.lookAt(focus.x, lookY, focus.z + 1)
  }
}
