// Build step (wired into vite.config.js): writes one real HTML file per route with its own title, description,
// canonical URL, share card, structured data and crawlable text, plus sitemap.xml. The text sits inside
// #root, so crawlers and no-JS visitors read it and the app replaces it the moment it starts.
import { readFileSync, writeFileSync } from 'node:fs'
import { FAQ, GUIDE, ROUTES, SITEMAP, SITE_NAME, SITE_URL, canonicalFor, structuredData } from '../src/seo.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function head(path) {
  const r = ROUTES[path]
  const url = canonicalFor(path)
  const image = SITE_URL + r.image
  const tags = [
    `<title>${esc(r.title)}</title>`,
    `<meta name="description" content="${esc(r.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    r.noindex ? '<meta name="robots" content="noindex, follow" />' : '<meta name="robots" content="index, follow, max-image-preview:large" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${esc(r.title)}" />`,
    `<meta property="og:description" content="${esc(r.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${esc(r.h1)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(r.title)}" />`,
    `<meta name="twitter:description" content="${esc(r.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    ...(r.preload ? [`<link rel="preload" href="${r.preload}" as="fetch" crossorigin />`] : []),
    ...structuredData(path).map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`),
  ]
  return tags.join('\n    ')
}

const links = (list) => (list.length ? `<ul class="seo-links">${list.map(([href, label]) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`).join('')}</ul>` : '')
const faqHtml = () => `<section class="seo-faq"><h2>Questions</h2>${FAQ.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}</section>`

function body(path) {
  const r = ROUTES[path]
  if (path === '/') {
    // mirrors the landing page's hero so the swap to the live app is seamless
    return `<div class="landing">
  <nav class="land-nav"><a href="/" class="land-logo"><span>CLUTCH DRIVE</span></a><div class="land-links"><a href="/play?mode=survivor">Survivor</a><a href="/h2h">Head-to-Head</a><a href="/hoops">🏀 Hoops</a><a href="/how-to-play">How to play</a><a href="/play?mode=daily" class="btn primary small">Play</a></div></nav>
  <main>
  <header class="hero"><div class="hero-canvas" aria-hidden="true"></div><div class="hero-copy">
    <div class="eyebrow pill"><span class="dot"></span> A new Daily Drive every day</div>
    <h1><span class="h1-a">CLUTCH</span><span class="h1-b">DRIVE</span></h1>
    <p class="hero-tag">Trailing late. Clock running. Call the plays.</p>
    <div class="hero-ctas"><a href="/play?mode=daily" class="btn primary big">Play today’s drive</a><a href="/hoops" class="btn big">🏀 Daily Hoops</a></div>
    <p class="hero-fine">${esc(r.intro[0])}</p>
  </div></header>
  <section class="how"><h2>Free football and basketball strategy games</h2>${r.intro.map((p) => `<p>${esc(p)}</p>`).join('')}${links(r.links)}</section>
  ${faqHtml()}
  </main>
</div>`
  }
  const guide = path === '/how-to-play' ? GUIDE.map((g) => `<section id="${g.id}"><h2>${esc(g.title)}</h2>${g.items.map(([h, t]) => `<h3>${esc(h)}</h3><p>${esc(t)}</p>`).join('')}</section>`).join('') + faqHtml() : ''
  return `<div class="seo-shell">
  <header class="seo-top"><a href="/">${path === '/hoops' ? '🏀 Clutch Hoops' : '🏈 Clutch Drive'}</a></header>
  <main><h1>${esc(r.h1)}</h1>${r.intro.map((p) => `<p>${esc(p)}</p>`).join('')}${links(r.links)}${guide}<p class="seo-loading">Loading the game…</p></main>
</div>`
}

export function writeSeoPages(outDir) {
  const template = readFileSync(`${outDir}/index.html`, 'utf8')
  for (const path of Object.keys(ROUTES)) {
    const html = template
      .replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, head(path))
      .replace('<div id="root"></div>', `<div id="root">${body(path)}</div>`)
    writeFileSync(`${outDir}/${ROUTES[path].file}`, html)
  }
  const today = new Date().toISOString().slice(0, 10)
  const urls = SITEMAP.map(([p, freq, pri]) => `  <url><loc>${esc(SITE_URL + p)}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${pri}</priority></url>`)
  writeFileSync(`${outDir}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`)
  writeFileSync(`${outDir}/robots.txt`, `User-agent: *\nAllow: /\nDisallow: /locker\n\nSitemap: ${SITE_URL}/sitemap.xml\n`)
  return Object.keys(ROUTES).length
}
