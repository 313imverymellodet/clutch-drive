import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { isLight, uniformOf } from '../data/nflTeams'

export { NFL_TEAMS, TEAM_BY_ABBR } from '../data/nflTeams'

// ?v= busts browser caches when the models change (keep in sync with the preloads in src/seo.js)
export const MODEL_URL = '/models/player.glb?v=2'
export const PLAYER_SCALE = 1.2 // model is ~1.47 units tall; 1 unit = 1 yard on the field

// Clip names come straight from the Blender action names in blender/build_player.py
export const CLIPS = ['Idle', 'Shotgun', 'Ready', 'Stance', 'Run', 'RunBall', 'Backpedal', 'Shuffle', 'Block', 'Throw', 'Catch', 'Dive', 'Tackle', 'Fall', 'JukeL', 'JukeR', 'Spin', 'Slide', 'Spike', 'Celebrate', 'Dance', 'Flex', 'Dejected', 'Clap']
export const HOOPS_CLIPS = ['Idle', 'Run', 'Dribble', 'Defend', 'DefSlide', 'Shoot', 'Pass', 'Catch', 'Contest', 'Layup', 'Dunk', 'Block', 'Hold', 'Celebrate', 'Dance', 'Flex', 'Dejected', 'Clap']
export const ONE_SHOT = new Set(['Throw', 'Catch', 'Dive', 'Tackle', 'Fall', 'JukeL', 'JukeR', 'Spin', 'Slide', 'Spike', 'Shoot', 'Pass', 'Contest', 'Layup', 'Dunk'])
export const THROW_RELEASE = 16 / 30 // frame 16 of the Throw clip at 30fps

export const SKIN_TONES = ['#f1c7a5', '#dfa47e', '#c68863', '#a5694a', '#7d4a33', '#5a3524']

const gradientMap = (() => {
  const t = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat)
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
})()

const materialCache = new Map()

function toonMaterial(slot, source, uniform, skin) {
  let hex
  if (slot === 'Skin') hex = skin
  else if (uniform[slot]) hex = uniform[slot]
  const key = `${slot}|${hex ?? 'base'}`
  if (!materialCache.has(key)) {
    const color = hex ? new THREE.Color(hex) : source.color.clone()
    materialCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap, name: slot }))
  }
  return materialCache.get(key)
}

// ---------------------------------------------------------------- jersey numbers
const numberCache = new Map()
const numberGeometry = new THREE.PlaneGeometry(0.2, 0.17)

function numberMaterial(number, team) {
  const key = `${number}|${team.num}|${team.jersey}`
  if (!numberCache.has(key)) {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 108
    const g = c.getContext('2d')
    g.font = '900 92px "Arial Black", Impact, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.lineWidth = 10
    // outline in a contrasting color so light-on-light (e.g. Dallas white) still reads
    const sameTone = isLight(team.num) === isLight(team.jersey)
    g.strokeStyle = sameTone ? (isLight(team.num) ? team.stripe : '#ffffff') : team.jersey
    g.strokeText(String(number), 64, 58)
    g.fillStyle = team.num
    g.fillText(String(number), 64, 58)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    numberCache.set(key, new THREE.MeshToonMaterial({ map: tex, gradientMap, alphaTest: 0.4 }))
  }
  return numberCache.get(key)
}

/** Glue number decals to the back and chest; they ride on the spine bone. `depth` follows the body type. */
function addNumbers(root, number, team, depth = 1) {
  const spine = root.getObjectByName('spine')
  if (!spine) return
  root.updateMatrixWorld(true)
  const mat = numberMaterial(number, team)
  // model faces +z: back decal at -z (big), chest decal at +z (smaller)
  for (const [z, ry, y, size] of [[-0.152, Math.PI, 0.79, 1], [0.152, 0, 0.74, 0.75]]) {
    const plane = new THREE.Mesh(numberGeometry, mat)
    plane.position.set(0, y, z * depth)
    plane.rotation.y = ry
    plane.scale.setScalar(size)
    root.add(plane)
    plane.updateMatrixWorld(true)
    spine.attach(plane) // keeps the rest-pose placement, then follows the spine's animation
  }
}

// ---------------------------------------------------------------- looks: body type, gear, hair
// Optional meshes in the GLBs (blender/build_player.py): hidden unless a look turns them on.
const FOOTBALL_GEAR = ['Visor', 'Towel', 'Sleeve', 'EyeBlack']
export const HAIR_STYLES = ['HairShort', 'HairFade', 'HairAfro', 'HairTwists', 'HairBun']
const HOOPS_GEAR = [...HAIR_STYLES, 'Headband', 'Beard', 'Sleeve']

/** Small deterministic hash so a player's look never changes between plays. */
const hash = (...xs) => {
  let h = 2166136261
  for (const x of xs) for (const ch of String(x)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/** heavy/lean 0..1 shape keys, a height scale and the gear to show, for a football position. */
export function footballLook(role, number = 0, teamKey = '') {
  const body = { OL: [0.95, 0, 1.04], C: [0.9, 0, 1.03], DL: [0.85, 0, 1.04], TE: [0.45, 0, 1.03], LB: [0.4, 0, 1.01], RB: [0.15, 0, 0.98], QB: [0, 0.1, 1.01], WR: [0, 0.6, 1.0], CB: [0, 0.7, 0.98], S: [0, 0.35, 1.0] }[role] ?? [0, 0, 1]
  const r = (salt) => hash(teamKey, number, role, salt)
  const skill = !['OL', 'C', 'DL'].includes(role)
  const gear = []
  if (skill && r('visor') < 0.14) gear.push('Visor')
  else if (r('eyeblack') < 0.4) gear.push('EyeBlack')
  if (['QB', 'RB', 'WR', 'TE'].includes(role) && r('towel') < 0.4) gear.push('Towel')
  if (r('sleeve') < 0.3) gear.push('Sleeve')
  return { heavy: body[0], lean: body[1], height: body[2], gear }
}

/** Same for a basketball slot (PG..C): bigs are heavier and taller, and everyone gets a hairstyle. */
export function hoopsLook(slot, number = 0, teamKey = '') {
  const body = { PG: [0, 0.6, 0.93], SG: [0, 0.35, 0.97], SF: [0.1, 0.1, 1], PF: [0.5, 0, 1.05], C: [0.85, 0, 1.09] }[slot] ?? [0, 0, 1]
  const r = (salt) => hash(teamKey, number, slot, salt)
  const gear = []
  const h = r('hair')
  const style = h < 0.12 ? null : HAIR_STYLES[Math.floor(((h - 0.12) / 0.88) * HAIR_STYLES.length)]
  if (style) gear.push(style)
  if (r('band') < 0.22 && style !== 'HairAfro' && style !== 'HairBun') gear.push('Headband')
  if (r('beard') < 0.3) gear.push('Beard')
  if (r('sleeve') < 0.25) gear.push('Sleeve')
  return { heavy: body[0], lean: body[1], height: body[2], gear }
}

/** Apply a look to a cloned model: shape keys on every mesh, optional meshes on or off. */
function applyLook(root, look, optional) {
  const show = new Set(look?.gear ?? [])
  for (const name of optional) {
    const node = root.getObjectByName(name)
    if (node) node.visible = show.has(name)
  }
  root.traverse((o) => {
    const dict = o.morphTargetDictionary
    if (!dict || !o.morphTargetInfluences) return
    if (dict.Heavy != null) o.morphTargetInfluences[dict.Heavy] = look?.heavy ?? 0
    if (dict.Lean != null) o.morphTargetInfluences[dict.Lean] = look?.lean ?? 0
  })
}

/** Torso depth relative to the base body, so number decals sit on a heavy or lean chest. */
const depthOf = (look) => 1 + 0.26 * (look?.heavy ?? 0) - 0.12 * (look?.lean ?? 0)

/** Clone the rigged model, dress it in a team's uniform, and return handles the sim needs. */
export function buildCharacter(gltf, team, skin = SKIN_TONES[1], number = null, look = null) {
  const uniform = uniformOf(team)
  const root = cloneSkinned(gltf.scene)
  root.traverse((o) => {
    if (o.isMesh) {
      o.material = toonMaterial(o.material.name, o.material, uniform, skin)
      o.frustumCulled = false // skinned bounds don't follow the animation
    }
  })
  applyLook(root, look, FOOTBALL_GEAR)
  if (number != null) addNumbers(root, number, team, depthOf(look))
  root.scale.setScalar(PLAYER_SCALE * (look?.height ?? 1))
  // GLTFLoader strips "." from node names: "forearm.R" -> "forearmR"
  const hand = root.getObjectByName('forearmR')
  return { root, hand, animator: new Animator(root, gltf.animations) }
}

export const HOOPS_MODEL_URL = '/models/hoops.glb?v=2'
export const HOOPS_SCALE = 4.4 // feet: about a 6'6" player, chibi proportions

/** The basketball model: uniform = material slot -> color (see src/hoops/teams.js hoopsUniform). */
export function buildHoopsCharacter(gltf, uniform, skin, number, numberStyle, look = null) {
  const root = cloneSkinned(gltf.scene)
  root.traverse((o) => {
    if (o.isMesh) {
      o.material = toonMaterial(o.material.name, o.material, uniform, skin)
      o.frustumCulled = false
    }
  })
  applyLook(root, look, HOOPS_GEAR)
  if (number != null) addNumbers(root, number, numberStyle, depthOf(look))
  root.scale.setScalar(HOOPS_SCALE * (look?.height ?? 1))
  const hand = root.getObjectByName('forearmR')
  return { root, hand, animator: new Animator(root, gltf.animations) }
}

const _v = new THREE.Vector3()
/** World position of the right glove (tip of the forearm bone). */
export function handWorld(hand, out = _v) {
  hand.updateWorldMatrix(true, false)
  return hand.localToWorld(out.set(0, 0.2, 0))
}

/** Thin wrapper over AnimationMixer: idempotent play() with crossfades. */
export class Animator {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root)
    this.actions = {}
    for (const clip of clips) {
      const a = this.mixer.clipAction(clip)
      if (ONE_SHOT.has(clip.name)) {
        a.setLoop(THREE.LoopOnce, 1)
        a.clampWhenFinished = true
      }
      this.actions[clip.name] = a
    }
    this.current = null
    this.name = null
  }

  play(name, { fade = 0.18, timeScale = 1, restart = false, randomStart = false } = {}) {
    const next = this.actions[name]
    if (!next) return
    if (this.current === next && !restart) {
      next.setEffectiveTimeScale(timeScale)
      return
    }
    next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1).play()
    if (randomStart) next.time = Math.random() * next.getClip().duration
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false)
    this.current = next
    this.name = name
  }

  update(dt) {
    this.mixer.update(dt)
  }
}
