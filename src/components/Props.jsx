import { forwardRef, useMemo } from 'react'
import * as THREE from 'three'

const shadowTexture = (() => {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(0,0,0,0.45)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
})()

const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false })
const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)

/** Cheap soft blob shadow; much lighter than real shadow maps on phones. */
export const BlobShadow = forwardRef(function BlobShadow({ size = 1.1, ...props }, ref) {
  return <mesh ref={ref} geometry={shadowGeometry} material={shadowMaterial} scale={size} position-y={0.02} {...props} />
})

/** Low-poly football. Long axis is local +Z. */
export const Football = forwardRef(function Football(props, ref) {
  const geom = useMemo(() => new THREE.SphereGeometry(0.11, 8, 6).scale(1, 1, 1.65), [])
  return (
    <group ref={ref} {...props}>
      <mesh geometry={geom}>
        <meshToonMaterial color="#8a4b22" />
      </mesh>
      <mesh position={[0, 0.105, 0]}>
        <boxGeometry args={[0.025, 0.012, 0.13]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
})
