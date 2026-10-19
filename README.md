# Clutch Drive

Low-poly chibi football: characters built in Blender, played in the browser with Three.js / React Three Fiber.
You're trailing late in the 4th with the clock running. Call the plays and win it with a touchdown.

- **Daily Drive** (`/play?mode=daily`): a **real NFL moment** each day (actual score, clock, field position and timeouts from a team that trailed by 4–6 late), the same for everyone, with a Wordle-style result to share. Afterward you see what really happened and whether you beat history.
- **Survivor** (`/play?mode=survivor`): a run of real moments; each win digs into a tougher one (lower real win probability). Best streak is saved.
- **Practice** (`/play?mode=practice`): pick any two of the 32 teams and run drives as often as you like.
- **Defense** (`/play?mode=defense`): you just took the lead; stop the AI's two-minute drive. Call one of 8 coverages each snap, disguise your shell, and guess the concept. Win the Daily Drive and you get a bonus "hold the lead" round.
- **Head-to-Head** (`/h2h`): duel a friend online. Create a match, send the link, and each of you gets one drive from the same late-game spot. On every snap the defense locks in a coverage (it can disguise its look and guess the play), then the offense reads the look and calls a play. Best drive wins.
- **Locker Room** (`/locker`): every animation in any uniform.

The name lives in `src/brand.js`, so a rename is a one-line change.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

- **Playbook:** 18 concepts across four families, with a route for every receiver. Any play can be flipped (⇄).
  - **Quick:** Quick Out, Slant-Flat, Stick, Hitches.
  - **Intermediate:** Dig, Levels, Flood, Mesh, Curl-Flat, Smash, Y-Cross.
  - **Deep:** Deep Shot, Four Verts, Post-Wheel.
  - **Run:** HB Dive, Outside Zone, HB Draw, **QB Blast** (QB power behind a lead block).
- **Read progression:** pick your 1st look, 2nd look and check-down. After the snap the QB works them in that order: he throws to the first open man, moves on if covered, checks down, scrambles or throws it away under pressure, and sometimes stares down a receiver (that's how interceptions happen).
- **Calling a play:** tap a play to see its routes and numbered reads on the field, then tap again (or SNAP) to run it. Keys: 1–6 pick, Enter snaps, F flips, T timeout, R replay.
- **Reading the defense:** the defense shows a shell before the snap. It's often a disguise, and it rotates into the real coverage at the snap. The coach suggests what grades out best against the look (from the play × coverage data), and the "Beats Cover X" tags on the play cards come from the same data.
- **Clock rules:** incompletions and runs out of bounds stop the clock. If you're tackled in bounds, the clock runs while you pick the next play (minimum 8 seconds). Timeouts stop it.

## You're the QB now (live controls)

During a play in Daily, Survivor and Practice you can take over:

- **Throw it yourself:** each read gets a ring on the field and a button (green = open, yellow = tight, red = covered). Tap either one, or press 1–3. A tap during the drop throws as soon as he's set. **Pump fake** (Q) can freeze defenders near the receiver he's looking at, but it costs time. **Throw away** (X) and **Scramble** (S) are always there. Do nothing and the QB works your read progression himself. Once you touch anything he waits on you, so hold it too long and you'll get sacked.
- **After the catch:** **Juke** (← / →) can freeze nearby tacklers, **Spin** (↑) makes the next tackle much harder, **Get out of bounds** (S) stops the clock, and **Get down** (↓) ends the play where you are.
- **Spike it:** appears next to Timeout when the clock is running. It takes about 3 seconds to hustle to the line plus 1 second for the spike, and it costs a down.
- Taps are logged against the simulation's own clock, so instant replay re-runs them exactly. The Daily stays fair: the same taps on the same play give the same result.
- Head-to-head and Defense mode keep the automatic QB for now, because a live tap would have to be synced to the other browser mid-play.
- `node scripts/live-qb-e2e.mjs` checks all of this against the dev server.

## Sound

Crowd, touchdown roar, groan, cheer, tackle hit, QB cadence and the victory theme were generated with Viewmax (Everygen) and processed by `scripts/make-sounds.mjs` (trims silence, evens out volume, makes the crowd loop seamless, encodes AAC) into `public/sounds/`. `src/game/sound.js` downloads them as the game loads, decodes them on the first tap, and holds a clip asked for while audio is still starting (like the cadence on "Take the field") until it can play. It uses the built-in synth sounds for anything that fails to load. On iPhones it asks to be treated as media playback, so sound still plays with the silent switch on.

## Clutch Hoops (`/hoops`, beta)

The basketball game: down late, your ball, one possession at a time both ways.

- **Offense:** call one of 7 sets (High Pick & Roll, Horns Pop, Floppy, Iso, Spain Pick & Roll, Post Up, Hammer). Each has paths, screens and a read order (`src/hoops/sets.js`). Then take over whenever you like: pass to any teammate (rings and buttons show who's open, keys 1–4), **Drive** (D), **Stepback** (S, can freeze your defender), or **Shoot** (Space): tap to rise, tap again at the top of the jump. The meter grades the release perfect / good / early / late. Do nothing and your team runs the set, with the handler working the reads.
- **Defense:** pick a coverage (Man, Switch everything, Drop, Hedge & recover, 2-3 Zone), then play it live: **Contest** (C) right as the shooter rises (about 18% fewer points; too early and your man bites and gives up a lane), **Double** (X) to trap the ball (more steals, but someone's open), or **Foul** (F). Scouting shows the set they keep running and which coverages it hurts.
- **Hot hand:** two straight makes by a player and he's 🔥 heating up (+4% shooting, +7% after three), for both teams.
- **Feedback:** every shot gets a quality line ("Contested three · 34% shot · perfect release"). Sets that beat the look they're showing are marked ✓, though the look can be a disguise. Each reacts to screens differently: switch swaps assignments and creates mismatches, drop gives up pull-ups, hedge leaves the roller open for a beat. Help defenders rotate to stop drives and leave their man open for the kick-out.
- **End-game rules:** the game clock and shot clock run; a shot released before the horn counts; a timeout after a make or a stop advances the ball (saves about 4s); offensive rebounds reset the shot clock to 14. When you're behind, **Foul** to stop the clock. When the AI is behind, it fouls you, and you shoot free throws with a timing mini-game. A tie at the horn goes to a 45-second overtime.
- **AI:** their defense keys on the sets you keep calling and sometimes disguises its look. Their offense attacks the coverages you lean on, and runs out the clock when it leads.
- **Engine:** `src/hoops/sim.js` is a fixed-step, seeded half-court sim like the football one (instant replay re-runs your taps). `node scripts/hoops-outcomes.mjs` plays every set against every coverage to tune it: currently about 0.96 points per possession, with clear strengths and weaknesses per set.
- **Arena and crowd** (`src/hoops/Arena.jsx`): about 900 low-poly fans in home colors. Bodies, heads and signs are three instanced meshes, and they bounce, clap and throw their arms up in the vertex shader. There are courtside seats, camera flashes on big moments, rafter banners, and LED ribbons that switch to DE-FENSE!, 3!!!, BUCKET! or STOP!. The crowd is partisan: it roars for home buckets and stops and groans for road ones.
- **Sound** (`src/hoops/sound.js`, Viewmax clips `public/sounds/hoops-*.m4a`, made with `node scripts/make-sounds.mjs <dir> hoops`): arena crowd bed (louder when it's tight late), dribbles timed to the ball hitting the floor, sneaker squeaks on hard cuts, swish, rim clank, referee whistle, horn, the home crowd's DE-FENSE chant, roars and groans, and a hype track when you win.
- **Characters:** `blender/build_player.py -- --hoops` builds `public/models/hoops.glb`: no helmet, hair, tank top, shorts, plus Dribble, Shoot, Pass, Defend, Contest and Layup clips.
- Daily (`/hoops`) is the same made-up scenario for everyone each day. Practice (`/hoops?mode=practice`) lets you pick any two teams. The win probability is an estimate for now. Real NBA endings and a fitted model from hoopR play-by-play are the next step, along with Survivor, Defense mode and head-to-head for hoops.
- `node scripts/hoops-e2e.mjs [outDir] [w] [h] [mode]` plays a whole game through the UI.

## Real moments and win probability

`npm run data` (or `node scripts/build-moments.mjs <cacheDir> 2012 2026`) downloads nflverse play-by-play and builds two files:

- `src/data/moments.json`: every first-down snap where a team trailed by 4–6 with 0:35–3:00 left on its own 10–45 yard line (343 moments from 2012 to now). It keeps teams, score, clock, field position, timeouts, nflverse's win probability, how the drive really ended, and the final score. **No player names or play descriptions are read.**
- `src/data/wpModel.json`: a logistic win-probability model fit on about 14,000 real late-game plays. On held-out plays its log loss is 0.517 vs. 0.517 for nflverse's own model, and it's well calibrated. At the 343 moment starts it averages within 4.3 points of nflverse's numbers.

The Daily walks through the moments in a fixed shuffle (no repeats for about 11 months). The live meter (`src/game/winprob.js`) updates after every snap and while the clock runs. The end screen shows the win-probability chart and "what really happened".

Data credit (required by the CC BY 4.0 license): real game situations and the win-probability model come from [nflverse](https://github.com/nflverse/nflverse-data) play-by-play data. The credit appears on the landing page footer and the end-of-drive history card.

## Real branding

The game shows **real player names, jersey numbers and team logos** in dev, previews and (since `REAL_BRANDING=1` was set on the Vercel project's Production environment) on the live site.

- `scripts/build-players.mjs` (part of `npm run data`) writes `src/data/players.json`. For each real moment it uses the 22 players those teams actually leaned on in that game: the QB who ran that drive, the most-targeted receivers and tight end, the lead back, and the defenders with the most tackles, sacks, hits and pass breakups. Numbers and names come from nflverse weekly rosters. Practice, Defense and Head-to-Head use each team's current lineup from the latest season.
- Names show up in every play call ("Complete to Plaxico Burress"), the read picker, the intro ("Charlie Batch is under center"), the landing page and the "what really happened" card. Jerseys carry the real numbers. Names are labels only; they never change how a play resolves, so seeds and head-to-head sync are unaffected.
- Logos load from ESPN's logo CDN (CORS-enabled) and appear in the scorebug, intro, team pickers, landing hero and painted at midfield.
- The switch is `__REAL__` in `vite.config.js`: on for dev and previews, and for production only when `REAL_BRANDING=1` (currently set in Vercel). To turn it off live, remove that variable or set it to `0` (`npx vercel env rm REAL_BRANDING production`) and redeploy. When it's off, the lineup data isn't bundled at all and nothing loads from ESPN.
- Real names and NFL logos generally need NFLPA and NFL licenses for a public game; the variable is the one place to switch them off.

## Football AI

Both sides are real coordinators (`src/sim/playSim.js`, `src/sim/aiOffense.js`):

- **Defensive play-calling:** `chooseDefense` picks from Cover 1/2/3/4, Tampa 2, Fire Zone (zone blitz), Cover 0 and Prevent based on down, distance, clock and field position. It leans toward coverages that stop the concept families you've been calling.
- **Disguises:** it shows a different shell about 28% of the time, and much more often against an offense that keeps winning ("you've been reading us").
- **Keying:** call the same family 2 of 3 snaps and the defense keys on it: faster reads, tighter coverage, and someone sitting in that family's window (flat squat, robber, deep help, loaded box). Guessing wrong costs them a step, so mixing it up pays off.
- **Coverage behavior:** man defenders read receivers a beat late (they stay with straight lines but get beat on breaks), with a chance to "blanket" a man on any rep. Zones drop to landmarks, squeeze receivers, and break on the throw.
- **Pass rush:** blockers pair up with rushers; free rushers shoot gaps; the QB feels pressure.
- **Offensive coordinator** (Defense mode, and head-to-head when a shot clock runs out): it reads your shell but weighs the chance it's a disguise, using the play × coverage matrix. It manages the clock (sideline throws, timeouts) and avoids becoming predictable.
- **After the catch:** the ball carrier looks for open space, defenders take intercept angles, receivers stalk-block, and tackles can be broken (QB Blast breaks more).

`node scripts/outcomes.mjs [seeds] [--write]` prints every play against every coverage. `--write` regenerates `src/sim/counters.json`, which feeds both AIs, the coach and the play tags. `node scripts/spam.mjs` measures how fast repeated calls get shut down.

## Online head-to-head

- **Transport** (`src/net/room.js`): every message goes out on every path that's up, and the receiver de-duplicates:
  - **Direct:** a WebRTC data channel via PeerJS. Fastest, but between two devices on different networks it often can't connect, because the public TURN relays (including PeerJS's own) don't work.
  - **Relay:** MQTT over secure WebSockets through two independent public brokers (EMQX and Mosquitto). This works on any network that allows normal web traffic, so phones on cellular and home or office Wi-Fi all connect.
  - **Lobby and recovery:** the host publishes a retained "room open" marker, so a wrong code fails fast with a clear message. Both paths reconnect on their own: a phone host can switch apps to share the link, and a guest who drops mid-game resyncs. The duel screen shows 🟢 Direct, 🟡 Relay or 🔴 Reconnecting.
  - **Testing knob:** set `localStorage['cd.transport']` to `relay` or `direct` to force one path.
- **Referee** (`src/game/h2h.js`): pure match rules. The host's browser applies both players' actions and sends each side only what it may see (the offense never sees the real coverage or the defense's guess before the snap).
- **Sync:** each snap carries a seed, so both browsers run the identical deterministic play. The host's result is official. Shot clocks are 15 seconds; if one runs out, the CPU calls it.
- **Known limit:** networks that block WebSockets on ports 8084 and 8081 (some locked-down corporate Wi-Fi) fall back to direct only. A paid relay on port 443 would close that gap.
- **Tests:** `node scripts/h2h-selfplay.mjs` plays full duels through the rules, and `node scripts/h2h-e2e.mjs <dir> [baseUrl]` has two real browsers play each other over the network and checks that both screens match. Add `TRANSPORT=relay` to simulate two devices on different networks, and `FLAKY=1` to drop the host in the lobby and the guest mid-game.

## Character pipeline

`blender/build_player.py` builds the whole character from code: mesh, rig, and all animation clips.
It exports `public/models/player.glb` (~310 KB, mostly animation data) and saves `blender/player.blend` so you can open it and edit by hand.

```bash
npm run model           # rebuild the GLB after changing the script
npm run model:preview   # also render PNG previews to blender/preview/
```

- **Clips:** Idle, Stance, Run, Block, Throw, Catch, Dive, Fall, Celebrate (30 fps).
- **Team colors:** materials named `Jersey`, `Pants`, `Helmet`, `Stripe`, `Socks`, `Glove` and `Skin` get recolored per team in `src/three/characters.js`.
- **Posing:** the script measures each bone's axes, so poses are written as plain *swing / spread / twist* degrees. Feet stay flat automatically, and every pose is auto-grounded so nobody sinks into the turf.
- **Hand-made art later:** if you model a nicer character in Blender, keep the same bone names, action names and material names. The game will load it with no code changes.

## Deploy

Live at **https://clutch-drive.vercel.app**. The Vercel project is connected to this GitHub repo, so every push to `main` deploys to production automatically (other branches get preview URLs).
It's a static Vite build; `vercel.json` rewrites every route to `index.html`. The social-preview tags in `index.html` point at the production domain; update them if the domain changes.

Manual deploy, if ever needed: `npx vercel deploy --prod`.

## Code map

| Path | What it does |
| --- | --- |
| `src/pages/Landing.jsx`, `src/scenes/HeroScene.jsx` | Landing page with a live 3D hero of today's matchup |
| `src/pages/Game.jsx`, `src/ui/GameUI.jsx` | Game flow (intro → call → play → result → game over), scorebug, play cards, banners, share |
| `src/game/drive.js` | Drive rules: clock, downs, field position, score, daily/survivor scenarios, defensive call per snap, coach tips, share text |
| `src/game/sound.js` | Synthesized WebAudio sound effects (whistle, hits, catches, crowd) and mute |
| `src/components/RouteArt.jsx` | Pre-snap route preview drawn on the turf |
| `src/pages/H2H.jsx`, `src/game/h2h.js`, `src/net/room.js` | Head-to-head lobby and duel screen, match rules, peer-to-peer transport |
| `src/sim/playbook.js`, `src/ui/Playbook.jsx` | The 18-play playbook data, and the play caller UI (tabs, diagrams, read progression, flip, defense picker) |
| `src/sim/aiOffense.js`, `src/sim/counters.json` | Offensive coordinator AI, and the generated play × coverage matrix |
| `src/pages/Defend.jsx` | Defense mode (hold the lead) |
| `scripts/build-moments.mjs`, `src/game/moments.js`, `src/game/winprob.js` | nflverse data pipeline, real moments, live win probability |
| `scripts/build-players.mjs`, `src/game/real.jsx` | Real lineups and logos for test builds |
| `src/ui/LiveControls.jsx`, `src/components/LiveRings.jsx` | Live QB and ball-carrier controls |
| `src/hoops/*`, `src/pages/Hoops.jsx` | Clutch Hoops: sets, sim, game rules, AI, scene, UI |
| `src/data/nflTeams.js` | 32 teams: city, name, abbreviation, uniform colors (jersey, helmet, stripe, pants, socks, numbers, end zone) |
| `src/three/characters.js` | Loads and clones the rig, applies toon materials, uniforms and jersey numbers, `Animator` (crossfading clip player) |
| `src/sim/playSim.js` | Play calls, roles, routes, coverage, blocking, ball flight, catches, breakups, tackles. Seeded and fixed-step, so replays are exact. Units are yards; offense drives toward +z |
| `src/scenes/PlayScene.jsx` | Steps the sim at 60 Hz, applies it to the 3D players, and runs the ball, broadcast/replay cameras and crowd reactions |
| `src/components/Stadium.jsx` | Stands, instanced crowd in team colors (cheers via the vertex shader), goalposts, light towers, sky |
| `src/scenes/ViewerScene.jsx` | Character / animation viewer |
| `src/components/Field.jsx` | Field drawn onto a canvas texture (yard lines, hashes, numbers, end zones) |

## Dev helpers

- In dev builds, `window.__sim` is the live sim. `__sim.camMode = 'close'` switches to a replay-style close-up camera; `__sim.timeScale = 0.25` gives slow motion.
- `window.__advance(seconds)` steps the play and renders synchronously.
- `node scripts/capture.mjs <dir> <w> <h> [broadcast|close] [dig|deep|run] [seed]` saves headless screenshots through a play (needs `npm run dev` running and Google Chrome installed).
- `node scripts/e2e.mjs <dir> <w> <h> [daily|survivor|practice|defense] [plays]` plays a full drive by clicking the real UI and screenshots each step. Plays are names like `Levels,Mesh|flip,QB Blast`.
- `node scripts/make-assets.mjs` regenerates `public/og.png` (social card) and the PNG app icons.
- `node scripts/check-errors.mjs [path]` loads a page and prints any errors.
- `node scripts/outcomes.mjs [seeds]` simulates every play call across many seeds and prints the yardage spread, for balance tuning.
- `node scripts/capture-viewer.mjs <dir>` does the same for the Characters viewer.
