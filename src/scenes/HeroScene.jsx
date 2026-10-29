import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { MODEL_URL, SKIN_TONES, buildCharacter, footballLook } from '../three/characters'
import { BlobShadow, Football } from '../components/Props'

function Buddy({ team, skin, number, role, clip, delay = 0, ...props }) {
  const gltf = useGLTF(MODEL_URL)
  const { root, animator } = useMemo(() => buildCharacter(gltf, team, skin, number, footballLook(role, number, team.abbr)), [gltf, team, skin, number, role])
  useEffect(() => {
    const id = setTimeout(() => animator.play(clip, { restart: true }), delay)
    animator.play('Idle')
    return () => clearTimeout(id)
  }, [animator, clip, delay])
  useFrame((_, dt) => animator.update(Math.min(dt, 0.1)))
  return (
    <group {...props}>
      <primitive object={root} />
      <BlobShadow size={1.5} />
    </group>
  )
}

function SpinningBall() {
  const ref = useRef()
  useFrame((s) => {
    const t = s.clock.elapsedTime
    ref.current.position.set(Math.sin(t * 0.8) * 0.25, 2.55 + Math.sin(t * 2.2) * 0.12, 0.3)
    ref.current.rotation.set(0.5, t * 2.5, 0.3)
  })
  return <Football ref={ref} scale={2.2} />
}

function Turf() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#4f9a46' : '#58a84e'
      g.fillRect(0, i * 32, 256, 32)
    }
    g.fillStyle = 'rgba(255,255,255,0.9)'
    for (let i = 0; i < 8; i += 2) g.fillRect(0, i * 32 - 2, 256, 4)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  // soft fade at the edge so the disc never shows a hard cut, whatever the canvas size
  const fade = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(64, 64, 20, 64, 64, 64)
    grad.addColorStop(0, '#fff')
    grad.addColorStop(0.6, '#fff')
    grad.addColorStop(1, '#000')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }, [])
  return (
    <mesh rotation-x={-Math.PI / 2}>
      <circleGeometry args={[2.75, 48]} />
      <meshLambertMaterial map={tex} alphaMap={fade} transparent depthWrite={false} />
    </mesh>
  )
}

/** Landing-page hero: today's matchup celebrating on a turf disc. */
export default function HeroScene({ offense, defense }) {
  const rig = useRef()
  useFrame((s) => {
    rig.current.rotation.y = Math.sin(s.clock.elapsedTime * 0.25) * 0.35
  })
  return (
    <>
      <hemisphereLight args={['#fff6e8', '#3d6b35', 1.7]} />
      <directionalLight position={[3, 6, 5]} intensity={2.3} />
      <group ref={rig} position={[0, -0.2, 0]}>
        <Turf />
        <Buddy team={offense} skin={SKIN_TONES[2]} number={8} role="QB" clip="Flex" position={[0, 0, 0.5]} />
        <Buddy team={offense} skin={SKIN_TONES[4]} number={18} role="WR" clip="Dance" delay={500} position={[-1.4, 0, -0.2]} rotation-y={0.45} />
        <Buddy team={defense} skin={SKIN_TONES[0]} number={24} role="CB" clip="Ready" position={[1.4, 0, -0.2]} rotation-y={-0.5} />
        <SpinningBall />
      </group>
    </>
  )
}

useGLTF.preload(MODEL_URL)
