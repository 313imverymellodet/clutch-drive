// Loads a page headlessly and prints any page/console errors. Usage: node scripts/check-errors.mjs [path]
import puppeteer from 'puppeteer-core'
const path = process.argv[2] ?? '/'
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
await page.goto('http://localhost:5173' + path, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1500))
console.log(errors.length ? errors.join('\n') : 'no errors')
await browser.close()
