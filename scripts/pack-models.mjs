// Compresses the raw Blender exports (blender/export/*.glb) into the models the app loads (public/models/).
// meshopt geometry + animation compression with quantization: about 4x smaller, decoded by drei's useGLTF.
// Names, materials and extras (morph target names) are kept: the app looks up gear, slots and shape keys by name.
//   node scripts/pack-models.mjs
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'

for (const f of readdirSync('blender/export').filter((f) => f.endsWith('.glb'))) {
  const out = `public/models/${f}`
  execFileSync('npx', ['-y', 'gltfpack@0.24.0', '-i', `blender/export/${f}`, '-o', out, '-cc', '-kn', '-km', '-ke', '-vp', '14', '-af', '30'], { stdio: 'inherit' })
  console.log(`${out}: ${(statSync(`blender/export/${f}`).size / 1024).toFixed(0)} KB -> ${(statSync(out).size / 1024).toFixed(0)} KB`)
}
