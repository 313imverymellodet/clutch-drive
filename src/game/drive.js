import { NFL_TEAMS } from '../data/nflTeams'
import { BRAND, LAUNCH_DATE } from '../brand'
import { PLAYS, chooseDefense } from '../sim/playSim'

/*
 * The drive: game clock, downs, field position, score, win/lose.
 * Field position `ballOn` is yards from your own goal line (0–100). The sim's z = ballOn - 50.
 */

export const QUARTER_LABEL = '4TH'
export const HUDDLE_RUNOFF = 8 // seconds it takes to get lined up when the clock is running

// ------------------------------------------------------------------ seeded randomness
export function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function rngFrom(str) {
  let a = hashString(str)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function dayNumber(key = todayKey()) {
  const ms = new Date(`${key}T12:00:00`) - new Date(`${LAUNCH_DATE}T12:00:00`)
  return Math.max(1, Math.round(ms / 86400000) + 1)
}

// ------------------------------------------------------------------ scenarios
/**
 * A late-game spot: you're down 4–6, so only a touchdown wins.
 * difficulty 0 = gentle; survivor mode ramps it up each win.
 */
export function makeScenario(seedKey, { difficulty = 0, offense, defense } = {}) {
  const rnd = rngFrom(seedKey)
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  const off = offense ?? pick(NFL_TEAMS).abbr
  let def = defense ?? pick(NFL_TEAMS).abbr
  while (def === off) def = pick(NFL_TEAMS).abbr
  const deficit = 4 + Math.floor(rnd() * 3)
  const scoreDef = 17 + Math.floor(rnd() * 14)
  return {
    id: seedKey,
    offense: off,
    defense: def,
    scoreOff: scoreDef - deficit,
    scoreDef,
    clock: Math.round(Math.max(48, 118 - difficulty * 9 - rnd() * 30)),
    ballOn: Math.round(Math.max(12, 20 + rnd() * 16 - difficulty * 2)),
    timeouts: Math.max(0, Math.min(3, 1 + Math.floor(rnd() * 3) - (difficulty >= 3 ? 1 : 0))),
  }
}

export function newDrive(sc) {
  return {
    ...sc,
    down: 1,
    toGo: Math.min(10, 100 - sc.ballOn),
    clockRunning: false,
    plays: [], // { playId, kind, gain, first, emoji, text }
    status: 'playing', // playing | won | lost
    reason: null,
  }
}

export const ordinal = (n) => ['1st', '2nd', '3rd', '4th'][n - 1] ?? `${n}th`

export function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function fmtBallOn(ballOn) {
  if (ballOn === 50) return 'the 50'
  return ballOn < 50 ? `own ${ballOn}` : `opp ${100 - ballOn}`
}

export function downAndDistance(d) {
  const goal = d.ballOn + d.toGo >= 100
  return `${ordinal(d.down)} & ${goal ? 'Goal' : d.toGo}`
}

/** Clock management before the snap: burn the huddle, or call timeout to stop it. */
export function callTimeout(d) {
  if (!d.clockRunning || d.timeouts <= 0) return d
  return { ...d, timeouts: d.timeouts - 1, clockRunning: false, plays: [...d.plays, { playId: 'timeout', emoji: '⏱️', text: 'Timeout' }] }
}

export function tickClock(d, seconds) {
  if (!d.clockRunning || d.status !== 'playing') return d
  const clock = Math.max(0, d.clock - seconds)
  if (clock > 0) return { ...d, clock }
  return { ...d, clock: 0, status: 'lost', reason: 'The clock ran out before you could snap it.' }
}

function emojiFor(result) {
  if (result.kind === 'touchdown') return '🏈'
  if (result.kind === 'interception') return '❌'
  if (result.kind === 'incomplete' || result.gain <= 0) return '🟥'
  if (result.first) return '🟩'
  return '🟨'
}

/** Apply a finished play to the drive. elapsed = seconds from snap to whistle. */
export function applyResult(d, playId, result) {
  const elapsed = Math.max(2, (result.elapsed ?? 4) - 0.35)
  const clock = Math.max(0, d.clock - elapsed)
  const gain = result.kind === 'incomplete' ? 0 : result.gain
  const ballOn = Math.min(100, Math.max(0, d.ballOn + gain))
  const entry = { playId, kind: result.kind, gain, first: result.first, emoji: emojiFor(result) }
  const next = { ...d, clock, plays: [...d.plays, entry] }

  if (result.kind === 'interception') {
    next.status = 'lost'
    next.reason = `Intercepted by #${result.by ?? '?'}.`
    next.clockRunning = false
    return next
  }

  if (result.kind === 'touchdown' || ballOn >= 100) {
    next.ballOn = 100
    next.scoreOff = d.scoreOff + 7 // assume the extra point
    next.status = next.scoreOff > d.scoreDef ? 'won' : 'lost'
    next.reason = next.status === 'won' ? 'Touchdown! Game over, you win.' : 'Touchdown, but not enough.'
    next.clockRunning = false
    return next
  }
  if (ballOn <= 0) {
    next.status = 'lost'
    next.reason = 'Safety. Tackled in your own end zone.'
    return next
  }

  next.ballOn = ballOn
  const line = d.ballOn + d.toGo
  if (ballOn >= line) {
    next.down = 1
    next.toGo = Math.min(10, 100 - ballOn)
  } else {
    next.down = d.down + 1
    next.toGo = line - ballOn
  }
  // incompletions and plays out of bounds stop the clock; tackles in bounds keep it running
  next.clockRunning = result.kind === 'tackle' || result.kind === 'sack'

  if (next.down > 4) {
    next.down = 4 // the scoreboard never shows a 5th down
    next.status = 'lost'
    next.reason = 'Turnover on downs.'
  } else if (clock <= 0) {
    next.status = 'lost'
    next.reason = 'Time expired.'
  }
  return next
}

// ------------------------------------------------------------------ sharing
export function shareText(d, { mode, day, streak, url }) {
  const won = d.status === 'won'
  const title = mode === 'daily' ? `${BRAND.name} #${day}` : mode === 'survivor' ? `${BRAND.name} Survivor` : BRAND.name
  const line =
    `${d.offense} ${d.scoreOff}–${d.scoreDef} ${d.defense} ` +
    (won ? `✅ with ${fmtClock(d.clock)} left` : `❌ ${d.reason?.replace(/\.$/, '') ?? 'lost'}`)
  const grid = d.plays.map((p) => p.emoji).join('')
  const extra = mode === 'survivor' && streak ? `\nSurvivor streak: ${streak} 🔥` : ''
  return `${title} 🏈\n${line}\n${grid}${extra}\n${url}`
}

// ------------------------------------------------------------------ defense + coach
/**
 * Scouting report on the offense this drive: recency-weighted share of each call, and the play the defense
 * is keying on once you've leaned on it (2 of the last 3 calls, or the same call 3 times running).
 * Plays that burned the defense get extra attention.
 */
export function tendencies(d) {
  const calls = d.plays.filter((p) => PLAYS[p.playId])
  const share = { out: 0, dig: 0, deep: 0, run: 0 }
  let w = 1
  let total = 0
  for (let i = calls.length - 1; i >= 0 && i >= calls.length - 6; i--) {
    const bonus = calls[i].first || calls[i].kind === 'touchdown' ? 1.4 : 1
    share[calls[i].playId] += w * bonus
    total += w * bonus
    w *= 0.7
  }
  if (total) for (const k in share) share[k] /= total
  const last3 = calls.slice(-3).map((p) => p.playId)
  let key = null
  // leaning on one play all drive also gets noticed
  for (const play of Object.keys(share)) {
    const n = calls.filter((p) => p.playId === play).length
    if (n >= 4 && n / calls.length >= 0.5) key = { play, s: 0.8 }
  }
  for (const play of Object.keys(share)) {
    const n = last3.filter((x) => x === play).length
    const streak = last3.length >= 2 && last3.at(-1) === play && last3.at(-2) === play
    if (n === 3) key = { play, s: 1 }
    else if (streak) key = { play, s: 0.8 }
    else if (n === 2) key = key ?? { play, s: 0.55 }
  }
  return { share, key, count: calls.length }
}

/** The defense's call for the next snap. Seeded per drive and play number, so the daily is the same for everyone. */
export function defenseFor(d, difficulty = 0) {
  const n = d.plays.filter((p) => p.playId !== 'timeout').length
  return chooseDefense({ down: d.down, toGo: d.toGo, clock: d.clock, ballOn: d.ballOn }, rngFrom(`${d.id}|def|${n}`), difficulty, tendencies(d))
}

const COACH = {
  blitz: 'Blitz look, nobody deep! Take a Deep Shot or hit the Dig. Don\'t run into it.',
  cover1: 'Man coverage. The Dig beats man, and the Deep Shot has a real chance.',
  cover2: 'Two safeties deep. Attack the middle with the Dig, or take the Quick Out.',
  cover3: 'Three-deep zone. The Dig and Quick Out are there; the deep ball is risky.',
  prevent: 'Prevent D is giving you the short stuff. Quick Out or HB Dive. Avoid the deep ball.',
}

/** One line of advice for the current situation and the look the defense is showing. */
export function coachTip(d, shown, key = null) {
  if (key && key.s >= 0.55) {
    const name = PLAYS[key.play].label
    return key.s >= 1
      ? `They've seen the ${name} all drive and they're sitting on it. Change it up!`
      : `Careful: they're starting to key on the ${name}. Mix it up.`
  }
  const toGoal = 100 - d.ballOn
  if (d.clockRunning && d.clock < 30 && toGoal > 15) return d.timeouts ? 'Clock is bleeding! Call a timeout or get out of bounds with the Quick Out.' : 'No timeouts left. The Quick Out stops the clock.'
  if (d.down === 4) return `4th down, all or nothing. ${COACH[shown]}`
  return COACH[shown]
}
