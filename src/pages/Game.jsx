import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import PlayScene from '../scenes/PlayScene'
import { PlaySim } from '../sim/playSim'
import { TEAM_BY_ABBR } from '../data/nflTeams'
import { TeamSelect } from '../ui/TeamSelect'
import {
  HUDDLE_RUNOFF,
  applyResult,
  callTimeout,
  coachTip,
  dayNumber,
  defenseFor,
  downAndDistance,
  fmtBallOn,
  fmtClock,
  hashString,
  makeScenario,
  newDrive,
  shareText,
  tickClock,
  todayKey,
} from '../game/drive'
import { load, save } from '../game/storage'
import { Countdown, DefenseRead, DriveStrip, FieldBar, PlayCards, ResultBanner, Scorebug, ShareButton } from '../ui/GameUI'
import { playEvent, sfx, startAmbience, stopAmbience, unlock } from '../game/sound'
import { Link, navigate } from '../router'
import { BRAND } from '../brand'

const MODES = { daily: 'Daily Drive', survivor: 'Survivor', practice: 'Practice' }
const SITE = typeof location !== 'undefined' ? location.origin : ''

function newRunId() {
  return Math.random().toString(36).slice(2, 8)
}

export default function Game({ mode: rawMode }) {
  const mode = MODES[rawMode] ? rawMode : 'daily'
  const dateKey = todayKey()
  const day = dayNumber(dateKey)

  // ---------------------------------------------------------------- scenario per mode
  const [survivor, setSurvivor] = useState(() => load('cd.survivor', { runId: newRunId(), game: 0, streak: 0, best: 0 }))
  const [practice, setPractice] = useState(() => load('cd.practice', { offense: 'MIN', defense: 'DEN', n: 0 }))
  const dailySaved = mode === 'daily' ? load(`cd.daily.${dateKey}`, null) : null

  const scenario = useMemo(() => {
    if (mode === 'daily') return makeScenario(`daily-${dateKey}`)
    if (mode === 'survivor') return makeScenario(`surv-${survivor.runId}-${survivor.game}`, { difficulty: survivor.game })
    return makeScenario(`practice-${practice.n}`, { offense: practice.offense, defense: practice.defense })
  }, [mode, dateKey, survivor.runId, survivor.game, practice.n, practice.offense, practice.defense])

  const offense = TEAM_BY_ABBR[scenario.offense]
  const defense = TEAM_BY_ABBR[scenario.defense]

  // ---------------------------------------------------------------- drive + sim state
  const [drive, setDrive] = useState(() => newDrive(scenario))
  const [stage, setStage] = useState(dailySaved ? 'over' : 'intro') // intro | call | live | result | over
  const [sim] = useState(() => new PlaySim())
  const [simKey, setSimKey] = useState(0) // bump to re-render after sim.reset
  const [status, setStatus] = useState({ phase: 'presnap' })
  const [replaying, setReplaying] = useState(false)
  const [liveClock, setLiveClock] = useState(scenario.clock)
  const [preview, setPreview] = useState(null)
  const [coverage, setCoverage] = useState({ call: 'cover3', shown: 'cover3' })
  const applied = useRef(null)
  const huddleFrom = useRef(null)
  const difficulty = mode === 'survivor' ? survivor.game : 0
  if (import.meta.env.DEV) window.__sim = sim

  const los = drive.ballOn - 50
  const resetPresnap = useCallback(
    (d) => {
      sim.camMode = 'broadcast'
      sim.timeScale = 1
      // the defense lines up in its next look so you can read it before calling a play
      const cov = defenseFor(d, difficulty)
      sim.reset({ play: sim.play?.id ?? 'dig', seed: 1, los: d.ballOn - 50, toGo: d.toGo, coverage: cov, situation: { clock: d.clock }, difficulty })
      setCoverage(cov)
      setPreview(null)
      setSimKey((k) => k + 1)
      setReplaying(false)
    },
    [sim, difficulty],
  )

  // new scenario (mode switch, next survivor game, practice teams) -> fresh drive
  useEffect(() => {
    const d = newDrive(scenario)
    setDrive(d)
    setLiveClock(d.clock)
    applied.current = null
    resetPresnap(d)
    const saved = mode === 'daily' ? load(`cd.daily.${dateKey}`, null) : null
    setStage(saved ? 'over' : 'intro')
  }, [scenario, mode, dateKey, resetPresnap])

  // ---------------------------------------------------------------- clock: hurry-up while you pick a play
  useEffect(() => {
    if (stage !== 'call' || !drive.clockRunning || drive.status !== 'playing') return
    let last = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      setDrive((d) => tickClock(d, dt))
    }, 100)
    return () => clearInterval(id)
  }, [stage, drive.clockRunning, drive.status])

  // live game clock during the play
  useEffect(() => {
    if (stage !== 'live') {
      setLiveClock(drive.clock)
      return
    }
    const start = drive.clock
    const id = setInterval(() => setLiveClock(Math.max(0, start - Math.max(0, sim.t - 0.35))), 100)
    return () => clearInterval(id)
  }, [stage, drive.clock, sim])

  useEffect(() => {
    if (drive.status !== 'playing' && stage === 'call') setStage('over')
  }, [drive.status, stage])

  // ---------------------------------------------------------------- actions
  const takeField = () => {
    unlock()
    startAmbience()
    sfx.whistle(0.25)
    huddleFrom.current = drive.clock
    setStage('call')
  }
  useEffect(() => () => stopAmbience(), [])

  // last ten seconds of a running clock: tick tock
  const secondsLeft = Math.ceil(drive.clock)
  useEffect(() => {
    if (stage === 'call' && drive.clockRunning && secondsLeft <= 10 && secondsLeft > 0) sfx.tick()
  }, [secondsLeft, stage, drive.clockRunning])

  const callPlay = (playId) => {
    let d = drive
    // getting lined up takes time when the clock is running
    if (d.clockRunning) {
      const spent = (huddleFrom.current ?? d.clock) - d.clock
      d = tickClock(d, Math.max(0, HUDDLE_RUNOFF - spent))
      if (d.status !== 'playing') {
        setDrive(d)
        setStage('over')
        return
      }
    }
    d = { ...d, clockRunning: false }
    setDrive(d)
    const seed = mode === 'daily' ? hashString(`${scenario.id}|${d.plays.length}|${playId}`) : (Math.random() * 2 ** 31) | 0
    sim.camMode = 'broadcast'
    sim.timeScale = 1
    unlock()
    sim.reset({ play: playId, seed, los: d.ballOn - 50, toGo: d.toGo, coverage, situation: { clock: d.clock }, difficulty })
    sim.snap()
    setPreview(null)
    applied.current = null
    setSimKey((k) => k + 1)
    setReplaying(false)
    setStage('live')
  }

  const timeout = () => {
    sfx.whistle(0.3)
    setDrive((d) => callTimeout(d))
  }
  const skip = () => {
    sim.timeScale = replaying ? 3 : 4
  }

  const onStatus = useCallback(
    (s) => {
      setStatus(s)
      if (replaying) {
        if (s.phase === 'over') setStage('result')
        return
      }
      // apply the result once, at the whistle
      if ((s.phase === 'dead' || s.phase === 'over') && s.result && applied.current !== sim.seed) {
        applied.current = sim.seed
        setDrive((d) => applyResult(d, sim.play.id, s.result))
        setStage('result')
      }
    },
    [replaying, sim],
  )

  const nextPlay = () => {
    if (drive.status !== 'playing') {
      setStage('over')
      return
    }
    resetPresnap(drive)
    huddleFrom.current = drive.clock
    setStage('call')
  }

  const replay = () => {
    sim.reset({ play: sim.play.id, seed: sim.seed, los: sim.los, toGo: sim.firstDown - sim.los, coverage: sim.coverage, situation: sim.situation, difficulty })
    sim.camMode = 'close'
    sim.timeScale = 0.45
    sim.snap()
    setSimKey((k) => k + 1)
    setReplaying(true)
    setStage('live')
  }

  // keyboard: Enter/Space = take the field / next play, R = replay, T = timeout (1-4 call plays, see PlayCards)
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('select, input')) return
      const k = e.key.toLowerCase()
      if (stage === 'intro' && (k === 'enter' || k === ' ')) (e.preventDefault(), takeField())
      else if (stage === 'result' && status.phase === 'over' && (k === 'enter' || k === ' ')) (e.preventDefault(), nextPlay())
      else if (stage === 'result' && status.phase === 'over' && k === 'r') replay()
      else if (stage === 'call' && k === 't' && drive.clockRunning && drive.timeouts) timeout()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---------------------------------------------------------------- end of drive bookkeeping
  const finished = useRef(null)
  useEffect(() => {
    if (stage !== 'over' || drive.status === 'playing' || finished.current === scenario.id) return
    finished.current = scenario.id
    if (mode === 'daily' && !load(`cd.daily.${dateKey}`, null)) {
      save(`cd.daily.${dateKey}`, { status: drive.status, text: shareText(drive, { mode, day, url: SITE }), plays: drive.plays.map((p) => p.emoji).join('') })
      const st = load('cd.dailyStreak', { last: null, streak: 0, played: 0, wins: 0 })
      const won = drive.status === 'won'
      save('cd.dailyStreak', { last: dateKey, streak: won ? st.streak + 1 : 0, played: st.played + 1, wins: st.wins + (won ? 1 : 0) })
    }
    if (mode === 'survivor') {
      const won = drive.status === 'won'
      const next = won
        ? { ...survivor, streak: survivor.streak + 1, best: Math.max(survivor.best, survivor.streak + 1) }
        : { ...survivor, lostAt: survivor.streak }
      save('cd.survivor', next)
      setSurvivor(next)
    }
  }, [stage, drive, mode, dateKey, day, scenario.id, survivor])

  const nextSurvivorGame = () => {
    const next = { ...survivor, game: survivor.game + 1 }
    save('cd.survivor', next)
    setSurvivor(next)
  }
  const newSurvivorRun = () => {
    const next = { runId: newRunId(), game: 0, streak: 0, best: survivor.best }
    save('cd.survivor', next)
    setSurvivor(next)
  }
  const practiceAgain = (teams = {}) => {
    const next = { ...practice, ...teams, n: practice.n + 1 }
    save('cd.practice', next)
    setPractice(next)
  }

  // ---------------------------------------------------------------- render
  const clockShown = stage === 'live' && !replaying ? liveClock : drive.clock
  const showBanner = (stage === 'result' || (stage === 'live' && status.phase !== 'live')) && !replaying
  const savedDaily = mode === 'daily' ? load(`cd.daily.${dateKey}`, null) : null
  const firstDownZ = Math.min(drive.ballOn + drive.toGo, 100) - 50
  const inPlay = stage === 'live' || stage === 'result'
  void simKey // re-render trigger after sim.reset

  return (
    <main className="game">
      <Suspense fallback={<div className="loading">Lacing up cleats…</div>}>
        <Canvas dpr={[1, 2]} camera={{ fov: 45, position: [0, 14, los - 30], near: 0.1, far: 1000 }}>
          <PlayScene
            sim={sim}
            version={`${scenario.offense}-${scenario.defense}`}
            offense={offense}
            defense={defense}
            onStatus={onStatus}
            onEvent={playEvent}
            preview={stage === 'call' ? preview : null}
            los={inPlay ? sim.los : los}
            firstDown={inPlay ? (sim.firstDown >= 50 ? null : sim.firstDown) : firstDownZ >= 50 ? null : firstDownZ}
          />
        </Canvas>
      </Suspense>

      <div className="hud-top">
        <Scorebug drive={drive} offense={offense} defense={defense} clock={clockShown} running={stage === 'call' && drive.clockRunning} />
        <DriveStrip plays={drive.plays} />
        {replaying && <div className="replay-badge">REPLAY</div>}
      </div>

      {showBanner && <ResultBanner result={status.result} message={status.message} />}

      <div className="hud-bottom">
        {stage === 'intro' && (
          <IntroCard mode={mode} day={day} drive={drive} offense={offense} defense={defense} onGo={takeField} practice={practice} onTeams={practiceAgain} />
        )}

        {stage === 'call' && (
          <div className="sheet">
            <div className="sheet-head">
              <span className="sheet-title">
                {downAndDistance(drive)} <em>·</em> {fmtBallOn(drive.ballOn)}
              </span>
              {drive.clockRunning ? (
                <button className="btn small danger" onClick={timeout} disabled={drive.timeouts === 0}>
                  {drive.timeouts ? `Timeout (${drive.timeouts})` : 'No timeouts'}
                </button>
              ) : (
                <span className="clock-note">Clock stopped</span>
              )}
            </div>
            <FieldBar drive={drive} offense={offense} defense={defense} />
            {drive.clockRunning && <div className="hurry">⏱ Clock is running, call it fast!</div>}
            <DefenseRead shown={coverage.shown} keyOn={coverage.key} tip={coachTip(drive, coverage.shown, coverage.key)} />
            <PlayCards onCall={callPlay} onPreview={setPreview} />
          </div>
        )}

        {stage === 'live' && status.phase === 'live' && sim.timeScale < 2 && (
          <button className="btn small skip" onClick={skip}>Skip ⏩</button>
        )}

        {stage === 'result' && status.phase === 'over' && (
          <div className="actions">
            <button className="btn" onClick={replay}>{replaying ? 'Watch again' : '↺ Replay'}</button>
            <button className="btn primary" onClick={nextPlay}>
              {drive.status === 'playing' ? 'Next play →' : 'See result'}
            </button>
          </div>
        )}
      </div>

      {stage === 'over' && (
        <GameOver
          mode={mode}
          day={day}
          drive={savedDaily && drive.status === 'playing' ? null : drive}
          saved={savedDaily}
          survivor={survivor}
          onNextSurvivor={nextSurvivorGame}
          onNewRun={newSurvivorRun}
          onPractice={() => practiceAgain()}
          onReplay={drive.plays.length && drive.status !== 'playing' ? replay : null}
        />
      )}
    </main>
  )
}

function IntroCard({ mode, day, drive, offense, defense, onGo, practice, onTeams }) {
  const deficit = drive.scoreDef - drive.scoreOff
  return (
    <div className="intro card">
      <div className="eyebrow">{mode === 'daily' ? `Daily Drive #${day}` : mode === 'survivor' ? `Survivor · Game ${drive.id.split('-').pop() * 1 + 1}` : 'Practice'}</div>
      <h2>
        <span style={{ color: offense.endzone === '#FFFFFF' ? offense.stripe : offense.endzone }}>{offense.city} {offense.name}</span> trail by {deficit}
      </h2>
      <p className="lede">
        {fmtClock(drive.clock)} left in the 4th. Your ball on the {fmtBallOn(drive.ballOn)}, {drive.timeouts} timeout{drive.timeouts === 1 ? '' : 's'}.
        Only a touchdown wins it against the {defense.name}.
      </p>
      <ul className="rules">
        <li><b>Out of bounds</b> and <b>incompletions</b> stop the clock.</li>
        <li>Tackled in bounds? The clock keeps running while you pick the next play.</li>
      </ul>
      {mode === 'practice' && (
        <div className="matchup">
          <TeamSelect label="You" value={practice.offense} onChange={(v) => onTeams({ offense: v })} />
          <span className="vs">vs</span>
          <TeamSelect label="Them" value={practice.defense} onChange={(v) => onTeams({ defense: v })} />
        </div>
      )}
      <button className="btn primary big" onClick={onGo}>Take the field</button>
    </div>
  )
}

function GameOver({ mode, day, drive, saved, survivor, onNextSurvivor, onNewRun, onPractice, onReplay }) {
  const won = drive ? drive.status === 'won' : saved?.status === 'won'
  const text = drive ? shareText(drive, { mode, day, streak: survivor.streak, url: SITE }) : saved?.text
  const daily = load('cd.dailyStreak', { streak: 0, played: 0, wins: 0 })
  return (
    <div className="modal-wrap">
      <div className={`modal ${won ? 'won' : 'lost'}`}>
        <div className="modal-emoji">{won ? '🏆' : '😤'}</div>
        <h2>{won ? 'You won it!' : 'So close.'}</h2>
        {drive ? (
          <p className="lede">
            {drive.offense} {drive.scoreOff} – {drive.scoreDef} {drive.defense}. {drive.reason}
          </p>
        ) : (
          <p className="lede">You already played today's drive.</p>
        )}
        <div className="grid-emoji">{drive ? drive.plays.map((p) => p.emoji).join('') : saved?.plays}</div>

        {mode === 'daily' && (
          <div className="stats">
            <div><b>{daily.played}</b><span>Played</span></div>
            <div><b>{daily.played ? Math.round((100 * daily.wins) / daily.played) : 0}%</b><span>Win rate</span></div>
            <div><b>{daily.streak}</b><span>Streak</span></div>
          </div>
        )}
        {mode === 'survivor' && (
          <div className="stats">
            <div><b>{survivor.streak}</b><span>{won ? 'Streak' : 'Final streak'}</span></div>
            <div><b>{survivor.best}</b><span>Best</span></div>
          </div>
        )}

        <div className="modal-actions">
          {text && <ShareButton text={text} />}
          {onReplay && <button className="btn" onClick={onReplay}>↺ Replay last play</button>}
          {mode === 'survivor' && won && <button className="btn" onClick={onNextSurvivor}>Next game →</button>}
          {mode === 'survivor' && !won && <button className="btn" onClick={onNewRun}>Start a new run</button>}
          {mode === 'practice' && <button className="btn" onClick={onPractice}>New practice drive</button>}
          {mode === 'daily' && <button className="btn" onClick={() => navigate('/play?mode=survivor')}>Play Survivor</button>}
        </div>
        {mode === 'daily' && (
          <p className="fine">Next drive in <Countdown /></p>
        )}
        <p className="fine"><Link to="/">← {BRAND.name} home</Link></p>
      </div>
    </div>
  )
}
