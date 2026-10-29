import { Suspense, lazy, useEffect, useRef } from 'react'
import { Analytics } from '@vercel/analytics/react'
import Landing from './pages/Landing'
import { Link, useRoute } from './router'
import { BRAND } from './brand'
import { Logo } from './ui/Logo'
import { MuteButton } from './ui/MuteButton'
import { SettingsButton } from './ui/Settings'
import { applyMeta } from './seo'

const Game = lazy(() => import('./pages/Game'))
const H2H = lazy(() => import('./pages/H2H'))
const Defend = lazy(() => import('./pages/Defend'))
const Hoops = lazy(() => import('./pages/Hoops'))
const Locker = lazy(() => import('./pages/Locker'))
const HowToPlay = lazy(() => import('./pages/HowToPlay'))

const MODE_LABEL = { daily: 'Daily Drive', survivor: 'Survivor', practice: 'Practice', defense: 'Defense', h2h: 'Head-to-Head' }

export default function App() {
  const { path, query } = useRoute()
  const modeParam = query.get('mode')
  useEffect(() => {
    // the mode pages share one HTML file and canonical URL; give them their own tab title
    const title =
      path === '/play' && modeParam && modeParam !== 'daily' ? `${MODE_LABEL[modeParam] ?? 'Practice'} | ${BRAND.name}`
        : path === '/hoops' && (modeParam === 'practice' || modeParam === 'survivor') ? `${modeParam === 'practice' ? 'Practice' : 'Survivor'} | Clutch Hoops`
          : null
    applyMeta(path, title)
  }, [path, modeParam])
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
        <Suspense fallback={<div className="loading">Lacing up cleats…</div>}>
          <Locker />
        </Suspense>
      </Shell>
    )
  } else if (path === '/how-to-play') {
    page = (
      <Suspense fallback={<div className="loading">Loading…</div>}>
        <HowToPlay />
      </Suspense>
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
  // on phones the tabs scroll sideways: keep the current one in view
  const tabs = useRef(null)
  useEffect(() => {
    const nav = tabs.current
    const on = nav?.querySelector('.on')
    if (on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += on.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - on.offsetWidth) / 2
  }, [mode])
  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand" aria-label={`${BRAND.name} home`}>
          {mode?.startsWith('hoops') ? <span className="hoops-logo" aria-hidden="true">🏀</span> : <Logo size={26} />}
          <span className="title">{mode?.startsWith('hoops') ? 'CLUTCH HOOPS' : BRAND.name.toUpperCase()}</span>
        </Link>
        <div className="top-right">
          <nav className="tabs" ref={tabs}>
            {mode?.startsWith('hoops')
              ? [['hoops-daily', 'Daily', '/hoops?mode=daily'], ['hoops-survivor', 'Survivor', '/hoops?mode=survivor'], ['hoops-practice', 'Practice', '/hoops?mode=practice'], ['nfl', '🏈 Football', '/play?mode=daily']].map(([m, label, to]) => (
                  <Link key={m} to={to} className={mode === m ? 'on' : ''}>{label}</Link>
                ))
              : ['daily', 'survivor', 'practice', 'defense', 'h2h', 'hoops'].map((m) => (
                  <Link key={m} to={m === 'h2h' ? '/h2h' : m === 'hoops' ? '/hoops' : `/play?mode=${m}`} className={mode === m ? 'on' : ''}>
                    {m === 'h2h' ? 'H2H' : m === 'hoops' ? '🏀 Hoops' : MODE_LABEL[m].replace(' Drive', '')}
                  </Link>
                ))}
          </nav>
          {mode && <MuteButton />}
          {mode && <SettingsButton sport={mode.startsWith('hoops') ? 'hoops' : 'football'} />}
        </div>
      </header>
      <div className="stage" aria-label={title}>{children}</div>
    </div>
  )
}
