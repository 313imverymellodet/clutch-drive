import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

/** Scrolling LED ribbon text (canvas texture). */
function useRibbon(text, color, bg) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 2048
    c.height = 96
    const t = new THREE.CanvasTexture(c)
    t.wrapS = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  useEffect(() => {
    const c = tex.image
    const g = c.getContext('2d')
    g.fillStyle = bg
    g.fillRect(0, 0, c.width, c.height)
    g.font = '900 64px "Arial Black", Impact, sans-serif'
    g.textBaseline = 'middle'
    g.fillStyle = color
    // a whole number of repeats across the canvas so the scroll wraps without a seam
    const word = `${text}   ★   `
    const w = g.measureText(word).width
    const n = Math.max(1, Math.floor(c.width / w))
    const step = c.width / n
    for (let i = 0; i < n; i++) g.fillText(word, i * step + (step - w) / 2, c.height / 2 + 4)
    // LED dot texture
    g.fillStyle = 'rgba(0,0,0,0.25)'
    for (let x = 0; x < c.width; x += 6) g.fillRect(x, 0, 2, c.height)
    tex.needsUpdate = true
  }, [tex, text, color, bg])
  return tex
}

/** A scrolling LED ribbon board. width/height in venue units; the text repeats about every 70 units of width. */
export function Ribbon({ text, color, bg, position, rotation, width, height = 2.4, speed = 0.06, period = 70 }) {
  const tex = useRibbon(text, color, bg)
  useFrame((_, dt) => {
    tex.offset.x = (tex.offset.x + dt * speed) % 1
  })
  tex.repeat.set(width / period, 1)
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  )
}

/**
 * A big video board: the home team's colors, a headline (TOUCHDOWN!, DEFENSE!, ...) that pulses when it's hot,
 * and a line under it. Drawn on a canvas, redrawn only when the text changes.
 */
export function Jumbotron({ title, sub, team, hot = false, position, rotation, width = 30 }) {
  const height = width * 0.42
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 430
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  useEffect(() => {
    const c = tex.image
    const g = c.getContext('2d')
    const grad = g.createLinearGradient(0, 0, 0, c.height)
    grad.addColorStop(0, team.jersey)
    grad.addColorStop(1, '#05070c')
    g.fillStyle = grad
    g.fillRect(0, 0, c.width, c.height)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = hot ? '#ffd400' : '#ffffff'
    let size = 150
    g.font = `900 ${size}px "Arial Black", Impact, sans-serif`
    while (g.measureText(title).width > c.width - 80 && size > 60) g.font = `900 ${(size -= 8)}px "Arial Black", Impact, sans-serif`
    g.lineWidth = 14
    g.strokeStyle = 'rgba(0,0,0,0.45)'
    g.strokeText(title, c.width / 2, c.height * 0.44)
    g.fillText(title, c.width / 2, c.height * 0.44)
    g.font = '800 54px "Arial Black", Impact, sans-serif'
    g.fillStyle = 'rgba(255,255,255,0.85)'
    g.fillText(sub, c.width / 2, c.height * 0.8)
    // LED grid
    g.fillStyle = 'rgba(0,0,0,0.22)'
    for (let x = 0; x < c.width; x += 5) g.fillRect(x, 0, 1.5, c.height)
    for (let y = 0; y < c.height; y += 5) g.fillRect(0, y, c.width, 1.5)
    tex.needsUpdate = true
  }, [tex, title, sub, team, hot])
  const screen = useRef()
  useFrame(({ clock }) => {
    const v = hot ? 0.8 + 0.2 * Math.sin(clock.elapsedTime * 10) : 1
    screen.current?.color.setScalar(v)
  })
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0, -0.3]}>
        <boxGeometry args={[width + 1.6, height + 1.6, 0.5]} />
        <meshLambertMaterial color="#1a1d24" />
      </mesh>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial ref={screen} map={tex} toneMapped={false} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * width * 0.3, -height / 2 - 6, -0.6]}>
          <boxGeometry args={[0.8, 12, 0.8]} />
          <meshLambertMaterial color="#3a3f4b" />
        </mesh>
      ))}
    </group>
  )
}
