// Contact sheet of selected frames (for reviewing a video).  node contact.mjs <framesDir> <out.png> <t1,t2,...>
import { launch } from './director.mjs'
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'
const [dir, out, times] = process.argv.slice(2)
const ts = times.split(',').map(Number)
const cells = ts.map((t) => `<figure><img src="${pathToFileURL(`${dir}/frame_${String(Math.round(t * 30)).padStart(5, '0')}.jpg`).href}"><figcaption>${t.toFixed(1)}s</figcaption></figure>`).join('')
const b = await launch()
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 1400 })
writeFileSync(`${dir}/_sheet.html`, `<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(8,1fr);gap:6px;padding:6px;font:700 14px system-ui;color:#fff}img{width:100%;display:block}figure{margin:0}figcaption{text-align:center;padding:2px}</style>${cells}`)
await p.goto(pathToFileURL(`${dir}/_sheet.html`).href, { waitUntil: 'load' })
await p.screenshot({ path: out, fullPage: true })
await b.close()
