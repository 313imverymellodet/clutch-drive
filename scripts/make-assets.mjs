// Generates public/og.png (social preview) from the live landing page, plus PNG app icons from public/icon.svg.
// Usage: npm run dev (other terminal), then  node scripts/make-assets.mjs
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage()

// social card: the landing hero without the nav, at 1200x630
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
await page.addStyleTag({ content: '.land-nav{display:none!important}.hero{min-height:630px!important;padding-top:0!important}.hero-canvas{height:600px!important}.hero-fine{display:none}.pill,.matchup-chip{display:none!important}' })
await new Promise((r) => setTimeout(r, 2500))
await page.screenshot({ path: 'public/og.png' })

// icons
const svg = readFileSync('public/icon.svg', 'utf8')
for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
  await page.setViewport({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:#16181d">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await page.screenshot({ path: `public/${name}`, omitBackground: false })
}
await browser.close()
console.log('wrote public/og.png and icons')
