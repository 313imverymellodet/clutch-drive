// Loads a page headlessly and prints any page/console errors. Usage: node scripts/check-errors.mjs [path or full URL]
import puppeteer from 'puppeteer-core'
const arg = process.argv[2] ?? '/'
const url = arg.startsWith('http') ? arg : 'http://localhost:5173' + arg
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
await page.goto(url, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1500))
console.log(errors.length ? errors.join('\n') : 'no errors')
await browser.close()
