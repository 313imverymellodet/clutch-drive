import Peer from 'peerjs'

/*
 * Head-to-head transport: a direct browser-to-browser WebRTC data channel (PeerJS).
 * The host registers a peer id derived from a short room code; the guest connects to it.
 * PeerJS's free public broker only introduces the two browsers; game messages go peer-to-peer.
 */

const PREFIX = 'clutch-drive-v1-'
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L

export function makeCode(len = 5) {
  let s = ''
  const buf = crypto.getRandomValues(new Uint8Array(len))
  for (const b of buf) s += ALPHABET[b % ALPHABET.length]
  return s
}

export const normalizeCode = (code) => (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)

/** Wraps a PeerJS DataConnection: send(obj), onMessage(fn), onClose(fn). */
function wrap(conn) {
  const handlers = { message: new Set(), close: new Set() }
  conn.on('data', (data) => handlers.message.forEach((fn) => fn(data)))
  conn.on('close', () => handlers.close.forEach((fn) => fn()))
  conn.on('error', () => handlers.close.forEach((fn) => fn()))
  return {
    send: (obj) => {
      if (conn.open) conn.send(obj)
    },
    onMessage: (fn) => (handlers.message.add(fn), () => handlers.message.delete(fn)),
    onClose: (fn) => (handlers.close.add(fn), () => handlers.close.delete(fn)),
    close: () => conn.close(),
  }
}

function friendlyError(err) {
  const type = err?.type
  if (type === 'unavailable-id') return 'That room code is taken. Try creating the match again.'
  if (type === 'peer-unavailable') return "Couldn't find that match. Check the code, or ask your friend to create a new one."
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return "Couldn't reach the matchmaking server. Check your connection and try again."
  if (type === 'browser-incompatible') return "This browser can't do online play. Try Chrome, Safari or Firefox."
  return 'Connection problem. Please try again.'
}

/** Host a room. Resolves once registered; onGuest(channel) fires when a friend connects. */
export function hostRoom(code, { onGuest, onError }) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, { debug: 0 })
    let settled = false
    peer.on('open', () => {
      settled = true
      resolve({ code, close: () => peer.destroy() })
    })
    peer.on('connection', (conn) => {
      conn.on('open', () => onGuest(wrap(conn)))
    })
    peer.on('error', (err) => {
      const msg = friendlyError(err)
      if (!settled) reject(new Error(msg))
      else onError?.(msg)
    })
  })
}

/** Join a room by code. Resolves with a channel once the data connection is open. */
export function joinRoom(code, { onError } = {}) {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 })
    let settled = false
    const fail = (msg) => {
      if (settled) return onError?.(msg)
      settled = true
      peer.destroy()
      reject(new Error(msg))
    }
    const timer = setTimeout(() => fail("Couldn't connect. Make sure your friend's match is still open."), 15000)
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' })
      conn.on('open', () => {
        clearTimeout(timer)
        settled = true
        const ch = wrap(conn)
        resolve({ ...ch, close: () => peer.destroy() })
      })
    })
    peer.on('error', (err) => {
      clearTimeout(timer)
      fail(friendlyError(err))
    })
  })
}
