// Plays every set against every coverage many times and prints points per possession, shot mix and
// turnovers, to tune the hoops sim.  node scripts/hoops-outcomes.mjs [n=150]
import { HoopsSim, FIXED_DT } from '../src/hoops/sim.js'
import { SET_IDS, COVERAGE_IDS } from '../src/hoops/sets.js'

const N = +(process.argv[2] ?? 150)
const rows = []
let total = { pts: 0, n: 0 }
for (const set of SET_IDS) {
  const row = [set.padEnd(7)]
  for (const call of COVERAGE_IDS) {
    let pts = 0, threes = 0, rim = 0, tos = 0, fouls = 0, shots = 0, makes = 0, time = 0
    for (let seed = 1; seed <= N; seed++) {
      const s = new HoopsSim()
      s.reset({ set, seed: seed * 7919 + call.length, coverage: { call, shown: call }, flip: seed % 2 === 0 })
      s.start()
      for (let i = 0; i < 60 * 30 && s.phase !== 'over'; i++) s.step(FIXED_DT)
      const r = s.result
      if (!r) continue
      const ftPts = (r.fts ?? 0) * 0.78
      pts += r.points + ftPts
      time += r.elapsed
      if (r.shot) {
        shots++
        if (r.points) makes++
        if (r.shot.three) threes++
        if (r.shot.label === 'layup') rim++
      }
      if (['steal', 'shotclock', 'clock'].includes(r.kind)) tos++
      if (r.fts) fouls++
    }
    total.pts += pts
    total.n += N
    row.push(`${call}:${(pts / N).toFixed(2)} (3s ${Math.round((100 * threes) / Math.max(1, shots))}% rim ${Math.round((100 * rim) / Math.max(1, shots))}% to ${Math.round((100 * tos) / N)}% fg ${Math.round((100 * makes) / Math.max(1, shots))}% ${(time / N).toFixed(1)}s)`)
  }
  rows.push(row.join('  '))
}
console.log(rows.join('\n'))
console.log(`overall ${(total.pts / total.n).toFixed(3)} pts/possession (NBA late-game ~1.05-1.15)`)
