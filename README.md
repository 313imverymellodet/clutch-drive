# Clutch Drive

Low-poly chibi football: characters built in Blender, played in the browser with Three.js / React Three Fiber.
You're trailing late in the 4th with the clock running. Call the plays and win it with a touchdown.

- **Daily Drive** (`/play?mode=daily`): the same scenario and same play outcomes for everyone each day, with a Wordle-style emoji result to share.
- **Survivor** (`/play?mode=survivor`): win to stay alive; each game gets harder. Best streak is saved.
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
