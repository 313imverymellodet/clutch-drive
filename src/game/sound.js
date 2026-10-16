import { load, save } from './storage'

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

export const isMuted = () => muted
export function setMuted(m) {
  muted = m
  save('cd.muted', m)
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05)
  listeners.forEach((fn) => fn(m))
}
export function onMuteChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Call from a click/tap handler. Safe to call repeatedly. */
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = muted ? 0 : 0.9
      master.connect(ctx.destination)
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
const CLIPS = ['crowd', 'roar', 'groan', 'cheer', 'hit', 'cadence', 'theme']
const buffers = {}
function loadClips() {
  for (const name of CLIPS) {
    fetch(`/sounds/${name}.m4a`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => {
        buffers[name] = buf
        if (name === 'crowd' && ambience?.synth) restartAmbience()
      })
      .catch(() => {})
  }
}
function clip(name, gain = 1, { rate = 1 } = {}) {
  if (!ready() || !buffers[name]) return false
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
    if (clip('hit', big ? 0.9 : 0.6, { rate: big ? 0.9 : 1 + Math.random() * 0.1 })) return
    tone(big ? 95 : 120, 0.18, { gain: big ? 0.35 : 0.22, to: 45 })
    noise(0.14, { type: 'lowpass', freq: 380, gain: big ? 0.4 : 0.25 })
  },
  cheer(level = 1) {
    if (!ready()) return
    if (level >= 2 ? clip('roar', 0.8) : clip('cheer', 0.35 + level * 0.25)) return
    noise(1.6 + level, { freq: 900, q: 0.6, gain: 0.05 + level * 0.06, attack: 0.25, release: 1.4 + level })
    noise(1.4 + level, { type: 'highpass', freq: 2500, gain: 0.015 + level * 0.02, attack: 0.3, release: 1.2 + level })
  },
  groan() {
    if (!ready()) return
    if (clip('groan', 0.6)) return
    noise(1.4, { type: 'lowpass', freq: 1300, sweepTo: 350, gain: 0.12, attack: 0.15, release: 1.3 })
  },
  tick() {
    if (!ready()) return
    tone(1500, 0.03, { type: 'square', gain: 0.03 })
  },
  /** "Blue 42, set, HUT!" when you take the field. */
  cadence() {
    clip('cadence', 0.7)
  },
  /** Victory music on a win. */
  theme() {
    clip('theme', 0.35)
  },
  click() {
    if (!ready()) return
    tone(900, 0.04, { type: 'triangle', gain: 0.05 })
  },
}

/** Low stadium murmur while a game is on screen. */
export function startAmbience() {
  if (!ready() || ambience) return
  if (buffers.crowd) {
    const src = ctx.createBufferSource()
    src.buffer = buffers.crowd
    src.loop = true
    const g = ctx.createGain()
    g.gain.value = 0
    g.gain.setTargetAtTime(0.18, ctx.currentTime, 1)
    src.connect(g).connect(master)
    src.start(0, Math.random() * buffers.crowd.duration)
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

/** Swap the synth murmur for the recorded crowd once it has loaded. */
function restartAmbience() {
  stopAmbience()
  startAmbience()
}

export function stopAmbience() {
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
      return sfx.catch()
    case 'tackle':
      sfx.hit()
      return setTimeout(() => sfx.whistle(), 250)
    case 'brokenTackle':
      sfx.hit()
      return sfx.cheer(0.6)
    case 'sack':
      sfx.hit(true)
      sfx.groan()
      return setTimeout(() => sfx.whistle(), 300)
    case 'interception':
      sfx.groan()
      return setTimeout(() => sfx.whistle(), 400)
    case 'incomplete':
      sfx.groan()
      return setTimeout(() => sfx.whistle(0.28), 200)
    case 'out':
      return sfx.whistle()
    case 'touchdown':
      sfx.whistle(0.5)
      return sfx.cheer(2)
    default:
  }
}
