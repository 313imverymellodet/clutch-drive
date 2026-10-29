// Renders share cards through the real functions (api/og.js, api/r.js), no server needed.
//   node scripts/og-samples.mjs [outDir=captures/og]   → one PNG per sample + the landing HTML for the first
import { mkdirSync, writeFileSync } from 'node:fs'
import { GET as og } from '../api/og.js'
import { GET as landing } from '../api/r.js'

const outDir = process.argv[2] ?? 'captures/og'
mkdirSync(outDir, { recursive: true })

const SAMPLES = {
  'hoops-beat-ot': 's=h&m=d&n=8&a=LAL&b=BOS&x=101-99&w=1&g=grlwofogl&o=1&p=23&l=9&y=2024&h=0',
  'hoops-same': 's=h&m=d&n=9&a=GSW&b=MIL&x=110-114&w=0&g=goroglrowr&p=31&y=2023&h=0',
  'hoops-history-wins': 's=h&m=d&n=10&a=BKN&b=SAS&x=96-98&w=0&g=rlgowrlr&p=44&y=2022&h=1',
  'football-beat': 's=f&m=d&n=8&a=KC&b=BUF&x=27-24&w=1&g=gyrgcgyrgt&c=12&p=18&l=6&y=2021&h=0',
  'football-downs': 's=f&m=d&n=11&a=DAL&b=LV&x=20-24&w=0&g=gyrrpyrr&e=d&p=27&y=2019&h=1',
  'football-survivor': 's=f&m=s&a=CAR&b=PIT&x=31-27&w=1&g=ggyt&c=48&p=44&y=2015&h=1&k=5',
  'football-practice-long': 's=f&m=p&a=NYJ&b=MIA&x=16-20&w=0&g=gygygyrrgygyrgyrgcgyrrygrygx&e=i&p=21',
}

for (const [name, q] of Object.entries(SAMPLES)) {
  const t = Date.now()
  const res = await og(new Request(`https://example.test/api/og?${q}`))
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(`${outDir}/${name}.png`, buf)
  console.log(`${name}: ${res.status} ${res.headers.get('content-type')} ${(buf.length / 1024).toFixed(0)} kB ${Date.now() - t} ms`)
}

const bad = await og(new Request('https://example.test/api/og?s=h&a=XXX&b=BOS&x=1-2'))
console.log('invalid params:', bad.status, bad.headers.get('location'))

for (const ua of ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'facebookexternalhit/1.1 Facebot Twitterbot/1.0']) {
  const res = await landing(new Request(`https://example.test/r?${SAMPLES['hoops-beat-ot']}`, { headers: { 'user-agent': ua } }))
  const html = await res.text()
  console.log(`landing (${ua.slice(0, 24)}…): ${res.status}, redirect script: ${html.includes('location.replace')}`)
  writeFileSync(`${outDir}/landing-${/bot|facebook/i.test(ua) ? 'bot' : 'human'}.html`, html)
}
