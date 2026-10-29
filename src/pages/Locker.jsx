import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import ViewerScene from '../scenes/ViewerScene'
import { CLIPS, HOOPS_CLIPS, TEAM_BY_ABBR } from '../three/characters'
import { NBA_BY_ABBR } from '../hoops/teams'
import { load, save } from '../game/storage'
import { TeamSelect } from '../ui/TeamSelect'
import { NbaTeamSelect } from '../hoops/HoopsUI'

/** Locker Room: meet the players. Both sports, every animation, body types and gear by position. */
export default function Locker() {
  const [sport, setSport] = useState(() => load('cd.locker.sport', 'football'))
  const [clip, setClip] = useState('Celebrate')
  const [speed, setSpeed] = useState(1)
  const [lineup, setLineup] = useState(true)
  const [seed, setSeed] = useState(0)
  const [teams, setTeams] = useState(() => load('cd.locker', { team: 'MIN', opp: 'DEN', nba: 'LAL', nbaOpp: 'BOS' }))
  const pick = (k, v) => {
    const next = { ...teams, [k]: v }
    setTeams(next)
    save('cd.locker', next)
  }
  const pickSport = (s) => {
    setSport(s)
    save('cd.locker.sport', s)
    const list = s === 'hoops' ? HOOPS_CLIPS : CLIPS
    if (!list.includes(clip)) setClip('Celebrate')
  }
  const hoops = sport === 'hoops'
  const team = hoops ? NBA_BY_ABBR[teams.nba ?? 'LAL'] : TEAM_BY_ABBR[teams.team]
  const opponent = hoops ? NBA_BY_ABBR[teams.nbaOpp ?? 'BOS'] : TEAM_BY_ABBR[teams.opp]
  return (
    <>
      <Suspense fallback={<div className="loading">Lacing up…</div>}>
        <Canvas dpr={[1, 2]} camera={{ fov: 35, position: [1.5, 2.4, 9.6] }}>
          <ViewerScene sport={sport} clip={clip} team={team} opponent={opponent} speed={speed} lineup={lineup} seed={seed} />
        </Canvas>
      </Suspense>
      <div className="hud-bottom">
        <div className="card locker">
          <div className="seg locker-sport" role="radiogroup" aria-label="Sport">
            {[['football', '🏈 Football'], ['hoops', '🏀 Basketball']].map(([k, label]) => (
              <button key={k} role="radio" aria-checked={sport === k} className={sport === k ? 'on' : ''} onClick={() => pickSport(k)}>{label}</button>
            ))}
          </div>
          <div className="chips">
            {(hoops ? HOOPS_CLIPS : CLIPS).map((c) => (
              <button key={c} className={c === clip ? 'chip on' : 'chip'} onClick={() => setClip(c)}>{c}</button>
            ))}
          </div>
          <div className="row">
            {hoops ? (
              <>
                <NbaTeamSelect label="Team" value={teams.nba ?? 'LAL'} onChange={(v) => pick('nba', v)} />
                {lineup && <NbaTeamSelect label="Opponent" value={teams.nbaOpp ?? 'BOS'} onChange={(v) => pick('nbaOpp', v)} />}
              </>
            ) : (
              <>
                <TeamSelect label="Team" value={teams.team} onChange={(v) => pick('team', v)} />
                {lineup && <TeamSelect label="Opponent" value={teams.opp} onChange={(v) => pick('opp', v)} />}
              </>
            )}
          </div>
          <div className="row">
            <label className="speed">
              Speed {speed.toFixed(2)}×
              <input type="range" min="0.1" max="2" step="0.05" value={speed} onChange={(e) => setSpeed(+e.target.value)} />
            </label>
            <label className="toggle">
              <input type="checkbox" checked={lineup} onChange={(e) => setLineup(e.target.checked)} /> Lineup
            </label>
            <button className="chip" onClick={() => setSeed((s) => s + 1)}>🎲 New looks</button>
          </div>
        </div>
      </div>
    </>
  )
}
