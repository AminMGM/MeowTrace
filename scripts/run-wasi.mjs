// Runs a wasm32-wasip1 test binary under Node's WASI (used for `cargo test`
// on machines without a native MSVC linker). Usage: node scripts/run-wasi.mjs <file.wasm> [args]
import { readFile } from 'node:fs/promises'
import { WASI } from 'node:wasi'
import { argv } from "node:process"

const file = argv[2]
const wasi = new WASI({ version: 'preview1', args: [file, ...argv.slice(3)], env: {}, returnOnExit: true })
const module = await WebAssembly.compile(await readFile(file))
const instance = await WebAssembly.instantiate(module, wasi.getImportObject())
process.exitCode = wasi.start(instance)
