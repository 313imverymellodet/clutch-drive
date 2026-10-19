/*
 * Half-court sets. Units are feet: x = sideline to sideline (-25..25), z = distance from the baseline the
 * offense attacks (hoop at z = 5.25, three-point arc 23.75 ft from it, 22 ft in the corners, half court z = 47).
 *
 * paths:   per player, [t, x, z] waypoints (seconds after the ball is inbounded). The first one is where he starts.
 * screens: who sets a screen for whom, and when it's live. Coverages react to these (switch, drop, hedge...).
 * reads:   the progression the ball handler works, with when each option should come open. 'self' = shoot/drive.
 * entry:   an automatic opening pass (post entry, floppy catch) unless the player takes over first.
 */
export const HOOP = { x: 0, z: 5.25 }
export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

// spots
const TOP = [0, 29]
const LW = [-17, 21]
const RW = [17, 21]
const LC = [-22, 3]
const RC = [22, 3]
const LE = [-8, 19]
const RE = [8, 19]

const at = (t, [x, z]) => [t, x, z]

export const SETS = {
  pnr: {
    label: 'High Pick & Roll',
    family: 'pnr',
    desc: 'Big screens at the top, handler turns the corner, big rolls hard to the rim.',
    handler: 'PG',
    paths: {
      PG: [at(0, TOP), at(1.0, [0, 29.5]), at(1.8, [-6, 21]), at(2.7, [-5, 13])],
      SG: [at(0, LC)],
      SF: [at(0, RC)],
      PF: [at(0, RW), at(1.6, [18, 23])],
      C: [at(0, [-4, 22]), at(0.8, [-2, 28.2]), at(1.5, [-2, 28.2]), at(2.4, [0, 11]), at(2.9, [1, 7.5])],
    },
    screens: [{ by: 'C', for: 'PG', from: 0.8, to: 1.7 }],
    reads: [['C', 2.3], ['SG', 2.6], ['self', 2.0], ['SF', 2.9]],
  },
  horns: {
    label: 'Horns Pop',
    family: 'pnr',
    desc: 'Both bigs at the elbows. One screens and rolls, the other pops out for three.',
    handler: 'PG',
    paths: {
      PG: [at(0, TOP), at(0.9, [0, 28]), at(1.8, [7, 20]), at(2.6, [6, 12])],
      SG: [at(0, LC)],
      SF: [at(0, RC)],
      PF: [at(0, LE), at(1.2, [-4, 25.5]), at(2.0, [-6, 26])],
      C: [at(0, RE), at(0.7, [2.5, 26.5]), at(1.4, [2.5, 26.5]), at(2.3, [1, 10]), at(2.8, [0, 7])],
    },
    screens: [{ by: 'C', for: 'PG', from: 0.7, to: 1.6 }],
    reads: [['PF', 2.1], ['C', 2.5], ['self', 2.2], ['SG', 2.9]],
  },
  floppy: {
    label: 'Floppy',
    family: 'motion',
    desc: 'Shooter starts under the rim and runs off stacked screens for a catch-and-shoot three.',
    handler: 'PG',
    paths: {
      PG: [at(0, TOP), at(1.2, [2, 28])],
      SG: [at(0, [0, 6]), at(0.5, [3, 8]), at(1.5, [17, 20]), at(1.8, [17.5, 21])],
      SF: [at(0, LW)],
      PF: [at(0, [8, 10]), at(2.0, [-5, 8])],
      C: [at(0, [8, 6]), at(1.8, [5, 7])],
    },
    screens: [{ by: 'PF', for: 'SG', from: 0.6, to: 1.4 }, { by: 'C', for: 'SG', from: 0.5, to: 1.2 }],
    reads: [['SG', 1.7], ['C', 2.2], ['SF', 2.5], ['self', 2.8]],
    entry: { to: 'SG', at: 1.65, ifOpen: 4 },
  },
  iso: {
    label: 'Iso',
    family: 'iso',
    desc: 'Clear out one side for your best scorer. Help comes, kick it out.',
    handler: 'SF',
    paths: {
      SF: [at(0, RW), at(0.9, [17, 22]), at(1.8, [12, 13]), at(2.6, [6, 7])],
      PG: [at(0, LW)],
      SG: [at(0, LC)],
      PF: [at(0, [-8, 27])],
      C: [at(0, [-7, 7]), at(2.2, [-8, 5])],
    },
    screens: [],
    reads: [['self', 1.5], ['C', 2.4], ['SG', 2.6], ['PG', 2.8]],
  },
  spain: {
    label: 'Spain Pick & Roll',
    family: 'pnr',
    desc: 'Pick and roll plus a back screen on the roller’s defender. The screener pops for three.',
    handler: 'PG',
    paths: {
      PG: [at(0, TOP), at(1.0, [0, 29.5]), at(1.8, [-6, 21]), at(2.7, [-5, 13])],
      SG: [at(0, LW), at(1.1, [-4, 26]), at(1.6, [-2, 24.5]), at(2.4, [1, 30])],
      SF: [at(0, RC)],
      PF: [at(0, LC)],
      C: [at(0, [-4, 22]), at(0.8, [-2, 28.2]), at(1.5, [-2, 28.2]), at(2.4, [0, 11]), at(2.9, [1, 7.5])],
    },
    screens: [{ by: 'C', for: 'PG', from: 0.8, to: 1.7 }, { by: 'SG', for: 'C', from: 1.5, to: 2.2 }],
    reads: [['C', 2.3], ['SG', 2.5], ['self', 2.0], ['SF', 2.9]],
  },
  post: {
    label: 'Post Up',
    family: 'post',
    desc: 'Feed the big on the block. He backs down, kicks out to cutters, or goes up strong.',
    handler: 'PG',
    paths: {
      PG: [at(0, TOP), at(1.0, [6, 26]), at(2.2, [-4, 26])],
      SG: [at(0, RC), at(2.0, [12, 7]), at(2.6, [20, 4])],
      SF: [at(0, LW)],
      PF: [at(0, LC)],
      C: [at(0, [5, 14]), at(0.8, [7, 8]), at(2.4, [4, 6.5])],
    },
    screens: [],
    reads: [['C', 1.1], ['self', 2.4], ['SG', 2.6], ['SF', 2.9]],
    entry: { to: 'C', at: 1.1, ifOpen: 1 },
  },
  hammer: {
    label: 'Hammer',
    family: 'motion',
    desc: 'Baseline drive draws help while a screen frees the corner shooter on the other side.',
    handler: 'PG',
    paths: {
      PG: [at(0, RW), at(0.8, [18, 20]), at(1.6, [15, 9]), at(2.4, [9, 4])],
      SG: [at(0, LC), at(1.5, [-20, 10]), at(2.1, [-20, 16])],
      SF: [at(0, TOP)],
      PF: [at(0, [-12, 6]), at(1.4, [-16, 9])],
      C: [at(0, [6, 15]), at(1.8, [4, 7])],
    },
    screens: [{ by: 'PF', for: 'SG', from: 1.3, to: 2.0 }],
    reads: [['self', 1.8], ['SG', 2.2], ['C', 2.5], ['SF', 2.8]],
  },
}
export const SET_IDS = Object.keys(SETS)

export const FAMILY_LABEL = { pnr: 'Pick & roll', motion: 'Off-ball', iso: 'Iso', post: 'Post' }

/** Defensive coverages. `shown` before the play can differ from what they really play (a disguise). */
export const COVERAGES = {
  man: { name: 'Man', short: 'Man', blurb: 'Everyone checks his own man. Chase over screens.' },
  switch: { name: 'Switch everything', short: 'Switch', blurb: 'Swap on every screen. No open roller, but mismatches.' },
  drop: { name: 'Drop', short: 'Drop', blurb: 'Big sags into the paint. Takes away the rim, gives up pull-ups.' },
  hedge: { name: 'Hedge & recover', short: 'Hedge', blurb: 'Big jumps out at the ball handler, then races back.' },
  zone: { name: '2-3 Zone', short: 'Zone', blurb: 'Pack the paint. Shooters get looks from the corners and top.' },
}
export const COVERAGE_IDS = Object.keys(COVERAGES)

// What each set does best against (used by the AI and the "beats" tags), from scripts/hoops-outcomes.mjs.
export const BEATS = {
  pnr: ['man', 'hedge'],
  horns: ['zone', 'man'],
  floppy: ['man', 'drop'],
  iso: ['zone', 'drop'],
  spain: ['zone', 'hedge'],
  post: ['hedge', 'drop'],
  hammer: ['hedge', 'drop'],
}

/** Generic player ratings by position (0..1-ish; shooting = make rates before contest/timing). */
export const RATINGS = {
  PG: { three: 0.37, mid: 0.43, finish: 0.58, handle: 0.92, speed: 17.5, size: 0.3 },
  SG: { three: 0.39, mid: 0.43, finish: 0.58, handle: 0.78, speed: 17.5, size: 0.4 },
  SF: { three: 0.38, mid: 0.47, finish: 0.66, handle: 0.85, speed: 17.2, size: 0.6 },
  PF: { three: 0.34, mid: 0.4, finish: 0.64, handle: 0.55, speed: 16, size: 0.8 },
  C: { three: 0.24, mid: 0.36, finish: 0.69, handle: 0.4, speed: 15, size: 1 },
}
export const NUMBERS = { PG: 3, SG: 11, SF: 23, PF: 34, C: 12 }
