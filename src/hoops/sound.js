import { loopClip, playClip, sfx } from '../game/sound'
import { HAPTIC, haptic } from '../game/haptics'

/*
 * Basketball sounds (Viewmax clips, public/sounds/hoops-*.m4a) with synth fallbacks. The crowd belongs to the
 * home team: it roars for home buckets and stops, groans for theirs, and chants DE-FENSE when home is defending.
 */
export const hsfx = {
  dribble(loud = true) {
    playClip('hoops-dribble', loud ? 0.55 : 0.3, { rate: 0.92 + Math.random() * 0.16 })
  },
  squeak() {
    playClip('hoops-squeak', 0.32, { rate: 0.9 + Math.random() * 0.3 })
  },
  swish() {
    if (!playClip('hoops-swish', 0.9)) sfx.catch()
  },
  clank() {
    if (!playClip('hoops-clank', 0.8, { rate: 0.95 + Math.random() * 0.1 })) sfx.hit()
  },
  horn() {
    if (!playClip('hoops-horn', 0.75)) sfx.whistle(0.8)
  },
  whistle() {
    if (!playClip('hoops-whistle', 0.7)) sfx.whistle(0.35)
  },
  roar(level = 1) {
    if (!playClip('hoops-roar', 0.4 + 0.6 * level, { rate: level < 0.7 ? 1.08 : 1 })) sfx.cheer(level * 2)
  },
  ooh(level = 0.8) {
    if (!playClip('hoops-ooh', level)) sfx.groan()
  },
  catch() {
    playClip('hoops-dribble', 0.35, { rate: 1.45 })
  },
  theme() {
    playClip('hoops-theme', 0.5, { wait: true })
  },
}

let chant = null
/** The home crowd's DE-FENSE chant (loops until stopped). */
export function setChant(on) {
  if (on && !chant) chant = loopClip('hoops-chant', 0.42)
  else if (!on && chant) {
    chant.stop()
    chant = null
  }
}

/** Map a sim event to sounds. youOffense: whose ball; youHome: whose crowd. */
export function hoopsSound(e, { youOffense, youHome }) {
  const homeOffense = youOffense === youHome
  switch (e.type) {
    case 'dribble':
      return hsfx.dribble(e.loud)
    case 'squeak':
    case 'move':
    case 'switch':
      return hsfx.squeak()
    case 'catch':
      return hsfx.catch()
    case 'start':
      return null
    case 'pass':
      return sfx.click()
    case 'release':
      if (e.grade === 'perfect') haptic(HAPTIC.tap)
      return e.grade === 'perfect' ? sfx.click() : null
    case 'make':
    case 'three':
      haptic(e.type === 'three' ? HAPTIC.score : HAPTIC.hit)
      hsfx.swish()
      return setTimeout(() => (homeOffense ? hsfx.roar(e.type === 'three' ? 1 : 0.6) : hsfx.ooh(0.6)), 120)
    case 'rim':
      hsfx.clank()
      return setTimeout(() => (homeOffense ? hsfx.ooh(0.9) : hsfx.roar(0.45)), 150)
    case 'steal':
      haptic(HAPTIC.big)
      return homeOffense ? hsfx.ooh(0.8) : hsfx.roar(0.8)
    case 'buzzer':
      haptic(HAPTIC.big)
      return hsfx.horn()
    case 'whistle':
      return hsfx.whistle()
    case 'contest':
    case 'double':
      return hsfx.squeak()
    default:
  }
}
