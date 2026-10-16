import { useMemo } from 'react'
import * as THREE from 'three'

// Field coordinates (yards): x = sideline to sideline, z = downfield.
// Goal lines at z = ±50, end zones to ±60. The offense drives toward +z.
export const FIELD_WIDTH = 53.33
const PX = 16 // canvas pixels per yard

function drawField(home, away, mid = home) {
  const w = Math.round(FIELD_WIDTH * PX)
  const h = 120 * PX
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  // canvas row 0 = world z -60 (own end zone)
  const row = (z) => (z + 60) * PX

  for (let z = -50; z < 50; z += 5) {
    g.fillStyle = ((z + 50) / 5) % 2 ? '#4f9a46' : '#57a64d'
    g.fillRect(0, row(z), w, 5 * PX)
  }
  g.fillStyle = home.endzone
  g.fillRect(0, 0, w, 10 * PX)
  g.fillStyle = away.endzone
  g.fillRect(0, row(50), w, 10 * PX)

  g.fillStyle = 'rgba(255,255,255,0.92)'
  for (let z = -50; z <= 50; z += 5) g.fillRect(0, row(z) - 2, w, 4)
  // hash marks + sideline ticks every yard
  const hashX = [w / 2 - 3.08 * PX, w / 2 + 3.08 * PX]
  for (let z = -49; z < 50; z++) {
    if (z % 5 === 0) continue
    for (const x of hashX) g.fillRect(x - 0.35 * PX, row(z) - 1.5, 0.7 * PX, 3)
    g.fillRect(0.4 * PX, row(z) - 1.5, 0.7 * PX, 3)
    g.fillRect(w - 1.1 * PX, row(z) - 1.5, 0.7 * PX, 3)
  }
  g.lineWidth = 6
  g.strokeStyle = 'rgba(255,255,255,0.95)'
  g.strokeRect(3, 3, w - 6, h - 6)

  // yard numbers (facing each sideline)
  g.font = `bold ${2 * PX}px "Arial Black", Arial, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (let z = -40; z <= 40; z += 10) {
    const label = String(50 - Math.abs(z))
    for (const [x, rot] of [[9 * PX, Math.PI / 2], [w - 9 * PX, -Math.PI / 2]]) {
      g.save()
      g.translate(x, row(z))
      g.rotate(rot)
      g.fillText(label, 0, 0)
      g.restore()
    }
  }
  // end zone team names, scaled to fit
  for (const [z, team] of [[-55, home], [55, away]]) {
    const word = team.name.toUpperCase()
    g.save()
    g.translate(w / 2, row(z))
    g.scale(1, -1) // reads upright from behind the offense once the texture is mirrored
    let size = 5.5 * PX
    g.font = `900 ${size}px "Arial Black", Arial, sans-serif`
    const fit = (w - 6 * PX) / g.measureText(word).width
    if (fit < 1) g.font = `900 ${(size *= fit)}px "Arial Black", Arial, sans-serif`
    g.lineWidth = 0.35 * PX
    g.strokeStyle = 'rgba(255,255,255,0.9)'
    g.fillStyle = team.text
    g.strokeText(word, 0, 0)
    g.fillText(word, 0, 0)
    g.restore()
  }
  // midfield: home abbreviation in a ring
  g.save()
  g.translate(w / 2, row(0))
  g.scale(1, -1)
  g.beginPath()
  g.arc(0, 0, 5 * PX, 0, Math.PI * 2)
  g.fillStyle = mid.endzone
  g.fill()
  g.lineWidth = 0.4 * PX
  g.strokeStyle = '#ffffff'
  g.stroke()
  g.font = `900 ${3.4 * PX}px "Arial Black", Arial, sans-serif`
  g.fillStyle = mid.text
  g.fillText(mid.abbr, 0, 0.2 * PX)
  g.restore()
  return c
}

export function Field({ home, away, midfield, los, firstDown }) {
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(drawField(home, away, midfield ?? home))
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    // The broadcast camera looks down +z, which puts world +x on screen-left; mirror so text reads correctly.
    t.wrapS = THREE.RepeatWrapping
    t.repeat.x = -1
    return t
  }, [home, away, midfield])

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
        <planeGeometry args={[110, 170]} />
        <meshLambertMaterial color="#3c7d38" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[FIELD_WIDTH, 120]} />
        <meshLambertMaterial map={texture} />
      </mesh>
      {los != null && <Line z={los} color="#2f6cff" />}
      {firstDown != null && <Line z={firstDown} color="#ffd400" />}
    </group>
  )
}

function Line({ z, color }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, z]}>
      <planeGeometry args={[FIELD_WIDTH, 0.25]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} />
    </mesh>
  )
}
