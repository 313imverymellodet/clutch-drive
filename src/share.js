/*
 * Result links: the URL at the end of a shared result. /r?… carries one player's result in a few short params,
 * so link previews (iMessage, X, Discord, WhatsApp) show that player's own card: api/r.js serves the page with
 * the share tags and sends people on to the Daily, api/og.js draws the 1200x630 image.
 *
 * Plain data, no browser APIs and explicit .js imports: the app imports it and so do the Node functions.
 * Everything read back is checked against fixed lists (teams, grid symbols, number ranges), so a crafted
 * link can't put arbitrary text on a card.
 */
import { TEAM_BY_ABBR } from './data/nflTeams.js'
import { NBA_BY_ABBR } from './hoops/teams.js'

/** Grid emoji <-> one URL-safe letter (football and hoops share the alphabet). */
const GRID = { g: '🟩', y: '🟨', r: '🟥', o: '🟧', t: '🏈', p: '⏸️', x: '❌', c: '⏱️', f: '🎯', w: '💦', l: '🔒' }
const LETTER = Object.fromEntries(Object.entries(GRID).map(([k, e]) => [e.replace(/️/g, ''), k]))
const MAX_GRID = 40

/** Football loss reasons as one letter (the full text stays in the shared message). */
const REASONS = { i: 'Intercepted', d: 'Turnover on downs', t: 'Time expired', s: 'Safety', n: 'TD, not enough' }
const reasonCode = (reason = '') =>
  /^Intercepted/.test(reason) ? 'i' : /downs/.test(reason) ? 'd' : /clock ran out|Time expired/.test(reason) ? 't' : /^Safety/.test(reason) ? 's' : /not enough/.test(reason) ? 'n' : null

export const SPORTS = {
  f: { name: 'Clutch Drive', daily: 'Daily Drive', icon: '🏈', teams: TEAM_BY_ABBR },
  h: { name: 'Clutch Hoops', daily: 'Daily Hoops', icon: '🏀', teams: NBA_BY_ABBR },
}

/** Split an emoji grid string into its symbols (keeps ⏸️ / ⏱️ whole). */
const symbols = (grid) => [...grid.replace(/️/g, '')]

/** The result link for a football drive (drive state from src/game/drive.js). */
export function driveResultUrl(origin, d, { mode, day, streak }) {
  return resultUrl(origin, {
    s: 'f',
    m: mode,
    n: mode === 'daily' ? day : null,
    a: d.offense,
    b: d.defense,
    x: `${d.scoreOff}-${d.scoreDef}`,
    w: d.status === 'won',
    g: d.plays.map((p) => p.emoji).join(''),
    c: d.status === 'won' ? Math.max(0, Math.ceil(d.clock)) : null,
    e: d.status === 'won' ? null : reasonCode(d.reason ?? ''),
    p: d.wp0,
    lo: Math.min(d.wp0 ?? 1, ...d.plays.map((p) => p.wp ?? 1)),
    y: d.moment?.season,
    h: d.moment ? d.moment.won : null,
    k: mode === 'survivor' ? streak : null,
  })
}

/** The result link for a hoops game (game state from src/hoops/game.js). */
export function hoopsResultUrl(origin, g, { mode, day, moment }) {
  return resultUrl(origin, {
    s: 'h',
    m: mode,
    n: mode === 'daily' ? day : null,
    a: g.you,
    b: g.them,
    x: `${g.scoreYou}-${g.scoreThem}`,
    w: g.status === 'won',
    g: g.log.map((p) => p.emoji).join(''),
    o: g.ot || null,
    p: g.wp0,
    lo: Math.min(g.wp0 ?? 1, ...g.log.map((p) => p.wp ?? 1)),
    y: moment?.date ? +moment.date.slice(0, 4) : null,
    h: moment ? moment.won : null,
  })
}

function resultUrl(origin, r) {
  const q = new URLSearchParams()
  const put = (k, v) => v != null && v !== '' && v !== false && q.set(k, String(v))
  put('s', r.s)
  put('m', r.m === 'daily' ? 'd' : r.m === 'survivor' ? 's' : 'p')
  put('n', r.n)
  put('a', r.a)
  put('b', r.b)
  put('x', r.x)
  put('w', r.w ? 1 : 0)
  put('g', symbols(r.g).map((e) => LETTER[e] ?? '').join('').slice(0, MAX_GRID))
  put('c', r.c)
  put('e', r.e)
  put('o', r.o)
  if (r.p != null) put('p', Math.round(r.p * 100))
  // only worth showing when it dipped well below where it started
  if (r.p != null && r.lo != null && r.lo < r.p - 0.05) put('l', Math.round(r.lo * 100))
  if (r.y && r.h != null) {
    put('y', r.y)
    put('h', r.h === 1 || r.h === true ? 1 : 0)
  }
  put('k', r.k || null)
  return `${origin}/r?${q}`
}

const int = (v, lo, hi) => (v != null && /^\d{1,4}$/.test(v) && +v >= lo && +v <= hi ? +v : null)

/** Read and validate a result link's params. Returns null when the link can't make a card. */
export function parseResult(params) {
  const get = (k) => params.get(k)
  const s = get('s')
  const sport = SPORTS[s]
  if (!sport) return null
  const a = sport.teams[get('a')]
  const b = sport.teams[get('b')]
  const score = /^(\d{1,3})-(\d{1,3})$/.exec(get('x') ?? '')
  if (!a || !b || !score) return null
  const mode = { d: 'daily', s: 'survivor' }[get('m')] ?? 'practice'
  const day = mode === 'daily' ? int(get('n'), 1, 9999) : null
  const y = int(get('y'), 1990, 2100)
  const h = get('h')
  return {
    s,
    sport,
    mode,
    day,
    you: a,
    them: b,
    scoreYou: +score[1],
    scoreThem: +score[2],
    won: get('w') === '1',
    grid: [...(get('g') ?? '')].filter((k) => GRID[k]).slice(0, MAX_GRID).map((k) => GRID[k]),
    clockLeft: s === 'f' ? int(get('c'), 0, 600) : null,
    reason: s === 'f' ? REASONS[get('e')] ?? null : null,
    ot: s === 'h' ? int(get('o'), 0, 3) ?? 0 : 0,
    wp0: int(get('p'), 0, 100),
    wpLow: int(get('l'), 0, 100),
    real: y && (h === '0' || h === '1') ? { year: y, won: h === '1' } : null,
    streak: mode === 'survivor' ? int(get('k'), 1, 999) : null,
  }
}

/** The same params in a fixed order (for og:url and the image URL). */
export function canonicalQuery(r) {
  return resultUrl('', {
    ...r,
    m: r.mode,
    n: r.day,
    a: r.you.abbr,
    b: r.them.abbr,
    x: `${r.scoreYou}-${r.scoreThem}`,
    w: r.won,
    g: r.grid.join(''),
    c: r.clockLeft,
    e: Object.keys(REASONS).find((k) => REASONS[k] === r.reason) ?? null,
    o: r.ot || null,
    p: r.wp0 == null ? null : r.wp0 / 100,
    lo: r.wpLow == null ? null : r.wpLow / 100,
    y: r.real?.year,
    h: r.real ? (r.real.won ? 1 : 0) : null,
    k: r.streak,
  }).slice('/r?'.length)
}

/** How the player did against what really happened (same wording as the shared text). */
export function verdict(r) {
  if (!r.real) return null
  if (r.won && !r.real.won) return { key: 'beat', label: 'Beat history', line: 'I beat history 🔥' }
  if (r.won) return { key: 'matched', label: 'Matched history', line: 'matched history' }
  if (r.real.won) return { key: 'history', label: 'History wins this one', line: 'history wins this one' }
  return { key: 'same', label: 'Same as history', line: 'same as history' }
}

export const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

/** Title and description for the link preview. */
export function shareMeta(r) {
  const head = r.mode === 'daily' && r.day ? `${r.sport.name} #${r.day}` : r.mode === 'survivor' ? `${r.sport.name} Survivor` : r.sport.name
  const title = `${head}: ${r.you.abbr} ${r.scoreYou}–${r.scoreThem} ${r.them.abbr} ${r.won ? '✅' : '❌'}${r.ot ? ' (OT)' : ''}`
  const v = verdict(r)
  const how = r.won ? (r.clockLeft != null ? `Won it with ${fmtClock(r.clockLeft)} left.` : 'Won it.') : r.reason ? `${r.reason}.` : 'Came up short.'
  const real = v ? ` Real ${r.real.year}: ${r.real.won ? 'they won' : 'they lost'}, ${v.line}.` : ''
  const cta = r.s === 'h' ? 'Can you win today’s real NBA ending?' : 'Can you win today’s real NFL comeback drive?'
  return { title, description: `${how}${real} ${cta}`, alt: `${r.you.city} ${r.you.name} ${r.scoreYou}, ${r.them.city} ${r.them.name} ${r.scoreThem}` }
}

/** Where a visitor goes after the preview: the Daily for that sport (Survivor shares go to Survivor). */
export function playPath(r) {
  if (r.s === 'h') return '/hoops'
  return r.mode === 'survivor' ? '/play?mode=survivor' : '/play?mode=daily'
}
