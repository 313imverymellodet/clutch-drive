import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Real player names and team logos: on in dev and Vercel preview builds; production needs REAL_BRANDING=1
// (set in the Vercel project; REAL_BRANDING=0 turns them off anywhere). See README "Real branding".
const env = process.env
const real = env.REAL_BRANDING ? env.REAL_BRANDING === '1' : env.VERCEL_ENV !== 'production'

export default defineConfig({
  plugins: [react()],
  server: { host: true },
  define: { __REAL__: JSON.stringify(real) },
})
