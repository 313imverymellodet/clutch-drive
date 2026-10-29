// Serves dist/ the way Vercel does (vercel.json rewrites + clean routes + the api/ functions), for local
// Lighthouse and e2e runs against a production build.  npx vite build && node scripts/serve-dist.mjs [port=4180]
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

const port = +(process.argv[2] ?? 4180)
const { rewrites } = JSON.parse(readFileSync('vercel.json', 'utf8'))
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' }
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = decodeURIComponent(url.pathname)
  let file = join('dist', path)
  let fn = /^\/api\/(\w+)$/.exec(path)?.[1]
  if (!fn && (!existsSync(file) || statSync(file).isDirectory())) {
    const rule = rewrites.find((r) => new RegExp(`^${r.source.replace('(.*)', '.*')}$`).test(path))
    fn = /^\/api\/(\w+)$/.exec(rule?.destination ?? '')?.[1]
    file = join('dist', rule ? rule.destination : '/index.html')
  }
  if (fn) {
    // a Vercel function (api/<name>.js, Web Request -> Response)
    const { GET } = await import(`../api/${fn}.js`)
    const out = await GET(new Request(`http://${req.headers.host}${url.pathname}${url.search}`, { headers: req.headers }))
    res.writeHead(out.status, Object.fromEntries(out.headers))
    return res.end(Buffer.from(await out.arrayBuffer()))
  }
  if (path.startsWith('/_vercel/')) return res.writeHead(204).end() // analytics only exists on Vercel
  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  const body = readFileSync(file)
  // compress text like Vercel does, so local Lighthouse numbers are comparable
  if (/gzip/.test(req.headers['accept-encoding'] ?? '') && /text|javascript|json|xml|svg|manifest/.test(type)) {
    res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip' })
    return res.end(gzipSync(body))
  }
  res.writeHead(200, { 'content-type': type })
  res.end(body)
}).listen(port, () => console.log(`dist on http://localhost:${port}`))
