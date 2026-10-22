// GET /r?… (vercel.json rewrites it here): the page a shared result links to. Its share tags point at that
// player's own card (api/og.js), so iMessage, X, Discord and WhatsApp previews show their result. People are
// sent straight on to the Daily; link-preview crawlers get the tags without the redirect, since some of them
// (Apple's, for iMessage) run scripts and would otherwise end up on the Daily's generic card.
import { SITE_NAME } from '../src/seo.js'
import { canonicalQuery, parseResult, playPath, shareMeta } from '../src/share.js'

/** Bump when the card design changes: card images are cached for good per URL. */
const OG_VERSION = 1
const BOTS = /bot\b|bot\/|crawler|spider|facebookexternalhit|facebot|whatsapp|slack|discord|telegram|embedly|iframely|preview|linkedin|skype|vkshare|pinterest|quora|tumblr|bitly|mastodon|bluesky|google|bing|yandex|duckduck/i

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function originOf(request) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host
  return `${/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https'}://${host}`
}

export function GET(request) {
  const params = new URL(request.url).searchParams
  const r = parseResult(params)
  if (!r) return Response.redirect(new URL(params.get('s') === 'h' ? '/hoops' : '/play?mode=daily', originOf(request)), 302)

  const origin = originOf(request)
  const query = canonicalQuery(r)
  const url = `${origin}/r?${query}`
  const image = `${origin}/api/og?${query}&v=${OG_VERSION}`
  const target = playPath(r)
  const { title, description, alt } = shareMeta(r)
  const cta = r.s === 'h' ? 'Play today’s Daily Hoops' : r.mode === 'survivor' ? 'Play Survivor' : 'Play today’s Daily Drive'
  const bot = BOTS.test(request.headers.get('user-agent') ?? '')

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    ${bot ? '' : `<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')})</script>`}
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="noindex, follow" />
    <meta name="theme-color" content="#ffd400" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${esc(SITE_NAME)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(alt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(image)}" />
    <meta name="twitter:image:alt" content="${esc(alt)}" />
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #16181d; color: #fff; font: 600 16px/1.4 ui-rounded, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
      main { width: min(640px, calc(100% - 32px)); padding: 24px 0; text-align: center; }
      img { width: 100%; height: auto; border-radius: 14px; display: block; }
      h1 { font-size: 20px; margin: 18px 0 6px; }
      p { margin: 0 0 18px; opacity: 0.8; }
      a { display: inline-block; background: #ffd400; color: #16181d; font-weight: 900; text-decoration: none; padding: 12px 20px; border-radius: 14px; }
    </style>
  </head>
  <body>
    <main>
      <img src="${esc(image)}" alt="${esc(alt)}" width="1200" height="630" />
      <h1>${esc(title)}</h1>
      <p>${esc(description)}</p>
      <a href="${esc(target)}">${esc(cta)}</a>
    </main>
  </body>
</html>
`
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, max-age=300', vary: 'User-Agent' },
  })
}

export const HEAD = GET
