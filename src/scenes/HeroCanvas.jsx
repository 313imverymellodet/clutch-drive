import { Canvas } from '@react-three/fiber'
import HeroScene from './HeroScene'

/** The landing page's 3D players, in their own chunk so the page paints before three.js loads. */
export default function HeroCanvas({ offense, defense }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ fov: 30, position: [0, 3.9, 11.6] }} gl={{ alpha: true }} onCreated={({ camera }) => camera.lookAt(0, 0.85, 0)}>
      <HeroScene offense={offense} defense={defense} />
    </Canvas>
  )
}
