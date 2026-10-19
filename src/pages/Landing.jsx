import { Suspense, lazy, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { NFL_TEAMS, TEAM_BY_ABBR } from '../data/nflTeams'
import { dayNumber, fmtBallOn, fmtClock, todayKey } from '../game/drive'
import { DATA_CREDIT, momentForDay, momentLabel, scenarioFromMoment } from '../game/moments'
import { TeamLogo, rosterFor, useRealData } from '../game/real'
import { load } from '../game/storage'
import { Link } from '../router'
import { BRAND } from '../brand'
import { Logo } from '../ui/Logo'

const HeroScene = lazy(() => import('../scenes/HeroScene'))

export default function Landing() {
  const key = todayKey()
  const day = dayNumber(key)
  const sc = useMemo(() => scenarioFromMoment(momentForDay(key), `daily-${key}`), [key])
  const off = TEAM_BY_ABBR[sc.offense]
  const def = TEAM_BY_ABBR[sc.defense]
  const realData = useRealData()
  const qb = useMemo(() => rosterFor({ moment: sc.moment, offense: sc.offense, defense: sc.defense })?.off?.qb?.[1], [sc, realData]) // eslint-disable-line react-hooks/exhaustive-deps
  const played = load(`cd.daily.${key}`, null)
  const surv = load('cd.survivor', { best: 0 })

  return (
    <div className="landing">
      <nav className="land-nav">
        <Link to="/" className="land-logo" aria-label={`${BRAND.name} home`}>
          <Logo />
          <span>{BRAND.name.toUpperCase()}</span>
        </Link>
        <div className="land-links">
          <Link to="/play?mode=survivor">Survivor</Link>
          <Link to="/h2h">Head-to-Head</Link>
          <Link to="/hoops">🏀 Hoops <span className="new-pill">NEW</span></Link>
          <Link to="/locker">Locker Room</Link>
          <Link to="/play?mode=daily" className="btn primary small">Play</Link>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-canvas" aria-hidden="true">
          <Suspense fallback={null}>
            <Canvas dpr={[1, 2]} camera={{ fov: 30, position: [0, 3.9, 11.6] }} gl={{ alpha: true }} onCreated={({ camera }) => camera.lookAt(0, 0.85, 0)}>
              <HeroScene offense={off} defense={def} />
            </Canvas>
          </Suspense>
        </div>
        <div className="hero-copy">
          <div className="eyebrow pill">
            <span className="dot" /> Daily Drive #{day} is live
          </div>
          <h1>
            <span className="h1-a">CLUTCH</span>
            <span className="h1-b">DRIVE</span>
          </h1>
          <p className="hero-tag">{BRAND.tagline}</p>
          <div className="matchup-chip">
            <span className="mc-team" style={{ background: off.endzone, color: off.text }}><TeamLogo abbr={off.abbr} size={20} />{off.abbr}</span>
            <span className="mc-mid">
              <b>{fmtClock(sc.clock)}</b> left · down {sc.scoreDef - sc.scoreOff} · ball on {fmtBallOn(sc.ballOn)} · real win prob {Math.round(sc.moment.wp * 100)}%
            </span>
            <span className="mc-team" style={{ background: def.endzone, color: def.text }}><TeamLogo abbr={def.abbr} size={20} />{def.abbr}</span>
          </div>
          <div className="hero-ctas">
            <Link to="/play?mode=daily" className="btn primary big">
              {played ? "See today's result" : "Play today's drive"}
            </Link>
            <Link to="/h2h" className="btn big">⚔️ Duel a friend</Link>
          </div>
          <p className="hero-fine">📅 Today is a real moment: {momentLabel(sc.moment)}.{qb && <> You're {qb}.</>} Can you beat what really happened?</p>
        </div>
      </header>

      <section className="how">
        <h2>How it works</h2>
        <div className="how-grid">
          <article>
            <span className="num">1</span>
            <h3>Read the situation</h3>
            <p>Every Daily is a real NFL moment: the actual score, clock, field position and timeouts. Only a touchdown wins it, and a live win-probability meter shows every swing.</p>
          </article>
          <article>
            <span className="num">2</span>
            <h3>Call the play</h3>
            <p>18 real concepts (Levels, Flood, Mesh, Smash, Four Verts, QB Blast…). Set your read progression, then watch your QB work it in 3D.</p>
          </article>
          <article>
            <span className="num">3</span>
            <h3>Brag about it</h3>
            <p>Everyone gets the same drive each day. Share your result and see who's more clutch.</p>
            <div className="share-sample">
              <div>{BRAND.name} #{day} 🏈</div>
              <div>{off.abbr} 27–24 {def.abbr} ✅ with 0:09 left</div>
              <div>🟩🟨🟥🟩⏱️🟩🏈</div>
            </div>
          </article>
        </div>
      </section>

      <section className="modes">
        <Link to="/hoops" className="mode-card hoops">
          <span className="mode-emoji">🏀</span>
          <h3>Clutch Hoops <span className="new-pill">NEW</span></h3>
          <p>Down late, your ball. Call the set, read the coverage, time your jumper at the top. A new game every day.</p>
        </Link>
        <Link to="/play?mode=daily" className="mode-card daily">
          <span className="mode-emoji">📅</span>
          <h3>Daily Drive</h3>
          <p>One shot a day. Same drive for everyone.</p>
        </Link>
        <Link to="/play?mode=survivor" className="mode-card survivor">
          <span className="mode-emoji">🔥</span>
          <h3>Survivor</h3>
          <p>Win to stay alive. Each game gets harder.{surv.best ? ` Your best: ${surv.best}.` : ''}</p>
        </Link>
        <Link to="/play?mode=defense" className="mode-card defense">
          <span className="mode-emoji">🛡️</span>
          <h3>Defense</h3>
          <p>You just took the lead. Call coverages, disguise your looks and stop their two-minute drive.</p>
        </Link>
        <Link to="/h2h" className="mode-card h2h">
          <span className="mode-emoji">⚔️</span>
          <h3>Head-to-Head</h3>
          <p>Send a link. You call their defense, they call yours. Disguise it, guess their play, out-scheme your friend.</p>
        </Link>
        <Link to="/play?mode=practice" className="mode-card practice">
          <span className="mode-emoji">🏟️</span>
          <h3>Practice</h3>
          <p>Pick any two teams and run it as many times as you like.</p>
        </Link>
      </section>

      <section className="teams">
        <h2>All 32 teams</h2>
        <div className="marquee" aria-label="Teams">
          <div className="marquee-track">
            {[...NFL_TEAMS, ...NFL_TEAMS].map((t, i) => (
              <span key={i} className="team-chip" style={{ background: t.endzone, color: t.text }} aria-hidden={i >= NFL_TEAMS.length}>
                {t.abbr}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <h2>The clock is running.</h2>
        <Link to="/play?mode=daily" className="btn primary big">Take the field</Link>
      </section>

      <footer className="land-foot">
        <p>{BRAND.disclaimer}</p>
        <p>{DATA_CREDIT} <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noreferrer">nflverse</a></p>
      </footer>
    </div>
  )
}
