import DATA from '../data/moments.json'
import { TEAM_BY_ABBR } from '../data/nflTeams'
import { dayNumber, rngFrom } from './drive'

/*
 * Real late-game moments (built by scripts/build-moments.mjs from nflverse play-by-play, CC BY 4.0):
 * a team trailing by 4-6 getting the ball back with under 3:00 left. Teams and situations only.
 */
export const MOMENTS = DATA.moments
export const DATA_CREDIT = 'Real game situations and the win-probability model come from nflverse play-by-play data (CC BY 4.0).'

// a fixed shuffle so the Daily walks through every moment before repeating
const ORDER = (() => {
  const idx = MOMENTS.map((_, i) => i)
  const rnd = rngFrom('clutch-drive-moments-v1')
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
})()

export function momentForDay(dateKey) {
  return MOMENTS[ORDER[(dayNumber(dateKey) - 1) % ORDER.length]]
}

/** Survivor: each win digs into tougher real spots (lower real win probability). */
const BY_WP = [...MOMENTS].sort((a, b) => b.wp - a.wp)
export function momentForSurvivor(runId, game) {
  const rnd = rngFrom(`surv-moment-${runId}-${game}`)
  const band = Math.min(0.85, game * 0.12) // slide the window toward low-WP moments
  const start = Math.floor(band * BY_WP.length)
  const span = Math.max(20, Math.floor(BY_WP.length * 0.25))
  return BY_WP[Math.min(BY_WP.length - 1, start + Math.floor(rnd() * span))]
}

export function momentLabel(m) {
  const away = m.home === m.off ? m.def : m.off
  return `${m.post ? 'Playoffs' : `Week ${m.week}`}, ${m.season} · ${away} at ${m.home}`
}

const OUTCOME = {
  Touchdown: 'scored the go-ahead touchdown',
  Turnover: 'turned it over',
  'Turnover on downs': 'turned it over on downs',
  'End of half': 'ran out of time',
  'Opp touchdown': 'gave up a defensive touchdown',
  Punt: 'had to punt',
  Safety: 'gave up a safety',
  'Field goal': 'kicked a field goal',
  'Missed field goal': 'missed a field goal',
}

/** "The real Seahawks turned it over on downs and lost 17-13." (qb: "..., with Russell Wilson at QB, ...") */
export function realOutcome(m, qb = null) {
  const t = TEAM_BY_ABBR[m.off]
  const how = OUTCOME[m.result] ?? 'came up short'
  const [f, a] = m.final
  const res = m.won === 1 ? `won ${f}–${a}` : m.won === 0.5 ? `tied ${f}–${a}` : `lost ${a}–${f}`
  return `The real ${t?.name ?? m.off}${qb ? `, with ${qb} at QB,` : ''} ${how} and ${res}.`
}

/** A real moment as a drive scenario (plus the history to compare against). */
export function scenarioFromMoment(m, id) {
  return {
    id,
    offense: m.off,
    defense: m.def,
    scoreOff: m.scoreOff,
    scoreDef: m.scoreDef,
    clock: m.clock,
    ballOn: m.ballOn,
    timeouts: m.timeouts,
    defTimeouts: m.defTimeouts,
    moment: m,
  }
}
