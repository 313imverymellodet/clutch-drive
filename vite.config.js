import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeSeoPages } from './scripts/seo-pages.mjs'

// Real player names and team logos: on in dev and Vercel preview builds; production needs REAL_BRANDING=1
// (set in the Vercel project; REAL_BRANDING=0 turns them off anywhere). See README "Real branding".
const env = process.env
const real = env.REAL_BRANDING ? env.REAL_BRANDING === '1' : env.VERCEL_ENV !== 'production'

/** After a production build: one HTML file per route (titles, share cards, structured data, crawlable text) + sitemap/robots. */
const seoPages = () => ({
  name: 'seo-pages',
  apply: 'build',
  closeBundle() {
    const n = writeSeoPages('dist')
    console.log(`seo-pages: wrote ${n} pages, sitemap.xml, robots.txt`)
  },
})

export default defineConfig({
  plugins: [react(), seoPages()],
  server: { host: true },
  define: { __REAL__: JSON.stringify(real) },
})
