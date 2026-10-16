import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { MODEL_URL, SKIN_TONES, buildCharacter, handWorld } from '../three/characters'
import { Field } from '../components/Field'
import { Stadium } from '../components/Stadium'
import { BlobShadow, Football } from '../components/Props'
import { RouteArt } from '../components/RouteArt'
import { LiveRings } from '../components/LiveRings'
import { FIXED_DT, LOS } from '../sim/playSim'

const focus = new THREE.Vector3(0, 0, LOS + 5)
const camGoal = new THREE.Vector3()
const ballHold = new THREE.Vector3()
const tmpTarget = new THREE.Vector3()

/**
 * Draws a PlaySim. `version` changes whenever the sim is reset so the 22 characters are rebuilt.
 * offense/defense are NFL team objects from src/data/nflTeams.js.
 */
export default function PlayScene({ sim, version, offense, defense, onStatus, onEvent, los = LOS, firstDown = null, preview = null, homeIsDefense = false, liveControls = false }) {
  const gltf = useGLTF(MODEL_URL)
  const { camera, size, gl, scene } = useThree()
  const ballRef = useRef()
  const shadowRefs = useRef([])
  const lastStatus = useRef('')
  const acc = useRef(0)
  const [excited, setExcited] = useState(false)

  // One rigged clone per player, dressed in its team's uniform with its jersey number.
  const actors = useMemo(
    () =>
      sim.players.map((p, i) =>
        buildCharacter(gltf, p.team === 'off' ? offense : defense, SKIN_TONES[(i * 7 + 3) % SKIN_TONES.length], p.number),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gltf, offense, defense, version],
  )

  useEffect(() => {
    focus.set(0, 0, sim.los + 5)
    acc.current = 0
    setExcited(false)
  }, [version, sim])

  // a new snap (or presnap) resets the status latch so the UI hears about it
  useEffect(() => {
    lastStatus.current = ''
  }, [los, version])

  const tickRef = useRef()
  tickRef.current = (dt, rawDt) => {
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

    // sim events (snap, catch, tackle, ...) go to the UI for sound and feedback
    if (sim.events.length) {
      const evs = sim.events.splice(0)
      if (onEvent) evs.forEach(onEvent)
    }

    const status = `${sim.seed}|${sim.play.id}|${sim.phase}|${sim.message ?? ''}`
    if (status !== lastStatus.current) {
      lastStatus.current = status
      onStatus({ phase: sim.phase, message: sim.message, result: sim.result })
      // the home crowd cheers for the home side (in Defense mode that's the defense)
      const good = !!sim.result?.good
      setExcited(sim.phase !== 'presnap' && sim.phase !== 'live' && !!sim.result && (homeIsDefense ? !good : good))
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
      <fog attach="fog" args={['#cfe9ff', 110, 420]} />
      <hemisphereLight args={['#eef8ff', '#4a7d42', 1.5]} />
      <directionalLight position={[8, 14, -6]} intensity={2.1} />
      <Stadium home={homeIsDefense ? defense : offense} away={homeIsDefense ? offense : defense} excited={excited} />
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
  const b = sim.ball
  const aspect = size.width / size.height
  const fov = aspect < 1 ? 58 : 45
  if (camera.fov !== fov) {
    camera.fov = fov
    camera.updateProjectionMatrix()
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
    focus.lerp(tmpTarget.set(b.pos.x * 0.5, 0, b.pos.z + (presnap ? -7 : 5)), Math.min(1, rawDt * 2.2))
    camGoal.set(focus.x * 0.4, (presnap ? 15 : 12) * pull, focus.z - (presnap ? 21 : 17) * pull)
    camera.position.lerp(camGoal, Math.min(1, rawDt * 2.5))
    camera.lookAt(focus.x, 0, focus.z + 1)
  }
}
