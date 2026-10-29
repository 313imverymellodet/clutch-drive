import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { HOOPS_MODEL_URL, HOOPS_SCALE, MODEL_URL, ONE_SHOT, PLAYER_SCALE, SKIN_TONES, buildCharacter, buildHoopsCharacter, footballLook, hoopsLook } from '../three/characters'
import { hoopsUniform, numberStyle } from '../hoops/teams'
import { BlobShadow } from '../components/Props'

/** One player in the Locker Room. Football and hoops models are shown at the same size. */
function Character({ sport, team, skin, number, role, seed, away = false, clip, speed, ...props }) {
  const gltf = useGLTF(sport === 'hoops' ? HOOPS_MODEL_URL : MODEL_URL)
  const { root, animator } = useMemo(() => {
    if (sport === 'hoops') {
      const a = buildHoopsCharacter(gltf, hoopsUniform(team, { away, hair: number }), skin, number, numberStyle(team, away), hoopsLook(role, number, `${team.abbr}${seed}`))
      a.root.scale.multiplyScalar(PLAYER_SCALE / HOOPS_SCALE)
      return a
    }
    return buildCharacter(gltf, team, skin, number, footballLook(role, number, `${team.abbr}${seed}`))
  }, [gltf, sport, team, skin, number, role, seed, away])

  useEffect(() => {
    // a clip this sport doesn't have falls back to the idle
    animator.play(animator.actions[clip] ? clip : 'Idle', { restart: true, fade: 0.25 })
  }, [animator, clip])

  // In the viewer, one-shot clips replay after a short hold so you can keep watching them.
  useEffect(() => {
    if (!ONE_SHOT.has(clip)) return
    let timer
    const onFinish = () => {
      timer = setTimeout(() => animator.play(clip, { restart: true, fade: 0 }), 700)
    }
    animator.mixer.addEventListener('finished', onFinish)
    return () => {
      clearTimeout(timer)
      animator.mixer.removeEventListener('finished', onFinish)
    }
  }, [animator, clip])

  useFrame((_, dt) => {
    animator.current?.setEffectiveTimeScale(speed)
    animator.update(Math.min(dt, 0.1))
  })

  return (
    <group {...props}>
      <primitive object={root} />
      <BlobShadow size={1.4} />
    </group>
  )
}

// a starting five per sport: body types and gear follow the position
const LINEUPS = {
  football: [
    ['OL', 74, 'team', -3.4],
    ['WR', 11, 'team', -1.7],
    ['QB', 8, 'team', 0],
    ['CB', 24, 'opp', 1.7],
    ['DL', 92, 'opp', 3.4],
  ],
  hoops: [
    ['C', 33, 'team', -3.4],
    ['SG', 3, 'team', -1.7],
    ['PG', 0, 'team', 0],
    ['SF', 7, 'opp', 1.7],
    ['PF', 21, 'opp', 3.4],
  ],
}

function CameraFit({ lineup }) {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(lineup ? 1.2 : 2.2, lineup ? 1.2 : 1.9, lineup ? 10.5 : 5.2)
  }, [camera, lineup])
  return null
}

export default function ViewerScene({ sport = 'football', clip, team, opponent, speed, lineup, seed = 0 }) {
  return (
    <>
      <color attach="background" args={[sport === 'hoops' ? '#2a2016' : '#bfe3ff']} />
      <hemisphereLight args={['#eaf6ff', sport === 'hoops' ? '#5a4022' : '#4a7d42', 1.6]} />
      <directionalLight position={[3, 6, 4]} intensity={2.2} />
      <CameraFit lineup={lineup} />
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[lineup ? 6 : 4, 40]} />
        <meshLambertMaterial color={sport === 'hoops' ? '#d9a768' : '#57a64d'} />
      </mesh>
      {lineup ? (
        LINEUPS[sport].map(([role, number, side, x], i) => (
          <Character
            key={`${sport}-${role}`}
            sport={sport}
            role={role}
            number={number}
            seed={seed}
            team={side === 'team' ? team : opponent}
            away={sport === 'hoops' && side === 'opp'}
            skin={SKIN_TONES[(i * 2 + seed) % SKIN_TONES.length]}
            clip={clip}
            speed={speed}
            position={[x, 0, Math.abs(x) > 2 ? -0.6 : x === 0 ? 0.5 : 0]}
            rotation-y={-x * 0.08}
          />
        ))
      ) : (
        <Character sport={sport} role={sport === 'hoops' ? 'SF' : 'WR'} number={sport === 'hoops' ? 7 : 18} seed={seed} team={team} skin={SKIN_TONES[(2 + seed) % SKIN_TONES.length]} clip={clip} speed={speed} />
      )}
      {/* aim low so the players sit in the top half, above the control card */}
      <OrbitControls target={[0, lineup ? -0.35 : 0.3, 0]} minDistance={2} maxDistance={14} maxPolarAngle={Math.PI / 2 - 0.05} enablePan={false} />
    </>
  )
}

useGLTF.preload(MODEL_URL)
