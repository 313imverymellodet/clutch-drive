import COUNTER_DATA from './counters.json'
import { COVERAGES, COVERAGE_IDS, PLAYS } from './playSim'

/*
 * Offensive coordinator AI (used in Defense mode and when a head-to-head player's shot clock runs out).
 * It reads the shell the defense shows, but knows shells can be disguises, so it weighs the play x coverage
 * matrix (from scripts/outcomes.mjs) by its belief about the real coverage. Then it adjusts for the
 * situation (down, distance, clock, field position) and avoids becoming predictable.
 */

const MATRIX = COUNTER_DATA?.matrix ?? {}
const SHELLS_SHOWING = {
  // which real calls might be hiding behind each shown shell
  cover1: ['blitz'],
  cover2: ['cover1', 'cover3', 'tampa2', 'cover4', 'firezone'],
  tampa2: ['cover3'],
  cover3: ['cover2', 'tampa2', 'cover4', 'blitz', 'firezone'],
  cover4: ['cover1', 'cover3', 'firezone', 'prevent'],
  firezone: [],
  blitz: [],
  prevent: [],
}

/** P(real coverage | shown shell). */
export function beliefGiven(shown, honesty = 0.65) {
  const others = SHELLS_SHOWING[shown] ?? []
  const b = Object.fromEntries(COVERAGE_IDS.map((c) => [c, 0]))
  b[shown] = others.length ? honesty : 1
  for (const c of others) b[c] = (1 - honesty) / others.length
  return b
}

/** Expected value of a play vs. a belief over coverages: win rate plus a little for yards. */
export function playValue(play, belief) {
  const row = MATRIX[play]
  if (!row) return 0.4
  let v = 0
  for (const [c, p] of Object.entries(belief)) if (p && row[c]) v += p * (row[c].win + row[c].yds / 30 - (row[c].int ?? 0) * 2)
  return v
}

/** Best plays against a shown look (for the coach and tags). */
export function bestPlaysVs(shown, n = 3, filter = () => true) {
  const belief = beliefGiven(shown)
  return Object.keys(PLAYS)
    .filter(filter)
    .map((id) => [id, playValue(id, belief)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id)
}

/** The coverage a play does best against, from the matrix ("Beats Cover 2"). */
export function bestMatchup(play) {
  const row = MATRIX[play]
  if (!row) return null
  let best = null
  for (const c of COVERAGE_IDS) if (row[c] && (!best || row[c].win > row[best].win)) best = c
  return best && row[best].win >= 0.6 ? COVERAGES[best] : null
}

/**
 * Pick a play. situation: { down, toGo, clock, ballOn, clockRunning, timeouts }.
 * history: recent play ids (to stay unpredictable). Returns { play, flip, reads: null }.
 */
export function chooseOffense(situation, shown, rnd = Math.random, { difficulty = 0, history = [] } = {}) {
  const { down = 1, toGo = 10, clock = 120, ballOn = 25, clockRunning = false, timeouts = 0 } = situation
  const toGoal = 100 - ballOn
  const belief = beliefGiven(shown, 0.6 + difficulty * 0.03)
  const recentFams = history.slice(-2).map((id) => PLAYS[id]?.family)
  const scores = Object.keys(PLAYS).map((id) => {
    const p = PLAYS[id]
    let s = playValue(id, belief)
    if (toGo <= 2) s += p.family === 'run' ? 0.25 : 0
    if (toGo <= 2 && id === 'blast') s += 0.2
    if (down >= 3 && toGo >= 7) s += p.family === 'run' ? -0.45 : p.family === 'quick' ? -0.15 : 0.1
    if (clock < 40 && clockRunning && !timeouts) s += p.sideline?.length ? 0.35 : p.family === 'run' ? -0.6 : 0
    if (clock < 20) s += p.family === 'deep' ? 0.25 : p.family === 'run' ? -0.8 : 0
    if (toGoal <= 12 && (id === 'deep' || id === 'verts' || id === 'postwheel')) s -= 0.5
    if (recentFams.filter((f) => f === p.family).length === 2) s -= 0.3 // don't get keyed on
    if (history.at(-1) === id) s -= 0.2
    return [id, s]
  })
  // softmax pick: smarter coordinators are greedier
  const temp = Math.max(0.06, 0.14 - difficulty * 0.015)
  const max = Math.max(...scores.map(([, s]) => s))
  const weights = scores.map(([id, s]) => [id, Math.exp((s - max) / temp)])
  const total = weights.reduce((a, [, w]) => a + w, 0)
  let r = rnd() * total
  let play = weights[0][0]
  for (const [id, w] of weights) {
    if ((r -= w) <= 0) {
      play = id
      break
    }
  }
  return { play, flip: rnd() < 0.5, reads: null }
}
