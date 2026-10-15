import * as THREE from 'three'
import { THROW_RELEASE } from '../three/characters'

/*
 * Play simulation. Units are yards: x = sideline to sideline, z = downfield; offense drives toward +z.
 * The sim decides positions, facing and which clip each player is in; PlayScene draws it.
 * Stepped with a fixed dt and a seed, a play is fully repeatable, which is what makes instant replay work.
 *
 * Football AI in here:
 *  - Defense calls a coverage (chooseDefense) and may disguise it pre-snap.
 *  - Man defenders trail receivers; zone defenders drop to landmarks, shade receivers in their area,
 *    and break on the ball once it's thrown.
 *  - Pass rush vs. pass protection: blockers pick up rushers; each rusher beats his block after a while.
 *    Unblocked or winning rushers hurry the QB (early throw) or sack him.
 *  - After the catch: the carrier scores candidate directions for open space; defenders take intercept
 *    angles; teammates peel off to block the nearest pursuers.
 */

export const LOS = -25 // default line of scrimmage: own 25 (z = yard line from own goal - 50)
export const FIRST_DOWN = LOS + 10
export const FIXED_DT = 1 / 60
const END_LINE = 58.5 // keep routes and zones inside the back of the end zone
const SIDELINE = 26.2
const GOAL_LINE = 50
const HOLE_X = -0.8 // the A gap the HB Dive aims for

export const PLAYS = {
  out: { id: 'out', label: 'Quick Out', detail: 'Pass · slot to the sideline', type: 'pass', target: 'slot', throwAt: 0.8, drop: 3.0, toSideline: true },
  dig: { id: 'dig', label: 'Dig', detail: 'Pass · WR1 over the middle', type: 'pass', target: 'x', throwAt: 1.55, drop: 7.3 },
  deep: { id: 'deep', label: 'Deep Shot', detail: 'Pass · WR2 go route', type: 'pass', target: 'z', throwAt: 1.85, drop: 7.6 },
  run: { id: 'run', label: 'HB Dive', detail: 'Run · handoff up the gut', type: 'run' },
}

export const COVERAGES = {
  cover1: { id: 'cover1', name: 'Cover 1', read: 'Man coverage, one safety deep', short: 'Man, single-high' },
  cover2: { id: 'cover2', name: 'Cover 2', read: 'Two safeties deep, corners sitting in the flats', short: 'Two-high zone' },
  cover3: { id: 'cover3', name: 'Cover 3', read: 'Single-high zone, corners bailing deep', short: 'Three-deep zone' },
  blitz: { id: 'blitz', name: 'Cover 0 Blitz', read: 'Blitz! Six rushing and nobody deep', short: 'All-out blitz' },
  prevent: { id: 'prevent', name: 'Prevent', read: 'Prevent shell: everybody deep, soft underneath', short: 'Prevent' },
}

// Which coverages take away each play (from the outcomes.mjs balance table).
export const COUNTERS = {
  out: { cover1: 1, cover2: 0.8, blitz: 0.6 },
  dig: { cover2: 1, prevent: 0.7 },
  deep: { cover2: 1, cover3: 1, prevent: 0.8 },
  run: { blitz: 1, cover1: 0.9 },
}

/**
 * Defensive coordinator: pick a coverage for the situation and the offense's tendencies, sometimes disguised.
 * tendency: { share: { out, dig, deep, run } (recent, recency-weighted), key: { play, s } | null }
 */
export function chooseDefense({ down = 1, toGo = 10, clock = 120, ballOn = 25 } = {}, rnd = Math.random, difficulty = 0, tendency = null) {
  const toGoal = 100 - ballOn
  const w = { cover1: 0.24, cover2: 0.24, cover3: 0.3, blitz: 0.12, prevent: 0.1 }
  // lean toward whatever stops what they keep calling
  if (tendency?.share) {
    for (const [play, share] of Object.entries(tendency.share)) {
      for (const [cov, k] of Object.entries(COUNTERS[play] ?? {})) w[cov] += share * k * (0.9 + difficulty * 0.1)
    }
  }
  if (clock < 50 && toGoal > 35) w.prevent += 0.35
  if (down >= 3 && toGo >= 7) (w.blitz += 0.18), (w.cover2 += 0.08)
  if (toGo <= 3) (w.blitz += 0.1), (w.cover1 += 0.15)
  if (toGoal <= 15) (w.prevent = 0), (w.blitz += 0.15), (w.cover1 += 0.2), (w.cover3 -= 0.1)
  w.blitz += difficulty * 0.03
  const total = Object.values(w).reduce((a, b) => a + b, 0)
  let r = rnd() * total
  let call = 'cover3'
  for (const [k, v] of Object.entries(w)) {
    if ((r -= v) <= 0) {
      call = k
      break
    }
  }
  const disguise = { cover2: 'cover3', cover3: 'cover2', cover1: 'cover3', blitz: 'cover1', prevent: 'prevent' }
  const shown = rnd() < 0.12 + difficulty * 0.04 ? disguise[call] : call
  return { call, shown, key: tendency?.key ?? null }
}

const V = (x, z) => new THREE.Vector3(x, 0, z)
const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()
const tmp3 = new THREE.Vector3()

const SNAP_TIME = 0.35
const BALL_SPEED = 22 // short and intermediate throws
const DEEP_BALL_SPEED = 17 // more air under the deep ball
const ballSpeed = (dist) => (dist > 24 ? DEEP_BALL_SPEED : BALL_SPEED)

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Position along a polyline after travelling `dist` yards (clamped to the end). */
function alongRoute(pts, dist, out) {
  for (let i = 1; i < pts.length; i++) {
    const seg = pts[i].distanceTo(pts[i - 1])
    if (dist <= seg || i === pts.length - 1) return out.copy(pts[i - 1]).lerp(pts[i], Math.min(1, dist / seg))
    dist -= seg
  }
  return out.copy(pts[pts.length - 1])
}

/** Distance covered after t seconds with a short acceleration ramp. */
function routeDistance(t, speed, accel = 0.55) {
  if (t <= 0) return 0
  if (t < accel) return (speed * t * t) / (2 * accel)
  return speed * (t - accel / 2)
}

function angleLerp(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * k
}

const isDefBack = (p) => p.role === 'CB' || p.role === 'S' || p.role === 'LB'

export class PlaySim {
  constructor() {
    this.timeScale = 1 // < 1 for slow motion
    this.camMode = 'broadcast' // broadcast | close
    this.reset()
  }

  /**
   * los: line of scrimmage in field z; toGo: yards for a first down.
   * coverage: { call, shown } from chooseDefense (defaults to Cover 3). situation: { clock } for clock-aware AI.
   */
  reset({ play = 'dig', seed = 1, los = LOS, toGo = 10, coverage = null, situation = {}, difficulty = 0 } = {}) {
    this.los = los
    this.firstDown = Math.min(los + toGo, GOAL_LINE)
    this.play = PLAYS[play]
    this.seed = seed
    this.rng = mulberry32(seed)
    this.coverage = coverage ?? { call: 'cover3', shown: 'cover3' }
    this.situation = situation
    this.difficulty = difficulty
    this.t = 0
    this.phase = 'presnap' // presnap | live | dead | over
    this.players = []
    this.events = []
    this.message = null
    this.result = null
    this.catchTime = Infinity
    this.deadTime = Infinity
    this.tackleTime = Infinity
    this.throwAt = this.play.throwAt ?? Infinity
    this.hurried = false
    this.carrier = null
    this.tackler = null
    this.interceptor = null
    this.aim = null
    this.target = null

    const r = (a, b) => a + (b - a) * this.rng()
    this.r = r
    const route = (pts) => pts.map(([x, z]) => V(x, Math.min(END_LINE, this.los + z)))
    const off = (role, x, dz, extra = {}) => this.add('off', role, x, this.los + dz, 0, extra)
    const def = (role, x, dz, extra = {}) => this.add('def', role, x, this.los + dz, Math.PI, extra)
    const isRun = this.play.type === 'run'

    // ------------------------------------------------ offense
    this.center = off('C', 0, -0.9, { number: 55, anim: 'Block' })
    off('OL', 1.6, -1.0, { number: 66, anim: 'Stance' })
    off('OL', -1.6, -1.0, { number: 67, anim: 'Stance' })
    off('OL', 3.2, -1.2, { number: 71, anim: 'Stance' })
    off('OL', -3.2, -1.2, { number: 75, anim: 'Stance' })
    this.qb = off('QB', 0, -5, { number: 8, anim: 'Idle', feel: r(0.08, 0.3) }) // feel = how fast he senses the rush
    this.rb = off('RB', 1.6, -5, {
      number: 22,
      anim: 'Stance',
      ...(isRun
        ? { route: route([[1.6, -5], [0.5, -4.4], [HOLE_X, -1.6], [HOLE_X, 4]]), routeStart: SNAP_TIME + 0.1, speed: 6.5 }
        : { route: route([[1.6, -5], [2.4, -3.5], [7, -1.5], [9, -1]]), routeStart: 0.9, speed: 6 }),
    })
    this.te = off('TE', -4.8, -1.3, { number: 87, anim: 'Stance', route: route([[-4.8, -1.3], [-4.8, 1.5], [3, 3.5], [10, 4]]), routeStart: isRun ? 99 : 0.55, speed: 6 })
    this.x = off('WR', 17, -1, { number: 18, anim: 'Stance', route: route([[17, -1], [17, 10], [15.5, 11.8], [4, 13], [-6, 13.5]]), routeStart: 0.35, speed: r(7.8, 8.4) })
    this.z = off('WR', -14, -1.5, { number: 11, anim: 'Stance', route: route([[-14, -1.5], [-14.5, 60]]), routeStart: 0.35, speed: r(7.9, 8.5) })
    const outDepth = r(2.5, 4.5)
    this.slot = off('WR', 9, -1.5, { number: 13, anim: 'Stance', route: route([[9, -1.5], [9, outDepth], [23, outDepth + 0.8]]), routeStart: 0.35, speed: 7.8 })

    // offensive "hot" adjustment: if the defense shows blitz, keep the back and tight end in to protect
    this.maxProtect = this.coverage.shown === 'blitz' && !isRun
    if (this.maxProtect) {
      this.rb.routeStart = 99
      this.te.routeStart = 99
    }

    // ------------------------------------------------ defense (aligned to what they *show*)
    const align = ALIGN[this.coverage.shown]
    const D = {}
    const dlNumbers = [93, 97, 91, 99]
    ;[[-0.9, 1.1], [0.9, 1.1], [-3.8, 1.1], [3.8, 1.1]].forEach(([x, dz], i) => {
      D[`DL${i}`] = def('DL', x, dz, { number: dlNumbers[i], anim: 'Stance', speed: r(5.6, 6.4), shed: (isRun ? r(2.1, 3.3) : r(1.1, 3.2)) - difficulty * 0.12 })
    })
    D.MLB = def('LB', ...align.MLB, { number: 54, anim: 'Idle', speed: r(6.9, 7.6) })
    D.SLB = def('LB', ...align.SLB, { number: 50, anim: 'Idle', speed: r(6.8, 7.5) })
    D.WLB = def('LB', ...align.WLB, { number: 52, anim: 'Idle', speed: r(6.8, 7.5) })
    D.CBX = def('CB', ...align.CBX, { number: 24, anim: 'Idle', speed: r(7.8, 8.6) })
    D.CBZ = def('CB', ...align.CBZ, { number: 21, anim: 'Idle', speed: r(7.8, 8.6) })
    D.SS = def('S', ...align.SS, { number: 31, anim: 'Idle', speed: r(7.5, 8.3) })
    D.FS = def('S', ...align.FS, { number: 29, anim: 'Idle', speed: r(7.7, 8.5) })
    for (const p of Object.values(D)) {
      p.react = r(0.12, 0.42) - difficulty * 0.03 // how fast they read the play / the throw
      if (isRun && p.role !== 'DL') p.react += r(0.25, 0.9) // the play fake freezes the second level
      p.tackle = r(0.72, 0.9) + difficulty * 0.02
      p.blanket = this.rng() < 0.33 + difficulty * 0.05 // sometimes the defender just wins the rep
      p.zoneW = r(0.25, 0.6) // how tightly a zone defender squeezes receivers (eyes in the backfield vs. on his man)
    }
    this.D = D
    this.assignDefense(this.coverage.call)
    this.applyKey(this.coverage.key)

    if (this.play.type === 'pass') this.target = this[this.play.target]

    this.ball = {
      pos: new THREE.Vector3(0, 0.15, this.los),
      dir: new THREE.Vector3(0, 0, 1),
      state: 'ground', // ground | snap | held | air | loose | dead
      holder: null,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      t0: 0,
      t1: 0,
      arc: 0,
      vel: new THREE.Vector3(),
    }
  }

  /** What each defender actually does once the ball is snapped. */
  assignDefense(call) {
    const { D, los } = this
    const zone = (x, dz, deep = false, range = 13) => ({ type: 'zone', spot: V(x, Math.min(END_LINE, los + dz)), deep, range })
    const man = (target, press = false) => ({ type: 'man', target, press })
    const rush = { type: 'rush' }
    for (let i = 0; i < 4; i++) D[`DL${i}`].assign = rush
    const A = {
      cover1: { CBX: man(this.x, true), CBZ: man(this.z, true), SS: man(this.slot), SLB: man(this.rb), WLB: man(this.te), MLB: zone(0, 4), FS: zone(0, 17, true, 20) },
      cover2: { CBX: zone(18, 5), CBZ: zone(-17, 5), SS: zone(12, 19, true, 17), FS: zone(-12, 19, true, 17), MLB: zone(0, 9), SLB: zone(7, 8), WLB: zone(-7, 8) },
      cover3: { CBX: zone(16, 17, true), CBZ: zone(-15, 17, true), FS: zone(0, 19, true, 20), SS: zone(12, 6), SLB: zone(5, 8), MLB: zone(-1, 8), WLB: zone(-11, 6) },
      blitz: { CBX: man(this.x, true), CBZ: man(this.z, true), SS: man(this.slot, true), FS: man(this.te), SLB: man(this.rb), MLB: rush, WLB: rush },
      prevent: { CBX: zone(17, 22, true), CBZ: zone(-16, 22, true), SS: zone(7, 28, true), FS: zone(-7, 28, true), MLB: zone(0, 12), SLB: zone(10, 10), WLB: zone(-10, 10) },
    }[call]
    for (const [k, a] of Object.entries(A)) D[k].assign = a
    if (call === 'prevent') D.DL3.assign = zone(5, 5) // three-man rush, edge drops
    for (const p of Object.values(D)) if (p.assign.type === 'rush' && p.role === 'LB') p.blitzer = true
  }

  /**
   * The defense is keying on a play it expects (from tendencies, or a human defender's guess).
   * Guess right: quicker reads, tighter coverage, and someone sits right where that play goes.
   * Guess wrong: they're cheating out of position and a step slow.
   */
  applyKey(key) {
    this.key = key && key.s > 0 ? key : null
    if (!this.key) return
    const { D } = this
    const s = this.key.s
    const hit = this.key.play === this.play.id
    for (const p of Object.values(D)) {
      if (hit) {
        p.react = Math.max(0.04, p.react - 0.2 * s)
        if (this.rng() < 0.35 * s) p.blanket = true
      } else p.react += 0.12 * s
    }
    const zoneAt = (k, x, dz, deep = false) => {
      const a = D[k].assign
      if (a.type !== 'zone') return false
      a.spot.set(x, 0, Math.min(END_LINE, this.los + dz))
      a.deep = deep
      return true
    }
    switch (this.key.play) {
      case 'out': // sit on the flat to the slot side
        if (!zoneAt('CBX', 17.5, 4) && !zoneAt('SS', 16, 4)) D.SS.blanket = true
        break
      case 'dig': // a robber in the dig window over the middle
        if (!zoneAt('MLB', 4, 12)) zoneAt('FS', 4, 13)
        zoneAt('SLB', 9, 11)
        D.CBX.blanket = true
        break
      case 'deep': // everybody deeper, help over the top to the go side
        zoneAt('FS', -10, 22, true) || zoneAt('SS', -9, 22, true)
        if (D.CBZ.assign.type === 'man') D.CBZ.blanket = true
        else zoneAt('CBZ', -15, 21, true)
        break
      case 'run': // load the box, no play-fake freeze, linemen fight off blocks
        zoneAt('SS', 2, 5)
        zoneAt('MLB', -0.5, 3.5)
        for (const p of Object.values(D)) {
          if (p.role === 'LB' && hit) p.react = 0.05
          if (p.role === 'DL') p.shed -= 0.6 * s
        }
        break
      default:
    }
  }

  add(team, role, x, z, yaw, extra) {
    const p = {
      id: this.players.length,
      team,
      role,
      pos: V(x, z),
      start: V(x, z),
      vel: new THREE.Vector3(),
      yaw,
      face: null, // point to look at (overrides velocity facing)
      anim: 'Idle',
      animScale: 1,
      locked: false, // true while a one-shot owns the animation
      down: false,
      react: 0,
      cutBias: 0,
      blocker: null, // for defenders: the offensive player engaged with him
      shedAt: Infinity, // when the defender gets off the block
      blocking: null, // for offense: the defender being blocked
      ...extra,
    }
    this.players.push(p)
    return p
  }

  emit(type, data = {}) {
    this.events.push({ type, t: this.t, ...data })
  }

  snap() {
    if (this.phase !== 'presnap') return
    this.phase = 'live'
    this.t = 0
    const b = this.ball
    b.state = 'snap'
    b.from.copy(b.pos)
    b.t0 = 0
    b.t1 = SNAP_TIME
    b.arc = 0.4
    this.setupProtection()
    this.emit('snap')
  }

  /** Pair blockers with rushers inside-out; extra rushers come free. */
  setupProtection() {
    const rushers = this.players.filter((p) => p.team === 'def' && p.assign?.type === 'rush')
    const blockers = this.players.filter((p) => p.role === 'OL' || p.role === 'C')
    if (this.maxProtect || this.play.type === 'run') blockers.push(this.te)
    if (this.maxProtect) blockers.push(this.rb)
    rushers.sort((a, b) => Math.abs(a.start.x) - Math.abs(b.start.x))
    const free = [...blockers]
    for (const d of rushers) {
      let best = null
      let bd = Infinity
      for (const o of free) {
        const dd = Math.abs(o.start.x - d.start.x) + (o.role === 'RB' ? 2 : 0)
        if (dd < bd) {
          bd = dd
          best = o
        }
      }
      if (!best || bd > 6) continue
      free.splice(free.indexOf(best), 1)
      best.blocking = d
      d.blocker = best
      d.shedAt = d.role === 'DL' ? d.shed : this.r(1.1, 1.9) // a picked-up blitzer is stonewalled for a moment
    }
  }

  // ------------------------------------------------------------------ steering
  look(p, dx, dz) {
    p.lookPt ??= new THREE.Vector3()
    p.face = p.lookPt.set(p.pos.x + dx, 0, p.pos.z + dz)
  }

  steer(p, target, maxSpeed, dt, accel = 22) {
    if (this.isEngaged(p)) maxSpeed = Math.min(maxSpeed, 0.9)
    tmp.subVectors(target, p.pos)
    tmp.y = 0
    const dist = tmp.length()
    const want = Math.min(maxSpeed, dist * 3)
    if (dist > 1e-4) tmp.multiplyScalar(want / dist)
    else tmp.set(0, 0, 0)
    tmp2.subVectors(tmp, p.vel)
    const dv = tmp2.length()
    const maxDv = accel * dt
    if (dv > maxDv) tmp2.multiplyScalar(maxDv / dv)
    p.vel.add(tmp2)
    p.pos.addScaledVector(p.vel, dt)
  }

  brake(p, dt, rate = 10) {
    p.vel.multiplyScalar(Math.max(0, 1 - rate * dt))
    p.pos.addScaledVector(p.vel, dt)
  }

  /** A defender is held up while his blocker is on him and he hasn't shed yet. */
  isEngaged(p) {
    const b = p.blocker
    return !!b && !b.down && this.t < p.shedAt && b.pos.distanceTo(p.pos) < 1.3
  }

  followRoute(p, dt) {
    const prev = tmp2.copy(p.pos)
    alongRoute(p.route, routeDistance(this.t - p.routeStart, p.speed), p.pos)
    p.vel.subVectors(p.pos, prev).divideScalar(Math.max(dt, 1e-4))
  }

  routePosAt(p, t, out) {
    return alongRoute(p.route, routeDistance(t - p.routeStart, p.speed), out)
  }

  oneShot(p, clip) {
    p.anim = clip
    p.animScale = 1
    p.locked = true
    p.lockedAt = this.t
  }

  /** Intercept angle: aim where the carrier will be when we can get there. */
  pursue(p, speed, dt) {
    const c = this.carrier
    if (this.t < this.catchTime + p.react) {
      this.brake(p, dt, 4)
      p.face = c.pos
      return
    }
    let tt = 0
    for (; tt < 2.5; tt += 0.1) {
      tmp3.copy(c.pos).addScaledVector(c.vel, tt)
      if (tmp3.distanceTo(p.pos) <= speed * tt + 0.8) break
    }
    tmp3.copy(c.pos).addScaledVector(c.vel, Math.min(tt, 1.6))
    tmp3.x = THREE.MathUtils.clamp(tmp3.x, -SIDELINE - 1, SIDELINE + 1)
    this.steer(p, tmp3, speed, dt)
    p.hold = this.isEngaged(p) ? 'Block' : null
    p.face = null
  }

  // ------------------------------------------------------------------ main step
  step(dt) {
    if (this.phase === 'presnap') return
    this.t += dt
    const t = this.t

    for (const p of this.players) {
      if (p.down) {
        this.brake(p, dt, 5)
        continue
      }
      if (this.phase === 'dead' || this.phase === 'over') {
        this.brake(p, dt, 4)
        const focus = this.carrier ?? this.interceptor ?? this.target
        p.face = focus && p !== focus ? focus.pos : null
        continue
      }
      if (p.team === 'def') this.actDefense(p, t, dt)
      else this[`act_${p.role}`]?.(p, t, dt)
    }
    // short position history so man defenders react to breaks a beat late, like humans
    for (const p of this.players) {
      if (p.team !== 'off') continue
      p.hist ??= []
      p.hist.push(p.pos.x, p.pos.z)
      if (p.hist.length > 80) p.hist.splice(0, 2)
    }

    this.separate()
    this.updateBall(t, dt)
    if (this.phase === 'live') {
      this.checkPressure(t)
      this.checkTackle(t)
      this.checkBoundaries(t)
    }
    this.updateFall(t)

    if (this.phase === 'dead' && t > this.deadTime + 1.1) this.finish()

    for (const p of this.players) this.pickAnim(p, dt)
  }

  finish() {
    this.phase = 'over'
    const good = this.result?.good
    const focus = this.carrier ?? this.interceptor ?? this.target
    for (const p of this.players) {
      if (p.down) continue
      p.locked = false
      p.face = focus && p !== focus ? focus.pos : null
      const skill = p.role !== 'OL' && p.role !== 'C'
      if (p.team === 'off') p.anim = good && skill ? 'Celebrate' : 'Idle'
      else p.anim = !good && isDefBack(p) ? 'Celebrate' : 'Idle'
    }
  }

  /** Push overlapping players apart (except the tackler on the ball carrier). */
  separate() {
    const ps = this.players
    const R = 0.85
    // route runners are on rails until the ball is caught, so the other player gives way
    const weight = (p) => (p.route && this.t >= p.routeStart && !this.carrier ? 0 : 1)
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]
        const b = ps[j]
        if ((a === this.tackler && b === this.carrier) || (b === this.tackler && a === this.carrier)) continue
        const dx = b.pos.x - a.pos.x
        const dz = b.pos.z - a.pos.z
        const d2 = dx * dx + dz * dz
        if (d2 >= R * R || d2 < 1e-8) continue
        const d = Math.sqrt(d2)
        const aw = weight(a)
        const bw = weight(b)
        if (aw + bw === 0) continue
        const push = (R - d) / d / (aw + bw)
        a.pos.x -= dx * push * aw
        a.pos.z -= dz * push * aw
        b.pos.x += dx * push * bw
        b.pos.z += dz * push * bw
      }
    }
  }

  pickAnim(p, dt) {
    const speed = Math.hypot(p.vel.x, p.vel.z)
    let yawTarget = p.yaw
    if (p.face) yawTarget = Math.atan2(p.face.x - p.pos.x, p.face.z - p.pos.z)
    else if (speed > 0.4) yawTarget = Math.atan2(p.vel.x, p.vel.z)
    p.yaw = angleLerp(p.yaw, yawTarget, Math.min(1, dt * 10))

    if (p.locked || this.phase === 'over') return
    if (p.hold) {
      p.anim = p.hold
      p.animScale = 1
      return
    }
    if (speed > 0.6) {
      const forward = Math.sin(p.yaw) * p.vel.x + Math.cos(p.yaw) * p.vel.z
      p.anim = 'Run'
      p.animScale = THREE.MathUtils.clamp(speed / 6.5, 0.55, 1.45) * (forward < -0.3 * speed ? -1 : 1)
    } else {
      p.anim = 'Idle'
      p.animScale = 1
    }
  }

  // ------------------------------------------------------------------ offense
  act_C(p, t, dt) {
    this.act_OL(p, t, dt)
  }

  act_OL(p, t, dt) {
    if (this.carrier && this.play.type !== 'run') return this.blockDownfield(p, t, dt, 3.5)
    if (this.play.type === 'run') return this.runBlock(p, t, dt)
    this.passBlock(p, t, dt)
  }

  /** Stay between your man and the quarterback, giving ground slowly. */
  passBlock(p, t, dt) {
    p.hold = 'Block'
    const d = p.blocking
    if (d && !d.down) {
      tmp.subVectors(this.qb.pos, d.pos).setY(0).normalize().multiplyScalar(0.95).add(d.pos)
      tmp.z = Math.min(tmp.z, this.los - 0.4)
      this.steer(p, tmp, 4.6, dt, 26)
      p.face = d.pos
    } else {
      // no man: sit in the pocket
      tmp.copy(p.start).setZ(p.start.z - Math.min(1.4, t * 1.2))
      this.steer(p, tmp, 2.5, dt)
      this.look(p, 0, 5)
    }
  }

  /** Run blocking: drive your man off the ball and away from the hole. */
  runBlock(p, t, dt) {
    if (this.carrier && this.carrier.pos.z > this.los + 2) return this.blockDownfield(p, t, dt, 3.5)
    p.hold = 'Block'
    const d = p.blocking
    if (d && !d.down) {
      const away = Math.sign(d.pos.x - HOLE_X || p.start.x - HOLE_X || 1)
      tmp.copy(d.pos).add(tmp2.set(-away * 0.35, 0, -0.75))
      this.steer(p, tmp, 4.4, dt, 26)
      p.face = d.pos
    } else {
      // nobody on me: climb to the second level and wall off a linebacker
      let lb = null
      let ld = 9
      for (const d of this.players) {
        if (d.role !== 'LB' || d.down || (d.blocker && d.blocker.blocking === d)) continue
        const dd = d.pos.distanceTo(p.pos)
        if (dd < ld) (ld = dd), (lb = d)
      }
      if (lb && t > SNAP_TIME + 0.2) {
        p.blocking = lb
        lb.blocker = p
        lb.shedAt = t + this.r(0.7, 1.5)
        return
      }
      tmp.copy(p.start).setZ(p.start.z + Math.min(1.6, t * 1.5))
      if (Math.abs(p.start.x - HOLE_X) < 1.7) tmp.x += Math.sign(p.start.x - HOLE_X) * Math.min(0.9, t * 1.2)
      this.steer(p, tmp, 2.5, dt)
      this.look(p, 0, 5)
    }
  }

  /** After the catch: find the most dangerous unblocked defender near the ball and get in his way. */
  blockDownfield(p, t, dt, speed) {
    const c = this.carrier
    if (!p.blocking || p.blocking.down || p.blocking.pos.distanceTo(c.pos) > 9) {
      let best = null
      let score = Infinity
      for (const d of this.players) {
        if (d.team !== 'def' || d.down || (d.blocker && d.blocker !== p && !d.blocker.down && d.blocker.blocking === d)) continue
        const toBall = d.pos.distanceTo(c.pos)
        const toMe = d.pos.distanceTo(p.pos)
        if (toBall > 9 || toMe > 7) continue
        const s = toBall + toMe * 0.6
        if (s < score) {
          score = s
          best = d
        }
      }
      if (p.blocking && p.blocking.blocker === p) p.blocking.blocker = null
      p.blocking = best
      if (best) {
        best.blocker = p
        best.shedAt = t + this.r(0.45, 1.2)
      }
    }
    const d = p.blocking
    if (d) {
      tmp.subVectors(c.pos, d.pos).setY(0).normalize().multiplyScalar(0.9).add(d.pos)
      this.steer(p, tmp, speed + 2.5, dt, 20)
      p.hold = d.pos.distanceTo(p.pos) < 1.4 ? 'Block' : null
      p.face = p.hold ? d.pos : null
    } else {
      tmp.copy(c.pos).add(tmp2.set(p.start.x > c.pos.x ? 3 : -3, 0, -1))
      this.steer(p, tmp, speed, dt)
      p.hold = null
      p.face = null
    }
  }

  act_QB(p, t, dt) {
    const b = this.ball
    if (t < SNAP_TIME) return this.look(p, 0, 20)

    if (this.play.type === 'run') {
      if (b.holder === p) {
        this.steer(p, tmp.set(0.3, 0, this.los - 4.9), 2, dt)
        p.face = this.rb.pos
        const meshReady = t >= SNAP_TIME + 0.45 && this.rb.pos.distanceTo(p.pos) < 1.6
        if (meshReady || t >= SNAP_TIME + 0.8) this.handoff(t)
        return
      }
      this.steer(p, tmp.set(5, 0, this.los - 7), 4.5, dt) // carry out the fake
      return
    }

    if (b.holder !== p && p.threw) {
      this.brake(p, dt)
      if (p.locked && t > p.lockedAt + 1.25) p.locked = false
      return
    }
    const dropEnd = 0.45 + this.play.drop * 0.11
    if (!p.threw && t < Math.min(dropEnd, this.throwAt)) {
      this.steer(p, tmp.set(0, 0, this.los - this.play.drop), 4.4, dt)
      return this.look(p, 0, 20)
    }
    if (!this.aim) this.planThrow(Math.max(t, this.throwAt))
    if (t < this.throwAt) {
      this.brake(p, dt)
      p.face = this.aim.point
      return
    }
    if (!p.threw) {
      p.threw = true
      this.oneShot(p, 'Throw')
      if (this.throwAt < t - 0.05) this.planThrow(t) // late start: re-aim for the real release
    }
    this.brake(p, dt)
    p.face = this.aim.point
    if (b.state === 'held' && b.holder === p && t >= this.aim.release) this.release(t)
    if (p.locked && t > p.lockedAt + 1.25) p.locked = false
  }

  act_WR(p, t, dt) {
    if (p === this.carrier) return this.actCarrier(p, t, dt)
    if (this.carrier) return this.blockDownfield(p, t, dt, 5)
    if (t < p.routeStart) {
      p.hold = 'Stance'
      return
    }
    p.hold = null
    p.face = null
    if (p === this.target && this.aim && this.ball.state === 'air' && t >= this.aim.time - 0.22 && !p.catching) {
      p.catching = true
      this.oneShot(p, 'Catch')
    }
    if (p.locked && t > p.lockedAt + 0.8) p.locked = false
    this.followRoute(p, dt)
  }

  act_TE(p, t, dt) {
    if (p === this.carrier) return this.actCarrier(p, t, dt)
    if (this.carrier) return this.blockDownfield(p, t, dt, 5)
    if (t < p.routeStart) {
      if (this.play.type === 'run') return this.runBlock(p, t, dt)
      if (p.blocking) return this.passBlock(p, t, dt)
      p.hold = 'Block'
      return
    }
    this.act_WR(p, t, dt)
  }

  act_RB(p, t, dt) {
    if (p === this.carrier) return this.actCarrier(p, t, dt)
    if (this.carrier) return this.blockDownfield(p, t, dt, 5)
    if (t < p.routeStart) {
      if (p.blocking && t > SNAP_TIME) return this.passBlock(p, t, dt)
      p.hold = t < SNAP_TIME ? 'Stance' : 'Block'
      return
    }
    this.act_WR(p, t, dt)
  }

  /** Ball carrier: score a fan of directions for open space and progress, then go. */
  actCarrier(p, t, dt) {
    if (p.locked && t > p.lockedAt + 0.62) p.locked = false
    const since = t - this.catchTime
    p.face = null
    // the back hits the A gap first
    if (p === this.rb && this.play.type === 'run' && p.pos.z < this.los + 0.5) {
      this.steer(p, tmp.set(HOLE_X, 0, this.los + 2), 7.4, dt, 20)
      return
    }
    const clock = this.situation.clock ?? 120
    const nearSideline = Math.abs(p.pos.x) > SIDELINE - 7
    if ((this.play.toSideline && since > 0.3) || (clock < 25 && nearSideline && since > 0.3)) {
      // get what you can, then step out to stop the clock
      this.steer(p, tmp.set(Math.sign(p.pos.x) * (SIDELINE + 3), 0, p.pos.z + p.cutBias * 3 + 1.2), 6.5, dt, 14)
      return
    }
    let bestScore = -Infinity
    let bestAngle = 0
    const curAngle = Math.atan2(p.vel.x, Math.max(0.1, p.vel.z))
    for (let a = -1.4; a <= 1.4001; a += 0.2) {
      const dx = Math.sin(a)
      const dz = Math.cos(a)
      const px = p.pos.x + dx * 4
      const pz = p.pos.z + dz * 4
      let clearance = 8
      for (const d of this.players) {
        if (d.team !== 'def' || d.down) continue
        const ex = d.pos.x + d.vel.x * 0.35
        const ez = d.pos.z + d.vel.z * 0.35
        let dd = Math.hypot(ex - px, ez - pz)
        if (this.isEngaged(d)) dd += 2.5
        clearance = Math.min(clearance, dd)
      }
      let s = dz * 1.6 + clearance * 0.55 - Math.abs(a - curAngle) * 0.35 + p.cutBias * dx * 0.3
      if (Math.abs(px) > SIDELINE - 1) s -= 4
      if (s > bestScore) {
        bestScore = s
        bestAngle = a
      }
    }
    tmp.set(Math.sin(bestAngle), 0, Math.cos(bestAngle)).multiplyScalar(6).add(p.pos)
    const speed = p === this.rb ? 7.2 : since < 0.4 ? 4.8 : 7.3
    this.steer(p, tmp, speed, dt, 16)
  }

  // ------------------------------------------------------------------ defense
  actDefense(p, t, dt) {
    const a = p.assign
    p.hold = null
    if (this.carrier) {
      // run fits: blocked defenders stay engaged until they shed, then everyone pursues
      if (this.isEngaged(p)) {
        p.hold = 'Block'
        this.steer(p, this.carrier.pos, 1, dt)
        return
      }
      return this.pursue(p, p.speed + (p.role === 'DL' ? 0 : 0.4), dt)
    }
    if (t < SNAP_TIME * 0.6) return

    if (a.type === 'rush') return this.rushQB(p, t, dt)

    // after the throw: break on the ball
    const b = this.ball
    const ballRange = a.type === 'man' ? 40 : a.deep ? 22 : 16
    const readDelay = p.react + (a.type === 'zone' && !p.blanket ? 0.25 : 0)
    if (b.state === 'air' && this.aim && t > b.t0 + readDelay && p.pos.distanceTo(this.aim.point) < ballRange) {
      this.steer(p, this.aim.point, p.speed + 0.4, dt, 26)
      p.face = null
      return
    }

    if (a.type === 'man') {
      const r = a.target
      if (t < 0.25 + p.react * 0.4) return
      // read the receiver a beat late and extrapolate: stays with straight lines, overruns sharp breaks
      const lagT = p.blanket ? 0.03 : a.press ? 0.1 + p.react * 0.25 : 0.12 + p.react * 0.35
      const lag = Math.min((r.hist?.length ?? 0) / 2 - 2, Math.round(lagT / dt))
      let vx = 0
      let vz = 0
      if (lag > 0) {
        const h = r.hist
        const i = h.length - 2 - lag * 2
        vx = (h[i] - h[i - 2]) / dt
        vz = (h[i + 1] - h[i - 1]) / dt
        tmp.set(h[i] + vx * lagT, 0, h[i + 1] + vz * lagT)
      } else tmp.copy(r.pos)
      const v = Math.hypot(vx, vz)
      if (r.routeStart > 50) tmp.z += 3 // his man stayed in to block: sit underneath
      else if (v > 2) {
        // hip pocket: just behind him along his path, shaded to the inside
        const back = p.blanket ? 0.35 : 0.75
        tmp.x -= (vx / v) * back
        tmp.z -= (vz / v) * back
        tmp.x += r.pos.x > 0 ? -0.3 : 0.3
      } else tmp.z += a.press ? 0.9 : 1.6 // pre-snap / at the stem: cushion
      this.steer(p, tmp, p.speed + (p.blanket ? 0.5 : 0), dt, a.press || p.blanket ? 20 : 16)
      p.face = t < 1.0 ? this.qb.pos : null
      return
    }

    // zone: drop to the landmark, then squeeze the most dangerous receiver in your area
    const spot = a.spot
    let threat = null
    let td = Infinity
    for (const o of this.players) {
      if (o.team !== 'off' || !o.route || o.routeStart > 50 || t < o.routeStart) continue
      const d = o.pos.distanceTo(spot)
      const deeperThanMe = o.pos.z > p.pos.z - 2
      if ((a.deep ? deeperThanMe && d < (a.range ?? 13) : d < 7.5) && d < td) {
        td = d
        threat = o
      }
    }
    tmp.copy(spot)
    if (threat) {
      const w = a.deep ? (p.blanket ? 0.8 : p.zoneW) : THREE.MathUtils.clamp(1 - td / 7.5, 0, 1) * 0.85
      tmp2.copy(threat.pos)
      tmp2.z += a.deep ? 2.5 : 0.8
      tmp.lerp(tmp2, w)
      // disciplined deep defenders stay over the top; the rest can get caught flat-footed
      if (a.deep) tmp.z = Math.max(tmp.z, threat.pos.z + (p.blanket ? 1.5 : -1.5))
    }
    tmp.z = Math.min(tmp.z, END_LINE)
    this.steer(p, tmp, a.deep ? p.speed : p.speed - 0.7, dt, 16)
    p.face = this.qb.pos
  }

  rushQB(p, t, dt) {
    if (this.play.type === 'run' && this.isEngaged(p)) {
      p.hold = 'Block'
      tmp.copy(p.pos).add(tmp2.set(Math.sign(p.pos.x - HOLE_X || 1) * 0.8, 0, 0.5)) // getting driven back and out of the hole
      this.steer(p, tmp, 1, dt)
      this.look(p, 0, -5)
      return
    }
    const qb = this.qb
    tmp.copy(qb.pos)
    // edge rushers loop around the corner instead of running into the pile
    if (p.blocker && Math.abs(p.start.x) > 3 && p.pos.z > qb.pos.z + 2) tmp.x += Math.sign(p.start.x) * 2.2
    // a free rusher (nobody picked him up) shoots the gap beside the pile, then closes on the quarterback
    const free = !p.blocker
    if (free && p.pos.z > this.los - 2) tmp.set(Math.sign(p.start.x || 1) * 2.5, 0, this.los - 3)
    const engaged = this.isEngaged(p)
    this.steer(p, tmp, engaged ? 0.9 : p.speed + (free ? 0.5 : 0), dt, free ? 24 : 18)
    p.hold = engaged ? 'Block' : null
    p.face = engaged ? qb.pos : null
  }

  // ------------------------------------------------------------------ ball
  handoff(t) {
    this.ball.holder = this.rb
    this.carrier = this.rb
    this.catchTime = t
    this.rb.cutBias = (this.rng() - 0.5) * 0.6
    this.message = 'Handoff!'
    this.emit('handoff')
  }

  /** Lead the receiver: iterate to where he'll be when the ball gets there. */
  planThrow(throwStart) {
    const release = tmp.set(this.qb.pos.x, 1.6, this.qb.pos.z)
    const tr = throwStart + THROW_RELEASE
    let ta = tr + 1
    const point = new THREE.Vector3()
    for (let i = 0; i < 6; i++) {
      this.routePosAt(this.target, ta, point)
      const dist = release.distanceTo(point)
      ta = tr + dist / ballSpeed(dist)
    }
    this.routePosAt(this.target, ta, point)
    this.aim = { time: ta, point, release: tr }
    this.throwAt = throwStart
  }

  release(t) {
    const b = this.ball
    b.state = 'air'
    b.holder = null
    b.from.copy(b.pos)
    b.to.copy(this.aim.point).setY(1.25)
    b.t0 = t
    b.t1 = this.aim.time
    b.arc = Math.max(0.6, b.from.distanceTo(b.to) * 0.09)
    this.emit('throw')
  }

  /** Rushers closing in: hurry the throw, or bring the quarterback down. */
  checkPressure(t) {
    const qb = this.qb
    if (this.play.type !== 'pass' || this.ball.holder !== qb || t < SNAP_TIME) return
    let nearest = Infinity
    let who = null
    for (const d of this.players) {
      if (d.team !== 'def' || d.down || this.isEngaged(d)) continue
      const dd = d.pos.distanceTo(qb.pos)
      if (dd < nearest) {
        nearest = dd
        who = d
      }
    }
    // only a ball that's basically out escapes the sack
    if (nearest < 1.0 && !(qb.threw && t > this.aim.release - 0.1)) return this.sack(t, who)
    // feel the rush: a free rusher less than ~0.6s away forces a hurried throw after a beat
    if (!qb.threw && !this.hurried && t > 0.7 && nearest / who.speed < 0.6 && t + qb.feel < this.throwAt) {
      this.hurried = true
      this.message = 'Under pressure!'
      this.planThrow(t + qb.feel)
    }
  }

  sack(t, d) {
    const qb = this.qb
    this.oneShot(d, 'Dive')
    d.down = true
    d.yaw = Math.atan2(qb.pos.x - d.pos.x, qb.pos.z - d.pos.z)
    d.vel.set(Math.sin(d.yaw), 0, Math.cos(d.yaw)).multiplyScalar(3)
    this.tackler = d
    this.carrier = qb
    this.catchTime = t
    this.phase = 'dead'
    this.deadTime = t
    this.tackleTime = t
    qb.pendingFall = t + 0.18
    const gain = Math.round(qb.pos.z - this.los)
    this.result = { good: false, kind: 'sack', gain, first: false, spot: qb.pos.z, elapsed: t }
    this.message = `SACKED by #${d.number} for ${gain} yards`
    this.emit('sack', { by: d.number })
  }

  updateBall(t, dt) {
    const b = this.ball
    if (b.state === 'snap' || b.state === 'air') {
      if (b.state === 'snap') b.to.set(this.qb.pos.x, 1.0, this.qb.pos.z + 0.3)
      const u = THREE.MathUtils.clamp((t - b.t0) / (b.t1 - b.t0), 0, 1)
      const prev = tmp.copy(b.pos)
      b.pos.lerpVectors(b.from, b.to, u)
      b.pos.y += 4 * b.arc * u * (1 - u)
      if (b.pos.distanceToSquared(prev) > 1e-8) b.dir.subVectors(b.pos, prev).normalize()
      if (u >= 1) {
        if (b.state === 'snap') {
          b.state = 'held'
          b.holder = this.qb
        } else this.arrive(t)
      }
    } else if (b.state === 'loose') {
      // deflected ball tumbles to the turf
      b.vel.y -= 25 * dt
      b.pos.addScaledVector(b.vel, dt)
      if (b.pos.y < 0.12) {
        b.pos.y = 0.12
        b.vel.multiplyScalar(0.4)
        b.vel.y = Math.abs(b.vel.y) * 0.3
      }
    }
    // held / dead: PlayScene snaps the ball to the holder's glove after animation.
  }

  /** Ball reaches the receiver: overthrow, interception, breakup, or catch. */
  arrive(t) {
    const b = this.ball
    const r = this.target
    let nd = Infinity
    let cover = null
    for (const d of this.players) {
      if (d.team !== 'def' || d.down) continue
      const dd = Math.min(d.pos.distanceTo(r.pos), d.pos.distanceTo(this.aim.point))
      if (dd < nd) {
        nd = dd
        cover = d
      }
    }
    const deep = this.play.id === 'deep'
    const incomplete = (msg) => {
      b.state = 'loose'
      b.holder = null
      this.phase = 'dead'
      this.deadTime = t
      this.result = { good: false, kind: 'incomplete', gain: 0, first: false, spot: this.los, elapsed: t }
      this.message = msg
      this.emit('incomplete')
    }
    const overthrow = 0.06 + (this.hurried ? 0.16 : 0) + (deep ? 0.07 : 0)
    if (this.rng() < overthrow) {
      b.vel.copy(b.dir).multiplyScalar(9).setY(1)
      return incomplete(this.hurried ? `Incomplete! Rushed throw sails past #${r.number}` : `Incomplete! Overthrown, just past #${r.number}`)
    }
    // a deep ball hangs, so defenders in the area get a real shot at it
    const reach = deep ? 2.8 : this.play.id === 'dig' ? 2.2 : 1.6
    const pInt = THREE.MathUtils.clamp((reach * 0.55 - nd) / (reach * 0.55), 0, 1) * (deep ? 0.3 : 0.28) * (this.hurried ? 1.4 : 1)
    const pBreak = THREE.MathUtils.clamp((reach - nd) / reach, 0, deep ? 0.65 : 0.55)
    const roll = this.rng()
    if (roll < pInt) {
      b.state = 'held'
      b.holder = cover
      this.interceptor = cover
      this.oneShot(cover, 'Catch')
      this.phase = 'dead'
      this.deadTime = t
      this.result = { good: false, kind: 'interception', gain: 0, first: false, spot: this.los, elapsed: t, by: cover.number }
      this.message = `INTERCEPTED by #${cover.number}!`
      this.emit('interception', { by: cover.number })
      return
    }
    if (roll < pInt + pBreak) {
      b.vel.set((this.rng() - 0.5) * 6, 4, -3)
      return incomplete(`Incomplete! Broken up by #${cover.number}`)
    }
    if (this.rng() < 0.07) {
      b.vel.set((this.rng() - 0.5) * 3, 3, 1.5)
      return incomplete(`Dropped! #${r.number} can't hang on`)
    }
    b.state = 'held'
    b.holder = r
    this.carrier = r
    this.catchTime = t
    r.cutBias = (this.rng() - 0.5) * 0.6
    this.message = nd < 2 ? 'Caught it in traffic!' : 'Caught it! Run!'
    this.emit('catch')
  }

  checkTackle(t) {
    const c = this.carrier
    if (!c || t < this.catchTime + 0.45) return
    for (const d of this.players) {
      if (d.team !== 'def' || d.locked || d.down || this.isEngaged(d)) continue
      const dist = d.pos.distanceTo(c.pos)
      if (dist >= 1.8) continue
      // from behind you need to be right on him to make the play
      tmp.copy(c.vel).setY(0)
      const fromBehind = tmp.lengthSq() > 4 && tmp.normalize().dot(tmp2.subVectors(c.pos, d.pos).setY(0).normalize()) > 0.6
      if (fromBehind && dist > 1.25) continue
      this.oneShot(d, 'Dive')
      d.down = true
      d.face = null
      d.yaw = Math.atan2(c.pos.x - d.pos.x, c.pos.z - d.pos.z)
      d.vel.set(Math.sin(d.yaw), 0, Math.cos(d.yaw)).multiplyScalar(4)
      // tackle odds: worse from behind, worse for big guys in space
      tmp.copy(c.vel).setY(0)
      const chasing = tmp.lengthSq() > 1 && tmp.normalize().dot(tmp2.subVectors(c.pos, d.pos).setY(0).normalize()) > 0.5
      const make = d.tackle - (chasing ? 0.14 : 0) - (d.role === 'DL' && c !== this.rb ? 0.1 : 0)
      if (this.rng() > make) {
        d.vel.multiplyScalar(0.6)
        d.yaw += (this.rng() - 0.5) * 0.9
        this.message = 'Broke a tackle!'
        c.cutBias = -c.cutBias || 0.3
        this.emit('brokenTackle')
        continue
      }
      this.tackler = d
      // a tackle right at the sideline usually knocks him out of bounds (and stops the clock)
      const atSideline = Math.abs(c.pos.x) > (this.play.toSideline ? 16 : SIDELINE - 1.5)
      this.endPlay(t, atSideline ? 'out' : 'tackle')
      c.pendingFall = t + 0.22
      this.emit(atSideline ? 'out' : 'tackle')
      return
    }
  }

  checkBoundaries(t) {
    const c = this.carrier
    if (!c || this.phase !== 'live') return
    if (c.pos.z >= GOAL_LINE) {
      this.endPlay(t, 'touchdown')
      this.emit('touchdown')
    } else if (Math.abs(c.pos.x) > SIDELINE) {
      this.endPlay(t, 'out')
      this.emit('out')
    }
  }

  endPlay(t, kind) {
    const c = this.carrier
    this.phase = 'dead'
    this.deadTime = t
    this.tackleTime = t
    const spot = kind === 'touchdown' ? GOAL_LINE : c.pos.z
    const gain = Math.round(spot - this.los)
    const first = spot >= this.firstDown
    this.result = { good: kind === 'touchdown' || first || gain >= 4, kind, gain, first, spot, elapsed: t }
    const how = this.play.type === 'run' ? `#${c.number} runs` : `Complete to #${c.number}`
    const yards = `${gain} yard${Math.abs(gain) === 1 ? '' : 's'}`
    if (kind === 'touchdown') this.message = `TOUCHDOWN! ${how} ${yards}`
    else this.message = `${how} for ${yards}${kind === 'out' ? ', out of bounds' : ''}${first ? ' — FIRST DOWN!' : ''}`
  }

  updateFall(t) {
    const c = this.carrier
    if (c && c.pendingFall && t >= c.pendingFall) {
      c.pendingFall = null
      c.down = true
      this.oneShot(c, 'Fall')
      this.ball.state = 'dead'
    }
  }
}

// Pre-snap alignments (x, depth past the line) for what the defense *shows*.
const ALIGN = {
  cover1: { MLB: [0, 5], SLB: [4.5, 5], WLB: [-4.5, 5], CBX: [17, 1.8], CBZ: [-14, 1.8], SS: [9, 5], FS: [0, 14] },
  cover2: { MLB: [0, 5], SLB: [4.5, 5], WLB: [-4.5, 5], CBX: [17.5, 4.5], CBZ: [-14.5, 4.5], SS: [9, 13], FS: [-9, 13] },
  cover3: { MLB: [0, 5], SLB: [4.5, 5], WLB: [-4.5, 5], CBX: [17, 7], CBZ: [-14, 7], SS: [10, 7], FS: [0, 14] },
  blitz: { MLB: [1.3, 2.4], SLB: [3.5, 4], WLB: [-1.6, 2.4], CBX: [17, 1.6], CBZ: [-14, 1.6], SS: [9, 3.5], FS: [-5, 5] },
  prevent: { MLB: [0, 8], SLB: [7, 8], WLB: [-7, 8], CBX: [17, 11], CBZ: [-14, 11], SS: [8, 20], FS: [-8, 20] },
}
