import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { MODEL_URL, ONE_SHOT, SKIN_TONES, buildCharacter } from '../three/characters'
import { BlobShadow } from '../components/Props'

function Character({ team, skin, number, clip, speed, ...props }) {
  const gltf = useGLTF(MODEL_URL)
  const { root, animator } = useMemo(() => buildCharacter(gltf, team, skin, number), [gltf, team, skin, number])

  useEffect(() => {
    animator.play(clip, { restart: true, fade: 0.25 })
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

export default function ViewerScene({ clip, team, opponent, speed, lineup }) {
  return (
    <>
      <color attach="background" args={['#bfe3ff']} />
      <hemisphereLight args={['#eaf6ff', '#4a7d42', 1.6]} />
      <directionalLight position={[3, 6, 4]} intensity={2.2} />
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[4, 32]} />
        <meshLambertMaterial color="#57a64d" />
      </mesh>
      {lineup ? (
        <>
          <Character team={team} skin={SKIN_TONES[0]} number={8} clip={clip} speed={speed} position={[-1.7, 0, 0]} />
          <Character team={team} skin={SKIN_TONES[3]} number={18} clip={clip} speed={speed} position={[0, 0, 0.4]} />
          <Character team={opponent} skin={SKIN_TONES[5]} number={24} clip={clip} speed={speed} position={[1.7, 0, 0]} />
        </>
      ) : (
        <Character team={team} skin={SKIN_TONES[2]} number={18} clip={clip} speed={speed} />
      )}
      <OrbitControls target={[0, 0.85, 0]} minDistance={2} maxDistance={9} maxPolarAngle={Math.PI / 2 - 0.05} enablePan={false} />
    </>
  )
}

useGLTF.preload(MODEL_URL)
