// Turns the raw Viewmax (Everygen) sound generations into web-ready clips in public/sounds.
//
//   node scripts/make-sounds.mjs <dirWithMp3s> [set=nfl|hoops]
//
// nfl expects crowd, roar, groan, cheer, hit, cadence and theme .mp3 files; hoops expects crowd, roar, ooh,
// chant, swish, clank, dribble, squeak, horn, whistle and theme (written as hoops-*.m4a). macOS only: uses afconvert to
// decode and to encode AAC. Trims silence, normalizes, fades tails, and makes the crowd bed loop seamlessly.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const [dir, SET = 'nfl'] = process.argv.slice(2)
if (!dir) {
  console.error('usage: node scripts/make-sounds.mjs <dirWithMp3s>')
  process.exit(1)
}
const RATE = 44100
const OUT = 'public/sounds'
mkdirSync(OUT, { recursive: true })

function readWav(file) {
  const b = readFileSync(file)
  let p = 12
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4)
    const size = b.readUInt32LE(p + 4)
    if (id === 'data') {
      const s = new Float32Array(size / 2)
      for (let i = 0; i < s.length; i++) s[i] = b.readInt16LE(p + 8 + i * 2) / 32768
      return s
    }
    p += 8 + size + (size % 2)
  }
  throw new Error(`no data chunk in ${file}`)
}

function writeWav(file, s) {
  const b = Buffer.alloc(44 + s.length * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + s.length * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(RATE, 24)
  b.writeUInt32LE(RATE * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(s.length * 2, 40)
  for (let i = 0; i < s.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767))), 44 + i * 2)
  writeFileSync(file, b)
}

const db = (x) => 10 ** (x / 20)
function trim(s, threshDb = -42, padMs = 8) {
  const t = db(threshDb)
  let a = 0
  while (a < s.length && Math.abs(s[a]) < t) a++
  let z = s.length - 1
  while (z > a && Math.abs(s[z]) < t) z--
  const pad = Math.round((padMs / 1000) * RATE)
  return s.slice(Math.max(0, a - pad), Math.min(s.length, z + pad))
}
function normalize(s, peakDb = -1) {
  let peak = 0
  for (const v of s) peak = Math.max(peak, Math.abs(v))
  const k = peak ? db(peakDb) / peak : 1
  return s.map((v) => v * k)
}
function fades(s, inMs = 4, outMs = 150) {
  const a = Math.round((inMs / 1000) * RATE)
  const z = Math.min(s.length, Math.round((outMs / 1000) * RATE))
  for (let i = 0; i < a; i++) s[i] *= i / a
  for (let i = 0; i < z; i++) s[s.length - 1 - i] *= i / z
  return s
}
/** Keep just the first `ms` of a clip (one bounce, one clank), with a quick fade-out. */
const head = (s, ms, fadeMs = 60) => fades(s.slice(0, Math.min(s.length, Math.round((ms / 1000) * RATE))), 1, fadeMs)

function seamlessLoop(s, fadeSec = 2) {
  const F = Math.round(fadeSec * RATE)
  const out = s.slice(F)
  const n = out.length
  for (let j = 0; j < F; j++) {
    const k = j / F
    // equal-power crossfade from the end of the clip into the audio that preceded the loop start
    out[n - F + j] = s[s.length - F + j] * Math.cos((k * Math.PI) / 2) + s[j] * Math.sin((k * Math.PI) / 2)
  }
  return out
}

const NFL = {
  crowd: (s) => normalize(seamlessLoop(s.slice(Math.round(0.5 * RATE), s.length - Math.round(0.5 * RATE))), -3),
  roar: (s) => fades(normalize(trim(s)), 4, 1500),
  groan: (s) => fades(normalize(trim(s)), 4, 800),
  cheer: (s) => fades(normalize(trim(s)), 4, 500),
  hit: (s) => fades(normalize(trim(s, -36, 2)), 1, 80),
  cadence: (s) => fades(normalize(trim(s)), 4, 120),
  theme: (s) => fades(normalize(trim(s)), 20, 1200),
}

const HOOPS = {
  crowd: (s) => normalize(seamlessLoop(s.slice(Math.round(0.5 * RATE), s.length - Math.round(0.5 * RATE))), -3),
  roar: (s) => fades(normalize(trim(s)), 4, 1500),
  ooh: (s) => fades(normalize(trim(s)), 4, 700),
  chant: (s) => normalize(seamlessLoop(trim(s), 0.8), -2),
  swish: (s) => normalize(head(trim(s, -40, 2), 1100, 300)),
  clank: (s) => normalize(head(trim(s, -36, 1), 900, 250)),
  dribble: (s) => normalize(head(trim(s, -34, 1), 380, 90)),
  squeak: (s) => normalize(head(trim(s, -38, 2), 1300, 150)),
  horn: (s) => fades(normalize(head(trim(s), 2600, 300)), 4, 300),
  whistle: (s) => normalize(head(trim(s, -36, 2), 900, 120)),
  theme: (s) => fades(normalize(trim(s)), 20, 1200),
}
const JOBS = SET === 'hoops' ? HOOPS : NFL
const prefix = SET === 'hoops' ? 'hoops-' : ''

for (const [name, job] of Object.entries(JOBS)) {
  const tmp = `${dir}/${name}.dec.wav`
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', `${dir}/${name}.mp3`, tmp])
  const s = job(readWav(tmp))
  const wav = `${dir}/${name}.out.wav`
  writeWav(wav, s)
  const out = `${OUT}/${prefix}${name}.m4a`
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', name === 'theme' ? '96000' : '64000', wav, out])
  console.log(`${name}: ${(s.length / RATE).toFixed(2)}s -> ${out} (${readFileSync(out).length} bytes)`)
}
