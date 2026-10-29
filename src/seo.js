/*
 * Search and sharing metadata for every page, in one place. Plain data (no JSX, no browser APIs) so it's used
 * twice: by the app (document title/meta on navigation) and by the build (vite.config.js writes a real HTML
 * file per route with these tags, structured data and crawlable text, plus sitemap.xml).
 *
 * Moving to a custom domain? Change SITE_URL. Everything else follows.
 */
export const SITE_URL = 'https://clutch-drive.vercel.app'
export const SITE_NAME = 'Clutch Drive'

const DISCLAIMER = 'Fan-made game. Not affiliated with or endorsed by the NFL, the NBA or their teams.'

export const ROUTES = {
  '/': {
    file: 'index.html',
    title: 'Clutch Drive: Free Daily Football & Basketball Strategy Games',
    description: 'Down late, clock running: call the plays and win it. Free browser games built on real NFL and NBA endings, with a new daily challenge, live win probability and cute 3D players.',
    image: '/og.png',
    changefreq: 'daily',
    priority: 1,
    h1: 'Clutch Drive: call the plays, win the game',
    intro: [
      'Clutch Drive is a free sports strategy game you play in your browser. Every day you get a real late-game moment from an NFL or NBA game: the real score, clock, field position and timeouts. You call the plays, your cute low-poly team runs them in 3D, and a live win-probability meter shows every swing.',
      'Play the Daily Drive (football), Daily Hoops (basketball), Survivor in both sports, Defense mode, or duel a friend online. Share your result like a daily puzzle and see who is more clutch.',
    ],
    links: [
      ['/play?mode=daily', 'Play today’s Daily Drive (football)'],
      ['/hoops', 'Play today’s Daily Hoops (basketball)'],
      ['/h2h', 'Duel a friend online'],
      ['/whats-new', 'What’s new in V2'],
      ['/how-to-play', 'How to play'],
    ],
  },
  '/play': {
    file: 'play.html',
    canonicalQuery: '?mode=daily',
    title: 'Daily Drive: Win a Real NFL Two-Minute Drill | Clutch Drive',
    description: 'A real NFL comeback spot every day. Trailing late with the clock running: call the plays, set your reads, and drive for the winning touchdown. Free, no download.',
    image: '/og.png',
    changefreq: 'daily',
    priority: 0.9,
    h1: 'Daily Drive: the two-minute drill, every day',
    intro: [
      'Your team trails by 4 to 6 with under three minutes left: a real situation from an NFL game. Call plays from an 18-concept playbook (Levels, Mesh, Smash, Four Verts, QB Blast and more), read the defense, manage the clock with timeouts and spikes, and throw it yourself if you want.',
      'Everyone gets the same drive each day. Afterward you see what really happened in that game and whether you beat history.',
    ],
    links: [
      ['/play?mode=survivor', 'Survivor: win to stay alive'],
      ['/play?mode=defense', 'Defense: protect the lead'],
      ['/play?mode=practice', 'Practice with any two teams'],
      ['/how-to-play#football', 'Football tips'],
    ],
    preload: '/models/player.glb?v=2',
  },
  '/hoops': {
    file: 'hoops.html',
    canonicalQuery: '',
    title: 'Clutch Hoops: Free Daily Basketball Play-Calling Game',
    description: 'A real NBA ending every day: down late, your ball. Call pick-and-rolls and coverages, time your jumper, foul to stop the clock, and beat what really happened. Free in your browser.',
    image: '/og-hoops.jpg',
    changefreq: 'daily',
    priority: 0.9,
    h1: 'Clutch Hoops: win a real NBA ending',
    intro: [
      'Clutch Hoops drops you into the last minute of a real NBA game with your team trailing. On offense, call a set (High Pick & Roll, Horns, Floppy, Spain, Iso, Post Up, Hammer) and take over: pass, drive, step back, and release your jumper at the top. On defense, pick a coverage and contest shots, double team, or foul to stop the clock.',
      'A new real ending every day, a live win-probability meter, and a share card to brag with.',
    ],
    links: [
      ['/hoops?mode=survivor', 'Hoops Survivor: win to stay alive'],
      ['/hoops?mode=practice', 'Hoops practice: pick any two teams'],
      ['/how-to-play#hoops', 'Basketball tips'],
      ['/play?mode=daily', 'Try the football Daily Drive'],
    ],
    preload: '/models/hoops.glb?v=2',
  },
  '/h2h': {
    file: 'h2h.html',
    canonicalQuery: '',
    title: 'Head-to-Head: Online Football Play-Calling Duel | Clutch Drive',
    description: 'Send a link and duel a friend: you call their defense, they call yours. Disguise your coverage, guess their play and out-scheme them in a late-game drive. Free and online.',
    image: '/og.png',
    changefreq: 'monthly',
    priority: 0.7,
    h1: 'Head-to-Head: out-scheme a friend',
    intro: ['Create a room, send the link, and play the same late-game spot against a friend. One drive each: you call your offense and their defense, they do the same. Best drive wins.'],
    links: [['/how-to-play', 'How to play']],
    preload: '/models/player.glb?v=2',
  },
  '/how-to-play': {
    file: 'how-to-play.html',
    canonicalQuery: '',
    title: 'How to Play Clutch Drive & Clutch Hoops: Plays, Reads and Tips',
    description: 'Learn the football playbook, read progressions and coverages, clock management, and the basketball sets, defenses and shot timing in Clutch Drive and Clutch Hoops.',
    image: '/og.png',
    changefreq: 'monthly',
    priority: 0.6,
    h1: 'How to play Clutch Drive and Clutch Hoops',
    intro: ['Everything you need to win the Daily: how the football playbook and read progressions work, how to beat each coverage, and how to run the basketball sets and time your shot.'],
    links: [
      ['/play?mode=daily', 'Play the Daily Drive'],
      ['/hoops', 'Play Daily Hoops'],
    ],
  },
  '/locker': {
    file: 'locker.html',
    canonicalQuery: '',
    title: 'Locker Room: Meet the 3D Players | Clutch Drive',
    description: 'Meet the Clutch Drive and Clutch Hoops players up close: every animation, every team’s colors, body types by position, gear and hairstyles.',
    image: '/og.png',
    changefreq: 'monthly',
    priority: 0.4,
    h1: 'Locker Room: meet the players',
    intro: ['Spin the football and basketball players, try all 24 football and 18 basketball animations, and dress them in any team’s colors. Linemen are big, receivers are lean, and gear and hairstyles change player to player.'],
    links: [
      ['/whats-new', 'What’s new in V2'],
      ['/play?mode=daily', 'Play the Daily Drive'],
    ],
    preload: '/models/player.glb?v=2',
  },
  '/whats-new': {
    file: 'whats-new.html',
    canonicalQuery: '',
    title: 'What’s New in Clutch Drive V2: New Players, Crowds and Modes',
    description: 'Clutch Drive V2: rebuilt 3D players with faces and 18 new animations, crowds that do the wave, night games, celebration cams, Clutch Hoops Survivor, camera angles and more.',
    image: '/og.png',
    changefreq: 'monthly',
    priority: 0.6,
    h1: 'What’s new in Clutch Drive V2',
    intro: ['Clutch Drive V2 is the biggest update yet to both games: new players, new animations, living crowds, night games, a new basketball mode and a lot more feel.'],
    links: [
      ['/play?mode=daily', 'Play today’s Daily Drive'],
      ['/hoops?mode=survivor', 'Play Clutch Hoops Survivor'],
      ['/locker', 'Meet the players in the Locker Room'],
    ],
  },
}

/** The guide (rendered by the How to Play page and written into its static HTML). */
export const GUIDE = [
  {
    id: 'football',
    title: 'Football: the Daily Drive',
    items: [
      ['The situation', 'You trail by 4 to 6 late in the 4th quarter, so only a touchdown wins it. The scorebug shows down, distance, clock and timeouts. The win-probability meter updates after every snap.'],
      ['Calling a play', 'Pick a concept from the Quick, Intermediate, Deep or Run tabs. Each pass play shows its routes and a read order: 1st look, 2nd look, check-down. You can reorder the reads before the snap.'],
      ['Reading the defense', 'The defense shows a look before the snap (Cover 2, Cover 3, man, blitz…), but it can be a disguise. Quick game beats the blitz, Smash beats Cover 2, Mesh beats man, Four Verts stretches Cover 3. Spam one play and the AI keys on it.'],
      ['Playing QB yourself', 'During the play, tap a receiver (or press 1 to 3) to throw it. Green rings are open, yellow tight, red covered. Pump fake, throw it away or scramble. After the catch: juke, spin, get out of bounds or get down.'],
      ['Clock management', 'Incompletions and plays out of bounds stop the clock; tackles in bounds keep it running. Use timeouts, or spike it to stop the clock for a down.'],
      ['Camera and feel', 'Open Settings (⚙️) to switch the camera: Broadcast, All-22 (high and wide, see every route) or Field level. Score and the camera swings around your guy while he celebrates. Turn on Reduced motion to skip the celebration cam, camera shake and confetti.'],
    ],
  },
  {
    id: 'hoops',
    title: 'Basketball: Clutch Hoops',
    items: [
      ['The situation', 'A real NBA ending: your team trails by 1 to 5 with the ball and under a minute and a half left. Possessions alternate until the horn; a tie goes to overtime.'],
      ['Calling a set', 'Pick one of seven sets. Each card shows the paths, screens and read order, and a ✓ marks sets that beat the coverage they are showing (if it is real).'],
      ['Taking over', 'Tap a teammate to pass (or 1 to 4), Drive (D), Stepback (S), or Shoot (Space): tap once to rise and again when the bar hits green. Two straight makes and a player heats up 🔥.'],
      ['Defense', 'Choose Man, Switch, Drop, Hedge or a 2-3 Zone. During their play, Contest (C) right as the shooter rises, Double team (X) to trap the ball, or Foul (F) to stop the clock when you are behind.'],
      ['End-game strategy', 'A timeout after a make or a stop advances the ball and saves about four seconds. Ahead late, the AI fouls you, so hit your free throws.'],
      ['Survivor', 'Win a real ending to unlock the next one. Each game is a tougher spot and the defense gets smarter; one loss ends the run. Your best streak is saved.'],
      ['Camera', 'Settings (⚙️) has three views: Broadcast, Courtside (lower and closer) and Overhead (best for reading the floor). Big threes, dunks and buzzer-beaters get a push-in on the shooter.'],
    ],
  },
]

export const FAQ = [
  ['Is Clutch Drive free?', 'Yes. Both games are free to play in any modern browser on phone, tablet or computer. There is nothing to download or install.'],
  ['Are these real games?', 'Yes. The daily challenges are real late-game situations from NFL and NBA games, built from public play-by-play data (nflverse and sportsdataverse hoopR). At the end you see what really happened.'],
  ['Is there a new challenge every day?', 'Yes. The Daily Drive and Daily Hoops change every day and are the same for everyone, so you can compare results with friends.'],
  ['Can I play against a friend?', 'Yes. Head-to-Head creates a room link: send it to a friend and you each call the other team’s defense.'],
  ['Is it an official NFL or NBA game?', DISCLAIMER + ' Team names and colors are used only to identify teams.'],
]

/** Absolute URL for a route (with its canonical query, if any). */
export function canonicalFor(path) {
  const r = ROUTES[path] ?? ROUTES['/']
  return `${SITE_URL}${path === '/' ? '/' : path}${r.canonicalQuery ?? ''}`
}

/** JSON-LD structured data for a route. */
export function structuredData(path) {
  const r = ROUTES[path] ?? ROUTES['/']
  const game = (name, url, description, image, genre) => ({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name,
    url,
    description,
    image: SITE_URL + image,
    genre,
    gamePlatform: ['Web browser', 'Mobile web'],
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any',
    playMode: ['SinglePlayer', 'MultiPlayer'],
    inLanguage: 'en',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  })
  const out = []
  if (path === '/') {
    out.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/`, description: r.description })
    out.push(game('Clutch Drive', `${SITE_URL}/`, ROUTES['/play'].description, '/og.png', ['Sports', 'Strategy', 'Football']))
    out.push(game('Clutch Hoops', `${SITE_URL}/hoops`, ROUTES['/hoops'].description, '/og-hoops.jpg', ['Sports', 'Strategy', 'Basketball']))
  } else if (path === '/play' || path === '/h2h') {
    out.push(game('Clutch Drive', canonicalFor(path), r.description, r.image, ['Sports', 'Strategy', 'Football']))
  } else if (path === '/hoops') {
    out.push(game('Clutch Hoops', canonicalFor(path), r.description, r.image, ['Sports', 'Strategy', 'Basketball']))
  } else if (path === '/how-to-play') {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    })
  }
  if (path !== '/') {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: r.h1, item: canonicalFor(path) },
      ],
    })
  }
  return out
}

/** Pages listed in sitemap.xml: canonical URLs only (the mode pages point their canonical at the daily). */
export const SITEMAP = [
  ['/', 'daily', 1],
  ['/play?mode=daily', 'daily', 0.9],
  ['/hoops', 'daily', 0.9],
  ['/how-to-play', 'monthly', 0.7],
  ['/whats-new', 'monthly', 0.6],
  ['/h2h', 'monthly', 0.7],
  ['/locker', 'monthly', 0.4],
]

/** V2 release notes: the landing section, the /whats-new page and its static HTML all read this. */
export const WHATS_NEW = [
  {
    id: 'players',
    emoji: '🧢',
    title: 'All-new players',
    image: '/v2/players-football.webp',
    alt: 'Five football players in team colors flexing: a big lineman, a lean receiver, the quarterback and two defenders',
    text: 'The chibi players are rebuilt from the ground up, and now they have faces that react: they blink, grin, grimace on a hit and yell after a score. Linemen are big, receivers and corners are lean, and gear changes player to player: visors, towels, arm sleeves and eye black. Football players got real shoulder pads and a proper facemask.',
  },
  {
    id: 'animations',
    emoji: '🕺',
    title: '18 new animations',
    image: '/v2/td-celebration.webp',
    alt: 'A receiver flexing in the end zone after a touchdown while the beaten cornerback holds his helmet',
    text: 'Ball carriers tuck the ball and actually juke, spin and slide. Defenders backpedal in coverage, shuffle sideways and wrap up on tackles. Score and your guy dances or flexes while the camera swings around him; give one up and the DBs grab their helmets. The quarterback waits in the shotgun, linebackers sit in their stance.',
  },
  {
    id: 'crowds',
    emoji: '📣',
    title: 'Crowds that live and die with you',
    image: '/v2/hoops-crowd.webp',
    alt: 'A packed basketball arena on its feet with arms in the air, with a section of traveling fans in the corner',
    text: 'Every seat is a little fan now, in both games. They start the wave, jump on big plays and put their hands on their heads when the other team scores, and the visiting section goes off when you get stopped. The benches react too, phone lights come out at night and late in close games, and when you shoot free throws on the road, the fans behind the basket wave their arms to distract you.',
  },
  {
    id: 'night',
    emoji: '🌙',
    title: 'Under the lights',
    image: '/v2/night-stadium.webp',
    alt: 'A football stadium at night under bright light towers, with a video board showing TOUCHDOWN',
    text: 'Real Monday and Thursday night games are played at night: a dark sky full of stars, glowing light towers and camera flashes in the stands. Video boards above both end zones and LED ribbons along the sidelines call out touchdowns, picks, sacks and first downs.',
  },
  {
    id: 'hoops',
    emoji: '🏀',
    title: 'Clutch Hoops Survivor and dunks',
    image: '/v2/hoops-dunk.webp',
    alt: 'A center rising up for a dunk in a crowded paint',
    text: 'A new mode: win a real NBA ending to unlock the next one. Every game is a tougher spot and the defense gets smarter, and one loss ends the run. Bigs throw down dunks, shooters hold the follow-through after a three, and the camera pushes in on the big ones.',
  },
  {
    id: 'feel',
    emoji: '💥',
    title: 'Feel every snap',
    text: 'Big hits freeze the frame for a beat and shake the camera. Phones buzz on catches, sacks, touchdowns and threes (on Android), and confetti flies when you win.',
  },
  {
    id: 'settings',
    emoji: '⚙️',
    title: 'Settings and camera angles',
    text: 'A new Settings menu: volume, haptics and reduced motion, plus camera angles. Football has Broadcast, All-22 and Field level; basketball has Broadcast, Courtside and Overhead.',
  },
  {
    id: 'locker',
    emoji: '🎽',
    title: 'Locker Room 2.0',
    image: '/v2/players-hoops.webp',
    alt: 'Five basketball players with different hairstyles and builds',
    text: 'Meet both rosters up close: every animation in both sports, any team’s colors, body types by position. Tap New looks to reshuffle hairstyles and gear.',
  },
]

/** In the browser: keep title, description, canonical and share tags right as the app navigates. */
export function applyMeta(path, title = null) {
  if (typeof document === 'undefined') return
  const key = ROUTES[path] ? path : '/'
  const r = ROUTES[key]
  document.title = title ?? r.title
  const set = (selector, make, attr, value) => {
    let el = document.head.querySelector(selector)
    if (!el) {
      el = make()
      document.head.appendChild(el)
    }
    el.setAttribute(attr, value)
  }
  const meta = (attrName, name) => () => {
    const m = document.createElement('meta')
    m.setAttribute(attrName, name)
    return m
  }
  set('meta[name="description"]', meta('name', 'description'), 'content', r.description)
  set('meta[name="robots"]', meta('name', 'robots'), 'content', r.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large')
  set('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', canonicalFor(key))
  set('meta[property="og:title"]', meta('property', 'og:title'), 'content', r.title)
  set('meta[property="og:description"]', meta('property', 'og:description'), 'content', r.description)
  set('meta[property="og:url"]', meta('property', 'og:url'), 'content', canonicalFor(key))
  set('meta[property="og:image"]', meta('property', 'og:image'), 'content', SITE_URL + r.image)
}
