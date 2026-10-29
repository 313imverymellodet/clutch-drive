import { useSyncExternalStore } from 'react'
import { load, save } from './storage'

/*
 * Player settings, saved on this device: volume, haptics, camera per sport, reduced motion.
 * Plain module state with subscribers, so the sound engine and the 3D scenes can read it without React.
 */

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const DEFAULTS = { volume: 0.9, haptics: true, camera: 'broadcast', hoopsCamera: 'broadcast', reducedMotion: null }
let state = { ...DEFAULTS, ...load('cd.settings', {}) }
const subs = new Set()

export const getSettings = () => state
/** Reduced motion follows the system setting until the player picks one here. */
export const reducedMotion = () => state.reducedMotion ?? prefersReducedMotion()

export function setSetting(key, value) {
  state = { ...state, [key]: value }
  save('cd.settings', state)
  subs.forEach((fn) => fn(state))
}

export function onSettings(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

export function useSettings() {
  return useSyncExternalStore(onSettings, getSettings, getSettings)
}

export const FOOTBALL_CAMERAS = [
  ['broadcast', 'Broadcast'],
  ['high', 'All-22'],
  ['field', 'Field level'],
]
export const HOOPS_CAMERAS = [
  ['broadcast', 'Broadcast'],
  ['low', 'Courtside'],
  ['high', 'Overhead'],
]
