import { getSettings } from './settings'

/*
 * Phone buzzes for the big moments (Android browsers; iPhone Safari has no vibration API, so it's a no-op there).
 * Off in Settings, and never more than a short pattern.
 */
export const HAPTIC = {
  tap: 8,
  hit: 22,
  big: [35, 40, 35],
  score: [25, 35, 25, 35, 90],
  miss: 40,
}

export function haptic(pattern) {
  if (!getSettings().haptics) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* not supported */
  }
}
