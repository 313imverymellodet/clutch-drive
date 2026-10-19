import { useEffect, useState } from 'react'

/*
 * Real branding (test builds only, see vite.config.js): real player names and jersey numbers from
 * nflverse (scripts/build-players.mjs) and team logos from ESPN's logo CDN. When __REAL__ is false the
 * lineup data is never bundled and every helper here returns null, so the game falls back to generic
 * numbers and team colors.
 */
export const REAL = __REAL__

let DATA = null
const ready = REAL ? import('../data/players.json').then((m) => (DATA = m.default)) : Promise.resolve(null)

/** Re-render once the lineup data has loaded (it's a separate, lazily loaded chunk). */
export function useRealData() {
  const [data, setData] = useState(DATA)
  useEffect(() => {
    // always subscribe: the data can land between the first render and this effect
    let live = true
    ready.then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [])
  return data
}

const OFF_SLOTS = ['qb', 'rb', 'te', 'x', 'z', 'slot', 'C', 'OL1', 'OL2', 'OL3', 'OL4']
const DEF_SLOTS = ['DL0', 'DL1', 'DL2', 'DL3', 'MLB', 'SLB', 'WLB', 'CBX', 'CBZ', 'SS', 'FS']
const bySlot = (slots, list) => (list ? Object.fromEntries(slots.map((s, i) => [s, list[i]]).filter(([, v]) => v)) : null)

/**
 * The 22 on the field: the real game-day lineups for a real moment, otherwise each team's current one.
 * Returns { off: { qb: [number, name], ... }, def: { DL0: [...], ... } } or null.
 */
export function rosterFor({ moment, offense, defense }) {
  if (!REAL || !DATA) return null
  const m = moment && DATA.moments[`${moment.id}|${moment.off}|${moment.clock}`]
  const off = m?.off ?? DATA.teams[offense]?.off
  const def = m?.def ?? DATA.teams[defense]?.def
  if (!off && !def) return null
  return { off: bySlot(OFF_SLOTS, off), def: bySlot(DEF_SLOTS, def), season: m ? moment.season : DATA.season }
}

/** "Charlie Batch" -> "C. Batch" (for tight spots like dropdowns). */
export const shortName = (name) => (name ? name.replace(/^(\S)\S*\s+/, '$1. ') : name)

const ESPN = { WAS: 'wsh' }
/** Team logo URL (CORS-enabled, so it can also be drawn into the field texture). */
export function logoUrl(abbr) {
  if (!REAL || !abbr) return null
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${ESPN[abbr] ?? abbr.toLowerCase()}.png`
}

const ESPN_NBA = { GSW: 'gs', NOP: 'no', NYK: 'ny', SAS: 'sa', UTA: 'utah', WAS: 'wsh' }
/** NBA team logo URL (same CDN; CORS-enabled for the court texture). */
export function nbaLogoUrl(abbr) {
  if (!REAL || !abbr) return null
  return `https://a.espncdn.com/i/teamlogos/nba/500/${ESPN_NBA[abbr] ?? abbr.toLowerCase()}.png`
}

export function TeamLogo({ abbr, size = 22, className = 'team-logo', league = 'nfl' }) {
  const url = league === 'nba' ? nbaLogoUrl(abbr) : logoUrl(abbr)
  if (!url) return null
  return <img className={className} src={url} alt="" width={size} height={size} loading="lazy" decoding="async" />
}
