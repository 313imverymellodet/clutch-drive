import * as THREE from 'three'
import { HOOP, NUMBERS, POSITIONS, RATINGS, SETS } from './sets.js'

/*
 * One half-court possession. Units are feet (see sets.js). Fixed-step and seeded, so a possession replays
 * exactly from its seed plus the logged inputs (instant replay, the Daily, head-to-head later).
 *
 * Offense runs a set: players follow their paths, screens are live in their windows, the ball handler works
 * the read progression (pass to the first open option, take his own shot, or drive), catchers decide
 * catch-and-shoot / attack / swing. The player can take over at any moment: pass (to any teammate), shoot
 * (a timing meter), drive, or step back.
 *
 * Defense plays a coverage: man (chase screens), switch (swap on screens: mismatches), drop (big sags to
 * protect the rim, gives up pull-ups), hedge (big jumps the handler, roller open for a beat), 2-3 zone.
 * Help defenders rotate to stop drives and leave their man open for the kick-out.
 */

export const FIXED_DT = 1 / 60
export const SHOOT_RELEASE = 18 / 30 // release frame of the Shoot clip
export const RIM_HEIGHT = 10
const PASS_RELEASE = 5 / 30
const PASS_SPEED = 46
const COURT_X = 24.5
const HOOP_V = new THREE.Vector3(HOOP.x, 0, HOOP.z)

const V = (x, z) => new THREE.Vector3(x, 0, z)
const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const distToHoop = (p) => Math.hypot(p.x - HOOP.x, p.z - HOOP.z)
/** Behind the arc (22 ft in the corners, 23.75 ft elsewhere), with a little slack for the shooter's heels. */
export function isThree(p) {
  return (p.z <= 14.2 && Math.abs(p.x) >= 21.8) || (p.z > 14.2 && distToHoop(p) >= 23.6)
}
export function shotLabel(p) {
  const d = distToHoop(p)
  if (isThree(p)) return p.z <= 14.2 ? 'corner three' : d > 27 ? 'deep three' : 'three'
  if (d < 6.5) return 'layup'
  if (d < 12) return 'floater'
  return 'jumper'
}

/** Point-to-segment distance and where along the segment it lands (0..1). */
function laneDistance(p, a, b) {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const len2 = abx * abx + abz * abz || 1
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2))
  return { d: Math.hypot(a.x + abx * u - p.x, a.z + abz * u - p.z), u }
}

const ZONE_SPOTS = { PG: [-7, 22], SG: [7, 22], SF: [-15, 10], PF: [15, 10], C: [0, 8] }

export class HoopsSim {
  constructor() {
    this.timeScale = 1
    this.reset()
  }

  /**
   * set: id from SETS. coverage: { call, shown }. shotClock / gameClock: seconds left at the start.
   * roster: optional { off: { PG: [number, name], ... }, def: {...} }. inputs: logged taps (replays).
   * milk: the offense is protecting a lead and runs clock before shooting. flip: mirror the set.
   */
  reset({ set = 'pnr', seed = 1, coverage = null, shotClock = 24, gameClock = 120, roster = null, inputs = null, milk = false, flip = false, user = false, userDef = false, boosts = null } = {}) {
    this.set = SETS[set] ?? SETS.pnr
    this.setId = SETS[set] ? set : 'pnr'
    this.seed = seed
    this.rng = mulberry32(seed)
    this.coverage = coverage ?? { call: 'man', shown: 'man' }
    this.shotClock = shotClock
    this.gameClock = gameClock
    this.roster = roster
    this.milk = milk
    this.flip = flip ? -1 : 1
    this.user = user // the player can take over this possession (their offense)
    this.userDef = userDef // the player is defending: contest, double team, foul
    this.boosts = boosts // hot hands: { SG: 0.05 } added to that player's shooting
    this.contestReady = 0
    this.doubleReady = 0
    this.t = 0
    this.phase = 'presnap'
    this.players = []
    this.events = []
    this.message = null
    this.result = null
    this.queue = []
    this.inputLog = []
    this.replayInputs = inputs ? inputs.map((e) => ({ ...e })) : null
    this.manual = false
    this.readIdx = 0
    this.reads = this.set.reads.map(([key, at]) => ({ key, at }))
    this.entryDone = !this.set.entry
    this.shot = null
    this.pass = null
    this.screensDone = new Set()
    this.lastHelpCheck = 0

    const fx = this.flip
    for (const pos of POSITIONS) {
      const path = (this.set.paths[pos] ?? [[0, 0, 26]]).map(([t, x, z]) => ({ t, x: x * fx, z }))
      const b = boosts?.[pos] ?? 0
      const r = b ? { ...RATINGS[pos], three: RATINGS[pos].three + b, mid: RATINGS[pos].mid + b, finish: RATINGS[pos].finish + b * 0.7 } : RATINGS[pos]
      const real = roster?.off?.[pos]
      this.add({ team: 'off', key: pos, path, rating: r, hot: b > 0, number: real?.[0] ?? NUMBERS[pos], name: real?.[1] ?? null, speed: r.speed, pos: V(path[0].x, path[0].z) })
    }
    this.byKey = Object.fromEntries(this.players.map((p) => [p.key, p]))
    for (const pos of POSITIONS) {
      const man = this.byKey[pos]
      const r = RATINGS[pos]
      const real = roster?.def?.[pos]
      const start = this.coverage.shown === 'zone' ? V(ZONE_SPOTS[pos][0], ZONE_SPOTS[pos][1]) : tmp.copy(HOOP_V).sub(man.pos).setY(0).normalize().multiplyScalar(4).add(man.pos).clone()
      const d = this.add({ team: 'def', key: `d${pos}`, slot: pos, man, rating: r, number: real?.[0] ?? NUMBERS[pos] + 1, name: real?.[1] ?? null, speed: r.speed - 0.6, pos: start })
      d.react = 0.12 + this.rng() * 0.18
      man.defender = d
    }
    this.defenders = this.players.filter((p) => p.team === 'def')
    this.offense = this.players.filter((p) => p.team === 'off')
    for (const p of this.players) this.face(p, p.team === 'off' ? HOOP_V : p.man?.pos ?? HOOP_V)

    const handler = this.byKey[this.set.handler]
    this.ball = { state: 'held', holder: handler, pos: new THREE.Vector3(handler.pos.x, 3, handler.pos.z), from: new THREE.Vector3(), to: new THREE.Vector3(), t0: 0, t1: 0, arc: 0, vel: new THREE.Vector3(), target: null }
    handler.caughtAt = -1
  }

  add(p) {
    const player = { id: this.players.length, vel: new THREE.Vector3(), yaw: 0, anim: 'Idle', oneShot: null, oneShotUntil: 0, screenedUntil: 0, frozenUntil: 0, ...p }
    this.players.push(player)
    return player
  }

  face(p, target) {
    p.yaw = Math.atan2(target.x - p.pos.x, target.z - p.pos.z)
  }

  emit(type, data = {}) {
    this.events.push({ type, t: this.t, ...data })
  }

  start() {
    if (this.phase !== 'presnap') return
    this.phase = 'live'
    this.emit('start')
  }

  // ------------------------------------------------------------------ inputs
  /** Player commands: pass {key}, shoot, release, drive, stepback (offense); foul (defense). */
  input(cmd) {
    if (this.replayInputs) return false
    if (this.phase !== 'live') return false
    this.queue.push(cmd)
    return true
  }

  applyInputs(t) {
    const due = this.replayInputs ? this.replayInputs.filter((e) => !e.done && e.t <= t + 1e-6) : this.queue.splice(0)
    for (const e of due) {
      if (this.replayInputs) e.done = true
      if (this.command(e, t) && !this.replayInputs) this.inputLog.push({ t, ...e })
    }
  }

  command(e, t) {
    const b = this.ball
    const B = b.state === 'held' ? b.holder : null
    if (e.type === 'foul') {
      if (!B || this.phase !== 'live') return false
      this.intentionalFoul(B, t)
      return true
    }
    if (e.type === 'contest' || e.type === 'double') {
      if (!this.userDef || !B || B.team !== 'off') return false
      return e.type === 'contest' ? this.userContest(B, t) : this.userDouble(B, t)
    }
    if (!this.user || !B || B.team !== 'off') return false
    if (e.type === 'release') {
      if (!B.gatherAt || B.released) return false
      this.release(B, t)
      return true
    }
    if (B.gatherAt) return false // already rising up
    this.manual = true
    switch (e.type) {
      case 'pass': {
        const R = this.byKey[e.key]
        if (!R || R === B) return false
        this.startPass(B, R, t)
        return true
      }
      case 'shoot':
        this.gather(B, t, true)
        return true
      case 'drive':
        B.driving = true
        B.path = null
        this.message = 'Attack the rim!'
        return true
      case 'stepback': {
        if ((B.moveReady ?? 0) > t) return false
        B.moveReady = t + 1.2
        tmp.copy(B.pos).sub(HOOP_V).setY(0).normalize()
        B.stepback = { until: t + 0.38, dir: tmp.clone() }
        B.driving = false
        const d = B.defender
        if (d && d.pos.distanceTo(B.pos) < 6 && this.rng() < 0.7 - (d.rating.size - 0.5) * 0.3) d.frozenUntil = t + 0.5
        this.message = 'Stepback!'
        this.emit('move')
        return true
      }
      default:
        return false
    }
  }

  /** Your hand-up: right as he rises it's a real contest; too early and your man bites and gives up a lane. */
  userContest(B, t) {
    if (this.contestReady > t) return false
    this.contestReady = t + 1
    let d = null
    let best = Infinity
    for (const x of this.defenders) {
      const dd = x.pos.distanceTo(B.pos)
      if (dd < best) (best = dd), (d = x)
    }
    d.oneShot = 'Contest'
    if (B.gatherAt && !B.released) {
      d.oneShotUntil = t + 0.7
      d.closeUntil = t + 0.7
      d.contestBoost = t + 0.9
      this.message = 'Hand in his face!'
    } else {
      d.oneShotUntil = t + 0.6
      d.frozenUntil = t + 0.8
      this.message = `${who(d)} bit! He's got a lane.`
      if (!B.driving && distToHoop(B.pos) < 27) {
        B.driving = true
        B.path = null
      }
    }
    this.emit('contest')
    return true
  }

  /** Send a second defender at the ball. The trap can force a turnover, but somebody is left open. */
  userDouble(B, t) {
    if (this.doubleReady > t) return false
    this.doubleReady = t + 2.5
    let helper = null
    let best = Infinity
    for (const x of this.defenders) {
      if (x === B.defender) continue
      const dd = x.pos.distanceTo(B.pos)
      if (dd < best) (best = dd), (helper = x)
    }
    if (!helper) return false
    helper.doubleUntil = t + 1.6
    helper.doubleTarget = B
    B.trappedUntil = t + 1.6
    B.trappedAt = t
    B.pressuredUntil = t + 1.6
    this.message = 'Double team!'
    this.emit('double')
    return true
  }

  /** What the player can do right now (on-screen controls + rings). */
  controls() {
    if (this.phase !== 'live') return null
    const b = this.ball
    const B = b.state === 'held' ? b.holder : null
    if (!this.user) {
      if (!B || B.team !== 'off') return null
      return { mode: 'defense', canFoul: true, interactive: this.userDef, shooting: !!(B.gatherAt && !B.released), canContest: this.contestReady <= this.t, canDouble: this.doubleReady <= this.t, trapped: B.trappedUntil > this.t }
    }
    if (!B && b.state !== 'pass') return null
    if (B?.gatherAt) {
      const progress = (this.t - B.gatherAt) / 1.05
      return { mode: 'shooting', meter: { progress: Math.min(1, progress), green: [(SHOOT_RELEASE - 0.05) / 1.05, (SHOOT_RELEASE + 0.05) / 1.05], good: [(SHOOT_RELEASE - 0.12) / 1.05, (SHOOT_RELEASE + 0.12) / 1.05] }, released: !!B.released }
    }
    if (!B) return { mode: 'passing' }
    const order = this.reads.map((r) => r.key)
    return {
      mode: 'offense',
      holder: { key: B.key, name: B.name, number: B.number, hot: B.hot },
      mates: this.offense
        .filter((p) => p !== B)
        .map((p) => ({ key: p.key, n: order.indexOf(p.key) + 1 || null, name: p.name, number: p.number, open: this.openness(p, B, false), pos: p.pos, hot: p.hot })),
      self: this.spaceOf(B),
      layup: distToHoop(B.pos) < 6.5,
      three: isThree(B.pos),
      manual: this.manual,
      shotClock: Math.max(0, this.shotClock - this.t),
    }
  }

  // ------------------------------------------------------------------ evaluation
  /** Feet of space a receiver would have when a pass from B got there (minus a blocked passing lane). */
  openness(R, B = this.ball.holder, noisy = true) {
    if (!B || R === B) return -9
    const flight = R.pos.distanceTo(B.pos) / PASS_SPEED + PASS_RELEASE
    tmp.copy(R.vel).multiplyScalar(flight).add(R.pos)
    let space = 20
    let lane = 9
    for (const d of this.defenders) {
      const close = Math.max(0, flight - d.react - 0.1) * 8
      space = Math.min(space, d.pos.distanceTo(tmp) - close)
      const l = laneDistance(d.pos, B.pos, tmp)
      if (l.u > 0.12 && l.u < 0.92) lane = Math.min(lane, l.d)
    }
    let open = space - (lane < 2.4 ? (2.4 - lane) * 2.5 : 0)
    if (distToHoop(tmp) < 7 && space > 3) open += 1.5 // a cutter/roller at the rim is worth more
    if (noisy) open += (this.rng() - 0.5) * 1.6
    return open
  }

  /** Space a shooter has right now (nearest defender, defenders behind him count less). */
  spaceOf(B) {
    let s = 20
    for (const d of this.defenders) {
      const dist = d.pos.distanceTo(B.pos)
      const behind = distToHoop(d.pos) > distToHoop(B.pos) + 1.5
      s = Math.min(s, behind ? dist + 2.5 : dist)
    }
    return s
  }

  laneToRim(B) {
    for (const d of this.defenders) {
      const l = laneDistance(d.pos, B.pos, HOOP_V)
      if (l.u > 0.05 && l.d < 3) return false
    }
    return true
  }

  shooterOK(B) {
    const r = B.rating
    return isThree(B.pos) ? r.three >= 0.32 : distToHoop(B.pos) < 6.5 || r.mid >= 0.38
  }

  // ------------------------------------------------------------------ actions
  startPass(B, R, t) {
    B.anim = 'Pass'
    B.oneShot = 'Pass'
    B.oneShotUntil = t + 0.45
    B.driving = false
    this.face(B, R.pos)
    const flight = R.pos.distanceTo(B.pos) / PASS_SPEED + 0.08
    const lead = R.vel.clone().multiplyScalar(flight + PASS_RELEASE).add(R.pos)
    lead.x = Math.max(-COURT_X, Math.min(COURT_X, lead.x))
    lead.z = Math.max(1.5, Math.min(46, lead.z))
    // passing lanes: a defender sitting in it may pick it off
    let thief = null
    let best = 0
    for (const d of this.defenders) {
      const l = laneDistance(d.pos, B.pos, lead)
      if (l.u < 0.25 || l.u > 0.85 || l.d > 1.7) continue
      const p = 0.22 * (1 - l.d / 1.7) * (B.pos.distanceTo(lead) > 22 ? 1.4 : 1)
      if (p > best) (best = p), (thief = d)
    }
    // passing out of a trap is risky
    if (B.trappedUntil > t) {
      const trapper = this.defenders.find((x) => x.doubleUntil > t && x.doubleTarget === B)
      if (trapper && best < 0.14) (best = 0.14), (thief = trapper)
    }
    const stolen = thief && this.rng() < best
    this.pass = { from: B, to: R, lead, release: t + PASS_RELEASE, arrive: t + PASS_RELEASE + flight, thief: stolen ? thief : null }
    this.message = null
  }

  releasePass(t) {
    const p = this.pass
    const b = this.ball
    b.state = 'pass'
    b.holder = null
    b.from.set(p.from.pos.x, 4.2, p.from.pos.z)
    b.to.set(p.lead.x, 4, p.lead.z)
    b.t0 = t
    b.t1 = p.arrive
    b.arc = p.from.pos.distanceTo(p.lead) > 25 ? 3 : 0.8
    p.released = true
    this.emit('pass')
  }

  arrivePass(t) {
    const p = this.pass
    const b = this.ball
    this.pass = null
    if (p.thief) {
      b.state = 'held'
      b.holder = p.thief
      this.end(t, { kind: 'steal', by: p.thief.number, byName: p.thief.name, points: 0 }, `STOLEN by ${who(p.thief)}!`)
      this.emit('steal')
      return
    }
    b.state = 'held'
    b.holder = p.to
    p.to.caughtAt = t
    p.to.decided = false
    p.to.oneShot = 'Catch'
    p.to.oneShotUntil = t + 0.3
    p.to.path = p.to.path?.filter((w) => w.t > t) ?? null
    this.emit('catch')
  }

  /** Rise up: a layup goes right away; a jumper releases at the top (or when the player lets go). */
  gather(B, t, byUser = false) {
    const layup = distToHoop(B.pos) < 6.5
    B.gatherAt = t
    B.driving = false
    B.layup = layup
    // bigs (and a springy small forward) close to the rim throw it down: same shot, different show
    B.dunk = layup && distToHoop(B.pos) < 5 && (B.key === 'C' || B.key === 'PF' || (B.key === 'SF' && B.rating.finish >= 0.6))
    B.oneShot = B.dunk ? 'Dunk' : layup ? 'Layup' : 'Shoot'
    B.oneShotUntil = t + 1.2
    B.anim = B.oneShot
    B.byUser = byUser && !layup
    this.face(B, HOOP_V)
    this.emit('gather')
    if (layup) B.autoRelease = t + 0.38
    else if (!byUser) B.autoRelease = t + SHOOT_RELEASE + (this.rng() - 0.5) * 0.24
    else B.autoRelease = t + 1.05 // never let go: it comes out late
  }

  release(B, t) {
    B.released = true
    const err = B.layup ? 0.04 : Math.abs(t - B.gatherAt - SHOOT_RELEASE)
    const grade = B.layup ? null : err < 0.05 ? 'perfect' : err < 0.12 ? 'good' : t - B.gatherAt < SHOOT_RELEASE ? 'early' : 'late'
    const timing = B.layup ? 1 : { perfect: 1.12, good: 1, early: 0.74, late: 0.7 }[grade] * (err > 0.25 ? 0.75 : 1)
    const d = distToHoop(B.pos)
    const three = isThree(B.pos)
    const r = B.rating
    let base = d < 6.5 ? r.finish : d < 12 ? r.finish * 0.72 : three ? r.three + (B.pos.z <= 14.2 ? 0.02 : 0) : r.mid
    if (d > 26) base -= (d - 26) * 0.014
    // contest: nearest defender at the release, bigger ones matter more at the rim
    let c = 30
    let contester = null
    for (const def of this.defenders) {
      const dd = def.pos.distanceTo(B.pos)
      if (dd < c) (c = dd), (contester = def)
    }
    let contest = c < 1.5 ? 0.64 : c < 3 ? 0.82 : c < 5 ? 0.93 : c < 7 ? 0.98 : c > 9 ? 1.05 : 1
    if (d < 6.5 && c < 3.5) contest -= 0.1 * (contester?.rating.size ?? 0.5)
    if (B.stepback && t < B.stepback.until + 0.6) contest *= 0.96
    const greatContest = contester?.contestBoost > t && c < 4.5
    if (greatContest) contest *= 0.9
    const pMake = Math.max(0.03, Math.min(0.94, base * contest * timing))
    const made = this.rng() < pMake
    const foulP = d < 6.5 && c < 3 ? 0.14 : c < 2 ? 0.06 : 0.012
    const fouled = this.rng() < foulP
    const flight = d < 6.5 ? 0.45 : 0.8 + d * 0.016
    const b = this.ball
    b.state = 'shot'
    b.holder = null
    b.from.set(B.pos.x, d < 6.5 ? 8.5 : 8, B.pos.z)
    b.to.set(HOOP.x, RIM_HEIGHT + 0.3, HOOP.z)
    b.t0 = t
    b.t1 = t + flight
    b.arc = d < 6.5 ? 2 : 4 + d * 0.18
    this.shot = { shooter: B, made, fouled, three, d, contest: c, contester, grade, pMake, release: t, label: shotLabel(B.pos), buzzer: t > this.gameClock - 0.01, greatContest }
    if (contester && c < 7) {
      contester.oneShot = 'Contest'
      contester.oneShotUntil = t + 0.7
    }
    if (grade) this.emit('release', { grade })
    this.emit('shot')
  }

  arriveShot(t) {
    const s = this.shot
    const b = this.ball
    const pts = s.three ? 3 : 2
    const who_ = who(s.shooter)
    if (s.made) {
      b.state = 'swish'
      b.t0 = t
      const kind = s.fouled ? 'and1' : 'make'
      this.end(t, { kind, points: pts, fts: s.fouled ? 1 : 0, shot: this.shotInfo() }, `${s.fouled ? 'AND ONE! ' : ''}${who_} ${s.three ? 'drains the three' : s.label === 'layup' ? (s.shooter.dunk ? 'throws it down' : 'scores at the rim') : 'hits the ' + s.label}!${gradeNote(s)}`)
      this.emit(s.three ? 'three' : 'make')
    } else {
      b.state = 'loose'
      b.vel.set((this.rng() - 0.5) * 14, 6 + this.rng() * 4, 3 + this.rng() * 8)
      b.pos.copy(b.to)
      const kind = s.fouled ? 'fouled' : 'miss'
      this.end(t, { kind, points: 0, fts: s.fouled ? (s.three ? 3 : 2) : 0, shot: this.shotInfo() }, s.fouled ? `Fouled on the ${s.label}! ${s.three ? 3 : 2} free throws.` : `${who_} misses the ${s.label}${s.greatContest ? '. Great contest!' : s.contest < 3 ? ' (well contested).' : '.'}${gradeNote(s)}`)
      this.emit('rim')
    }
  }

  shotInfo() {
    const s = this.shot
    return { by: s.shooter.key, number: s.shooter.number, name: s.shooter.name, three: s.three, label: s.label, contest: +s.contest.toFixed(1), grade: s.shooter.byUser ? s.grade : null, pMake: +s.pMake.toFixed(2), release: s.release, buzzer: s.buzzer, greatContest: !!s.greatContest }
  }

  intentionalFoul(B, t) {
    const d = B.defender ?? this.defenders[0]
    d.oneShot = 'Contest'
    d.oneShotUntil = t + 0.5
    this.end(t, { kind: 'foulDrawn', points: 0, fts: 2 }, `Foul on ${who(d)}. ${who(B)} heads to the line.`)
    this.emit('whistle')
  }

  end(t, result, message) {
    this.phase = 'dead'
    this.deadAt = t
    this.result = { ...result, elapsed: Math.min(t, this.gameClock), set: this.setId }
    this.message = message
  }

  // ------------------------------------------------------------------ step
  step(dt) {
    if (this.phase === 'presnap' || this.phase === 'over') return
    this.t += dt
    const t = this.t
    if (this.phase === 'live') this.applyInputs(t)
    const b = this.ball

    if (this.phase === 'live') {
      // clocks: a shot already in the air still counts
      if (b.state !== 'shot') {
        if (t >= this.gameClock) {
          this.end(this.gameClock, { kind: 'clock', points: 0 }, 'Time runs out before a shot goes up!')
          this.emit('buzzer')
        } else if (t >= this.shotClock) {
          this.end(t, { kind: 'shotclock', points: 0 }, 'Shot clock violation!')
          this.emit('buzzer')
        }
      }
    }

    if (this.phase === 'live') {
      const B = b.state === 'held' ? b.holder : null
      if (B && B.team === 'off') {
        if (B.gatherAt && !B.released && t >= B.autoRelease) this.release(B, t)
        else if (!B.gatherAt && !this.pass) this.decide(B, t)
      }
      if (this.pass && !this.pass.released && t >= this.pass.release) this.releasePass(t)
      if (this.pass?.released && t >= this.pass.arrive) this.arrivePass(t)
      if (b.state === 'shot' && t >= b.t1) this.arriveShot(t)
      this.screens(t)
      this.help(t)
    }

    for (const p of this.offense) this.moveOffense(p, t, dt)
    for (const d of this.defenders) this.moveDefense(d, t, dt)
    this.separate()
    this.updateBall(t, dt)
    for (const p of this.players) this.pickAnim(p, t)
    if (this.phase === 'dead' && t > this.deadAt + 1.3) this.phase = 'over'
  }

  /** The auto ball handler (and the AI's offense): reads, catch decisions, shot-clock urgency. */
  decide(B, t) {
    if (this.user && this.manual) return
    const left = Math.min(this.shotClock, this.gameClock) - t
    const d = distToHoop(B.pos)
    // at the rim with the ball: finish it
    if (d < 6 && this.spaceOf(B) > 1.2) return this.gather(B, t)
    if (B.driving && d < 9) {
      // help arrived: dump it off or kick it out, else go up through contact
      const best = this.bestOption(B)
      if (best && best.open > 5 && this.rng() < 0.8) return this.startPass(B, best.p, t)
      return this.gather(B, t)
    }
    if (this.milk && left > 7 && d > 8) {
      // protect the lead: hold it, dribble out the clock
      B.path = B.path?.length ? B.path : [{ t, x: B.pos.x, z: Math.max(B.pos.z, 26) }]
      return
    }
    if (left < 2.6) return this.forceShot(B, t)
    // trapped: find the open man before the trap closes
    if (B.trappedUntil > t && t - B.trappedAt > 0.35) {
      const out = this.bestOption(B)
      if (out && out.open > 2.5) return this.startPass(B, out.p, t)
    }
    // scripted entry (post feed, floppy catch)
    if (!this.entryDone && B.key === this.set.handler && t >= this.set.entry.at) {
      this.entryDone = true
      const R = this.byKey[this.set.entry.to]
      if (this.openness(R, B) >= this.set.entry.ifOpen) return this.startPass(B, R, t)
    }
    // just caught it: shoot it, attack, or swing it
    if (B.caughtAt > 0 && !B.decided && t - B.caughtAt > 0.28) {
      B.decided = true
      const space = this.spaceOf(B) + (this.rng() - 0.5) * 1.2
      if (space > 4.2 && this.shooterOK(B)) return this.gather(B, t)
      // attack the closeout
      if ((this.laneToRim(B) || space > 3) && d < 27 && B.rating.handle > 0.5) {
        B.driving = true
        B.path = null
        return
      }
      const best = this.bestOption(B)
      if (best && best.open > 5) return this.startPass(B, best.p, t)
      B.hangSince = t
    }
    if (B.driving) return
    // the progression
    const read = this.reads[this.readIdx]
    if (read && B.key === (this.set.handler) && t >= read.at) {
      if (read.key === 'self') {
        const space = this.spaceOf(B) + (this.rng() - 0.5) * 1.2
        if (space > 4.5 && this.shooterOK(B)) return this.gather(B, t)
        if (this.laneToRim(B) && d < 22) {
          B.driving = true
          B.path = null
          return
        }
      } else {
        const R = this.byKey[read.key]
        const need = this.readIdx === 0 ? 4.8 : 4.2
        if (R !== B && this.openness(R, B) >= need) return this.startPass(B, R, t)
      }
      this.readIdx++
      const next = this.reads[this.readIdx]
      if (next) next.at = Math.max(next.at, t + 0.3)
      return
    }
    // out of reads (or a catcher who held it): best thing available
    const lastRead = this.reads.at(-1)?.at ?? 2.5
    const waited = B.key === this.set.handler ? t > lastRead + 0.6 : B.hangSince != null && t > B.hangSince + 0.7
    if (waited) {
      const best = this.bestOption(B)
      const space = this.spaceOf(B)
      if (space > 3.5 && this.shooterOK(B)) return this.gather(B, t)
      if (best && best.open > 4) return this.startPass(B, best.p, t)
      // nothing there: put it on the floor and make something happen
      B.driving = true
      B.path = null
    }
  }

  bestOption(B) {
    let best = null
    for (const p of this.offense) {
      if (p === B) continue
      const open = this.openness(p, B)
      if (!best || open > best.open) best = { p, open }
    }
    return best
  }

  forceShot(B, t) {
    const best = this.bestOption(B)
    if (best && best.open > this.spaceOf(B) + 4 && Math.min(this.shotClock, this.gameClock) - t > 1.6) return this.startPass(B, best.p, t)
    this.gather(B, t)
  }

  /** Screens: switch swaps assignments; otherwise the screened defender gets stuck, and the big drops or hedges. */
  screens(t) {
    for (const [i, s] of this.set.screens.entries()) {
      if (this.screensDone.has(i) || t < s.from || t > s.to) continue
      const S = this.byKey[s.by]
      const U = this.byKey[s.for]
      if (S.pos.distanceTo(U.pos) > 4.5) continue
      this.screensDone.add(i)
      const dU = U.defender
      const dS = S.defender
      if (!dU || !dS || this.coverage.call === 'zone') continue
      const onBall = this.ball.holder === U
      if (this.coverage.call === 'switch') {
        dU.man = S
        dS.man = U
        S.defender = dU
        U.defender = dS
        this.emit('switch')
        if (onBall) this.message = 'They switch it!'
        continue
      }
      dU.screenedUntil = t + 0.75 + (this.rng() - 0.5) * 0.3
      if (onBall && this.coverage.call === 'drop') dS.mode = { type: 'drop', until: t + 2.2, ball: U }
      if (onBall && this.coverage.call === 'hedge') {
        dS.mode = { type: 'hedge', until: t + 0.95, ball: U }
        U.pressuredUntil = t + 0.95
      }
      this.emit('screen')
    }
  }

  /** Help defense: a driver who has beaten his man draws the nearest weak-side defender. */
  help(t) {
    const B = this.ball.state === 'held' ? this.ball.holder : null
    if (!B || B.team !== 'off' || t - this.lastHelpCheck < 0.1) return
    this.lastHelpCheck = t
    if (B.trappedUntil > t && !B.gatherAt && this.rng() < 0.006) {
      const trapper = this.defenders.find((x) => x.doubleUntil > t && x.doubleTarget === B) ?? B.defender
      this.ball.holder = trapper
      this.end(t, { kind: 'steal', by: trapper.number, byName: trapper.name, points: 0 }, `TRAPPED! ${who(trapper)} rips it away!`)
      this.emit('steal')
      return
    }
    const d = distToHoop(B.pos)
    const own = B.defender
    const beaten = !own || own.screenedUntil > t || own.frozenUntil > t || distToHoop(own.pos) > d + 0.5
    if (d > 17 || !beaten || this.coverage.call === 'zone') return
    if (this.defenders.some((x) => x.helpUntil > t)) return
    let helper = null
    let best = Infinity
    tmp2.copy(HOOP_V).sub(B.pos).setY(0).normalize().multiplyScalar(Math.min(5, d * 0.5)).add(B.pos)
    for (const x of this.defenders) {
      if (x === own || x.mode?.until > t) continue
      const dd = x.pos.distanceTo(tmp2)
      if (dd < best) (best = dd), (helper = x)
    }
    if (helper && best < 16) {
      helper.helpUntil = t + 1.3
      helper.helpTarget = B
      this.emit('help')
    }
  }

  // ------------------------------------------------------------------ movement
  steer(p, target, maxSpeed, dt, accel = 34) {
    tmp.subVectors(target, p.pos).setY(0)
    const dist = tmp.length()
    const want = Math.min(maxSpeed, dist * 4)
    tmp.normalize().multiplyScalar(want)
    tmp2.subVectors(tmp, p.vel)
    const dv = Math.min(tmp2.length(), accel * dt)
    if (dv > 0) p.vel.addScaledVector(tmp2.normalize(), dv)
    p.pos.addScaledVector(p.vel, dt)
    p.pos.x = Math.max(-COURT_X, Math.min(COURT_X, p.pos.x))
    p.pos.z = Math.max(0.8, Math.min(46.5, p.pos.z))
  }

  brake(p, dt, rate = 30) {
    const sp = p.vel.length()
    if (sp > 0) p.vel.multiplyScalar(Math.max(0, sp - rate * dt) / sp)
    p.pos.addScaledVector(p.vel, dt)
  }

  pathTarget(p, t) {
    const path = p.path
    if (!path?.length) return null
    if (t <= path[0].t) return tmp2.set(path[0].x, 0, path[0].z)
    for (let i = 1; i < path.length; i++) {
      if (t <= path[i].t) {
        const a = path[i - 1]
        const c = path[i]
        const u = (t - a.t) / (c.t - a.t || 1)
        return tmp2.set(a.x + (c.x - a.x) * u, 0, a.z + (c.z - a.z) * u)
      }
    }
    const last = path[path.length - 1]
    return tmp2.set(last.x, 0, last.z)
  }

  moveOffense(p, t, dt) {
    if (this.phase !== 'live' || p.gatherAt || t < p.oneShotUntil - 0.25) {
      this.brake(p, dt)
      return
    }
    if (p.stepback && t < p.stepback.until) {
      this.steer(p, tmp2.copy(p.stepback.dir).multiplyScalar(6).add(p.pos), 13, dt, 60)
      return
    }
    const hasBall = this.ball.holder === p && this.ball.state === 'held'
    if (hasBall && p.driving) {
      // attack: aim a step outside the defender toward the rim
      tmp2.copy(HOOP_V).sub(p.pos).setY(0)
      const d = tmp2.length()
      tmp2.normalize().multiplyScalar(Math.min(d, 6)).add(p.pos)
      const slow = p.pressuredUntil > t ? 0.65 : 1
      this.steer(p, tmp2, (p.speed - 2) * slow * (0.8 + p.rating.handle * 0.2), dt, 40)
      this.face(p, HOOP_V)
      return
    }
    const target = this.pathTarget(p, t)
    if (target) {
      const slow = hasBall ? (p.pressuredUntil > t ? 0.6 : 0.85) : 1
      this.steer(p, target, p.speed * slow, dt)
    } else this.brake(p, dt)
    if (hasBall || !this.ball.holder) this.face(p, HOOP_V)
    else if (this.ball.holder) this.face(p, this.ball.holder.pos)
  }

  moveDefense(d, t, dt) {
    if (this.phase !== 'live' || d.frozenUntil > t) {
      this.brake(d, dt, 20)
      return
    }
    const b = this.ball
    const ballPos = b.state === 'held' ? b.holder.pos : b.state === 'pass' && this.pass ? this.pass.lead : b.pos
    const shooter = this.shot?.shooter ?? (b.holder?.gatherAt ? b.holder : null)
    let target
    let speed = d.speed
    if (shooter && t < (d.oneShotUntil ?? 0) && d.oneShot === 'Contest') {
      target = shooter.pos
      if (d.closeUntil > t) speed += 1.5
    } else if (d.doubleUntil > t && d.doubleTarget && b.holder === d.doubleTarget) {
      const T = d.doubleTarget
      target = tmp.copy(HOOP_V).sub(T.pos).setY(0).normalize().multiplyScalar(2).add(T.pos).setX(T.pos.x + (d.pos.x > T.pos.x ? 2 : -2))
      speed += 1.5
    } else if (d.helpUntil > t && d.helpTarget && b.holder === d.helpTarget) {
      target = tmp.copy(HOOP_V).sub(d.helpTarget.pos).setY(0).normalize().multiplyScalar(3.5).add(d.helpTarget.pos)
      speed += 1
    } else if (d.mode && d.mode.until > t) {
      const U = d.mode.ball
      if (d.mode.type === 'drop') {
        const dd = distToHoop(U.pos)
        target = tmp.copy(HOOP_V).sub(U.pos).setY(0).normalize().multiplyScalar(Math.max(6, dd * 0.5)).add(U.pos)
      } else target = tmp.copy(HOOP_V).sub(U.pos).setY(0).normalize().multiplyScalar(2.2).add(U.pos).setX(U.pos.x + (d.pos.x > U.pos.x ? 1.5 : -1.5))
    } else if (this.coverage.call === 'zone') {
      const [zx, zz] = ZONE_SPOTS[d.slot]
      // the zone defender whose area the ball is in steps out to it
      const owner = this.zoneOwner(ballPos)
      if (owner === d && b.state === 'held') {
        target = tmp.copy(HOOP_V).sub(ballPos).setY(0).normalize().multiplyScalar(3.2).add(ballPos)
        speed += 1.5 // closing out
      } else {
        tmp.set(zx + (ballPos.x - zx) * 0.4, 0, zz + (ballPos.z - zz) * 0.3)
        target = tmp
      }
    } else {
      const m = d.man
      const toHoop = tmp.copy(HOOP_V).sub(m.pos).setY(0)
      const mDist = toHoop.length()
      toHoop.normalize()
      if (b.holder === m && b.state === 'held') {
        target = toHoop.multiplyScalar(Math.min(3.4, mDist * 0.4)).add(m.pos)
      } else {
        const fromBall = m.pos.distanceTo(ballPos)
        if (fromBall < 21) {
          // one pass away: stay between him and the rim, shade toward the ball
          tmp2.copy(ballPos).sub(m.pos).setY(0).normalize().multiplyScalar(1.6)
          target = toHoop.multiplyScalar(Math.min(4, mDist * 0.35)).add(m.pos).add(tmp2)
        } else {
          // help side: sag toward the paint
          tmp2.copy(ballPos).add(HOOP_V).multiplyScalar(0.5)
          target = tmp.copy(m.pos).lerp(tmp2, 0.45)
        }
      }
      if (d.screenedUntil > t) speed *= 0.3
    }
    this.steer(d, target, speed, dt, 30)
    const look = b.holder ?? (this.shot ? HOOP_V : null)
    if (look) this.face(d, look.pos ?? look)
  }

  zoneOwner(pos) {
    let best = null
    let bd = Infinity
    for (const d of this.defenders) {
      const [zx, zz] = ZONE_SPOTS[d.slot]
      const dd = Math.hypot(pos.x - zx, pos.z - zz)
      if (dd < bd) (bd = dd), (best = d)
    }
    return best
  }

  separate() {
    const ps = this.players
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]
        const c = ps[j]
        const dx = c.pos.x - a.pos.x
        const dz = c.pos.z - a.pos.z
        const d2 = dx * dx + dz * dz
        if (d2 > 2.2 * 2.2 || d2 < 1e-6) continue
        const d = Math.sqrt(d2)
        const push = (2.2 - d) * 0.5
        a.pos.x -= (dx / d) * push
        a.pos.z -= (dz / d) * push
        c.pos.x += (dx / d) * push
        c.pos.z += (dz / d) * push
      }
    }
  }

  updateBall(t, dt) {
    const b = this.ball
    if (b.state === 'pass' || b.state === 'shot') {
      const u = Math.max(0, Math.min(1, (t - b.t0) / (b.t1 - b.t0)))
      b.pos.lerpVectors(b.from, b.to, u)
      b.pos.y += 4 * b.arc * u * (1 - u)
    } else if (b.state === 'swish') {
      // through the net and down
      const u = Math.min(1, (t - b.t0) / 0.9)
      b.pos.set(HOOP.x, RIM_HEIGHT - u * 9.4, HOOP.z)
      if (b.pos.y < 0.4) b.pos.y = 0.4
    } else if (b.state === 'loose') {
      b.vel.y -= 32 * dt
      b.pos.addScaledVector(b.vel, dt)
      if (b.pos.y < 0.4) {
        b.pos.y = 0.4
        b.vel.y = Math.abs(b.vel.y) * 0.55
        b.vel.x *= 0.8
        b.vel.z *= 0.8
      }
    }
  }

  /** After the play: the shooter holds the follow-through on a three, bigs flex after a dunk, the bench claps. */
  reaction(p) {
    const r = this.result
    const s = this.shot
    const scored = r && r.points > 0
    const stopped = r && ['miss', 'steal', 'shotclock', 'clock'].includes(r.kind)
    const lead = p.key === 'PG' || p.key === 'C' || p.slot === 'PG' || p.slot === 'C'
    if (p.team === 'off' && scored) {
      if (p === s?.shooter) return s.three ? 'Hold' : p.dunk ? 'Flex' : 'Celebrate'
      return lead ? 'Celebrate' : 'Clap'
    }
    if (p.team === 'def' && stopped) {
      if ((r.kind === 'steal' && p.number === r.by) || (p === s?.contester && s.greatContest)) return 'Flex'
      return lead ? 'Celebrate' : 'Clap'
    }
    if (p.team === 'off' && stopped && p === s?.shooter && r.kind === 'miss') return 'Dejected'
    if (p.team === 'def' && scored && (s?.buzzer || s?.three) && p === s?.contester) return 'Dejected'
    return 'Idle'
  }

  pickAnim(p, t) {
    if (p.oneShot && t < p.oneShotUntil) {
      p.anim = p.oneShot
      return
    }
    p.oneShot = null
    if (this.phase === 'over' || (this.phase === 'dead' && t > this.deadAt + 0.4)) {
      p.anim = this.reaction(p)
      return
    }
    const speed = p.vel.length()
    const hasBall = this.ball.holder === p && this.ball.state === 'held'
    if (p.team === 'def') p.anim = speed > 9 ? 'Run' : speed > 2.5 ? 'DefSlide' : 'Defend'
    else if (hasBall) p.anim = speed > 10 ? 'Run' : 'Dribble'
    else {
      const screening = this.set.screens.some((s) => s.by === p.key && t >= s.from && t <= s.to)
      p.anim = screening && speed < 4 ? 'Block' : speed > 4 ? 'Run' : 'Idle'
    }
  }
}

export const who = (p) => p.name ?? `#${p.number}`
/** Your release timing, when you took the shot yourself. */
const gradeNote = (s) => (s.shooter.byUser && s.grade ? ` ${{ perfect: '🎯 Perfect release.', good: 'Good release.', early: 'Released early.', late: 'Released late.' }[s.grade]}` : '')
