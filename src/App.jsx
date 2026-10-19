import { Suspense, lazy, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Analytics } from '@vercel/analytics/react'
import Landing from './pages/Landing'
import ViewerScene from './scenes/ViewerScene'
import { CLIPS, TEAM_BY_ABBR } from './three/characters'
import { Link, useRoute } from './router'
import { BRAND } from './brand'
import { Logo } from './ui/Logo'
import { load, save } from './game/storage'
import { TeamSelect } from './ui/TeamSelect'
import { MuteButton } from './ui/GameUI'

const Game = lazy(() => import('./pages/Game'))
const H2H = lazy(() => import('./pages/H2H'))
const Defend = lazy(() => import('./pages/Defend'))
const Hoops = lazy(() => import('./pages/Hoops'))

const MODE_LABEL = { daily: 'Daily Drive', survivor: 'Survivor', practice: 'Practice', defense: 'Defense', h2h: 'Head-to-Head' }

export default function App() {
  const { path, query } = useRoute()
  let page
  if (path === '/play') {
    const mode = query.get('mode') ?? 'daily'
    page = (
      <Shell title={MODE_LABEL[mode] ?? 'Daily Drive'} mode={mode}>
        <Suspense fallback={<div className="loading">Lacing up cleats…</div>}>
          {mode === 'defense' ? <Defend daily={query.get('daily') === '1'} key={`d${query.get('daily')}`} /> : <Game mode={mode} key={mode} />}
        </Suspense>
      </Shell>
    )
  } else if (path === '/h2h') {
    page = (
      <Shell title="Head-to-Head" mode="h2h">
        <Suspense fallback={<div className="loading">Lacing up cleats…</div>}>
          <H2H room={query.get('room')} />
        </Suspense>
      </Shell>
    )
  } else if (path === '/hoops') {
    const mode = query.get('mode') ?? 'daily'
    page = (
      <Shell title="Clutch Hoops" mode={`hoops-${mode}`}>
        <Suspense fallback={<div className="loading">Lacing up sneakers…</div>}>
          <Hoops mode={mode} key={mode} />
        </Suspense>
      </Shell>
    )
  } else if (path === '/locker') {
    page = (
      <Shell title="Locker Room">
        <Locker />
      </Shell>
    )
  } else {
    page = <Landing />
  }
  return (
    <>
      {page}
      <Analytics />
    </>
  )
}

function Shell({ title, mode, children }) {
  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand" aria-label={`${BRAND.name} home`}>
          {mode?.startsWith('hoops') ? <span className="hoops-logo" aria-hidden="true">🏀</span> : <Logo size={26} />}
          <span className="title">{mode?.startsWith('hoops') ? 'CLUTCH HOOPS' : BRAND.name.toUpperCase()}</span>
        </Link>
        <div className="top-right">
          <nav className="tabs">
            {mode?.startsWith('hoops')
              ? [['hoops-daily', 'Daily', '/hoops?mode=daily'], ['hoops-practice', 'Practice', '/hoops?mode=practice'], ['nfl', '🏈 Football', '/play?mode=daily']].map(([m, label, to]) => (
                  <Link key={m} to={to} className={mode === m ? 'on' : ''}>{label}</Link>
                ))
              : ['daily', 'survivor', 'practice', 'defense', 'h2h', 'hoops'].map((m) => (
                  <Link key={m} to={m === 'h2h' ? '/h2h' : m === 'hoops' ? '/hoops' : `/play?mode=${m}`} className={mode === m ? 'on' : ''}>
                    {m === 'h2h' ? 'H2H' : m === 'hoops' ? '🏀 Hoops' : MODE_LABEL[m].replace(' Drive', '')}
                  </Link>
                ))}
          </nav>
          {mode && <MuteButton />}
        </div>
      </header>
      <div className="stage" aria-label={title}>{children}</div>
    </div>
  )
}

function Locker() {
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
