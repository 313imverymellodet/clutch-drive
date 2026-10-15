# Clutch Drive

Low-poly chibi football: characters built in Blender, played in the browser with Three.js / React Three Fiber.
You're trailing late in the 4th with the clock running. Call the plays and win it with a touchdown.

- **Daily Drive** (`/play?mode=daily`): the same scenario and same play outcomes for everyone each day, with a Wordle-style emoji result to share.
- **Survivor** (`/play?mode=survivor`): win to stay alive; each game gets harder. Best streak is saved.
- **Practice** (`/play?mode=practice`): pick any two of the 32 teams and run drives as often as you like.
- **Locker Room** (`/locker`): every animation in any uniform.

The name lives in `src/brand.js`, so a rename is a one-line change.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

- Before each snap the defense shows a look (Cover 1/2/3, blitz or prevent) and the coach suggests what beats it. Hover a play (or tap it once on a phone) to see its routes drawn on the field. Keys: 1–4 call plays, T timeout, Enter next play, R replay.
- In a game, call one of four plays:
  - **Quick Out**: a short throw to the slot, who steps out of bounds to stop the clock (6–9 yards).
  - **Dig**: a safe pass to WR1 over the middle (usually 14–23 yards).
  - **Deep Shot**: boom or bust to WR2 on a go route (about half fall incomplete; completions go for 35+).
  - **HB Dive**: a handoff up the A gap (2–7 yards).
  - Outcomes are seeded, so each snap plays out differently. There are broken tackles, pass breakups, overthrows, touchdowns and runs out of bounds. **Replay** re-runs the same play in slow motion with a close-up camera.
- **Clock rules:** incompletions and runs out of bounds stop the clock. If you're tackled in bounds, the clock runs in real time while you pick the next play, with a minimum 8 seconds to line up. Timeouts stop it.

Team names and colors are approximations, with no logos. Fan-made, not affiliated with the NFL.

## Football AI

The defense is a real opponent (`src/sim/playSim.js`):

- **Play-calling:** `chooseDefense` picks a coverage from down, distance, clock and field position, and disguises it about 12% of the time (more in later Survivor games).
- **Coverage:** man defenders read the receiver a beat late and extrapolate, so they stay with straight routes but get beat on sharp breaks. Some reps they "blanket" their man. Zone defenders drop to landmarks, squeeze receivers in their area, and break on the ball after the throw.
- **Pass rush:** blockers pair up with rushers; rushers win their reps after a random time, and a free rusher shoots a gap. The QB senses pressure and throws early (less accurate), or gets sacked. If the defense shows blitz, the back and tight end stay in to block.
- **After the catch:** the carrier scores a fan of directions for open space, defenders take intercept angles, teammates peel off to block, and tackles can be broken (especially arm tackles from behind).

`node scripts/outcomes.mjs` prints the balance table of every play against every coverage. Roughly: Dig beats man and Cover 3; Quick Out beats zones and stops the clock; Deep Shot beats the blitz and Cover 1 but gets picked off against Prevent and two-deep zones; HB Dive works against zones and gets stuffed by the blitz.

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
- `node scripts/e2e.mjs <dir> <w> <h> [daily|survivor|practice] [plays]` plays a full drive by clicking the real UI and screenshots each step.
- `node scripts/make-assets.mjs` regenerates `public/og.png` (social card) and the PNG app icons.
- `node scripts/check-errors.mjs [path]` loads a page and prints any errors.
- `node scripts/outcomes.mjs [seeds]` simulates every play call across many seeds and prints the yardage spread, for balance tuning.
- `node scripts/capture-viewer.mjs <dir>` does the same for the Characters viewer.
