// GET /api/og?… : the 1200x630 share card for one result (same params as /r, see src/share.js).
// Drawn with @vercel/og (Satori + resvg); emoji come from Twemoji. A link that doesn't validate gets the
// static card. Images are immutable per URL, so api/r.js adds a version param to bust old designs.
import { readFileSync } from 'node:fs'
import { ImageResponse } from '@vercel/og'
import { SITE_URL } from '../src/seo.js'
import { parseResult, verdict, fmtClock } from '../src/share.js'

const font = (file) => readFileSync(new URL(`./_fonts/${file}`, import.meta.url))
const FONTS = [
  { name: 'Archivo Black', data: font('ArchivoBlack-Regular.ttf'), weight: 400, style: 'normal' },
  { name: 'Archivo', data: font('Archivo-SemiBold.woff'), weight: 600, style: 'normal' },
]

const INK = '#16181d'
const INK2 = '#2a2e37'
const ACCENT = '#ffd400'
const MUTED = '#a3aab6'
const W = 1200
const PAD_X = 52

/** Satori element without JSX: h('div', style, ...children). */
const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c != null && c !== false && c !== '') } })
const text = (style, s) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: s } })

/** Team look: football uses jersey/number/stripe, hoops jersey/number/trim. */
const look = (t) => ({ bg: t.jersey, fg: t.num, accent: t.stripe ?? t.trim })

function teamRow(team, score, { you, winner }) {
  const c = look(team)
  return h(
    'div',
    { height: 116, borderRadius: 20, overflow: 'hidden', border: `3px solid ${winner ? ACCENT : 'rgba(255,255,255,0.12)'}` },
    h(
      'div',
      { flex: 1, alignItems: 'center', background: c.bg, paddingLeft: 30, gap: 22, borderBottom: `8px solid ${c.accent}` },
      text({ fontFamily: 'Archivo Black', fontSize: 70, color: c.fg, letterSpacing: 1 }, team.abbr),
      h(
        'div',
        { flexDirection: 'column', color: c.fg, opacity: 0.9 },
        text({ fontFamily: 'Archivo', fontSize: 26, lineHeight: 1.1 }, team.city),
        text({ fontFamily: 'Archivo Black', fontSize: 32, lineHeight: 1.05, textTransform: 'uppercase' }, team.name),
      ),
      you && text({ marginLeft: 6, padding: '4px 14px', borderRadius: 999, background: c.fg, color: c.bg, fontFamily: 'Archivo Black', fontSize: 20, letterSpacing: 1 }, 'YOU'),
    ),
    h(
      'div',
      { width: 220, alignItems: 'center', justifyContent: 'center', background: winner ? '#101216' : INK2 },
      text({ fontFamily: 'Archivo Black', fontSize: 86, color: winner ? ACCENT : '#e6e8ec' }, String(score)),
    ),
  )
}

function badge(v) {
  const styles = {
    beat: { background: ACCENT, color: INK, icon: '🔥' },
    matched: { background: '#1f9d55', color: '#fff', icon: '✅' },
    history: { background: INK2, color: '#fff', icon: '📅' },
    same: { background: INK2, color: '#fff', icon: '📅' },
  }[v.key]
  return text(
    { alignItems: 'center', gap: 10, padding: '8px 20px', borderRadius: 999, background: styles.background, color: styles.color, fontFamily: 'Archivo Black', fontSize: 26, border: styles.background === INK2 ? '2px solid rgba(255,255,255,0.25)' : 'none' },
    `${styles.icon} ${v.label.toUpperCase()}`,
  )
}

function grid(symbols) {
  if (!symbols.length) return null
  const perRow = symbols.length <= 18 ? symbols.length : Math.ceil(symbols.length / 2)
  const size = Math.min(perRow === symbols.length ? 60 : 50, Math.floor((W - 2 * PAD_X + 8) / perRow) - 8)
  return h(
    'div',
    { flexWrap: 'wrap', gap: 8, width: perRow * (size + 8) },
    symbols.map((e) => text({ width: size, height: size, alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.9), lineHeight: 1 }, e)),
  )
}

const otLabel = (ot) => (ot > 1 ? `${ot}OT` : 'OT')

function card(r) {
  const v = verdict(r)
  const title = `${r.sport.icon} ${r.sport.name.toUpperCase()}${r.mode === 'survivor' ? ' SURVIVOR' : ''}`
  const tie = r.scoreYou === r.scoreThem
  const outcome = r.won
    ? r.s === 'f'
      ? `✅ WON WITH ${fmtClock(r.clockLeft ?? 0)} LEFT`
      : `✅ CLOSED IT OUT${r.ot ? ` IN ${otLabel(r.ot)}` : ''}`
    : tie
      ? `🤝 TIED AFTER ${otLabel(r.ot)}`
      : `❌ ${(r.reason ?? 'Came up short').toUpperCase()}${r.ot ? ` (${otLabel(r.ot)})` : ''}`
  const wp = r.wp0 == null ? null : `WIN PROB ${r.wp0}%${r.wpLow != null ? ` (LOW ${r.wpLow}%)` : ''} → ${r.won ? 100 : 0}%`
  const host = SITE_URL.replace(/^https?:\/\//, '')
  return h(
    'div',
    { width: W, height: 630, flexDirection: 'column', background: `linear-gradient(140deg, #1f232b 0%, ${INK} 55%, #0e1013 100%)`, color: '#fff', fontFamily: 'Archivo', borderTop: `10px solid ${ACCENT}`, padding: `34px ${PAD_X}px 36px` },
    // header: brand + day, verdict
    h(
      'div',
      { alignItems: 'center', justifyContent: 'space-between', height: 56 },
      h(
        'div',
        { alignItems: 'center', gap: 16 },
        text({ padding: '6px 18px', borderRadius: 14, background: ACCENT, color: INK, fontFamily: 'Archivo Black', fontSize: 30, letterSpacing: 0.5 }, title),
        r.day && text({ fontFamily: 'Archivo Black', fontSize: 38, color: '#fff' }, `#${r.day}`),
        r.mode === 'practice' && text({ fontFamily: 'Archivo Black', fontSize: 24, color: MUTED }, 'PRACTICE'),
      ),
      v ? badge(v) : r.streak ? text({ fontFamily: 'Archivo Black', fontSize: 26, color: ACCENT }, `STREAK ${r.streak} 🔥`) : null,
    ),
    // final score
    h(
      'div',
      { flexDirection: 'column', gap: 14, marginTop: 24 },
      teamRow(r.you, r.scoreYou, { you: true, winner: r.won }),
      teamRow(r.them, r.scoreThem, { you: false, winner: !r.won && !tie }),
    ),
    // how it went
    h(
      'div',
      { alignItems: 'center', justifyContent: 'space-between', marginTop: 22, fontFamily: 'Archivo Black', fontSize: 28 },
      text({ color: '#fff' }, outcome + (r.mode === 'survivor' && r.streak && v ? ` · STREAK ${r.streak} 🔥` : '')),
      wp && text({ color: MUTED, fontSize: 24 }, wp),
    ),
    h('div', { marginTop: 16, flex: 1, alignItems: 'flex-start' }, grid(r.grid)),
    // footer: what really happened, call to action
    h(
      'div',
      { alignItems: 'center', justifyContent: 'space-between', fontSize: 24 },
      text({ color: MUTED }, r.real ? `📅 Real ${r.real.year}: ${r.real.won ? 'they won' : 'they lost'}` : 'A real late-game spot, every day'),
      text({ fontFamily: 'Archivo Black', color: ACCENT, fontSize: 24 }, `YOUR TURN › ${host.toUpperCase()}`),
    ),
  )
}

export function GET(request) {
  const params = new URL(request.url).searchParams
  const r = parseResult(params)
  if (!r) {
    // not a card we can draw: the static one for that sport
    return Response.redirect(new URL(params.get('s') === 'h' ? '/og-hoops.jpg' : '/og.png', SITE_URL), 302)
  }
  return new ImageResponse(card(r), { width: W, height: 630, fonts: FONTS, emoji: 'twemoji' })
}

export const HEAD = GET
