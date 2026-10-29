import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { HoopsSim } from '../hoops/sim'
import { COVERAGES, SETS } from '../hoops/sets'
import { NBA_BY_ABBR } from '../hoops/teams'
import { aiCoverage, aiSet, aiWillFoul, applyFoul, applyPossession, boostsFor, fmtClock, makeScenario, newGame, possRng, possSeed, shareText, startPossession, winProb } from '../hoops/game'
import { hoopsSound, hsfx, setChant } from '../hoops/sound'
import { CoveragePicker, FreeThrows, HoopsBug, HoopsControls, NbaTeamSelect, SetPicker, hoopsHeadline } from '../hoops/HoopsUI'
import { Countdown, ShareButton, WPChart, WinProbMeter } from '../ui/GameUI'
import { HOOPS_DATA_CREDIT, HOOPS_DATA_URL, hoopsMomentForDay, hoopsMomentLabel, hoopsRealOutcome, scenarioFromHoopsMoment } from '../hoops/moments'
import { TeamLogo } from '../game/real'
import { dayNumber, todayKey } from '../game/drive'
import { load, save } from '../game/storage'
import { preloadHoops, setAmbienceLevel, startAmbience, stopAmbience, unlock } from '../game/sound'
import { Link, navigate } from '../router'
import { captureCanvasProps } from '../capture'

const HoopsScene = lazy(() => import('../hoops/HoopsScene'))
const SITE = typeof location !== 'undefined' ? location.origin : ''
const meterTeam = (t) => ({ endzone: t.jersey, stripe: t.trim })

export default function Hoops({ mode: rawMode }) {
  const mode = rawMode === 'practice' ? 'practice' : 'daily'
  const dateKey = todayKey()
  const day = dayNumber(dateKey)
  const [practice, setPractice] = useState(() => load('cd.hoops.practice', { you: 'LAL', them: 'BOS', n: 0 }))
  const scenario = useMemo(
    () => (mode === 'daily' ? scenarioFromHoopsMoment(hoopsMomentForDay(dateKey), `daily-${dateKey}`) : makeScenario(`practice-${practice.n}`, { you: practice.you, them: practice.them })),
    [mode, dateKey, practice.n, practice.you, practice.them],
  )
  const saved = mode === 'daily' ? load(`cd.hoops.${dateKey}`, null) : null
  const you = NBA_BY_ABBR[scenario.you]
  const them = NBA_BY_ABBR[scenario.them]
  const home = scenario.youHome ? you : them

  const [g, setG] = useState(() => newGame(scenario))
  const [stage, setStage] = useState(saved ? 'over' : 'intro') // intro | call | defcall | live | ft | result | over
  const [sim] = useState(() => new HoopsSim())
  const [simKey, setSimKey] = useState(0)
  const [status, setStatus] = useState({ phase: 'presnap' })
  const [ctx, setCtx] = useState(null) // the possession in progress: { team, set, coverage, start, ft }
  const [lastPoss, setLastPoss] = useState(null)
  const [replaying, setReplaying] = useState(false)
  const [timeoutOn, setTimeoutOn] = useState(false)
  const applied = useRef(null)
  if (import.meta.env.DEV) window.__hoops = { sim, g }

  // fresh game on scenario change
  useEffect(() => {
    setG(newGame(scenario))
    setStage(mode === 'daily' && load(`cd.hoops.${dateKey}`, null) ? 'over' : 'intro')
    setCtx(null)
    setLastPoss(null)
  }, [scenario, mode, dateKey])

  // ------------------------------------------------------------------ possession flow
  const presnap = useCallback(
    (setId, coverage, flip = false) => {
      sim.timeScale = 1
      sim.reset({ set: setId, seed: 1, coverage, flip })
      setSimKey((k) => k + 1)
      setReplaying(false)
    },
    [sim],
  )

  const begin = useCallback(
    (cur) => {
      if (cur.status !== 'playing') return setStage('over')
      setTimeoutOn(false)
      if (cur.poss === 'you') {
        if (aiWillFoul(cur)) {
          // they foul as soon as you inbound it
          const start = startPossession(cur)
          if (start.status !== 'playing') return (setG(start), setStage('over'))
          presnap('pnr', { call: 'man', shown: 'man' })
          setCtx({ team: 'you', foul: true, start })
          return setStage('ft')
        }
        const cov = aiCoverage(cur)
        presnap('pnr', { call: cov.shown, shown: cov.shown })
        setCtx({ team: 'you', coverage: cov })
        return setStage('call')
      }
      const ai = aiSet(cur)
      presnap(ai.set, { call: 'man', shown: 'man' }, ai.flip)
      setCtx({ team: 'them', ai })
      setStage('defcall')
    },
    [presnap],
  )

  const tipOff = () => {
    unlock()
    startAmbience('hoops-crowd')
    hsfx.whistle()
    begin(g)
  }
  useEffect(() => {
    preloadHoops()
    return () => {
      stopAmbience()
      setChant(false)
      setAmbienceLevel(0.32)
    }
  }, [])

  const runSet = (setId) => {
    const start = startPossession(g, { timeout: timeoutOn && g.inbound > 0 })
    if (start.status !== 'playing') return (setG(start), setStage('over'))
    setG(start)
    sim.timeScale = 1
    sim.reset({ set: setId, seed: possSeed(start, setId), coverage: ctx.coverage, shotClock: start.shotClock, gameClock: start.clock, user: true, boosts: boostsFor(start, 'you') })
    sim.start()
    applied.current = null
    setCtx({ ...ctx, set: setId, start })
    setSimKey((k) => k + 1)
    setReplaying(false)
    setStage('live')
  }

  const lockCoverage = (call) => {
    const start = startPossession(g)
    if (start.status !== 'playing') return (setG(start), setStage('over'))
    setG(start)
    const { set, flip, milk } = ctx.ai
    sim.timeScale = 1
    sim.reset({ set, flip, milk, seed: possSeed(start, `${set}|${call}`), coverage: { call, shown: call }, shotClock: start.shotClock, gameClock: start.clock, user: false, userDef: true, boosts: boostsFor(start, 'them') })
    sim.start()
    applied.current = null
    setCtx({ ...ctx, set, coverage: call, start })
    setSimKey((k) => k + 1)
    setReplaying(false)
    setStage('live')
  }

  const foulNow = () => {
    // their ball, you're behind: foul before they run anything
    const start = startPossession(g)
    if (start.status !== 'playing') return (setG(start), setStage('over'))
    const next = applyFoul(start, 'them', null)
    hsfx.whistle()
    const last = next.log.at(-1)
    setLastPoss({ team: 'them', result: { kind: 'ft', points: last.points, fts: 2 }, message: `You foul. They make ${last.ftPoints} of 2.`, offReb: false })
    setG(next)
    setStage('result')
  }

  const onStatus = useCallback(
    (s) => {
      setStatus(s)
      if (replaying) {
        if (s.phase === 'over') setStage('result')
        return
      }
      if ((s.phase === 'dead' || s.phase === 'over') && s.result && applied.current !== sim.seed) {
        applied.current = sim.seed
        const r = s.result
        if (ctx?.team === 'you' && r.fts > 0) {
          setCtx((c) => ({ ...c, pending: r, message: s.message }))
          setTimeout(() => setStage('ft'), 900)
          return
        }
        setG((cur) => {
          const next = applyPossession(ctx.start ?? cur, ctx.team, r, { set: ctx.set, coverage: ctx.coverage })
          const last = next.log.at(-1)
          const hot = last?.heatingUp ? ` 🔥 ${r.shot?.name ?? `#${r.shot?.number}`} is heating up!` : ''
          setLastPoss({ team: ctx.team, result: r, message: s.message + hot, quality: shotQuality(r), offReb: !!last?.offReb })
          return next
        })
        setStage('result')
      }
    },
    [replaying, sim, ctx],
  )

  const ftDone = (made) => {
    const base = ctx.start ?? g
    const next = ctx.foul ? applyFoul(base, 'you', made) : applyPossession(base, 'you', ctx.pending, { set: ctx.set, ftMade: made })
    const fts = ctx.foul ? 2 : ctx.pending.fts
    if (made) hsfx.roar(made === fts ? 0.7 : 0.4)
    setLastPoss({ team: 'you', result: { ...(ctx.pending ?? { kind: 'ft' }), points: next.log.at(-1).points }, message: `${ctx.foul ? 'They foul to stop the clock. ' : ''}You make ${made} of ${fts}.`, offReb: !!next.log.at(-1)?.offReb })
    setG(next)
    setStage('result')
  }

  const next = () => begin(g)
  const replay = () => {
    sim.reset({ set: sim.setId, seed: sim.seed, coverage: sim.coverage, shotClock: sim.shotClock, gameClock: sim.gameClock, roster: sim.roster, inputs: sim.inputLog, milk: sim.milk, flip: sim.flip < 0, user: sim.user })
    sim.timeScale = 0.5
    sim.start()
    setSimKey((k) => k + 1)
    setReplaying(true)
    setStage('live')
  }
  const skip = () => {
    sim.timeScale = 3
  }

  // keyboard: Enter/Space = tip off / next possession, R = replay
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.target.closest?.('select, input')) return
      const k = e.key.toLowerCase()
      if (stage === 'intro' && (k === 'enter' || k === ' ')) (e.preventDefault(), tipOff())
      else if (stage === 'result' && (k === 'enter' || k === ' ')) (e.preventDefault(), g.status === 'playing' ? next() : setStage('over'))
      else if (stage === 'result' && k === 'r' && lastPoss?.result?.shot) replay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // end of game bookkeeping
  const finished = useRef(null)
  useEffect(() => {
    if (stage !== 'over' || g.status === 'playing' || finished.current === g.id) return
    finished.current = g.id
    if (mode === 'daily' && !load(`cd.hoops.${dateKey}`, null)) {
      save(`cd.hoops.${dateKey}`, { status: g.status, text: shareText(g, { day, url: `${SITE}/hoops`, mode, moment: scenario.moment }), grid: g.log.map((p) => p.emoji).join('') })
      // daily stats: played, wins, streak (a streak needs yesterday's game too)
      const st = load('cd.hoops.stats', { last: null, streak: 0, played: 0, wins: 0 })
      const won = g.status === 'won'
      const yesterday = todayKey(new Date(Date.now() - 86400000))
      save('cd.hoops.stats', { last: dateKey, played: st.played + 1, wins: st.wins + (won ? 1 : 0), streak: won ? (st.last === yesterday ? st.streak + 1 : 1) : 0 })
    }
    setChant(false)
    hsfx.horn()
    if (g.status === 'won') setTimeout(() => hsfx.theme(), 1600)
  }, [stage, g, mode, dateKey, day]) // eslint-disable-line react-hooks/exhaustive-deps

  const newPractice = (teams = {}) => {
    const p = { ...practice, ...teams, n: practice.n + 1 }
    save('cd.hoops.practice', p)
    setPractice(p)
  }

  // ------------------------------------------------------------------ render
  const live = stage === 'live'
  const trail = [g.wp0, ...g.log.map((p) => p.wp)]
  const youOffense = (ctx?.team ?? g.poss) === 'you'
  const offense = youOffense ? you : them
  const defense = youOffense ? them : you
  const shotClock = live && !replaying ? Math.max(0, sim.shotClock - sim.t) : g.shotClock
  const clockShown = live && !replaying ? Math.max(0, (ctx?.start?.clock ?? g.clock) - sim.t) : g.clock
  const h = stage === 'result' ? hoopsHeadline(lastPoss?.team, lastPoss?.result, lastPoss?.offReb) : null
  const homeOnDefense = (youOffense ? them : you) === home
  const tense = g.status === 'playing' && g.clock <= 40 && Math.abs(g.scoreYou - g.scoreThem) <= 4
  const tension = stage === 'intro' || stage === 'over' ? 0.04 : tense ? 0.26 : 0.1
  void simKey

  // the building gets louder late in a close game; the home crowd chants when its team is defending
  useEffect(() => {
    setAmbienceLevel(stage === 'over' ? 0.2 : tense ? 0.5 : 0.32)
    setChant(homeOnDefense && tense && (stage === 'live' || stage === 'defcall' || stage === 'call') && !replaying)
  }, [stage, tense, homeOnDefense, replaying])

  return (
    <main className="game hoops">
      <Suspense fallback={<div className="loading">Lacing up sneakers…</div>}>
        <Canvas dpr={[1, 2]} camera={{ fov: 46, position: [0, 40, 50], near: 0.5, far: 600 }} {...captureCanvasProps}>
          <HoopsScene
            sim={sim}
            version={`${scenario.id}-${youOffense}`}
            offense={offense}
            defense={defense}
            offenseAway={offense !== home}
            home={home}
            onStatus={onStatus}
            onEvent={(e) => hoopsSound(e, { youOffense, youHome: scenario.youHome })}
            tension={tension}
            board={homeOnDefense && (stage === 'live' || stage === 'call' || stage === 'defcall') && tense ? 'DEFENSE' : ''}
            controls={live && !replaying && youOffense}
            onPass={(key) => sim.input({ type: 'pass', key })}
          />
        </Canvas>
      </Suspense>

      <div className="hud-top">
        <HoopsBug g={{ ...g, clock: clockShown }} you={you} them={them} shotClock={stage === 'live' || stage === 'call' || stage === 'defcall' ? shotClock : null} />
        <WinProbMeter p={stage === 'result' || stage === 'over' ? trail.at(-1) ?? g.wp0 : winProb(g, clockShown)} last={stage === 'result' && trail.length > 1 ? trail.at(-2) : null} team={meterTeam(you)} />
        {replaying && <div className="replay-badge">REPLAY</div>}
      </div>

      {(stage === 'result' || (live && status.phase !== 'live' && !replaying)) && (h || status.message) && (
        <div className={`banner ${h?.tone ?? 'ok'}`} key={`${g.log.length}-${status.message}`}>
          {h && <div className="banner-big">{h.big}</div>}
          <div className="banner-sub">{stage === 'result' ? lastPoss?.message : status.message}</div>
          {stage === 'result' && lastPoss?.quality && <div className="banner-quality">{lastPoss.quality}</div>}
        </div>
      )}

      <div className="hud-bottom">
        {stage === 'intro' && (
          <div className="intro card">
            <div className="eyebrow">{mode === 'daily' ? `Daily Hoops #${day}` : 'Practice'} · Clutch Hoops beta</div>
            {scenario.moment && <span className="moment-tag">📅 Real moment · {hoopsMomentLabel(scenario.moment)}</span>}
            <h2>
              <TeamLogo abbr={you.abbr} league="nba" size={34} className="team-logo intro-logo" />
              <span style={{ color: you.jersey }}>{you.city} {you.name}</span> trail by {g.scoreThem - g.scoreYou}
            </h2>
            <p className="lede">
              {fmtClock(g.clock)} left in the 4th, your ball out of a timeout against the {them.name}. You have {g.timeouts} more timeout{g.timeouts === 1 ? '' : 's'}.
              Call a set on offense, a coverage on defense. Take over any possession: pass, drive, step back, and time your shot at the top of the jump.
            </p>
            {scenario.moment && <p className="fine">This really happened. Can you beat what the real {you.name} did?</p>}
            <ul className="rules">
              <li>Behind late? <b>Foul</b> to stop the clock. Ahead? They’ll foul you: hit your free throws.</li>
              <li>A <b>timeout</b> after a stop or a make advances the ball and saves about 4 seconds.</li>
            </ul>
            {mode === 'practice' && (
              <div className="matchup">
                <NbaTeamSelect label="You" value={practice.you} onChange={(v) => newPractice({ you: v })} />
                <span className="vs">vs</span>
                <NbaTeamSelect label="Them" value={practice.them} onChange={(v) => newPractice({ them: v })} />
              </div>
            )}
            <button className="btn primary big" onClick={tipOff}>Take the floor</button>
          </div>
        )}

        {stage === 'call' && ctx && (
          <SetPicker
            onCall={runSet}
            shown={ctx.coverage.shown}
            canTimeout={g.inbound > 0 && g.timeouts > 0}
            timeoutOn={timeoutOn}
            setTimeoutOn={setTimeoutOn}
            scout={scoutLine(g)}
            hot={boostsFor(g, 'you')}
          />
        )}
        {stage === 'defcall' && <CoveragePicker onLock={lockCoverage} onFoul={foulNow} canFoul={g.scoreYou < g.scoreThem && g.clock < 40} tip={defTip(g)} theirSets={g.theirSets ?? []} />}
        {stage === 'ft' && ctx && <FreeThrows n={ctx.foul ? 2 : ctx.pending?.fts ?? 2} rng={possRng(g, 'ft')} onDone={ftDone} title={ctx.foul ? 'They foul you. Ice it!' : 'Free throws'} />}

        {live && !replaying && status.phase === 'live' && <HoopsControls sim={sim} firstTime={g.log.length < 2} />}
        {live && status.phase === 'live' && sim.timeScale < 2 && (
          <button className="btn small skip" onClick={skip}>Skip ⏩</button>
        )}

        {stage === 'result' && (
          <div className="actions">
            {lastPoss?.result?.shot && <button className="btn" onClick={replay}>↺ Replay</button>}
            <button className="btn primary" onClick={() => (g.status === 'playing' ? next() : setStage('over'))}>
              {g.status === 'playing' ? (g.reason?.startsWith('Tied') ? 'Overtime →' : 'Next possession →') : 'See result'}
            </button>
          </div>
        )}
      </div>

      {stage === 'over' && <HoopsOver g={saved && g.status === 'playing' ? null : g} moment={scenario.moment} saved={saved} mode={mode} day={day} onAgain={() => (mode === 'daily' ? navigate('/hoops?mode=practice') : newPractice())} />}
    </main>
  )
}

/** "Contested three · 31% shot": what kind of look that was. */
function shotQuality(r) {
  const s = r?.shot
  if (!s) return null
  const look = s.contest < 2 ? 'Smothered' : s.contest < 4 ? 'Contested' : s.contest < 7 ? 'Decent look:' : 'Wide open'
  return `${look} ${s.label} · ${Math.round(s.pMake * 100)}% shot${s.grade ? ` · ${s.grade} release` : ''}`
}

function scoutLine(g) {
  const recent = g.yourSets.slice(-3)
  if (recent.length >= 2 && recent.every((s) => SETS[s].family === SETS[recent[0]].family)) return `They’ve seen a lot of ${SETS[recent[0]].label}. Expect them to sit on it.`
  const diff = g.scoreYou - g.scoreThem
  if (diff < 0 && diff >= -2 && g.clock < 24) return 'Two-point game: take the best look, not the hero shot.'
  if (diff <= -3 && g.clock < 30) return 'Down three or more: you need a three, or a quick two and a foul.'
  return null
}

function defTip(g) {
  const diff = g.scoreYou - g.scoreThem
  if (diff < 0 && g.clock < 30) return 'You’re behind: foul now to stop the clock, or gamble on a stop.'
  if (diff > 0 && diff <= 3) return 'Protect the lead: no open threes. Switching takes away the catch-and-shoot.'
  const recent = g.yourCoverages.slice(-2)
  if (recent.length === 2 && recent[0] === recent[1]) return `They know you love ${COVERAGES[recent[0]].short}. Mix it up.`
  return null
}

function HoopsOver({ g, moment, saved, mode, day, onAgain }) {
  const won = g ? g.status === 'won' : saved?.status === 'won'
  const text = g ? shareText(g, { day, url: `${SITE}/hoops`, mode, moment }) : saved?.text
  // stats are saved by the parent right after this mounts, so re-read them a beat later
  const [stats, setStats] = useState(() => load('cd.hoops.stats', { played: 0, wins: 0, streak: 0 }))
  useEffect(() => {
    const id = setTimeout(() => setStats(load('cd.hoops.stats', { played: 0, wins: 0, streak: 0 })), 50)
    return () => clearTimeout(id)
  }, [])
  return (
    <div className="modal-wrap">
      <div className={`modal ${won ? 'won' : 'lost'}`}>
        <div className="modal-emoji">{won ? '🏆' : '😤'}</div>
        <h2>{won ? 'Ballgame!' : 'So close.'}</h2>
        {g ? (
          <p className="lede">
            {g.you} {g.scoreYou} – {g.scoreThem} {g.them}{g.ot ? ' (OT)' : ''}. {g.reason}
          </p>
        ) : (
          <p className="lede">You already played today’s game.</p>
        )}
        <div className="grid-emoji">{g ? g.log.map((p) => p.emoji).join('') : saved?.grid}</div>
        {g && <WPChart trail={[g.wp0, ...g.log.map((p) => p.wp), won ? 1 : 0]} />}
        {moment && <HoopsHistory m={moment} won={won} />}
        <p className="fine">🟩 bucket · 💦 three · 🎯 free throws · 🟥 empty · 🔒 stop · 🟧 they scored</p>
        {mode === 'daily' && (
          <div className="stats">
            <div><b>{stats.played}</b><span>Played</span></div>
            <div><b>{stats.played ? Math.round((100 * stats.wins) / stats.played) : 0}%</b><span>Win rate</span></div>
            <div><b>{stats.streak}</b><span>Streak</span></div>
          </div>
        )}
        <div className="modal-actions">
          {text && <ShareButton text={text} />}
          <button className="btn" onClick={onAgain}>{mode === 'daily' ? 'Practice' : 'New game'}</button>
          <button className="btn" onClick={() => navigate('/play?mode=daily')}>🏈 Today’s Daily Drive</button>
        </div>
        {mode === 'daily' && <p className="fine">Next game in <Countdown /></p>}
        <p className="fine"><Link to="/">← Home</Link> · <Link to="/how-to-play#hoops">Tips</Link></p>
      </div>
    </div>
  )
}

function HoopsHistory({ m, won }) {
  const realWon = m.won === 1
  const verdict = won && !realWon ? '🔥 You beat history!' : won ? '✅ You matched history.' : realWon ? '📜 History wins this one.' : '🤝 Same as history.'
  return (
    <div className="history">
      <b>What really happened · {hoopsMomentLabel(m)}</b>
      {hoopsRealOutcome(m)}
      {m.wp != null && <> ESPN’s model, which also weighs the pregame betting line, gave them {Math.round(m.wp * 100)}% at that moment.</>} <b style={{ display: 'inline', fontSize: 12 }}>{verdict}</b>
      <p className="credit">{HOOPS_DATA_CREDIT} <a href={HOOPS_DATA_URL} target="_blank" rel="noreferrer">hoopR</a></p>
    </div>
  )
}
