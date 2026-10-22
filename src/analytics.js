import { track } from '@vercel/analytics'

/*
 * Funnel events for Vercel Web Analytics: who starts a game, who finishes it, how it ended, who shares.
 *   game_start { mode }           mode: drive-daily, drive-survivor, drive-practice, defense, defense-daily,
 *                                       hoops-daily, hoops-practice, h2h-host, h2h-guest
 *   game_end   { mode, result }   result: win, loss, or win-beat-history (won a real moment the real team lost)
 *   share      { mode, method }   method: native, clipboard, prompt
 * Vercel records custom events only on Pro plans and up, with 2 properties per event on Pro, so each event
 * stays within two. In dev they go to the console instead.
 */
export function trackEvent(name, props) {
  if (import.meta.env.DEV) return console.debug('[track]', name, props)
  try {
    track(name, props)
  } catch {
    /* analytics must never break the game */
  }
}

/** win / loss, or win-beat-history when you won a real moment the real team lost. */
export const resultOf = (won, moment) => (won ? (moment && moment.won !== 1 ? 'win-beat-history' : 'win') : 'loss')
