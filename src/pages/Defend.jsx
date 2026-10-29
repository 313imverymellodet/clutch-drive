import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import PlayScene from '../scenes/PlayScene'
import { COVERAGES, PLAYS, PlaySim } from '../sim/playSim'
import { chooseOffense } from '../sim/aiOffense'
import { TEAM_BY_ABBR } from '../data/nflTeams'
import { applyResult, callTimeout, dayNumber, defenseTip, downAndDistance, fmtBallOn, fmtClock, hashString, makeScenario, newDrive, rngFrom, tickClock, todayKey } from '../game/drive'
import { load, save } from '../game/storage'
import { FieldBar, Scorebug, ShareButton, WPChart, WinProbMeter, wpTrail } from '../ui/GameUI'
import { winProb } from '../game/winprob'
import { momentForDay } from '../game/moments'
import { isNightGame } from '../components/Stadium'
import { Confetti } from '../ui/Confetti'
import { TeamSelect } from '../ui/TeamSelect'
import { DefensePicker } from '../ui/Playbook'
import { playEvent, sfx, startAmbience, stopAmbience, unlock } from '../game/sound'
import { Link, navigate } from '../router'
import { BRAND } from '../brand'
import { rosterFor, useRealData } from '../game/real'
import { resultOf, trackEvent } from '../analytics'

const SITE = typeof location !== 'undefined' ? location.origin : ''
const AI_HUDDLE = 12 // seconds a running clock burns while their offense lines up

/** Emoji for a play from the defense's point of view. */
function defEmoji(p) {
  if (p.playId === 'timeout') return '⏱️'
  if (p.kind === 'interception') return '🛡️'
  if (p.kind === 'touchdown') return '💀'
  if (p.first) return '🟥'
  if (p.kind === 'incomplete' || p.kind === 'sack' || (p.gain ?? 0) <= 3) return '🟩'
  return '🟨'
}

function defHeadline(r) {
  if (!r) return null
  if (r.kind === 'interception') return { big: 'PICKED OFF!', tone: 'td' }
  if (r.kind === 'sack') return { big: 'SACKED!', tone: 'good' }
  if (r.kind === 'incomplete') return { big: 'INCOMPLETE!', tone: 'good' }
  if (r.kind === 'touchdown') return { big: 'TOUCHDOWN…', tone: 'bad' }
  if (r.first) return { big: 'FIRST DOWN', tone: 'bad' }
  if (r.gain <= 1) return { big: 'STUFFED!', tone: 'good' }
  return { big: `+${r.gain} for them`, tone: 'ok' }
}

/** Their drive: you lead by 4-6, so only a touchdown beats you. */
function makeDefenseScenario(seedKey, { you, them, difficulty = 0 }) {
  const sc = makeScenario(seedKey, { difficulty, offense: them, defense: you })
  return { ...sc, ballOn: Math.max(15, sc.ballOn - 2) }
}

export default function Defend({ daily: isDaily }) {
  const dateKey = todayKey()
  const day = dayNumber(dateKey)
  const [prefs, setPrefs] = useState(() => load('cd.defense', { you: 'DEN', them: 'KC', n: 0, streak: 0, best: 0 }))
  // the bonus round: today's real team scored, now they have to hold on
  const dailyTeams = useMemo(() => {
    const m = momentForDay(dateKey)
    return { you: m.off, them: m.def }
  }, [dateKey])
  const teams = isDaily ? dailyTeams : prefs
  // difficulty is locked in when a drive starts; updating the streak after a win must not restart the drive
  const streakRef = useRef(prefs.streak)
  const scenario = useMemo(() => {
    streakRef.current = prefs.streak
    return makeDefenseScenario(isDaily ? `defense-daily-${dateKey}` : `defense-${prefs.n}-${teams.you}-${teams.them}`, { you: teams.you, them: teams.them, difficulty: Math.min(4, prefs.streak) })
  }, [isDaily, dateKey, prefs.n, teams.you, teams.them]) // eslint-disable-line react-hooks/exhaustive-deps
  const them = TEAM_BY_ABBR[scenario.offense]
  const you = TEAM_BY_ABBR[scenario.defense]

  const [drive, setDrive] = useState(() => newDrive(scenario))
  const [stage, setStage] = useState('intro') // intro | call | live | result | over
  const [sim] = useState(() => new PlaySim())
  const [simKey, setSimKey] = useState(0)
  // test builds: both teams' current real players (read through a ref so a late load never restarts the drive)
  const realData = useRealData()
  const roster = useMemo(() => rosterFor({ offense: scenario.offense, defense: scenario.defense }), [scenario, realData]) // eslint-disable-line react-hooks/exhaustive-deps
  const rosterRef = useRef(roster)
  rosterRef.current = roster
  const [status, setStatus] = useState({ phase: 'presnap' })
  const [draft, setDraft] = useState({ call: 'cover3', shown: null, key: null })
  const [replaying, setReplaying] = useState(false)
  const [note, setNote] = useState(null)
  const applied = useRef(null)
  const history = useRef([])
  if (import.meta.env.DEV) window.__sim = sim

  const presnap = useCallback(
    (d, look) => {
      sim.camMode = 'broadcast'
      sim.timeScale = 1
      sim.reset({ play: 'dig', seed: 1, los: d.ballOn - 50, toGo: d.toGo, coverage: { call: look, shown: look }, roster: rosterRef.current })
      setSimKey((k) => k + 1)
    },
    [sim],
  )

  useEffect(() => {
    const d = newDrive(scenario)
    setDrive(d)
    history.current = []
    applied.current = null
    setStage('intro')
    presnap(d, 'cover3')
  }, [scenario, presnap])

  // the formation shows your chosen shell while you pick
  useEffect(() => {
    if (stage === 'call') presnap(drive, draft.shown ?? draft.call)
  }, [draft.call, draft.shown, stage]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopAmbience(), [])
  useEffect(() => save('cd.defense', prefs), [prefs])

  const start = () => {
    unlock()
    startAmbience()
    sfx.whistle(0.25)
    setStage('call')
    trackEvent('game_start', { mode: isDaily ? 'defense-daily' : 'defense' })
  }

  const lock = () => {
    unlock()
    let d = drive
    const n = d.plays.filter((p) => p.playId !== 'timeout').length
    const rnd = rngFrom(`${scenario.id}|off|${n}`)
    // their clock management: burn a timeout late, otherwise the huddle runs the clock
    if (d.clockRunning) {
      if (d.clock < 50 && d.timeouts > 0) {
        d = callTimeout(d)
        setNote(`${them.name} call timeout (${d.timeouts} left)`)
      } else {
        d = tickClock(d, AI_HUDDLE)
        if (d.status !== 'playing') {
          setDrive(d)
          setStage('over')
          return
        }
      }
    } else setNote(null)
    const shown = draft.shown ?? draft.call
    const call = chooseOffense({ ...d }, shown, rnd, { difficulty: Math.min(4, streakRef.current), history: history.current })
    history.current.push(call.play)
    d = { ...d, clockRunning: false }
    setDrive(d)
    const coverage = { call: draft.call, shown, key: draft.key ? { family: draft.key, s: 0.8, guess: true } : null }
    sim.camMode = 'broadcast'
    sim.timeScale = 1
    sim.reset({ play: call.play, seed: hashString(`${scenario.id}|${n}|${draft.call}|${shown}|${draft.key}`), los: d.ballOn - 50, toGo: d.toGo, coverage, situation: { clock: d.clock }, flip: call.flip, roster })
    sim.snap()
    applied.current = null
    setSimKey((k) => k + 1)
    setReplaying(false)
    setStage('live')
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
        setDrive((d) => applyResult(d, sim.play.id, s.result))
        setStage('result')
      }
    },
    [replaying, sim],
  )

  const next = () => {
    if (drive.status !== 'playing') return setStage('over')
    setDraft((d) => ({ ...d, shown: null, key: null }))
    setStage('call')
  }

  const replay = () => {
    sim.reset({ play: sim.play.id, seed: sim.seed, los: sim.los, toGo: sim.firstDown - sim.los, coverage: sim.coverage, situation: sim.situation, reads: sim.reads?.map((r) => r.key) ?? null, flip: sim.flip < 0, roster: sim.roster })
    sim.camMode = 'close'
    sim.timeScale = 0.45
    sim.snap()
    setSimKey((k) => k + 1)
    setReplaying(true)
    setStage('live')
  }

  // keys: Enter = start / lock / next, R = replay
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.target.closest?.('select, input')) return
      const k = e.key.toLowerCase()
      if (k === 'enter' && stage === 'intro') start()
      else if (k === 'enter' && stage === 'call') lock()
      else if ((k === 'enter' || k === ' ') && stage === 'result' && status.phase === 'over') (e.preventDefault(), next())
      else if (k === 'r' && stage === 'result' && status.phase === 'over') replay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // results bookkeeping (you win when *their* drive fails)
  const youWon = drive.status === 'lost'
  const finished = useRef(null)
  useEffect(() => {
    if (stage !== 'over' || drive.status === 'playing' || finished.current === scenario.id) return
    finished.current = scenario.id
    trackEvent('game_end', { mode: isDaily ? 'defense-daily' : 'defense', result: resultOf(youWon) })
    if (!isDaily) {
      const streak = youWon ? prefs.streak + 1 : 0
      const nextPrefs = { ...prefs, streak, best: Math.max(prefs.best, streak) }
      save('cd.defense', nextPrefs)
      setPrefs(nextPrefs)
    } else if (!load(`cd.defdaily.${dateKey}`, null)) save(`cd.defdaily.${dateKey}`, { won: youWon })
  }, [stage, drive.status, scenario.id, youWon, isDaily, prefs, dateKey])

  const lead = drive.scoreDef - drive.scoreOff
  const shownName = COVERAGES[draft.shown ?? draft.call].short
  const inPlay = stage === 'live' || stage === 'result'
  const firstDownZ = Math.min(drive.ballOn + drive.toGo, 100) - 50
  const h = stage === 'result' && !replaying ? defHeadline(status.result) : null
  const grid = drive.plays.map(defEmoji).join('')
  void simKey

  return (
    <main className="game">
      <Suspense fallback={<div className="loading">Lacing up cleats…</div>}>
        <Canvas dpr={[1, 2]} camera={{ fov: 45, position: [0, 14, drive.ballOn - 80], near: 0.1, far: 1000 }}>
          <PlayScene
            sim={sim}
            version={`${scenario.offense}-${scenario.defense}-${roster ? 'real' : 'generic'}`}
            offense={them}
            defense={you}
            onStatus={onStatus}
            onEvent={playEvent}
            homeIsDefense
            night={isDaily && isNightGame(momentForDay(dateKey))}
            los={inPlay ? sim.los : drive.ballOn - 50}
            firstDown={inPlay ? (sim.firstDown >= 50 ? null : sim.firstDown) : firstDownZ >= 50 ? null : firstDownZ}
          />
        </Canvas>
      </Suspense>

      <div className="hud-top">
        <Scorebug drive={drive} offense={them} defense={you} clock={drive.clock} running={false} />
        <WinProbMeter
          p={1 - (stage === 'result' || stage === 'over' ? wpTrail(drive).at(-1) : winProb(drive))}
          last={stage === 'result' && wpTrail(drive).length > 1 ? 1 - wpTrail(drive).at(-2) : null}
          team={you}
          label="YOUR WIN PROB"
        />
        <div className="duel-strip">
          <span className="duel-role def">You: DEFENSE · up {lead}</span>
          {grid && <span>{grid}</span>}
        </div>
        {note && stage === 'call' && <div className="reveal">⏱ {note}</div>}
      </div>

      {h && (
        <div className={`banner ${h.tone}`}>
          <div className="banner-big">{h.big}</div>
          {status.message && <div className="banner-sub">{status.message}</div>}
        </div>
      )}

      <div className="hud-bottom">
        {stage === 'intro' && (
          <div className="intro card">
            <div className="eyebrow">{isDaily ? `Daily Drive #${day} · bonus round` : `Defense${prefs.streak ? ` · streak ${prefs.streak}` : ''}`}</div>
            <h2>Hold the lead</h2>
            <p className="lede">
              You ({you.city} {you.name}) lead by {lead}. {them.name} get the ball on the {fmtBallOn(drive.ballOn)} with {fmtClock(drive.clock)} left and {drive.timeouts} timeout{drive.timeouts === 1 ? '' : 's'}. Only a touchdown beats you.
            </p>
            <ul className="rules">
              <li>Call a coverage each snap. <b>Disguise it</b>: their QB reads your shell.</li>
              <li>Guess their concept to jump it. Guess wrong and you're a step slow.</li>
              <li>Stop them on downs, pick it off, or run out the clock.</li>
            </ul>
            {!isDaily && (
              <div className="matchup">
                <TeamSelect label="You" value={prefs.you} onChange={(v) => setPrefs((p) => ({ ...p, you: v, n: p.n + 1 }))} />
                <span className="vs">vs</span>
                <TeamSelect label="Them" value={prefs.them} onChange={(v) => setPrefs((p) => ({ ...p, them: v, n: p.n + 1 }))} />
              </div>
            )}
            <button className="btn primary big" onClick={start}>Take the field</button>
          </div>
        )}
        {stage === 'call' && (
          <>
            <div className="sheet-mini">
              <span className="sheet-title">{downAndDistance(drive)} <em>·</em> {fmtBallOn(drive.ballOn)}</span>
              <FieldBar drive={drive} offense={them} defense={you} />
            </div>
            <DefensePicker
              draft={draft}
              setDraft={setDraft}
              onLock={lock}
              title={`Your call · they see ${shownName}`}
              scoutLine={defenseTip(drive)}
            />
          </>
        )}
        {stage === 'live' && status.phase === 'live' && sim.timeScale < 2 && (
          <button className="btn small skip" onClick={() => (sim.timeScale = 4)}>Skip ⏩</button>
        )}
        {stage === 'result' && status.phase === 'over' && (
          <div className="actions">
            {sim.play && <div className="reveal">They ran <b>{PLAYS[sim.play.id].label}</b></div>}
            <button className="btn" onClick={replay}>↺ Replay</button>
            <button className="btn primary" onClick={next}>{drive.status === 'playing' ? 'Next play →' : 'See result'}</button>
          </div>
        )}
      </div>

      {stage === 'over' && (
        <div className="modal-wrap">
          {youWon && <Confetti />}
          <div className={`modal ${youWon ? 'won' : 'lost'}`}>
            <div className="modal-emoji">{youWon ? '🛡️' : '💀'}</div>
            <h2>{youWon ? 'You held on!' : 'They scored.'}</h2>
            <p className="lede">
              {you.abbr} {drive.scoreDef} – {drive.scoreOff} {them.abbr}. {youWon ? reasonForDefense(drive.reason) : 'Touchdown. They win it.'}
            </p>
            <div className="grid-emoji">{grid}</div>
            <WPChart trail={[...wpTrail(drive), youWon ? 0 : 1]} invert />
            {!isDaily && (
              <div className="stats">
                <div><b>{prefs.streak}</b><span>Stop streak</span></div>
                <div><b>{prefs.best}</b><span>Best</span></div>
              </div>
            )}
            <div className="modal-actions">
              <ShareButton
                event={isDaily ? 'defense-daily' : 'defense'}
                text={`${BRAND.name} 🛡️ ${isDaily ? `#${day} defense` : 'Defense'}\n${you.abbr} ${drive.scoreDef}–${drive.scoreOff} ${them.abbr} ${youWon ? '✅ held on' : '❌ gave it up'}\n${grid}\n${SITE}/play?mode=defense`}
              />
              <button className="btn" onClick={replay}>↺ Replay last play</button>
              {!isDaily && <button className="btn" onClick={() => setPrefs((p) => ({ ...p, n: p.n + 1 }))}>Next drive</button>}
              {isDaily && <button className="btn" onClick={() => navigate('/play?mode=defense')}>Keep playing defense</button>}
            </div>
            <p className="fine"><Link to="/">← {BRAND.name} home</Link></p>
          </div>
        </div>
      )}
    </main>
  )
}

function reasonForDefense(reason) {
  if (!reason) return 'Stopped them.'
  if (/downs/i.test(reason)) return 'Stopped them on downs.'
  if (/Intercepted/i.test(reason)) return `${reason.replace('Intercepted', 'Picked off')} Ballgame.`
  if (/clock|Time/i.test(reason)) return 'They ran out of time.'
  return reason
}
