import { load, save } from './storage'
import { getSettings, onSettings } from './settings'
import { HAPTIC, haptic } from './haptics'

/*
 * Tiny synthesized sound kit (WebAudio, no files): whistle, hits, catches, crowd.
 * The AudioContext is created on the first user gesture (unlock()), as browsers require.
 */

let ctx = null
let master = null
let noiseBuf = null
let ambience = null
let muted = load('cd.muted', false)
const listeners = new Set()
const level = () => (muted ? 0 : getSettings().volume)
onSettings(() => master && master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05))

export const isMuted = () => muted
export function setMuted(m) {
  muted = m
  save('cd.muted', m)
  if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05)
  listeners.forEach((fn) => fn(m))
}
export function onMuteChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Call from a click/tap handler. Safe to call repeatedly. */
export function unlock() {
  unmuteIOS()
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = level()
      master.connect(ctx.destination)
      ctx.onstatechange = flushPending
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const d = noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      loadClips()
    }
    if (ctx.state === 'suspended') ctx.resume()
  } catch {
    ctx = null
  }
}

const ready = () => !!ctx && ctx.state === 'running'

// Recorded clips generated with Viewmax (scripts/make-sounds.mjs). Each falls back to the synth if it can't load.
// The bytes download as soon as the game loads (no gesture needed); they're decoded once audio is unlocked,
// so the first "Take the field" already has the QB's cadence ready.
// Basketball has its own set (hoops-*.m4a), fetched only when a hoops page asks for it (preloadHoops).
const CLIPS = ['crowd', 'roar', 'groan', 'cheer', 'hit', 'cadence', 'theme']
export const HOOPS_CLIPS = ['crowd', 'roar', 'ooh', 'chant', 'swish', 'clank', 'dribble', 'squeak', 'horn', 'whistle', 'theme'].map((n) => `hoops-${n}`)
const buffers = {}
const bytes = {}
const decoding = new Set()
const fetchClip = (name) => (bytes[name] ??= fetch(`/sounds/${name}.m4a`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))))
if (typeof window !== 'undefined') CLIPS.forEach(fetchClip)
const pending = []
function loadClips() {
  if (!ctx) return
  for (const name of Object.keys(bytes)) {
    if (decoding.has(name)) continue
    decoding.add(name)
    bytes[name]
      .then((b) => ctx.decodeAudioData(b.slice(0)))
      .then((buf) => {
        buffers[name] = buf
        if (name === ambienceBed && ambience?.synth) restartAmbience()
        flushPending()
      })
      .catch(() => {})
  }
}
/** Start downloading the basketball sounds (decoded on the first tap, like the rest). */
export function preloadHoops() {
  if (typeof window === 'undefined') return
  HOOPS_CLIPS.forEach(fetchClip)
  loadClips()
}
/** Play clips that were asked for while audio was still starting up or decoding (if it's still within a beat). */
let wantAmbience = false
let ambienceBed = 'crowd'
let ambienceLevel = 0.32
function flushPending() {
  if (!ready()) return
  if (wantAmbience && !ambience) startAmbience()
  const keep = []
  for (const job of pending.splice(0)) {
    if (performance.now() - job.at > 1500) continue
    if (buffers[job.name]) clip(job.name, job.gain, job.opts)
    else keep.push(job)
  }
  pending.push(...keep)
}

/** iPhones mute web audio when the side switch is on silent unless the page asks to be a media player. */
let sessionAudio = null
function unmuteIOS() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'
    if (!sessionAudio) {
      // older iOS: a silent, looping <audio> element moves the page into the playback category
      sessionAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQQAAACAgICA')
      sessionAudio.loop = true
      sessionAudio.setAttribute('playsinline', '')
      sessionAudio.volume = 0.01
    }
    sessionAudio.play().catch(() => {})
  } catch {
    /* not supported */
  }
}
/** Play a recorded clip by name (see CLIPS / HOOPS_CLIPS). Returns false if it isn't ready yet. */
export function playClip(name, gain = 1, opts = {}) {
  return clip(name, gain, opts)
}

/** Loop a clip (the arena chant) with a fade in; returns a stop() that fades it out. */
export function loopClip(name, gain = 0.5, fade = 0.6) {
  if (!ready() || !buffers[name]) return null
  const src = ctx.createBufferSource()
  src.buffer = buffers[name]
  src.loop = true
  const g = ctx.createGain()
  g.gain.value = 0
  g.gain.setTargetAtTime(gain, ctx.currentTime, fade / 3)
  src.connect(g).connect(master)
  src.start()
  return {
    stop() {
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.25)
      setTimeout(() => src.stop(), 1200)
    },
  }
}

function clip(name, gain = 1, { rate = 1, wait = false } = {}) {
  if (!ctx) return false
  if (!ready() || !buffers[name]) {
    // audio still starting or the clip still decoding: play it the moment it's ready (if that's within a beat)
    if (wait) pending.push({ name, gain, opts: { rate }, at: performance.now() })
    return false
  }
  const src = ctx.createBufferSource()
  src.buffer = buffers[name]
  src.playbackRate.value = rate
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(g).connect(master)
  src.start()
  return true
}

function noise(dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.01, release = dur, sweepTo = null } = {}) {
  const t = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.setValueAtTime(freq, t)
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
  f.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, release))
  src.connect(f).connect(g).connect(master)
  src.start(t, Math.random())
  src.stop(t + dur + 0.05)
}

function tone(freq, dur, { type = 'sine', gain = 0.2, to = null, delay = 0 } = {}) {
  const t = ctx.currentTime + delay
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + dur + 0.02)
}

export const sfx = {
  whistle(len = 0.38) {
    if (!ready()) return
    const t = ctx.currentTime
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.02)
    g.gain.setValueAtTime(0.09, t + len - 0.06)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.frequency.value = 38 // the pea rattling inside
    lfoGain.gain.value = 140
    lfo.connect(lfoGain)
    for (const f of [2950, 3120]) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = f
      lfoGain.connect(o.frequency)
      o.connect(g)
      o.start(t)
      o.stop(t + len + 0.02)
    }
    g.connect(master)
    lfo.start(t)
    lfo.stop(t + len + 0.02)
  },
  snap() {
    if (!ready()) return
    tone(180, 0.09, { type: 'square', gain: 0.06, to: 120 })
    noise(0.06, { freq: 900, gain: 0.08 })
  },
  throw() {
    if (!ready()) return
    noise(0.28, { freq: 600, sweepTo: 2400, q: 2, gain: 0.07, attack: 0.05 })
  },
  catch() {
    if (!ready()) return
    tone(520, 0.08, { gain: 0.12, to: 260 })
    noise(0.05, { type: 'lowpass', freq: 1400, gain: 0.08 })
  },
  hit(big = false) {
    if (!ready()) return
    if (clip('hit', big ? 1 : 0.8, { rate: big ? 0.9 : 1 + Math.random() * 0.1 })) return
    tone(big ? 95 : 120, 0.18, { gain: big ? 0.35 : 0.22, to: 45 })
    noise(0.14, { type: 'lowpass', freq: 380, gain: big ? 0.4 : 0.25 })
  },
  cheer(level = 1) {
    if (!ready()) return
    if (level >= 2 ? clip('roar', 1) : clip('cheer', 0.5 + level * 0.3)) return
    noise(1.6 + level, { freq: 900, q: 0.6, gain: 0.05 + level * 0.06, attack: 0.25, release: 1.4 + level })
    noise(1.4 + level, { type: 'highpass', freq: 2500, gain: 0.015 + level * 0.02, attack: 0.3, release: 1.2 + level })
  },
  groan() {
    if (!ready()) return
    if (clip('groan', 0.8)) return
    noise(1.4, { type: 'lowpass', freq: 1300, sweepTo: 350, gain: 0.12, attack: 0.15, release: 1.3 })
  },
  tick() {
    if (!ready()) return
    tone(1500, 0.03, { type: 'square', gain: 0.03 })
  },
  /** "Blue 42, set, HUT!" when you take the field. */
  cadence() {
    clip('cadence', 1, { wait: true })
  },
  /** Victory music on a win. */
  theme() {
    clip('theme', 0.5, { wait: true })
  },
  /** Quick crowd pop so you know sound is on (unmuting, first tap). */
  check() {
    if (!clip('cheer', 0.6)) this.cheer(0.6)
  },
  click() {
    if (!ready()) return
    tone(900, 0.04, { type: 'triangle', gain: 0.05 })
  },
}

/** Low stadium murmur while a game is on screen. */
export function startAmbience(bed = ambienceBed) {
  wantAmbience = true
  if (bed !== ambienceBed && ambience) stopAmbience(), (wantAmbience = true)
  ambienceBed = bed
  if (!ready() || ambience) return
  if (buffers[bed]) {
    const src = ctx.createBufferSource()
    src.buffer = buffers[bed]
    src.loop = true
    const g = ctx.createGain()
    g.gain.value = 0
    g.gain.setTargetAtTime(ambienceLevel, ctx.currentTime, 1)
    src.connect(g).connect(master)
    src.start(0, Math.random() * buffers[bed].duration)
    ambience = { src, g }
    return
  }
  const src = ctx.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = 700
  f.Q.value = 0.5
  const g = ctx.createGain()
  g.gain.value = 0
  g.gain.setTargetAtTime(0.025, ctx.currentTime, 1)
  src.connect(f).connect(g).connect(master)
  src.start()
  ambience = { src, g, synth: true }
}

/** Crowd volume: louder when the game is tight and late (0.32 is the normal murmur). */
export function setAmbienceLevel(level) {
  ambienceLevel = level
  if (ambience && !ambience.synth && ctx) ambience.g.gain.setTargetAtTime(level, ctx.currentTime, 0.8)
}

/** Swap the synth murmur for the recorded crowd once it has loaded. */
function restartAmbience() {
  stopAmbience()
  startAmbience()
}

export function stopAmbience() {
  wantAmbience = false
  if (!ambience) return
  const { src, g } = ambience
  g.gain.setTargetAtTime(0, ctx.currentTime, 0.3)
  setTimeout(() => src.stop(), 1500)
  ambience = null
}

/** Route sim events to sounds. */
export function playEvent(e) {
  switch (e.type) {
    case 'snap':
      return sfx.snap()
    case 'throw':
      return sfx.throw()
    case 'catch':
    case 'handoff':
      haptic(HAPTIC.tap)
      return sfx.catch()
    case 'firstDown':
      return sfx.cheer(1)
    case 'tackle':
      haptic(HAPTIC.hit)
      sfx.hit()
      return setTimeout(() => sfx.whistle(), 250)
    case 'brokenTackle':
      haptic(HAPTIC.hit)
      sfx.hit()
      return sfx.cheer(0.6)
    case 'sack':
      haptic(HAPTIC.big)
      sfx.hit(true)
      sfx.groan()
      return setTimeout(() => sfx.whistle(), 300)
    case 'interception':
      haptic(HAPTIC.miss)
      sfx.groan()
      return setTimeout(() => sfx.whistle(), 400)
    case 'incomplete':
      sfx.groan()
      return setTimeout(() => sfx.whistle(0.28), 200)
    case 'out':
      return sfx.whistle()
    case 'pump':
      return sfx.click()
    case 'move':
      haptic(HAPTIC.tap)
      return sfx.cheer(0.4)
    case 'slide':
      return setTimeout(() => sfx.whistle(), 200)
    case 'spike':
      sfx.hit()
      return setTimeout(() => sfx.whistle(0.3), 250)
    case 'touchdown':
      haptic(HAPTIC.score)
      sfx.whistle(0.5)
      return sfx.cheer(2)
    default:
  }
}
