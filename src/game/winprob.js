import MODEL from '../data/wpModel.json'

/*
 * Live win probability for the team on offense in a late "need a touchdown" spot.
 * Logistic model fit by scripts/build-moments.mjs on real 4th-quarter plays (nflverse play-by-play,
 * CC BY 4.0). On held-out plays it scores about the same as nflverse's own win-probability model.
 * The feature list must match features() in that script.
 */
function features({ secs, yl, down, togo, to, dto, diff }) {
  const m = secs / 60
  const y = yl / 100
  const lt = Math.log(Math.max(1, togo))
  return [1, m, Math.sqrt(m), y, y * y, y * m, down === 2 ? 1 : 0, down === 3 ? 1 : 0, down === 4 ? 1 : 0, lt, down === 4 ? lt : 0, to, to * (1 / (m + 0.25)), dto, diff, y < 0.1 ? 1 : 0]
}

/** Win probability (0..1) for the offense, from a drive object. */
export function winProb(d) {
  if (d.status === 'won') return 1
  if (d.status === 'lost') return 0
  const diff = d.scoreOff - d.scoreDef
  if (diff > 0) return 0.99
  const x = features({
    secs: Math.max(0, d.clock),
    yl: Math.max(1, 100 - d.ballOn),
    down: d.down,
    togo: d.toGo,
    to: d.timeouts,
    dto: d.defTimeouts ?? 2,
    diff: Math.max(-8, Math.min(-3, diff)),
  })
  let z = 0
  for (let i = 0; i < x.length; i++) z += MODEL.w[i] * x[i]
  const p = 1 / (1 + Math.exp(-z))
  return Math.min(0.995, Math.max(0.005, p))
}

export const pct = (p) => `${Math.round(p * 100)}%`
