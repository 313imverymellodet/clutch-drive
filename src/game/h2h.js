import { applyResult, callTimeout, hashString, newDrive, rngFrom, tendencies, tickClock } from './drive'
import { PLAYS, chooseDefense } from '../sim/playSim'

/*
 * Head-to-head duel rules. Pure functions; the host's browser is the referee.
 *
 * A duel is two drives from the same late-game spot. Each player gets one drive on offense while
 * the other calls the defense. Per snap: the defense locks in a coverage (it can show a different
 * look, and guess which play is coming), then the offense reads the look and calls a play.
 * Both browsers then run the same seeded sim, so they see the identical play.
 * Best drive wins: a touchdown beats no touchdown, then more time left, then field position.
 */

export const SHOT_CLOCK_MS = 15000
export const HUDDLE_RUNOFF = 15 // seconds a running clock burns between snaps
export const RESULT_PAUSE_MS = 3600
export const HALF_PAUSE_MS = 5200
export const COVERAGE_IDS = ['cover1', 'cover2', 'cover3', 'blitz', 'prevent']

const other = (role) => (role === 'host' ? 'guest' : 'host')
export const offenseRole = (m) => m.order[m.half]
export const defenseRole = (m) => other(m.order[m.half])

export function duelScenario(seed) {
  const rnd = rngFrom(`duel-${seed}`)
  return {
    clock: Math.round(75 + rnd() * 40),
    ballOn: Math.round(20 + rnd() * 12),
    deficit: 4 + Math.floor(rnd() * 3),
    scoreDef: 17 + Math.floor(rnd() * 11),
    timeouts: rnd() < 0.5 ? 2 : 3,
  }
}

function makeDrive(m, half) {
  const offRole = m.order[half]
  const sc = m.sc
  return newDrive({
    id: `duel-${m.seed}-${half}`,
    offense: m.players[offRole].team,
    defense: m.players[other(offRole)].team,
    scoreOff: sc.scoreDef - sc.deficit,
    scoreDef: sc.scoreDef,
    clock: sc.clock,
    ballOn: sc.ballOn,
    timeouts: sc.timeouts,
  })
}

export function newMatch({ seed, players, first = 'host' }) {
  const m = {
    v: 1,
    seed,
    sc: duelScenario(seed),
    players, // { host: { team, name }, guest: { team, name } }
    order: [first, other(first)], // who's on offense in drive 1 and drive 2
    half: 0,
    drives: [null, null],
    summaries: [null, null],
    phase: 'def-call', // def-call | off-call | live | result | half | over
    defCall: null,
    snap: null,
    n: 0,
    lastResult: null,
    winner: null,
    rev: 0,
  }
  m.drives[0] = makeDrive(m, 0)
  return m
}

const drive = (m) => m.drives[m.half]

function summarize(d) {
  return { td: d.status === 'won', clock: d.clock, ballOn: d.ballOn, reason: d.reason, grid: d.plays.map((p) => p.emoji).join(''), offense: d.offense }
}

/** Compare the two drives. Returns 'host' | 'guest' | 'draw'. */
export function decide(m) {
  const [a, b] = m.summaries
  const ra = m.order[0]
  const rb = m.order[1]
  if (a.td !== b.td) return a.td ? ra : rb
  if (a.td && b.td) {
    if (Math.abs(a.clock - b.clock) >= 1) return a.clock > b.clock ? ra : rb
    return 'draw'
  }
  if (a.ballOn !== b.ballOn) return a.ballOn > b.ballOn ? ra : rb
  return 'draw'
}

/** What the CPU calls if a player lets the shot clock run out. */
function autoDefense(m) {
  const d = drive(m)
  return chooseDefense({ down: d.down, toGo: d.toGo, clock: d.clock, ballOn: d.ballOn }, rngFrom(`${m.seed}|auto|${m.half}|${m.n}`), 1, tendencies(d))
}
function autoOffense(m) {
  const best = { blitz: 'deep', cover1: 'dig', cover2: 'dig', cover3: 'out', prevent: 'run' }
  const pick = best[m.defCall?.shown ?? 'cover3']
  const key = tendencies(drive(m)).key
  return key?.play === pick ? 'out' : pick
}

function endDriveIfOver(m) {
  const d = drive(m)
  if (d.status === 'playing') return
  m.summaries[m.half] = summarize(d)
  if (m.half === 0) m.phase = 'half'
  else {
    m.phase = 'over'
    m.winner = decide(m)
  }
}

/**
 * Apply an action from a player ('host' | 'guest') or the referee ('ref').
 * Returns a new match, or the same object if the action isn't allowed right now.
 */
export function reduce(match, action, actor) {
  const m = structuredClone(match)
  const offR = offenseRole(m)
  const defR = defenseRole(m)
  const d = drive(m)
  switch (action.type) {
    case 'def': {
      if (m.phase !== 'def-call' || (actor !== defR && actor !== 'ref')) return match
      const call = COVERAGE_IDS.includes(action.call) ? action.call : 'cover3'
      const shown = COVERAGE_IDS.includes(action.shown) ? action.shown : call
      const key = PLAYS[action.key] ? { play: action.key, s: 0.8, guess: true } : action.autoKey ?? null
      m.defCall = { call, shown, key }
      m.phase = 'off-call'
      break
    }
    case 'timeout': {
      if (m.phase !== 'off-call' || actor !== offR || !d.clockRunning || !d.timeouts) return match
      m.drives[m.half] = callTimeout(d)
      break
    }
    case 'off': {
      if (m.phase !== 'off-call' || (actor !== offR && actor !== 'ref') || !PLAYS[action.play]) return match
      let nd = d
      if (nd.clockRunning) {
        nd = tickClock(nd, HUDDLE_RUNOFF)
        if (nd.status !== 'playing') {
          m.drives[m.half] = nd
          endDriveIfOver(m)
          break
        }
      }
      nd = { ...nd, clockRunning: false }
      m.drives[m.half] = nd
      m.snap = {
        id: `${m.seed}-${m.half}-${m.n}`,
        play: action.play,
        coverage: m.defCall,
        seed: hashString(`${m.seed}|${m.half}|${m.n}|${action.play}`),
        los: nd.ballOn - 50,
        toGo: nd.toGo,
        clock: nd.clock,
      }
      m.n += 1
      m.phase = 'live'
      break
    }
    case 'result': {
      if (m.phase !== 'live' || actor !== 'ref' || action.snapId !== m.snap?.id) return match
      m.drives[m.half] = applyResult(d, m.snap.play, action.result)
      m.lastResult = { result: action.result, message: action.message, snapId: m.snap.id, coverage: m.snap.coverage }
      m.phase = 'result'
      break
    }
    case 'next': {
      if (m.phase !== 'result' || actor !== 'ref') return match
      m.defCall = null
      if (drive(m).status === 'playing') m.phase = 'def-call'
      else endDriveIfOver(m)
      break
    }
    case 'startHalf2': {
      if (m.phase !== 'half' || actor !== 'ref') return match
      m.half = 1
      m.n = 0
      m.drives[1] = makeDrive(m, 1)
      m.defCall = null
      m.snap = null
      m.lastResult = null
      m.phase = 'def-call'
      break
    }
    case 'expire': {
      if (actor !== 'ref') return match
      if (m.phase === 'def-call') {
        const auto = autoDefense(m)
        return reduce(match, { type: 'def', call: auto.call, shown: auto.shown, autoKey: auto.key }, 'ref')
      }
      if (m.phase === 'off-call') return reduce(match, { type: 'off', play: autoOffense(m) }, 'ref')
      return match
    }
    default:
      return match
  }
  m.rev += 1
  return m
}

/** What a given player is allowed to see: the offense never sees the real call or the defense's guess pre-snap. */
export function viewFor(m, role) {
  if (!m || role === defenseRole(m) || !m.defCall || m.phase === 'live' || m.phase === 'result') return m
  return { ...m, defCall: { shown: m.defCall.shown, call: null, key: null } }
}

export const isMyTurn = (m, role) =>
  (m.phase === 'def-call' && defenseRole(m) === role) || (m.phase === 'off-call' && offenseRole(m) === role)
