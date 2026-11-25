// Builds the Rust tracing core to WebAssembly and copies it into the renderer.
//   npm run core        → release wasm → src/renderer/src/engine/meowtrace_core.wasm
//   npm run core:test   → also runs the Rust unit tests as a WASI binary under Node
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const crate = resolve('core-rs')
const run = (args) => execFileSync('cargo', args, { cwd: crate, stdio: 'inherit' })

run(['build', '--release', '--target', 'wasm32-unknown-unknown'])
const wasm = join(crate, 'target/wasm32-unknown-unknown/release/meowtrace_core.wasm')
const dest = resolve('src/renderer/src/engine/meowtrace_core.wasm')
mkdirSync(resolve('src/renderer/src/engine'), { recursive: true })
copyFileSync(wasm, dest)
console.log(`core: ${(statSync(dest).size / 1024).toFixed(0)} KB → ${dest}`)
execFileSync(process.execPath, [resolve('scripts/embed-wasm.mjs')], { stdio: 'inherit' })

if (process.argv.includes('--test')) {
  run(['test', '--release', '--target', 'wasm32-wasip1', '--no-run'])
  const found = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/^meowtrace_core-[0-9a-f]+\.wasm$/.test(name)) found.push(p)
    }
  }
  walk(join(crate, 'target/wasm32-wasip1/release'))
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (!found.length) throw new Error('test binary not found')
  execFileSync(process.execPath, ['--no-warnings', resolve('scripts/run-wasi.mjs'), found[0]], { stdio: 'inherit' })
}
