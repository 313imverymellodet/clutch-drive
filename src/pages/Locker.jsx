import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import ViewerScene from '../scenes/ViewerScene'
import { CLIPS, TEAM_BY_ABBR } from '../three/characters'
import { load, save } from '../game/storage'
import { TeamSelect } from '../ui/TeamSelect'

/** Locker Room: look at the players and their animations up close. */
export default function Locker() {
  const [clip, setClip] = useState('Celebrate')
  const [speed, setSpeed] = useState(1)
  const [lineup, setLineup] = useState(true)
  const [teams, setTeams] = useState(() => load('cd.locker', { team: 'MIN', opp: 'DEN' }))
  const pick = (k, v) => {
    const next = { ...teams, [k]: v }
    setTeams(next)
    save('cd.locker', next)
  }
  return (
    <>
      <Suspense fallback={<div className="loading">Lacing up cleats…</div>}>
        <Canvas dpr={[1, 2]} camera={{ fov: 35, position: [2.2, 1.9, 5.2] }}>
          <ViewerScene clip={clip} team={TEAM_BY_ABBR[teams.team]} opponent={TEAM_BY_ABBR[teams.opp]} speed={speed} lineup={lineup} />
        </Canvas>
      </Suspense>
      <div className="hud-bottom">
        <div className="card locker">
          <div className="chips">
            {CLIPS.map((c) => (
              <button key={c} className={c === clip ? 'chip on' : 'chip'} onClick={() => setClip(c)}>{c}</button>
            ))}
          </div>
          <div className="row">
            <TeamSelect label="Team" value={teams.team} onChange={(v) => pick('team', v)} />
            {lineup && <TeamSelect label="Opponent" value={teams.opp} onChange={(v) => pick('opp', v)} />}
          </div>
          <div className="row">
            <label className="speed">
              Speed {speed.toFixed(2)}×
              <input type="range" min="0.1" max="2" step="0.05" value={speed} onChange={(e) => setSpeed(+e.target.value)} />
            </label>
            <label className="toggle">
              <input type="checkbox" checked={lineup} onChange={(e) => setLineup(e.target.checked)} /> Lineup
            </label>
          </div>
        </div>
      </div>
    </>
  )
}
