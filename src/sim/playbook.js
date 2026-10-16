/*
 * Offensive playbook. Same 11-man formation every snap (can be flipped left/right):
 *
 *   Z (-14,-1.5)   TE (-4.8,-1.3)   [OL]   SLOT (9,-1.5)   X (17,-1)
 *                         QB (0,-5)   RB (1.6,-5)
 *
 * Routes are polylines in (x, yards past the line). Each pass play lists its default read
 * progression (first look, second look, check-down); the player can reorder it before the snap.
 * `sideline` = receivers who get out of bounds after the catch (clock management).
 * Run plays give the hole (x) and the ball carrier's path.
 */

export const FAMILIES = {
  quick: { label: 'Quick', blurb: 'Ball out fast. Beats the blitz.' },
  mid: { label: 'Intermediate', blurb: 'Chunk plays over the middle and outside.' },
  deep: { label: 'Deep', blurb: 'Take a shot. Needs time.' },
  run: { label: 'Run', blurb: 'Keep it on the ground. Clock keeps running.' },
}

export const ELIGIBLE = ['x', 'slot', 'z', 'te', 'rb']
export const POS_LABEL = { x: 'X', slot: 'Slot', z: 'Z', te: 'TE', rb: 'RB', qb: 'QB' }

const P = (label, family, desc, extra) => ({ label, family, desc, ...extra })

export const PLAYBOOK = {
  // ------------------------------------------------------------ quick game (3-step)
  out: P('Quick Out', 'quick', 'Slot out to the sideline. Stops the clock.', {
    tag: 'Stops clock', drop: 3, sideline: ['slot', 'te'],
    routes: {
      slot: [[9, -1.5], [9, 3.5], [23, 4.3]],
      z: [[-14, -1.5], [-14, 1.5], [-7, 6]],
      x: [[17, -1], [17, 28]],
      te: [[-4.8, -1.3], [-6, 0], [-14, 2]],
      rb: [[1.6, -5], [4, -3], [6, -2]],
    },
    reads: ['slot', 'z', 'rb'],
  }),
  slant: P('Slant-Flat', 'quick', 'Slant inside, slot to the flat. Quickest throw in the book.', {
    tag: 'Blitz beater', drop: 3, sideline: ['slot'],
    routes: {
      x: [[17, -1], [17, 1.5], [10, 7]],
      slot: [[9, -1.5], [10, 0], [19, 1.5]],
      z: [[-14, -1.5], [-14, 1.5], [-8, 7]],
      te: [[-4.8, -1.3], [-4.8, 5], [-6.5, 5.5]],
      rb: [[1.6, -5], [0, -1.5], [0, 2]],
    },
    reads: ['x', 'slot', 'te'],
  }),
  stick: P('Stick', 'quick', 'TE sits down at 5, back leaks to the flat.', {
    tag: 'Sure yards', drop: 3, sideline: ['rb'],
    routes: {
      te: [[-4.8, -1.3], [-4.8, 5.5], [-6.5, 6]],
      rb: [[1.6, -5], [-4, -3], [-11, -1]],
      z: [[-14, -1.5], [-14, 30]],
      slot: [[9, -1.5], [9, 5.5], [7.5, 6]],
      x: [[17, -1], [17, 30]],
    },
    reads: ['te', 'rb', 'slot'],
  }),
  hitch: P('Hitches', 'quick', 'Everyone runs 6 and turns around. Great vs. soft corners.', {
    tag: 'Vs. soft D', drop: 3,
    routes: {
      x: [[17, -1], [17, 6], [16, 5]],
      slot: [[9, -1.5], [9, 6], [9.5, 5]],
      z: [[-14, -1.5], [-14, 6], [-13, 5]],
      te: [[-4.8, -1.3], [-4.8, 18]],
      rb: [[1.6, -5], [3, -2], [3, 0]],
    },
    reads: ['x', 'z', 'slot'],
  }),
  // ------------------------------------------------------------ intermediate (5/7-step)
  dig: P('Dig', 'mid', 'X runs a 13-yard in-breaker over the middle.', {
    tag: 'Chunk gain', drop: 7,
    routes: {
      x: [[17, -1], [17, 10], [15.5, 11.8], [4, 13], [-6, 13.5]],
      z: [[-14, -1.5], [-14.5, 30]],
      slot: [[9, -1.5], [9, 4.5], [19, 5]],
      te: [[-4.8, -1.3], [-4.8, 1.5], [3, 3.5], [10, 4]],
      rb: [[1.6, -5], [2.4, -3.5], [7, -1.5], [9, -1]],
    },
    reads: ['x', 'slot', 'rb'],
  }),
  levels: P('Levels', 'mid', 'Two in-breakers stacked at 5 and 12 yards. Reads the linebacker.', {
    tag: 'Beats zone', drop: 5,
    routes: {
      x: [[17, -1], [17, 12], [5, 12.5], [-2, 13]],
      slot: [[9, -1.5], [9, 5], [1, 5.5], [-4, 6]],
      te: [[-4.8, -1.3], [-4.8, 1.5], [8, 3], [14, 3.5]],
      z: [[-14, -1.5], [-14, 30]],
      rb: [[1.6, -5], [4, -2.5], [5, -1]],
    },
    reads: ['x', 'slot', 'te'],
  }),
  flood: P('Flood', 'mid', 'Three levels to one sideline: sail, flat, and a crosser from the other side.', {
    tag: 'Beats Cover 3', drop: 7, sideline: ['slot', 'rb'],
    routes: {
      slot: [[9, -1.5], [9, 8], [21, 13.5]],
      rb: [[1.6, -5], [6, -3], [16, 0]],
      te: [[-4.8, -1.3], [-4.8, 2], [14, 9.5]],
      x: [[17, -1], [17, 30]],
      z: [[-14, -1.5], [-14, 10], [-6, 20]],
    },
    reads: ['slot', 'te', 'rb'],
  }),
  mesh: P('Mesh', 'mid', 'Two shallow crossers rub off each other. Man-coverage killer.', {
    tag: 'Beats man', drop: 5,
    routes: {
      slot: [[9, -1.5], [9, 1.5], [-12, 3]],
      te: [[-4.8, -1.3], [-4.8, 2.2], [12, 3.4]],
      x: [[17, -1], [17, 10], [24, 18]],
      z: [[-14, -1.5], [-14, 10], [-2, 11]],
      rb: [[1.6, -5], [6, -3], [12, 0], [14, 15]],
    },
    reads: ['slot', 'te', 'z'],
  }),
  curl: P('Curl-Flat', 'mid', 'Outside curls at 11 with flats underneath. Safe chain-mover.', {
    tag: 'Move chains', drop: 5, sideline: ['slot', 'te'],
    routes: {
      x: [[17, -1], [17, 11], [16, 10]],
      slot: [[9, -1.5], [9, 1], [18, 2]],
      z: [[-14, -1.5], [-14, 11], [-13, 10]],
      te: [[-4.8, -1.3], [-9, 1], [-16, 2]],
      rb: [[1.6, -5], [1, -2], [1, 0.5]],
    },
    reads: ['x', 'slot', 'z'],
  }),
  smash: P('Smash', 'mid', 'Hitch underneath, corner over the top. Cover 2 beater.', {
    tag: 'Beats Cover 2', drop: 5, sideline: ['slot'],
    routes: {
      x: [[17, -1], [17, 5], [16.5, 4.5]],
      slot: [[9, -1.5], [9, 9], [21, 17]],
      z: [[-14, -1.5], [-14, 10], [-7, 20]],
      te: [[-4.8, -1.3], [-8, 0], [-15, 1]],
      rb: [[1.6, -5], [3, -2], [3.5, 0]],
    },
    reads: ['slot', 'x', 'te'],
  }),
  cross: P('Y-Cross', 'mid', 'Tight end on a deep crosser behind the linebackers.', {
    tag: 'Big window', drop: 7,
    routes: {
      te: [[-4.8, -1.3], [-4.8, 4], [16, 16]],
      x: [[17, -1], [17, 10], [10, 22]],
      slot: [[9, -1.5], [9, 1], [-10, 2]],
      z: [[-14, -1.5], [-14, 14], [-15.5, 12]],
      rb: [[1.6, -5], [3, -2.5], [3, 0]],
    },
    reads: ['te', 'z', 'slot'],
  }),
  // ------------------------------------------------------------ deep shots (7-step)
  deep: P('Deep Shot', 'deep', 'Z on a go route down the sideline.', {
    tag: 'Boom or bust', drop: 7.6,
    routes: {
      z: [[-14, -1.5], [-14.5, 60]],
      x: [[17, -1], [17, 11], [8, 25]],
      slot: [[9, -1.5], [9, 3], [19, 4]],
      te: [[-4.8, -1.3], [-4.8, 1.5], [3, 3.5], [10, 4]],
      rb: [[1.6, -5], [2.4, -3.5], [7, -1.5], [9, -1]],
    },
    reads: ['z', 'x', 'rb'],
  }),
  verts: P('Four Verts', 'deep', 'Everybody goes. Stretches any coverage vertically.', {
    tag: 'Stretch it', drop: 7,
    routes: {
      x: [[17, -1], [17, 40]],
      slot: [[9, -1.5], [8, 40]],
      z: [[-14, -1.5], [-14, 40]],
      te: [[-4.8, -1.3], [-6, 40]],
      rb: [[1.6, -5], [1, -2], [0.5, 1]],
    },
    reads: ['slot', 'te', 'rb'],
  }),
  postwheel: P('Post-Wheel', 'deep', 'X clears with a post, slot wheels up the sideline behind it.', {
    tag: 'Shot play', drop: 7, sideline: ['slot'],
    routes: {
      x: [[17, -1], [17, 11], [7, 25]],
      slot: [[9, -1.5], [12, 1], [16, 4], [17, 34]],
      z: [[-14, -1.5], [-14, 12], [-3, 13]],
      te: [[-4.8, -1.3], [-4.8, 1.5], [-9, 3]],
      rb: [[1.6, -5], [3, -2.5], [3.5, 0]],
    },
    reads: ['x', 'slot', 'z'],
  }),
  // ------------------------------------------------------------ runs
  run: P('HB Dive', 'run', 'Handoff straight up the A gap.', {
    tag: 'Clock runs', run: { carrier: 'rb', hole: -0.8, path: [[1.6, -5], [0.5, -4.4], [-0.8, -1.6], [-0.8, 4]], handoff: 0.45 },
  }),
  outside: P('Outside Zone', 'run', 'Pitch it wide and let the back find a crease on the edge.', {
    tag: 'Get the edge', run: { carrier: 'rb', hole: 7, path: [[1.6, -5], [5.5, -4.2], [10, -1.5], [11.5, 1.5], [12, 6]], handoff: 0.15, toss: true },
  }),
  draw: P('HB Draw', 'run', 'Fake pass, then hand it off late. Punishes soft zones and the prevent.', {
    tag: 'Vs. soft zones', run: { carrier: 'rb', hole: -2.4, path: [[1.6, -5], [0.6, -4], [-2.4, -1.4], [-2.4, 4]], handoff: 1.05, draw: true },
  }),
  blast: P('QB Blast', 'run', 'The QB keeps it and blasts up the middle behind a lead block. Short yardage.', {
    tag: 'Power!', run: { carrier: 'qb', hole: 2.4, path: [[0, -5], [1.4, -3.2], [2.4, -1], [2.4, 4]], handoff: 0.35, lead: 'rb' },
  }),
}

export const PLAY_IDS = Object.keys(PLAYBOOK)
export const isPass = (id) => !PLAYBOOK[id]?.run
export const playsByFamily = (fam) => PLAY_IDS.filter((id) => PLAYBOOK[id].family === fam)

/** Receivers with a route (the progression can only use these). */
export const eligibleFor = (id) => ELIGIBLE.filter((k) => PLAYBOOK[id]?.routes?.[k])
