// Mixes a soundtrack for a captured video from its cues.json: music bed, crowd bed and hits timed to the play.
//   node marketing/tools/mix.mjs <hoops|football> <framesDir> <out.m4a>
// macOS: afconvert decodes the game's AAC clips and encodes the result.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const [game, dir, out] = process.argv.slice(2)
const RATE = 44100
const { duration, events } = JSON.parse(readFileSync(`${dir}/cues.json`, 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'mix-'))
const cache = {}
function load(name) {
  if (cache[name]) return cache[name]
  const wav = join(tmp, `${name}.wav`)
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', `public/sounds/${name}.m4a`, wav])
  const b = readFileSync(wav)
  let p = 12
  while (b.toString('ascii', p, p + 4) !== 'data') p += 8 + b.readUInt32LE(p + 4)
  const n = b.readUInt32LE(p + 4) / 2
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) s[i] = b.readInt16LE(p + 8 + i * 2) / 32768
  return (cache[name] = s)
}

const N = Math.ceil(duration * RATE)
const mix = new Float32Array(N)
/** Add a clip at time t (s) with gain; loop fills to the end; envelope(tSeconds) shapes it. */
function add(name, t, gain = 1, { loop = false, env = null, from = 0 } = {}) {
  const s = load(name)
  const start = Math.round(t * RATE)
  const len = loop ? N - start : Math.min(s.length - Math.round(from * RATE), N - start)
  for (let i = 0; i < len; i++) {
    const v = s[(Math.round(from * RATE) + i) % s.length]
    const time = (start + i) / RATE
    mix[start + i] += v * gain * (env ? env(time) : 1)
  }
}
const at = (type) => events.filter((e) => e.type === type).map((e) => e.t)
const impact = [...at('swish'), ...at('roar')][0] ?? duration
const fadeOut = (time) => Math.min(1, Math.max(0, (duration - time) / 1.2))
// music ducks under the big moment so the crowd can take over, then comes back for the end card
const duck = (time) => (time > impact - 0.1 && time < impact + 2.4 ? 0.45 : 1)
const fadeIn = (time) => Math.min(1, time / 0.5)

if (game === 'hoops') {
  add('hoops-theme', 0, 0.55, { env: (x) => fadeIn(x) * duck(x) * fadeOut(x) })
  add('hoops-crowd', 0, 0.32, { loop: true, env: fadeOut })
  at('whistle').forEach((t) => add('hoops-whistle', t, 0.55))
  at('squeak').forEach((t) => add('hoops-squeak', t, 0.45))
  at('swish').forEach((t) => add('hoops-swish', t, 1))
  at('roar').forEach((t) => add('hoops-roar', t, 0.95, { env: fadeOut }))
  at('end').forEach((t) => add('hoops-horn', t + 0.05, 0.35))
} else {
  add('theme', 0, 0.55, { env: (x) => fadeIn(x) * duck(x) * fadeOut(x) })
  add('crowd', 0, 0.3, { loop: true, env: fadeOut })
  at('whistle').forEach((t) => add('hoops-whistle', t, 0.5))
  at('throw').forEach((t) => add('cheer', t + 0.2, 0.5))
  at('roar').forEach((t) => add('roar', t, 0.95, { env: fadeOut }))
  at('end').forEach((t) => add('hoops-horn', t + 0.05, 0.3))
}

// normalize to -1 dBFS and write a 16-bit stereo WAV
let peak = 0
for (const v of mix) peak = Math.max(peak, Math.abs(v))
const k = peak ? 0.89 / peak : 1
const buf = Buffer.alloc(44 + N * 4)
buf.write('RIFF', 0)
buf.writeUInt32LE(36 + N * 4, 4)
buf.write('WAVEfmt ', 8)
buf.writeUInt32LE(16, 16)
buf.writeUInt16LE(1, 20)
buf.writeUInt16LE(2, 22)
buf.writeUInt32LE(RATE, 24)
buf.writeUInt32LE(RATE * 4, 28)
buf.writeUInt16LE(4, 32)
buf.writeUInt16LE(16, 34)
buf.write('data', 36)
buf.writeUInt32LE(N * 4, 40)
for (let i = 0; i < N; i++) {
  const v = Math.max(-32768, Math.min(32767, Math.round(mix[i] * k * 32767)))
  buf.writeInt16LE(v, 44 + i * 4)
  buf.writeInt16LE(v, 46 + i * 4)
}
const wav = join(tmp, 'mix.wav')
writeFileSync(wav, buf)
execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '160000', wav, out])
console.log(`mixed ${duration.toFixed(1)}s -> ${out} (events: ${events.map((e) => `${e.type}@${e.t}`).join(', ')})`)
