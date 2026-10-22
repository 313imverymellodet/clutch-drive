import { BEATS, COVERAGE_IDS, SETS, SET_IDS } from './sets'
import { NBA_TEAMS } from './teams'
import { hashString, rngFrom } from '../game/drive'
import WP from '../data/hoopsWpModel.json'

/*
 * The end of a game, possession by possession. The player has the ball first, trailing late.
 *
 * Clock rules that matter in a final two minutes:
 *  - After a make or a defensive rebound the ball has to come up the floor (INBOUND seconds) unless you call
 *    timeout, which advances it to the frontcourt (about a second).
 *  - An offensive rebound resets the shot clock to 14 and the play continues right away.
 *  - The trailing team fouls on purpose to stop the clock; free throws are 2 shots.
 *  - A shot released before the horn counts.
 */

export const INBOUND = 4.5
export const ATO_INBOUND = 0.9
export const FT_PCT = 0.78
const OFF_REB = 0.25

export function makeScenario(id, { you, them, difficulty = 0 } = {}) {
  const r = rngFrom(`hoops-${id}`)
  const pick = () => NBA_TEAMS[Math.floor(r() * NBA_TEAMS.length)].abbr
  let a = you ?? pick()
  let b = them ?? pick()
  while (b === a) b = pick()
  const deficit = 1 + Math.floor(r() * (3 + Math.min(3, difficulty)))
  const base = 96 + Math.floor(r() * 18)
  return {
    id,
    you: a,
    them: b,
    scoreYou: base,
    scoreThem: base + deficit,
    clock: Math.round(28 + r() * 50 - Math.min(20, difficulty * 4)),
    timeouts: r() < 0.5 ? 1 : 2,
    theirTimeouts: 1,
    youHome: r() < 0.5,
  }
}

export function newGame(sc) {
  const g = {
    id: sc.id,
    you: sc.you,
    them: sc.them,
    youHome: sc.youHome,
    scoreYou: sc.scoreYou,
    scoreThem: sc.scoreThem,
    clock: sc.clock,
    timeouts: sc.timeouts,
    theirTimeouts: sc.theirTimeouts,
    poss: 'you',
    shotClock: Math.min(24, sc.clock),
    inbound: 0, // seconds the next possession burns bringing the ball up (0 = already in the frontcourt)
    ato: true, // the first possession comes out of a timeout
    ot: 0,
    status: 'playing',
    reason: null,
    log: [],
    yourSets: [],
    yourCoverages: [],
    theirSets: [],
    heat: { you: {}, them: {} }, // makes in a row by position: two straight and he's heating up
  }
  g.wp0 = winProb(g)
  return g
}

/**
 * Win probability for you: a logistic model fit by scripts/build-hoops-moments.mjs on the last 6:00 of real
 * 4th quarters (sportsdataverse hoopR NBA play-by-play, ESPN data). Inputs: score margin, seconds left, who has
 * the ball, timeouts and home court. The feature list must match features() in that script.
 */
export function winProb(g, clock = g.clock) {
  const diff = g.scoreYou - g.scoreThem
  if (g.status === 'won') return 1
  if (g.status === 'lost') return 0
  if (clock <= 0) return diff > 0 ? 1 : diff < 0 ? 0 : 0.5
  const s = Math.sqrt(clock / 60 + 0.05)
  const poss = g.poss === 'you' ? 1 : -1
  const to = (g.timeouts ?? 0) - (g.theirTimeouts ?? 0)
  const d = Math.max(-15, Math.min(15, diff))
  const home = g.youHome ? 1 : -1
  const x = [d / s, d, poss / s, poss, to, to / s, (d * d * d) / (s * s * s * 100), home, d / (s * s), poss / (s * s)]
  let z = 0
  for (let i = 0; i < x.length; i++) z += WP.w[i] * x[i]
  return Math.min(0.995, Math.max(0.005, 1 / (1 + Math.exp(-z))))
}

/** A per-possession RNG that's the same for everyone on the same Daily possession. */
export const possRng = (g, salt = '') => rngFrom(`${g.id}|${g.log.length}|${g.ot}|${salt}`)
export const possSeed = (g, salt = '') => hashString(`${g.id}|${g.log.length}|${g.ot}|${salt}`)

// ------------------------------------------------------------------ AI
/** Their defense: key on the families you keep calling, sometimes disguise the look. */
export function aiCoverage(g, difficulty = 0) {
  const r = possRng(g, 'cov')
  const recent = g.yourSets.slice(-4)
  const score = (c) => {
    let s = 1 + r() * 0.6
    for (const id of recent) if (BEATS[id]?.includes(c)) s -= 0.55 // they've been burned by this
    if (g.clock < 24 && c === 'zone') s -= 0.3 // late: no zone, can't give up corner threes
    return s
  }
  const call = COVERAGE_IDS.reduce((a, c) => (score(c) > score(a) ? c : a), COVERAGE_IDS[0])
  const disguise = r() < 0.25 + difficulty * 0.05
  const shown = disguise ? (call === 'zone' ? 'man' : call === 'man' ? 'switch' : 'man') : call
  return { call, shown }
}

/** Their offense: attack the coverage you've leaned on; run clock when they lead. */
export function aiSet(g) {
  const r = possRng(g, 'set')
  const recent = g.yourCoverages.slice(-3)
  let best = null
  let bs = -Infinity
  for (const id of SET_IDS) {
    let s = r()
    for (const c of recent) if (BEATS[id].includes(c)) s += 0.6
    if (id === 'post' && g.clock < 20) s -= 0.4
    if (s > bs) (bs = s), (best = id)
  }
  return { set: best, flip: r() < 0.5, milk: g.scoreThem > g.scoreYou && g.clock < 40 }
}

/** Trailing late, the AI fouls you on purpose instead of letting the clock run. */
export function aiWillFoul(g) {
  if (g.poss !== 'you' || g.clock > 26 || g.clock < 1.5) return false
  const lead = g.scoreYou - g.scoreThem
  return lead > 0 && lead <= 6 && possRng(g, 'foul')() < 0.9
}

// ------------------------------------------------------------------ resolving possessions
export function emojiFor(team, r) {
  if (team === 'you') {
    if (['ft', 'fouled', 'foulDrawn'].includes(r.kind)) return r.points ? '🎯' : '🟥'
    return r.points >= 3 ? '💦' : r.points > 0 ? '🟩' : '🟥'
  }
  return r.points > 0 ? '🟧' : '🔒'
}

/** Start a possession: burn the inbound time. Returns the game with the clock run down. */
export function startPossession(g, { timeout = false } = {}) {
  const next = { ...g }
  if (timeout && g.poss === 'you' && g.timeouts > 0) {
    next.timeouts--
    next.inbound = Math.min(next.inbound, ATO_INBOUND)
    next.ato = true
  }
  // with the clock nearly gone they push it up and still get a last heave (about 1.5s)
  const burn = g.clock > 2.2 ? Math.min(next.inbound, g.clock - 1.5) : g.clock > 0.8 ? Math.min(next.inbound, g.clock - 0.6) : next.inbound
  next.clock = Math.max(0, g.clock - burn)
  next.inbound = 0
  if (next.clock <= 0) return finish(next, 'Time ran out bringing it up the floor.')
  return next
}

/**
 * Apply a finished sim possession. team: 'you' | 'them'. ft: { made } when free throws were already shot
 * (your mini-game); their free throws are rolled here.
 */
export function applyPossession(g, team, result, { set, coverage, ftMade = null } = {}) {
  const r = possRng(g, 'after')
  const next = { ...g, log: [...g.log], ato: false }
  next.clock = Math.max(0, g.clock - result.elapsed)
  let points = result.points ?? 0
  let fts = result.fts ?? 0
  let ftPoints = 0
  if (fts) {
    if (team === 'you') ftPoints = ftMade ?? 0
    else for (let i = 0; i < fts; i++) if (r() < FT_PCT) ftPoints++
  }
  points += ftPoints
  if (team === 'you') next.scoreYou += points
  else next.scoreThem += points
  const entry = { team, set, coverage, kind: result.kind, points, fts, ftPoints, shot: result.shot ?? null, clock: next.clock, emoji: emojiFor(team, { ...result, points }) }
  if (team === 'you' && set) next.yourSets = [...g.yourSets, set]
  if (team === 'them' && coverage) next.yourCoverages = [...g.yourCoverages, coverage]
  if (team === 'them' && set) next.theirSets = [...(g.theirSets ?? []), set]
  if (result.shot?.by) {
    const h = { ...(g.heat?.[team] ?? {}) }
    h[result.shot.by] = result.points > 0 && ['make', 'and1'].includes(result.kind) ? (h[result.shot.by] ?? 0) + 1 : 0
    next.heat = { ...(g.heat ?? { you: {}, them: {} }), [team]: h }
    entry.heatingUp = h[result.shot.by] === 2 ? result.shot.by : null
  }

  // who has it next
  const other = team === 'you' ? 'them' : 'you'
  const missedLastFt = fts > 0 && ftPoints < fts
  const offReb = (result.kind === 'miss' && r() < OFF_REB) || (missedLastFt && r() < 0.12)
  if (offReb) {
    next.poss = team
    next.shotClock = 14
    next.inbound = 0
    entry.offReb = true
  } else {
    next.poss = other
    next.shotClock = 24
    next.inbound = ['make', 'and1', 'fouled', 'foulDrawn'].includes(result.kind) || fts ? INBOUND : result.kind === 'steal' ? 1.5 : INBOUND - 1
  }
  next.log.push({ ...entry, wp: null })
  if (next.clock <= 0) return withWp(finish(next))
  next.shotClock = Math.min(next.shotClock, next.clock)
  return withWp(next)
}

/** Hot hands for a team's next possession: two straight makes +0.04, three or more +0.07. */
export function boostsFor(g, team) {
  const out = {}
  for (const [k, n] of Object.entries(g.heat?.[team] ?? {})) if (n >= 2) out[k] = n >= 3 ? 0.07 : 0.04
  return Object.keys(out).length ? out : null
}

/** Intentional foul by the trailing team: about a second off, then two free throws. */
export function applyFoul(g, shooter, made) {
  return applyPossession(g, shooter, { kind: 'ft', points: 0, fts: 2, elapsed: 1.2 }, { ftMade: shooter === 'you' ? made : null, set: null })
}

function withWp(g) {
  g.log[g.log.length - 1].wp = winProb(g)
  return g
}

function finish(g, reason = null) {
  const diff = g.scoreYou - g.scoreThem
  if (diff === 0 && g.ot < 3) {
    // tied at the horn: a short overtime, jump ball goes your way half the time
    return { ...g, ot: g.ot + 1, clock: 45, poss: rngFrom(`${g.id}|ot${g.ot}`)() < 0.5 ? 'you' : 'them', shotClock: 24, inbound: 0, reason: g.ot ? 'Still tied. Another overtime!' : 'Tied at the horn. Overtime!' }
  }
  return { ...g, clock: 0, status: diff > 0 ? 'won' : 'lost', reason: diff === 0 ? 'Still tied after three overtimes. Call it a draw.' : diff > 0 ? 'You closed it out!' : reason ?? 'Came up short.' }
}

export const fmtClock = (s) => {
  if (s < 10) return `0:0${Math.max(0, s).toFixed(1)}`.replace(/^0:0(\d\d)/, '0:$1')
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function shareText(g, { day, url, mode, moment = null }) {
  const won = g.status === 'won'
  const title = mode === 'daily' ? `🏀 Clutch Hoops #${day}` : '🏀 Clutch Hoops'
  const line = `${g.you} ${g.scoreYou}–${g.scoreThem} ${g.them} ${won ? '✅' : '❌'}${g.ot ? ' (OT)' : ''}`
  const grid = g.log.map((p) => p.emoji).join('')
  const lo = Math.min(g.wp0, ...g.log.map((p) => p.wp ?? 1))
  let history = ''
  if (moment) {
    const realWon = moment.won === 1
    history = `\n📅 Real ${moment.date?.slice(0, 4) ?? ''}: ${realWon ? 'they won' : 'they lost'} · ${won && !realWon ? 'I beat history 🔥' : won ? 'matched history' : realWon ? 'history wins this one' : 'same as history'}`
  }
  return `${title}\n${line}\n${grid}\n📈 Win prob ${Math.round(g.wp0 * 100)}%${lo < g.wp0 - 0.05 ? ` (low ${Math.round(lo * 100)}%)` : ''} → ${won ? 100 : 0}%${history}\n${url ?? ''}`.trim()
}

export const SET_LABEL = (id) => SETS[id]?.label ?? id
