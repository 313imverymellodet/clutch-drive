import * as THREE from 'three'
import { THROW_RELEASE } from '../three/characters'

/*
 * Play simulation. Units are yards: x = sideline to sideline, z = downfield; offense drives toward +z.
 * The sim decides positions, facing and which clip each player is in; PlayScene draws it.
 * Stepped with a fixed dt and a seed, a play is fully repeatable, which is what makes instant replay work.
 */

export const LOS = -25 // default line of scrimmage: own 25 (z = yard line from own goal - 50)
export const FIRST_DOWN = LOS + 10
const END_LINE = 58.5 // keep routes inside the back of the end zone
export const FIXED_DT = 1 / 60
const SIDELINE = 26.2
const GOAL_LINE = 50

export const PLAYS = {
  out: { id: 'out', label: 'Quick Out', detail: 'Pass · slot to the sideline', type: 'pass', target: 'slot', throwAt: 1.35, toSideline: true },
  dig: { id: 'dig', label: 'Dig', detail: 'Pass · WR1 over the middle', type: 'pass', target: 'x', throwAt: 1.55 },
  deep: { id: 'deep', label: 'Deep Shot', detail: 'Pass · WR2 go route', type: 'pass', target: 'z', throwAt: 1.75 },
  run: { id: 'run', label: 'HB Dive', detail: 'Run · handoff up the gut', type: 'run' },
}

const V = (x, z) => new THREE.Vector3(x, 0, z)
const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()

const SNAP_TIME = 0.35
const DROP_END = 1.15
const BALL_SPEED = 17
const HOLE_X = -0.8 // the A gap the HB Dive aims for

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

export class PlaySim {
  constructor() {
    this.timeScale = 1 // < 1 for slow motion
    this.camMode = 'broadcast' // broadcast | close
    this.reset()
  }

  /** los: line of scrimmage in field z; toGo: yards for a first down (goal to go near the end zone). */
  reset({ play = 'dig', seed = 1, los = LOS, toGo = 10 } = {}) {
    this.los = los
    this.firstDown = Math.min(los + toGo, GOAL_LINE)
    this.play = PLAYS[play]
    this.seed = seed
    this.rng = mulberry32(seed)
    this.t = 0
    this.phase = 'presnap' // presnap | live | dead | over
    this.players = []
    this.message = null
    this.result = null
    this.catchTime = Infinity
    this.deadTime = Infinity
    this.tackleTime = Infinity
    this.carrier = null
    this.tackler = null
    this.aim = null
    this.target = null

    const r = (a, b) => a + (b - a) * this.rng()
    const route = (pts) => pts.map(([x, z]) => V(x, Math.min(END_LINE, this.los + z)))
    const off = (role, x, dz, extra = {}) => this.add('off', role, x, this.los + dz, 0, extra)
    const def = (role, x, dz, extra = {}) => this.add('def', role, x, this.los + dz, Math.PI, extra)
    const isRun = this.play.type === 'run'

    this.center = off('C', 0, -0.9, { number: 55, anim: 'Block' })
    off('OL', 1.6, -1.0, { number: 66, anim: 'Stance' })
    off('OL', -1.6, -1.0, { number: 67, anim: 'Stance' })
    off('OL', 3.2, -1.2, { number: 71, anim: 'Stance' })
    off('OL', -3.2, -1.2, { number: 75, anim: 'Stance' })
    this.qb = off('QB', 0, -5, { number: 8, anim: 'Idle' })
    this.rb = off('RB', 1.6, -5, {
      number: 22,
      anim: 'Stance',
      ...(isRun
        ? { route: route([[1.6, -5], [0.5, -4.4], [HOLE_X, -1.6], [HOLE_X, 4]]), routeStart: SNAP_TIME + 0.1, speed: 6.5 }
        : { route: route([[1.6, -5], [2.4, -3.5], [7, -1.5], [9, -1]]), routeStart: 0.9, speed: 6 }),
    })
    this.te = off('TE', -4.8, -1.3, { number: 87, anim: 'Stance', route: route([[-4.8, -1.3], [-4.8, 1.5], [3, 3.5], [10, 4]]), routeStart: isRun ? 99 : 0.55, speed: 6 })
    this.x = off('WR', 17, -1, { number: 18, anim: 'Stance', route: route([[17, -1], [17, 10], [15.5, 11.8], [4, 13], [-6, 13.5]]), routeStart: 0.35, speed: r(7.9, 8.5) })
    this.z = off('WR', -14, -1.5, { number: 11, anim: 'Stance', route: route([[-14, -1.5], [-14.5, 60]]), routeStart: 0.35, speed: r(8.2, 8.8) })
    const outDepth = r(2.5, 4.5)
    this.slot = off('WR', 9, -1.5, { number: 13, anim: 'Stance', route: route([[9, -1.5], [9, outDepth], [18, outDepth + 0.5]]), routeStart: 0.35, speed: 7.8 })

    for (const [x, n] of [[-0.9, 93], [0.9, 97], [-3.8, 91], [3.8, 99]]) def('DL', x, 1.1, { number: n, anim: 'Stance', react: r(0, 0.15) })
    // linebackers read run/pass; against the run that read costs them a beat
    const lbRead = () => (isRun ? r(0.2, 1.1) : r(0.05, 0.3))
    def('LB', 0, 5, { number: 54, anim: 'Idle', zone: V(-1, Math.min(END_LINE, this.los + 8)), react: lbRead(), speed: r(6.8, 7.6) })
    def('LB', 4.5, 5, { number: 50, anim: 'Idle', zone: V(8, Math.min(END_LINE, this.los + 7)), react: lbRead(), speed: r(6.8, 7.6) })
    def('LB', -4.5, 5, { number: 52, anim: 'Idle', zone: V(-8, Math.min(END_LINE, this.los + 7)), react: lbRead(), speed: r(6.8, 7.6) })
    this.cbX = def('CB', 17, 6.5, { number: 24, anim: 'Idle', man: this.x, cushion: r(0.3, 2.2), speed: r(7.3, 8.1), react: r(0.1, 0.35) })
    this.cbZ = def('CB', -14, 6.5, { number: 21, anim: 'Idle', man: this.z, cushion: r(0.6, 2.0), speed: r(7.8, 8.6), react: r(0.1, 0.35) })
    def('S', 9, 13, { number: 31, anim: 'Idle', zone: V(11, Math.min(END_LINE, this.los + 16)), react: r(0.1, 0.4), speed: r(7.6, 8.4) })
    def('S', -9, 13, { number: 29, anim: 'Idle', zone: V(-12, Math.min(END_LINE, this.los + 22)), react: r(0.1, 0.4), speed: r(7.6, 8.4) })

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
      ...extra,
    }
    this.players.push(p)
    return p
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
  }

  // ------------------------------------------------------------------ steering
  look(p, dx, dz) {
    p.lookPt ??= new THREE.Vector3()
    p.face = p.lookPt.set(p.pos.x + dx, 0, p.pos.z + dz)
  }

  steer(p, target, maxSpeed, dt, accel = 22) {
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

  pursue(p, speed, dt) {
    // defenders take a beat to read the play
    if (this.t < this.catchTime + p.react) {
      this.brake(p, dt, 4)
      p.face = this.carrier.pos
      return
    }
    const c = this.carrier
    const lead = Math.min(0.7, p.pos.distanceTo(c.pos) / speed)
    tmp.copy(c.pos).addScaledVector(c.vel, lead)
    this.steer(p, tmp, speed, dt)
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
        const focus = this.carrier ?? this.target
        p.face = focus && p !== focus ? focus.pos : null
        continue
      }
      this[`act_${p.role}`]?.(p, t, dt)
    }

    this.separate()
    this.updateBall(t, dt)
    if (this.phase === 'live') {
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
    const focus = this.carrier ?? this.target
    for (const p of this.players) {
      if (p.down) continue
      p.locked = false
      p.face = focus && p !== focus ? focus.pos : null
      const skill = p.role !== 'OL' && p.role !== 'C'
      if (p.team === 'off') p.anim = good && skill ? 'Celebrate' : 'Idle'
      else p.anim = !good && (p.role === 'CB' || p.role === 'S' || p.role === 'LB') ? 'Celebrate' : 'Idle'
    }
  }

  /** Push overlapping players apart (except the tackler on the ball carrier). */
  separate() {
    const ps = this.players
    const R = 0.85
    // route runners are on rails until they carry the ball, so the other player gives way
    const weight = (p) => (p.route && this.t >= p.routeStart && p !== this.carrier ? 0 : 1)
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

  // ------------------------------------------------------------------ roles
  act_C(p, t, dt) {
    this.act_OL(p, t, dt)
  }

  act_OL(p, t, dt) {
    const runPlay = this.play.type === 'run'
    if (this.carrier && !runPlay) {
      p.hold = null
      tmp.copy(p.start).setZ(p.start.z + 3)
      this.steer(p, tmp, 3, dt)
      return
    }
    p.hold = 'Block'
    // pass pro gives ground; run blocking drives forward and opens the A gap
    const drive = runPlay ? Math.min(1.6, t * 1.5) : -Math.min(1.2, t * 1.4)
    tmp.copy(p.start).setZ(p.start.z + drive)
    // linemen next to the hole wall their man off to the side
    if (runPlay && Math.abs(p.start.x - HOLE_X) < 1.7) tmp.x += Math.sign(p.start.x - HOLE_X) * Math.min(0.9, t * 1.2)
    tmp.x += Math.sin(t * 3 + p.id) * 0.2
    this.steer(p, tmp, 2.5, dt)
    this.look(p, 0, 5)
  }

  act_DL(p, t, dt) {
    const c = this.carrier
    const runPlay = this.play.type === 'run'
    if (c && (!runPlay || c.pos.z > this.los + 1.5 || t > this.catchTime + 1.3)) {
      p.hold = null
      this.pursue(p, 5.8, dt)
      return
    }
    p.hold = 'Block'
    let target = runPlay ? this.los + 1.1 - Math.min(0.9, t * 0.8) : this.los - Math.min(1.4, t * 1.2)
    tmp.copy(p.start)
    if (runPlay && Math.abs(p.start.x - HOLE_X) < 2.2) {
      // the man over the hole gets driven back and sideways
      tmp.x += Math.sign(p.start.x - HOLE_X || 1) * Math.min(1.7, t * 1.8)
      target = this.los + 1.1 + Math.min(1.0, t * 0.9)
    }
    tmp.setZ(target)
    tmp.x += Math.sin(t * 2.6 + p.id) * 0.3
    this.steer(p, tmp, 2.5, dt)
    this.look(p, 0, -5)
  }

  act_QB(p, t, dt) {
    const b = this.ball
    if (t < SNAP_TIME) return this.look(p, 0, 20)

    if (this.play.type === 'run') {
      if (b.holder === p) {
        // open up to the back and hand it off at the mesh point
        this.steer(p, tmp.set(0.3, 0, this.los - 4.9), 2, dt)
        p.face = this.rb.pos
        const meshReady = t >= SNAP_TIME + 0.45 && this.rb.pos.distanceTo(p.pos) < 1.6
        if (meshReady || t >= SNAP_TIME + 0.8) this.handoff(t)
        return
      }
      // carry out the fake: boot away from the play
      this.steer(p, tmp.set(5, 0, this.los - 7), 4.5, dt)
      return
    }

    const throwAt = this.play.throwAt
    if (t < DROP_END + (throwAt - 1.55)) {
      this.steer(p, tmp.set(0, 0, this.los - 7.3), 4.2, dt)
      return this.look(p, 0, 20)
    }
    if (t < throwAt) {
      this.brake(p, dt)
      if (!this.aim) this.planThrow()
      p.face = this.aim.point
      return
    }
    if (!p.threw) {
      p.threw = true
      this.oneShot(p, 'Throw')
    }
    this.brake(p, dt)
    p.face = this.aim.point
    if (b.state === 'held' && b.holder === p && t >= throwAt + THROW_RELEASE) this.release(t)
    if (p.locked && t > p.lockedAt + 1.25) p.locked = false
  }

  act_WR(p, t, dt) {
    if (p === this.carrier) return this.actCarrier(p, t, dt)
    if (this.carrier) {
      // jog toward the play to help
      tmp.copy(this.carrier.pos).add(tmp2.set(p.start.x > 0 ? 3 : -3, 0, 2))
      this.steer(p, tmp, 4, dt)
      return
    }
    if (t < p.routeStart) {
      p.hold = 'Stance'
      return
    }
    p.hold = null
    p.face = null
    if (p === this.target && this.aim && t >= this.aim.time - 0.22 && !p.catching) {
      p.catching = true
      this.oneShot(p, 'Catch')
    }
    if (p.locked && t > p.lockedAt + 0.8) p.locked = false
    this.followRoute(p, dt)
  }

  act_TE(p, t, dt) {
    if (t < p.routeStart) {
      p.hold = 'Block'
      return
    }
    this.act_WR(p, t, dt)
  }

  act_RB(p, t, dt) {
    if (p === this.carrier) return this.actCarrier(p, t, dt)
    if (t < p.routeStart) {
      p.hold = t < SNAP_TIME ? 'Stance' : 'Block'
      return
    }
    this.act_WR(p, t, dt)
  }

  actCarrier(p, t, dt) {
    if (p.locked && t > p.lockedAt + 0.62) p.locked = false
    const since = t - this.catchTime
    // the back hits the A gap first, then everyone cuts away from the nearest defender
    if (p === this.rb && p.pos.z < this.los + 0.5) {
      this.steer(p, tmp.set(HOLE_X, 0, this.los + 2), 7.4, dt, 20)
      p.face = null
      return
    }
    let near = null
    let nd = Infinity
    for (const d of this.players) {
      if (d.team !== 'def' || d.down) continue
      const dd = d.pos.distanceTo(p.pos)
      if (dd < nd) {
        nd = dd
        near = d
      }
    }
    if (this.play.toSideline && since > 0.3) {
      // get what you can, then step out to stop the clock
      this.steer(p, tmp.set(Math.sign(p.pos.x) * (SIDELINE + 3), 0, p.pos.z + p.cutBias * 3 + 1.2), 6.5, dt, 14)
      p.face = null
      return
    }
    tmp.set(0, 0, 1)
    if (near && nd < 8) tmp.x += THREE.MathUtils.clamp((p.pos.x - near.pos.x) / nd + p.cutBias, -0.8, 0.8)
    tmp.normalize().multiplyScalar(10).add(p.pos)
    tmp.x = THREE.MathUtils.clamp(tmp.x, -SIDELINE + 1, SIDELINE - 1)
    const speed = p === this.rb ? 7.2 : since < 0.45 ? 4.5 : 7.2
    this.steer(p, tmp, speed, dt, 14)
    p.face = null
  }

  act_CB(p, t, dt) {
    if (this.carrier) return this.pursue(p, p.speed + 0.8, dt)
    if (t < 0.25 + p.react * 0.5) return
    // trail the receiver, cushion toward the end zone, slightly inside
    const r = p.man
    tmp.copy(r.pos)
    tmp.z += p.cushion
    tmp.x += r.pos.x > 0 ? -0.6 : 0.6
    this.steer(p, tmp, p.speed, dt, 16)
    p.face = t < 1.2 ? this.qb.pos : null
  }

  act_LB(p, t, dt) {
    if (this.carrier) return this.pursue(p, p.speed, dt)
    if (t < 0.3) return
    this.steer(p, p.zone, 4.8, dt)
    p.face = this.qb.pos
  }

  act_S(p, t, dt) {
    if (this.carrier) return this.pursue(p, p.speed, dt)
    if (t < 0.3) return
    // a safety bails deep when the go route threatens him
    if (this.z.pos.z > p.pos.z - 4 && Math.abs(this.z.pos.x - p.pos.x) < 14) tmp.copy(this.z.pos).setZ(this.z.pos.z + 5)
    else tmp.copy(p.zone)
    this.steer(p, tmp, 6.5, dt)
    p.face = this.qb.pos
  }

  // ------------------------------------------------------------------ ball
  handoff(t) {
    this.ball.holder = this.rb
    this.carrier = this.rb
    this.catchTime = t
    this.rb.cutBias = (this.rng() - 0.5) * 0.6
    this.message = 'Handoff!'
  }

  planThrow() {
    // iterate to find where the receiver will be when the ball gets there
    const release = tmp.set(this.qb.pos.x, 1.6, this.qb.pos.z)
    const tr = this.play.throwAt + THROW_RELEASE
    let ta = tr + 1
    const point = new THREE.Vector3()
    for (let i = 0; i < 6; i++) {
      this.routePosAt(this.target, ta, point)
      ta = tr + release.distanceTo(point) / BALL_SPEED
    }
    this.routePosAt(this.target, ta, point)
    this.aim = { time: ta, point }
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

  /** Ball reaches the receiver: tight coverage can knock it away. */
  arrive(t) {
    const b = this.ball
    const r = this.target
    let nd = Infinity
    let cover = null
    for (const d of this.players) {
      if (d.team !== 'def') continue
      const dd = d.pos.distanceTo(r.pos)
      if (dd < nd) {
        nd = dd
        cover = d
      }
    }
    if (this.rng() < 0.11) {
      // overthrown: sails past the receiver's fingertips
      b.state = 'loose'
      b.holder = null
      b.vel.copy(b.dir).multiplyScalar(9).setY(1)
      this.phase = 'dead'
      this.deadTime = t
      this.result = { good: false, kind: 'incomplete', gain: 0, first: false, spot: this.los, elapsed: t }
      this.message = `Incomplete! Overthrown, just past #${r.number}`
      return
    }
    const breakupChance = THREE.MathUtils.clamp((1.7 - nd) / 1.7, 0, 0.75)
    if (this.rng() < breakupChance) {
      b.state = 'loose'
      b.holder = null
      b.vel.set((this.rng() - 0.5) * 6, 4, -3)
      this.phase = 'dead'
      this.deadTime = t
      this.result = { good: false, kind: 'incomplete', gain: 0, first: false, spot: this.los, elapsed: t }
      this.message = `Incomplete! Broken up by #${cover.number}`
      return
    }
    b.state = 'held'
    b.holder = r
    this.carrier = r
    this.catchTime = t
    r.cutBias = (this.rng() - 0.5) * 0.6
    this.message = 'Caught it! Run!'
  }

  checkTackle(t) {
    const c = this.carrier
    if (!c || t < this.catchTime + 0.6) return
    for (const d of this.players) {
      // engaged blockers can't make the play
      if (d.team !== 'def' || d.locked || d.down || d.hold === 'Block') continue
      if (d.pos.distanceTo(c.pos) < 1.9) {
        this.oneShot(d, 'Dive')
        d.down = true
        d.face = null
        d.yaw = Math.atan2(c.pos.x - d.pos.x, c.pos.z - d.pos.z)
        d.vel.set(Math.sin(d.yaw), 0, Math.cos(d.yaw)).multiplyScalar(4)
        // some tackles get broken: the defender dives and whiffs
        if (this.rng() < 0.28) {
          d.vel.multiplyScalar(0.6)
          d.yaw += (this.rng() - 0.5) * 0.9
          this.message = 'Broke a tackle!'
          c.cutBias = -c.cutBias
          continue
        }
        this.tackler = d
        this.endPlay(t, 'tackle')
        c.pendingFall = t + 0.22
        return
      }
    }
  }

  checkBoundaries(t) {
    const c = this.carrier
    if (!c || this.phase !== 'live') return
    if (c.pos.z >= GOAL_LINE) this.endPlay(t, 'touchdown')
    else if (Math.abs(c.pos.x) > SIDELINE) this.endPlay(t, 'out')
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
