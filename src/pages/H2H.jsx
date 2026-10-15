import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import PlayScene from '../scenes/PlayScene'
import { COVERAGES, PLAYS, PlaySim } from '../sim/playSim'
import { TEAM_BY_ABBR } from '../data/nflTeams'
import { coachTip, fmtBallOn, fmtClock, tendencies } from '../game/drive'
import {
  COVERAGE_IDS,
  HALF_PAUSE_MS,
  RESULT_PAUSE_MS,
  SHOT_CLOCK_MS,
  defenseRole,
  isMyTurn,
  newMatch,
  offenseRole,
  reduce,
  viewFor,
} from '../game/h2h'
import { hostRoom, joinRoom, makeCode, normalizeCode } from '../net/room'
import { load, save } from '../game/storage'
import { DefenseRead, DriveStrip, FieldBar, PlayCards, ResultBanner, Scorebug, ShareButton } from '../ui/GameUI'
import { TeamSelect } from '../ui/TeamSelect'
import { playEvent, sfx, startAmbience, stopAmbience, unlock } from '../game/sound'
import { Link, navigate } from '../router'

const SITE = typeof location !== 'undefined' ? location.origin : ''
const COVER_BLURB = {
  cover1: 'Man-to-man, one safety deep. Stops the run and quick game.',
  cover2: 'Two deep halves, corners sit in the flats. Kills the deep ball.',
  cover3: 'Three deep, four under. Solid against everything, soft in the seams.',
  blitz: 'Send six, nobody deep. Stuffs runs; risky against a deep shot.',
  prevent: 'Everyone deep. Gives up short stuff, never the big play.',
}

// ------------------------------------------------------------------ connection / lobby
export default function H2H({ room: roomParam }) {
  const [team, setTeam] = useState(() => load('cd.h2h.team', 'MIN'))
  const [phase, setPhase] = useState('lobby') // lobby | hosting | joining | playing | left
  const [error, setError] = useState(null)
  const [code, setCode] = useState(() => normalizeCode(roomParam ?? ''))
  const [role, setRole] = useState(null)
  const [view, setView] = useState(null)
  const [clockEnds, setClockEnds] = useState(0)
  const chan = useRef(null)
  const roomRef = useRef(null)
  const matchRef = useRef(null) // host only: the full match (referee state)
  const teamRef = useRef(team)
  const roleRef = useRef(null)
  teamRef.current = team
  roleRef.current = role

  const pickTeam = (t) => {
    setTeam(t)
    save('cd.h2h.team', t)
  }

  // host: apply an action and broadcast what each side may see
  const hostDispatch = useCallback((action, actor) => {
    const prev = matchRef.current
    const next = reduce(prev, action, actor)
    if (next === prev) return
    matchRef.current = next
    const ends = next.phase === 'def-call' || next.phase === 'off-call' ? Date.now() + SHOT_CLOCK_MS : 0
    if (next.phase !== prev.phase || next.n !== prev.n || next.half !== prev.half) setClockEnds(ends)
    setView(viewFor(next, 'host'))
    chan.current?.send({ t: 'state', m: viewFor(next, 'guest'), clockLeft: ends ? ends - Date.now() : 0 })
  }, [])

  const startMatch = useCallback((guestTeam, first = 'host') => {
    const team = teamRef.current
    const players = { host: { team }, guest: { team: guestTeam === team ? (team === 'DEN' ? 'KC' : 'DEN') : guestTeam } }
    const m = newMatch({ seed: (Math.random() * 2 ** 31) | 0, players, first })
    matchRef.current = m
    const ends = Date.now() + SHOT_CLOCK_MS
    setClockEnds(ends)
    setView(viewFor(m, 'host'))
    chan.current?.send({ t: 'state', m: viewFor(m, 'guest'), clockLeft: SHOT_CLOCK_MS })
    setPhase('playing')
  }, [])

  const create = async () => {
    unlock()
    setError(null)
    const c = makeCode()
    setCode(c)
    setPhase('hosting')
    setRole('host')
    try {
      roomRef.current = await hostRoom(c, {
        onGuest: (ch) => {
          if (chan.current) return ch.close() // one opponent at a time
          chan.current = ch
          ch.onMessage((msg) => {
            if (msg.t === 'hello') startMatch(msg.team)
            else if (msg.t === 'act') hostDispatch(msg.action, 'guest')
            else if (msg.t === 'rematch') rematch()
          })
          ch.onClose(() => setPhase('left'))
        },
        onError: (m) => setError(m),
      })
    } catch (e) {
      setError(e.message)
      setPhase('lobby')
    }
  }

  const join = async () => {
    unlock()
    setError(null)
    const c = normalizeCode(code)
    if (c.length < 4) return setError('Enter the 5-letter code from your friend.')
    setPhase('joining')
    setRole('guest')
    try {
      const ch = await joinRoom(c, { onError: (m) => setError(m) })
      chan.current = ch
      roomRef.current = ch
      ch.onMessage((msg) => {
        if (msg.t === 'state') {
          setView(msg.m)
          setClockEnds(msg.clockLeft ? Date.now() + msg.clockLeft : 0)
          setPhase('playing')
        }
      })
      ch.onClose(() => setPhase('left'))
      ch.send({ t: 'hello', team })
    } catch (e) {
      setError(e.message)
      setPhase('lobby')
    }
  }

  const act = useCallback(
    (action) => {
      if (role === 'host') hostDispatch(action, 'host')
      else chan.current?.send({ t: 'act', action })
    },
    [role, hostDispatch],
  )

  function rematch() {
    if (roleRef.current === 'guest') return chan.current?.send({ t: 'rematch' })
    const prev = matchRef.current
    startMatch(prev.players.guest.team, prev.order[0] === 'host' ? 'guest' : 'host')
  }

  useEffect(() => () => {
    chan.current?.close()
    roomRef.current?.close?.()
    stopAmbience()
  }, [])

  // host referee timers: shot clock, result pause, halftime
  useEffect(() => {
    if (role !== 'host' || !view) return
    const ph = view.phase
    let ms = 0
    let action = null
    if (ph === 'def-call' || ph === 'off-call') (ms = SHOT_CLOCK_MS + 300), (action = { type: 'expire' })
    else if (ph === 'result') (ms = RESULT_PAUSE_MS), (action = { type: 'next' })
    else if (ph === 'half') (ms = HALF_PAUSE_MS), (action = { type: 'startHalf2' })
    if (!action) return
    const id = setTimeout(() => hostDispatch(action, 'ref'), ms)
    return () => clearTimeout(id)
  }, [role, view?.phase, view?.n, view?.half, hostDispatch]) // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'playing' && view) {
    return <Duel view={view} role={role} act={act} clockEnds={clockEnds} hostResult={(a) => role === 'host' && hostDispatch(a, 'ref')} onRematch={rematch} />
  }
  return (
    <Lobby
      phase={phase}
      team={team}
      pickTeam={pickTeam}
      code={code}
      setCode={setCode}
      error={error}
      onCreate={create}
      onJoin={join}
      invited={!!roomParam}
    />
  )
}

function Lobby({ phase, team, pickTeam, code, setCode, error, onCreate, onJoin, invited }) {
  const link = `${SITE}/h2h?room=${code}`
  const t = TEAM_BY_ABBR[team]
  return (
    <div className="lobby-wrap">
      <div className="lobby">
        <div className="eyebrow">Online head-to-head</div>
        <h2>Duel a friend</h2>
        <p className="lede">
          Same late-game spot, one drive each. You call their defense, they call yours. Best drive wins.
        </p>
        <div className="lobby-team" style={{ borderColor: t.endzone }}>
          <TeamSelect label="Your team" value={team} onChange={pickTeam} />
        </div>

        {phase === 'hosting' ? (
          <div className="lobby-box">
            <div className="room-code" aria-label="Room code">{code || '·····'}</div>
            <p className="fine">Send this link to a friend. The match starts when they join.</p>
            <div className="lobby-actions">
              <ShareButton text={`Duel me in Clutch Drive 🏈 ${link}`} label="Share invite link" />
              <button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
            </div>
            <p className="waiting"><span className="spinner" /> Waiting for your opponent…</p>
          </div>
        ) : (
          <>
            {!invited && (
              <button className="btn primary big" onClick={onCreate} disabled={phase !== 'lobby'}>
                Create a match
              </button>
            )}
            <div className={`lobby-join${invited ? ' stacked' : ''}`}>
              <label className="team-select">
                <span>{invited ? 'Room code' : 'Or join with a code'}</span>
                <input
                  value={code}
                  onChange={(e) => setCode(normalizeCode(e.target.value))}
                  placeholder="ABCDE"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={8}
                  className="code-input"
                />
              </label>
              <button className={`btn ${invited ? 'primary big' : ''}`} onClick={onJoin} disabled={phase === 'joining'}>
                {phase === 'joining' ? 'Connecting…' : invited ? 'Join the duel' : 'Join'}
              </button>
            </div>
          </>
        )}
        {phase === 'left' && <p className="error">Your opponent left the match.</p>}
        {error && <p className="error">{error}</p>}
        <p className="fine">
          Plays happen browser-to-browser. No account needed. <Link to="/">← Home</Link>
        </p>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ the duel screen
function useCountdown(ends) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!ends) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [ends])
  return ends ? Math.max(0, ends - now) : 0
}

function Duel({ view: m, role, act, clockEnds, hostResult, onRematch }) {
  const [sim] = useState(() => new PlaySim())
  const [simKey, setSimKey] = useState(0)
  const [status, setStatus] = useState({ phase: 'presnap' })
  const [preview, setPreview] = useState(null)
  const [draft, setDraft] = useState({ call: 'cover3', shown: null, key: null })
  const lastSnap = useRef(null)
  const reported = useRef(null)
  if (import.meta.env.DEV) window.__duel = { m, role, sim }

  const d = m.drives[m.half]
  const offense = TEAM_BY_ABBR[d.offense]
  const defense = TEAM_BY_ABBR[d.defense]
  const iAmOffense = offenseRole(m) === role
  const myTurn = isMyTurn(m, role)
  const left = useCountdown(clockEnds)
  const [, tick] = useState(0)
  useEffect(() => {
    if (m.phase !== 'live') return
    const id = setInterval(() => tick((x) => x + 1), 150)
    return () => clearInterval(id)
  }, [m.phase])

  useEffect(() => {
    startAmbience()
    sfx.whistle(0.3)
  }, [])

  // presnap: show the defense in the look they're showing (or the defender's draft look while picking)
  useEffect(() => {
    if (m.phase !== 'def-call' && m.phase !== 'off-call') return
    const shown = m.phase === 'def-call' && !iAmOffense ? draft.shown ?? draft.call : m.defCall?.shown ?? 'cover3'
    sim.camMode = 'broadcast'
    sim.timeScale = 1
    sim.reset({ play: 'dig', seed: 1, los: d.ballOn - 50, toGo: d.toGo, coverage: { call: shown, shown } })
    setSimKey((k) => k + 1)
  }, [m.phase, m.half, m.n, d.ballOn, d.toGo, m.defCall?.shown, draft.call, draft.shown, iAmOffense, sim]) // eslint-disable-line react-hooks/exhaustive-deps

  // snap: both browsers run the identical seeded play
  useEffect(() => {
    if (m.phase !== 'live' || !m.snap || lastSnap.current === m.snap.id) return
    lastSnap.current = m.snap.id
    const sn = m.snap
    sim.reset({ play: sn.play, seed: sn.seed, los: sn.los, toGo: sn.toGo, coverage: sn.coverage, situation: { clock: sn.clock } })
    sim.snap()
    setPreview(null)
    setSimKey((k) => k + 1)
  }, [m.phase, m.snap, sim])

  // reset the defense draft each snap
  useEffect(() => {
    if (m.phase === 'def-call') setDraft({ call: 'cover3', shown: null, key: null })
  }, [m.phase, m.n, m.half])

  const onStatus = useCallback(
    (s) => {
      setStatus(s)
      // the host's browser reports the official result at the whistle
      if ((s.phase === 'dead' || s.phase === 'over') && s.result && m.snap && reported.current !== m.snap.id) {
        reported.current = m.snap.id
        hostResult({ type: 'result', snapId: m.snap.id, result: s.result, message: s.message })
      }
    },
    [m.snap, hostResult],
  )

  const lockDefense = () => {
    unlock()
    sfx.click()
    act({ type: 'def', call: draft.call, shown: draft.shown ?? draft.call, key: draft.key })
  }
  const callPlay = (play) => {
    unlock()
    act({ type: 'off', play })
  }

  const shownNow = m.defCall?.shown ?? 'cover3'
  const scout = tendencies(d)
  const offName = iAmOffense ? 'You' : 'They'
  const firstDownZ = Math.min(d.ballOn + d.toGo, 100) - 50
  const inPlay = m.phase === 'live' || m.phase === 'result'
  const lr = m.lastResult
  const reveal = lr?.coverage && lr.coverage.call !== lr.coverage.shown ? `They showed ${COVERAGES[lr.coverage.shown].short}, played ${COVERAGES[lr.coverage.call].short}` : null
  void simKey

  return (
    <main className="game">
      <Suspense fallback={<div className="loading">Lacing up cleats…</div>}>
        <Canvas dpr={[1, 2]} camera={{ fov: 45, position: [0, 14, d.ballOn - 80], near: 0.1, far: 1000 }}>
          <PlayScene
            sim={sim}
            version={`${d.offense}-${d.defense}`}
            offense={offense}
            defense={defense}
            onStatus={onStatus}
            onEvent={playEvent}
            preview={m.phase === 'off-call' && iAmOffense ? preview : null}
            los={inPlay ? sim.los : d.ballOn - 50}
            firstDown={inPlay ? (sim.firstDown >= 50 ? null : sim.firstDown) : firstDownZ >= 50 ? null : firstDownZ}
          />
        </Canvas>
      </Suspense>

      <div className="hud-top">
        <Scorebug drive={d} offense={offense} defense={defense} clock={m.phase === 'live' ? Math.max(0, d.clock - Math.max(0, sim.t - 0.35)) : d.clock} running={false} />
        <div className="duel-strip">
          <span className="duel-half">Drive {m.half + 1}/2</span>
          <span className={`duel-role ${iAmOffense ? 'off' : 'def'}`}>{iAmOffense ? 'You: OFFENSE' : 'You: DEFENSE'}</span>
          {m.summaries[0] && (
            <span className="duel-sum">
              D1 {m.order[0] === role ? 'you' : 'them'}: {m.summaries[0].td ? `TD, ${fmtClock(m.summaries[0].clock)} left` : `no TD, ${fmtBallOn(m.summaries[0].ballOn)}`}
            </span>
          )}
        </div>
        <DriveStrip plays={d.plays} />
        {myTurn && <ShotClock left={left} />}
      </div>

      {m.phase === 'result' && <ResultBanner result={lr?.result} message={lr?.message} />}

      <div className="hud-bottom">
        {m.phase === 'def-call' && !iAmOffense && (
          <DefensePicker draft={draft} setDraft={setDraft} onLock={lockDefense} scout={scout} drive={d} />
        )}
        {m.phase === 'def-call' && iAmOffense && (
          <WaitCard title="The defense is calling its coverage" left={left}>
            Watch the safeties when they line up. They might be disguising it.
          </WaitCard>
        )}
        {m.phase === 'off-call' && iAmOffense && (
          <div className="sheet">
            <div className="sheet-head">
              <span className="sheet-title">
                {`${['1st', '2nd', '3rd', '4th'][d.down - 1]} & ${d.ballOn + d.toGo >= 100 ? 'Goal' : d.toGo}`} <em>·</em> {fmtBallOn(d.ballOn)}
              </span>
              {d.clockRunning ? (
                <button className="btn small danger" onClick={() => act({ type: 'timeout' })} disabled={!d.timeouts}>
                  {d.timeouts ? `Timeout (${d.timeouts})` : 'No timeouts'}
                </button>
              ) : (
                <span className="clock-note">Clock stopped</span>
              )}
            </div>
            <FieldBar drive={d} offense={offense} defense={defense} />
            {d.clockRunning && <div className="hurry">⏱ Clock is running: −15s when you snap it (timeout stops it)</div>}
            <DefenseRead shown={shownNow} tip={`${coachTip(d, shownNow)} (Could be a disguise.)`} />
            <PlayCards onCall={callPlay} onPreview={setPreview} />
          </div>
        )}
        {m.phase === 'off-call' && !iAmOffense && m.defCall && (
          <WaitCard title="Locked in. Waiting for their call…" left={left}>
            You're in <b>{COVERAGES[m.defCall.call].name}</b>
            {m.defCall.shown !== m.defCall.call && <>, showing <b>{COVERAGES[m.defCall.shown].short}</b></>}
            {m.defCall.key && <>, keying on the <b>{PLAYS[m.defCall.key.play].label}</b></>}.
          </WaitCard>
        )}
        {m.phase === 'result' && reveal && <div className="reveal">🎭 {reveal}</div>}
        {m.phase === 'result' && <div className="next-note">Next snap in a moment…</div>}
      </div>

      {m.phase === 'half' && <HalfCard m={m} role={role} />}
      {m.phase === 'over' && <DuelOver m={m} role={role} onRematch={onRematch} offName={offName} />}
    </main>
  )
}

function ShotClock({ left }) {
  const pct = Math.max(0, Math.min(1, left / SHOT_CLOCK_MS))
  const s = Math.ceil(left / 1000)
  const prev = useRef(s)
  useEffect(() => {
    if (s !== prev.current && s <= 5 && s > 0) sfx.tick()
    prev.current = s
  }, [s])
  return (
    <div className={`shotclock${s <= 5 ? ' late' : ''}`} aria-label={`${s} seconds to call it`}>
      <span className="sc-bar" style={{ transform: `scaleX(${pct})` }} />
      <span className="sc-label">YOUR CALL · {s}s</span>
    </div>
  )
}

function WaitCard({ title, left, children }) {
  return (
    <div className="card wait">
      <div className="wait-head">
        <span className="spinner" />
        <b>{title}</b>
        {left > 0 && <span className="wait-left">{Math.ceil(left / 1000)}s</span>}
      </div>
      <p className="lede small">{children}</p>
    </div>
  )
}

function DefensePicker({ draft, setDraft, onLock, scout, drive }) {
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const called = Object.entries(scout.share).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1])
  return (
    <div className="sheet defpick">
      <div className="sheet-head">
        <span className="sheet-title">
          Call the defense <em>·</em> {['1st', '2nd', '3rd', '4th'][drive.down - 1]} & {drive.ballOn + drive.toGo >= 100 ? 'Goal' : drive.toGo}
        </span>
        {called.length > 0 && (
          <span className="scout">Scouting: {called.map(([p, v]) => `${PLAYS[p].label} ${Math.round(v * 100)}%`).join(' · ')}</span>
        )}
      </div>
      <div className="covs">
        {COVERAGE_IDS.map((c) => (
          <button key={c} className={`cov${draft.call === c ? ' on' : ''} ${c}`} onClick={() => set({ call: c, shown: draft.shown === c ? null : draft.shown })}>
            <strong>{COVERAGES[c].name}</strong>
            <span>{COVER_BLURB[c]}</span>
          </button>
        ))}
      </div>
      <div className="defopts">
        <label className="team-select">
          <span>🎭 Show them</span>
          <select value={draft.shown ?? draft.call} onChange={(e) => set({ shown: e.target.value === draft.call ? null : e.target.value })}>
            {COVERAGE_IDS.map((c) => (
              <option key={c} value={c}>{c === draft.call ? `${COVERAGES[c].short} (no disguise)` : `${COVERAGES[c].short} (disguise)`}</option>
            ))}
          </select>
        </label>
        <div className="guess">
          <span className="guess-label">🔮 Guess their play (right: you jump it · wrong: a step slow)</span>
          <div className="chips">
            {[null, 'out', 'dig', 'deep', 'run'].map((p) => (
              <button key={p ?? 'none'} className={`chip${draft.key === p ? ' on' : ''}`} onClick={() => set({ key: p })}>
                {p ? PLAYS[p].label : 'No guess'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button className="btn primary big lock" onClick={onLock}>Lock it in</button>
    </div>
  )
}

function HalfCard({ m, role }) {
  const s = m.summaries[0]
  const mine = m.order[0] === role
  return (
    <div className="modal-wrap soft">
      <div className="modal">
        <div className="modal-emoji">{s.td ? '🏈' : '🛑'}</div>
        <h2>Drive 1 is done</h2>
        <p className="lede">
          {mine ? 'You' : 'They'} {s.td ? `scored with ${fmtClock(s.clock)} left` : `came up short at the ${fmtBallOn(s.ballOn)}`}.
        </p>
        <div className="grid-emoji">{s.grid}</div>
        <p className="lede"><b>Switching sides:</b> you're on {mine ? 'defense' : 'offense'} now. {mine ? 'Stop them!' : `Beat that.`}</p>
      </div>
    </div>
  )
}

function DuelOver({ m, role, onRematch }) {
  const won = m.winner === role
  const draw = m.winner === 'draw'
  const line = (i) => {
    const s = m.summaries[i]
    const who = m.order[i] === role ? 'You' : 'Them'
    return `${who} (${s.offense}): ${s.td ? `TD, ${fmtClock(s.clock)} left` : `no TD, ${fmtBallOn(s.ballOn)}`}`
  }
  const text = `Clutch Drive head-to-head 🏈\n${draw ? 'Dead even!' : won ? 'I won the duel!' : 'Lost the duel. Rematch?'}\n${m.summaries[0].grid}  vs  ${m.summaries[1].grid}\n${SITE}/h2h`
  return (
    <div className="modal-wrap">
      <div className={`modal ${won ? 'won' : 'lost'}`}>
        <div className="modal-emoji">{draw ? '🤝' : won ? '🏆' : '😤'}</div>
        <h2>{draw ? "It's a draw!" : won ? 'You won the duel!' : 'They won the duel.'}</h2>
        <div className="duel-lines">
          <p>{line(0)}<br /><span className="grid-emoji small">{m.summaries[0].grid}</span></p>
          <p>{line(1)}<br /><span className="grid-emoji small">{m.summaries[1].grid}</span></p>
        </div>
        <div className="modal-actions">
          <button className="btn primary" onClick={onRematch}>Rematch (switch who starts)</button>
          <ShareButton text={text} label="Share result" />
          <button className="btn" onClick={() => navigate('/h2h')}>New opponent</button>
        </div>
      </div>
    </div>
  )
}
