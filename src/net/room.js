import Peer from 'peerjs'
import mqtt from 'mqtt'

/*
 * Head-to-head transport. Every message goes out on every path that's up; the receiver de-duplicates.
 *
 *   direct  WebRTC data channel (PeerJS). Fastest, but needs the two devices to reach each other.
 *           Public TURN relays are unreliable/dead, so across many real networks this path fails.
 *   relay   MQTT over secure WebSockets through two independent public brokers. Works on any network
 *           that allows normal web traffic, which covers phones on cellular and most Wi-Fi.
 *
 * The host publishes a retained "room is open" marker so a guest can tell a wrong code from a slow host.
 * Paths reconnect on their own (a phone host that backgrounds the tab to share the link comes back).
 * Set localStorage 'cd.transport' to 'relay' or 'direct' to force one path (for testing).
 */

const PREFIX = 'clutch-drive-v1-'
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081']
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L
const topic = (code, box) => `clutchdrive/v1/${code}/${box}`
const rid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % ALPHABET.length]).join('')

export const makeCode = (len = 5) => rid(len)
export const normalizeCode = (code) => (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)

function forced() {
  try {
    return localStorage.getItem('cd.transport')
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ multiplexed channel
class Mux {
  constructor(myId) {
    this.myId = myId
    this.peerId = null
    this.seq = 0
    this.seen = new Set()
    this.paths = new Map()
    this.lastHeard = 0
    this.closed = false
    this.on = { message: new Set(), status: new Set(), close: new Set() }
    this.status = 'connecting'
  }
  setPath(name, send) {
    if (send) this.paths.set(name, send)
    else this.paths.delete(name)
  }
  send(body) {
    const env = { k: 'cd1', from: this.myId, to: this.peerId, seq: ++this.seq, body }
    for (const send of this.paths.values()) {
      try {
        send(env)
      } catch {
        /* a path dropped mid-send; another one will carry it */
      }
    }
  }
  /** Returns true if delivered to the app. */
  receive(env, via) {
    if (!env || env.k !== 'cd1' || env.from === this.myId) return false
    if (this.peerId && env.from !== this.peerId) return false
    if (env.to && env.to !== this.myId) return false
    this.lastHeard = Date.now()
    this.lastVia = via
    const key = `${env.from}:${env.seq}`
    if (this.seen.has(key)) return false
    this.seen.add(key)
    if (this.seen.size > 800) this.seen = new Set([...this.seen].slice(-400))
    if (env.body?.t !== 'ping') this.on.message.forEach((fn) => fn(env.body))
    return true
  }
  setStatus(s) {
    if (s === this.status) return
    this.status = s
    this.on.status.forEach((fn) => fn(s))
  }
  channel(close) {
    return {
      send: (body) => this.send(body),
      onMessage: (fn) => (this.on.message.add(fn), () => this.on.message.delete(fn)),
      onStatus: (fn) => (this.on.status.add(fn), fn(this.status), () => this.on.status.delete(fn)),
      onClose: (fn) => (this.on.close.add(fn), () => this.on.close.delete(fn)),
      close,
    }
  }
  /** Heartbeats + link status: direct | relay | reconnecting | lost. */
  startWatch(hasDirect) {
    const ping = setInterval(() => this.peerId && this.send({ t: 'ping' }), 2500)
    const watch = setInterval(() => {
      if (!this.peerId || this.closed) return
      const quiet = Date.now() - this.lastHeard
      if (quiet > 45000) {
        this.closed = true
        this.on.close.forEach((fn) => fn())
      } else if (quiet > 9000) this.setStatus('reconnecting')
      else this.setStatus(hasDirect() ? 'direct' : 'relay')
    }, 1000)
    return () => (clearInterval(ping), clearInterval(watch))
  }
}

// ------------------------------------------------------------------ relay path (MQTT)
function openRelay(subs, onEnv, onConnect) {
  const clients = BROKERS.map((url) => {
    const c = mqtt.connect(url, {
      protocolVersion: 4,
      clean: true,
      clientId: `cd_${rid(10)}`,
      reconnectPeriod: 1500,
      connectTimeout: 8000,
      keepalive: 20,
    })
    c.on('connect', () => {
      c.subscribe(subs, { qos: 1 })
      onConnect?.(c)
    })
    c.on('message', (t, buf) => {
      if (!buf?.length) return
      try {
        onEnv(JSON.parse(buf.toString()), t)
      } catch {
        /* not ours */
      }
    })
    c.on('error', () => {})
    return c
  })
  return {
    connected: () => clients.some((c) => c.connected),
    publish: (t, payload, opts = {}) => {
      for (const c of clients) if (c.connected) c.publish(t, typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: 1, ...opts })
    },
    close: () => clients.forEach((c) => c.end(true)),
  }
}

// ------------------------------------------------------------------ direct path helpers (PeerJS)
function keepPeerAlive(peer) {
  // phones drop the signaling socket when the tab is backgrounded (e.g. while sharing the link)
  const revive = () => !peer.destroyed && peer.disconnected && peer.reconnect()
  peer.on('disconnected', () => setTimeout(revive, 800))
  const onVis = () => document.visibilityState === 'visible' && revive()
  document.addEventListener('visibilitychange', onVis)
  return () => document.removeEventListener('visibilitychange', onVis)
}

const friendly = {
  network: "Couldn't reach the matchmaking servers. Check your internet connection and try again.",
  notFound: "Couldn't find that match. Check the code, or ask your friend to create a new one and keep the game open.",
  noHost: "Found the match, but the host isn't responding. Ask them to bring the game back on screen, then try again.",
}

// ------------------------------------------------------------------ host
/** Open a room. Resolves once at least one path is up; onGuest(channel) fires when a friend joins. */
export function hostRoom(code, { onGuest, onError } = {}) {
  const mode = forced()
  const mux = new Mux(`h${rid()}`)
  let started = false
  let relay = null
  let peer = null
  let unwatch = () => {}
  let unkeep = () => {}
  let direct = null
  const close = () => {
    mux.closed = true
    unwatch()
    unkeep()
    relay?.publish(topic(code, 'p'), '', { retain: true }) // clear the "room is open" marker
    setTimeout(() => relay?.close(), 300)
    peer?.destroy()
  }
  const handle = (env, via) => {
    if (!env || env.k !== 'cd1') return
    if (!mux.peerId && env.body?.t === 'hello') {
      mux.peerId = env.from
      mux.lastHeard = Date.now()
      if (!started) {
        started = true
        unwatch = mux.startWatch(() => !!direct?.open)
        onGuest?.(mux.channel(close))
      }
    }
    mux.receive(env, via)
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const ready = () => {
      if (settled) return
      settled = true
      resolve({ code, close })
    }
    if (mode !== 'direct') {
      relay = openRelay([topic(code, 'h')], (env) => handle(env, 'relay'), () => {
        relay.publish(topic(code, 'p'), { k: 'cd1', t: 'room', at: Date.now() }, { retain: true })
        ready()
      })
      mux.setPath('relay', (env) => relay.publish(topic(code, 'g'), env))
    }
    if (mode !== 'relay') {
      peer = new Peer(PREFIX + code, { debug: 0 })
      unkeep = keepPeerAlive(peer)
      peer.on('open', ready)
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          direct = conn
          mux.setPath('direct', (env) => conn.open && conn.send(env))
        })
        conn.on('data', (env) => handle(env, 'direct'))
        conn.on('close', () => {
          if (direct === conn) mux.setPath('direct', null)
        })
      })
      peer.on('error', () => {}) // the relay path carries on without it
    }
    setTimeout(() => {
      if (settled) return
      settled = true
      close()
      const err = new Error(friendly.network)
      onError?.(err.message)
      reject(err)
    }, 12000)
  })
}

// ------------------------------------------------------------------ guest
/** Join a room by code. onStatus('searching' | 'found' | 'connected'). Resolves with the channel. */
export function joinRoom(code, { onStatus, hello = {} } = {}) {
  const mode = forced()
  const mux = new Mux(`g${rid()}`)
  let relay = null
  let peer = null
  let direct = null
  let found = false
  let unwatch = () => {}
  let unkeep = () => {}
  const timers = []
  const close = () => {
    mux.closed = true
    unwatch()
    unkeep()
    timers.forEach(clearInterval)
    relay?.close()
    peer?.destroy()
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (msg) => {
      if (settled) return
      settled = true
      close()
      reject(new Error(msg))
    }
    const handle = (env, via) => {
      if (!env || env.k !== 'cd1') return
      // lock onto the host the first time it answers us
      if (!mux.peerId && env.to === mux.myId && env.body?.t === 'state') {
        mux.peerId = env.from
        found = true
      }
      if (mux.receive(env, via) && !settled && mux.peerId) {
        settled = true
        timers.forEach(clearInterval)
        unwatch = mux.startWatch(() => !!direct?.open)
        onStatus?.('connected')
        resolve(mux.channel(close))
      }
    }

    onStatus?.('searching')
    if (mode !== 'direct') {
      relay = openRelay([topic(code, 'g'), topic(code, 'p')], (env, t) => {
        if (t.endsWith('/p')) {
          if (env?.t === 'room' && !found) {
            found = true
            onStatus?.('found')
          }
          return
        }
        handle(env, 'relay')
      })
      mux.setPath('relay', (env) => relay.publish(topic(code, 'h'), env))
    }
    if (mode !== 'relay') {
      peer = new Peer({ debug: 0 })
      unkeep = keepPeerAlive(peer)
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' })
        conn.on('open', () => {
          direct = conn
          if (!found) (found = true), onStatus?.('found')
          mux.setPath('direct', (env) => conn.open && conn.send(env))
        })
        conn.on('data', (env) => handle(env, 'direct'))
        conn.on('close', () => {
          if (direct === conn) mux.setPath('direct', null)
        })
      })
      peer.on('error', () => {})
    }
    // knock until the host answers (it may be backgrounded for a moment)
    const knock = setInterval(() => !mux.peerId && mux.send({ ...hello, t: 'hello' }), 1500)
    timers.push(knock)
    timers.push(setTimeout(() => !mux.peerId && mux.send({ ...hello, t: 'hello' }), 300))
    timers.push(setTimeout(() => !found && fail(relay && !relay.connected() ? friendly.network : friendly.notFound), 12000))
    timers.push(setTimeout(() => fail(friendly.noHost), 45000))
  })
}
