import DATA from '../data/hoopsMoments.json'
import { NBA_BY_ABBR } from './teams'
import { dayNumber, rngFrom } from '../game/drive'

/*
 * Real NBA endings (built by scripts/build-hoops-moments.mjs from sportsdataverse hoopR play-by-play, ESPN-sourced):
 * a team down 1-5 with the ball and 0:25-1:30 left in the 4th. Teams and situations only.
 */
export const HOOPS_MOMENTS = DATA.moments
export const HOOPS_DATA_CREDIT = 'Real game situations and the win-probability model come from sportsdataverse hoopR NBA play-by-play (ESPN data).'
export const HOOPS_DATA_URL = 'https://github.com/sportsdataverse/hoopR'

// a fixed shuffle so the Daily walks through every moment before repeating
const ORDER = (() => {
  const idx = HOOPS_MOMENTS.map((_, i) => i)
  const rnd = rngFrom('clutch-hoops-moments-v1')
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
})()

export function hoopsMomentForDay(dateKey) {
  return HOOPS_MOMENTS[ORDER[(dayNumber(dateKey) - 1) % ORDER.length]]
}

const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function hoopsMomentLabel(m) {
  const away = m.home === m.off ? m.def : m.off
  return `${m.post ? 'Playoffs, ' : ''}${fmtDate(m.date)} · ${away} at ${m.home}`
}

const HOW = {
  three: (p) => `hit a three${p > 3 ? ` (${p} points on the trip)` : ''}`,
  two: (p) => (p > 2 ? `scored ${p} on the trip` : 'scored a bucket'),
  ft: (p) => `got to the line and made ${p}`,
  miss: () => 'came up empty',
  turnover: () => 'turned it over',
  time: () => 'ran out of time',
}

/** "The real Knicks hit a three on that trip and won 112–110." */
export function hoopsRealOutcome(m) {
  const t = NBA_BY_ABBR[m.off]
  const how = (HOW[m.result] ?? HOW.miss)(m.points)
  const [f, a] = m.final
  return `The real ${t?.name ?? m.off} ${how} on that possession and ${m.won ? `won ${f}–${a}` : `lost ${a}–${f}`}.`
}

/** A real moment as a hoops scenario (plus the history to compare against). */
export function scenarioFromHoopsMoment(m, id) {
  return {
    id,
    you: m.off,
    them: m.def,
    scoreYou: m.scoreOff,
    scoreThem: m.scoreDef,
    clock: m.clock,
    timeouts: m.timeouts,
    theirTimeouts: m.defTimeouts,
    youHome: m.home === m.off,
    moment: m,
  }
}
