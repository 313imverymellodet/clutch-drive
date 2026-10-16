import { NFL_TEAMS } from '../data/nflTeams'
import { BRAND, LAUNCH_DATE } from '../brand'
import { PLAYS, chooseDefense } from '../sim/playSim'
import { FAMILIES } from '../sim/playbook'
import { bestPlaysVs } from '../sim/aiOffense'
import { winProb } from './winprob'

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
  const d = {
    ...sc,
    down: 1,
    toGo: Math.min(10, 100 - sc.ballOn),
    clockRunning: false,
    plays: [], // { playId, kind, gain, first, emoji, text }
    status: 'playing', // playing | won | lost
    reason: null,
  }
  d.wp0 = winProb(d)
  return d
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
  const next = { ...d, timeouts: d.timeouts - 1, clockRunning: false }
  next.plays = [...d.plays, { playId: 'timeout', emoji: '⏱️', text: 'Timeout', wp: winProb(next) }]
  return next
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
  const next = applyResultRaw(d, playId, result)
  next.plays[next.plays.length - 1].wp = winProb(next)
  return next
}

function applyResultRaw(d, playId, result) {
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

  const line = d.ballOn + d.toGo
  // the sim's exact spot decides the first down; rounding the gain must not move the chains
  next.ballOn = result.first === false && ballOn >= line && line < 100 ? line - 1 : ballOn
  if (next.ballOn >= line) {
    next.down = 1
    next.toGo = Math.min(10, 100 - next.ballOn)
  } else {
    next.down = d.down + 1
    next.toGo = line - next.ballOn
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
  const lo = Math.min(d.wp0 ?? 1, ...d.plays.map((p) => p.wp ?? 1))
  const wpLine = `📈 Win prob ${Math.round((d.wp0 ?? 0) * 100)}%${lo < (d.wp0 ?? 0) - 0.05 ? ` (low ${Math.round(lo * 100)}%)` : ''} → ${won ? 100 : 0}%`
  let history = ''
  if (d.moment) {
    const realWon = d.moment.won === 1
    history = `\n📅 Real ${d.moment.season}: ${realWon ? 'they won' : 'they lost'} · ${won && !realWon ? 'I beat history 🔥' : won ? 'matched history' : realWon ? 'history wins this one' : 'same as history'}`
  }
  const extra = mode === 'survivor' && streak ? `\nSurvivor streak: ${streak} 🔥` : ''
  return `${title} 🏈\n${line}\n${grid}\n${wpLine}${history}${extra}\n${url}`
}

// ------------------------------------------------------------------ defense + coach
/**
 * Scouting report on the offense this drive, by concept family (quick / mid / deep / run):
 * recency-weighted share of calls (plays that burned the defense count extra), the family the defense
 * is keying on once you lean on it, and `exploit`: how often you've been winning lately. An offense that
 * keeps beating the looks it sees gets disguised against more.
 */
export function tendencies(d) {
  const calls = d.plays.filter((p) => PLAYS[p.playId])
  const share = { quick: 0, mid: 0, deep: 0, run: 0 }
  let w = 1
  let total = 0
  for (let i = calls.length - 1; i >= 0 && i >= calls.length - 6; i--) {
    const bonus = calls[i].first || calls[i].kind === 'touchdown' ? 1.4 : 1
    share[PLAYS[calls[i].playId].family] += w * bonus
    total += w * bonus
    w *= 0.7
  }
  if (total) for (const k in share) share[k] /= total
  const fam = (p) => PLAYS[p.playId].family
  const last3 = calls.slice(-3)
  let key = null
  for (const f of Object.keys(share)) {
    const n = last3.filter((p) => fam(p) === f).length
    const streak = last3.length >= 2 && fam(last3.at(-1)) === f && fam(last3.at(-2)) === f
    // the exact same play twice in a row is even easier to sit on
    const samePlay = streak && last3.at(-1).playId === last3.at(-2).playId
    if (n === 3) key = { family: f, s: 1, play: last3.at(-1).playId }
    else if (streak) key = { family: f, s: samePlay ? 0.9 : 0.7, play: last3.at(-1).playId }
    else if (n === 2) key = key ?? { family: f, s: 0.5, play: last3.at(-1).playId }
  }
  for (const f of Object.keys(share)) {
    const n = calls.filter((p) => fam(p) === f).length
    if (!key && n >= 4 && n / calls.length >= 0.6) key = { family: f, s: 0.7, play: calls.at(-1).playId }
  }
  const recent = calls.slice(-4)
  const wins = recent.filter((p) => p.first || p.kind === 'touchdown' || p.gain >= 8).length
  const exploit = recent.length >= 2 ? wins / recent.length : 0
  return { share, key, exploit, count: calls.length }
}

/** The defense's call for the next snap. Seeded per drive and play number, so the daily is the same for everyone. */
export function defenseFor(d, difficulty = 0) {
  const n = d.plays.filter((p) => p.playId !== 'timeout').length
  return chooseDefense({ down: d.down, toGo: d.toGo, clock: d.clock, ballOn: d.ballOn }, rngFrom(`${d.id}|def|${n}`), difficulty, tendencies(d))
}

/** One line of advice for the current situation and the look the defense is showing (from the play x coverage data). */
export function coachTip(d, shown, key = null) {
  if (key && key.s >= 0.5) {
    const fam = FAMILIES[key.family]?.label.toLowerCase() ?? 'that'
    return key.s >= 1
      ? `They've seen ${fam} plays all drive and they're sitting on them. Change it up!`
      : `Careful: they're starting to key on your ${fam} game. Mix it up.`
  }
  const toGoal = 100 - d.ballOn
  if (d.clockRunning && d.clock < 30 && toGoal > 15) return d.timeouts ? 'Clock is bleeding! Call a timeout or get out of bounds (Quick Out, Curl-Flat, Flood).' : 'No timeouts left. Throw to the sideline to stop the clock.'
  const short = toGoal <= 12
  const best = bestPlaysVs(shown, 3, (id) => !(short && PLAYS[id].family === 'deep') && !(d.toGo >= 8 && d.down >= 3 && PLAYS[id].family === 'run'))
  const names = best.map((id) => PLAYS[id].label).join(', ')
  const pre = d.down === 4 ? '4th down, all or nothing. ' : ''
  const ex = tendencies(d).exploit >= 0.5 ? " You're carving them up, so expect disguises." : ''
  return `${pre}Best vs. this look: ${names}.${ex}`
}

/** Coach for when you're on defense: what this offense likes, and what the situation calls for. */
export function defenseTip(d) {
  const t = tendencies(d)
  const fams = Object.entries(t.share).filter(([, v]) => v > 0.3).sort((a, b) => b[1] - a[1])
  const toGoal = 100 - d.ballOn
  const parts = []
  if (fams.length) parts.push(`They lean ${FAMILIES[fams[0][0]].label.toLowerCase()} (${Math.round(fams[0][1] * 100)}% lately).`)
  if (d.clock < 35 && toGoal > 30) parts.push('Clock is your friend: keep everything in front (Prevent, Cover 4).')
  else if (d.down >= 3 && d.toGo >= 7) parts.push("Long yardage: they'll throw. Pressure (Fire Zone) or two-deep zones.")
  else if (d.toGo <= 2) parts.push('Short yardage: load the box (Cover 1, Blitz) and guess run.')
  else if (toGoal <= 12) parts.push('Red zone: tight man coverage, no prevent.')
  if (!parts.length) parts.push('Disguise your look: offenses read the shell before the snap.')
  return parts.join(' ')
}
