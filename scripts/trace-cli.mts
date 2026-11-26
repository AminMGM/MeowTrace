// MeowTrace command-line tracer (Node + the same WASM core as the app).
//   npm run trace -- <input> [output.svg] [--kind logo|photo|...] [--colors N] [--detail low|medium|high]
//                    [--remove-bg] [--cutout] [--upscale] [--png preview.png]
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { Core } from '../src/shared/engine'
import { DEFAULT_SETTINGS, lockedPaletteBytes, resolveSettings, presetFor, toOptionArray } from '../src/shared/settings'
import type { ImageKind, TraceSettings, Detail } from '../src/shared/settings'
import { rawToDocument } from '../src/shared/document'
import { toSvg } from '../src/shared/exporters/svg'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string): boolean => args.includes(`--${name}`)
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--remove-bg', '--cutout', '--upscale'].includes(args[i - 1])))
const input = positional[0]
if (!input) {
  console.error('usage: npm run trace -- <input> [output.svg] [--kind logo] [--colors 8] [--detail high] [--remove-bg] [--cutout] [--upscale] [--png out.png]')
  process.exit(2)
}
const output = positional[1] ?? input.replace(/\.[^.]+$/, '') + '.svg'

const core = await Core.create(await readFile(resolve('src/renderer/src/engine/meowtrace_core.wasm')))
const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

let settings: TraceSettings = { ...DEFAULT_SETTINGS }
const kind = (flag('kind') ?? 'auto') as ImageKind
settings.kind = kind
if (kind !== 'auto') settings = { ...settings, ...presetFor(kind) }
if (flag('colors')) settings.colors = Number(flag('colors'))
if (flag('detail')) settings.detail = flag('detail') as Detail
if (has('remove-bg')) settings.removeBackground = true
if (has('cutout')) settings.stacked = false
if (has('upscale')) settings.upscale = true

const t0 = performance.now()
const analysis = core.analyze(rgba, info.width, info.height)
const resolved = resolveSettings(settings, analysis)
const opts = toOptionArray(resolved, info.width, info.height)
const seg = core.segment(rgba, info.width, info.height, opts, lockedPaletteBytes(resolved))
const t1 = performance.now()
const raw = core.vectorize(seg, opts)
const t2 = performance.now()
const doc = rawToDocument(raw)
const svg = toSvg(doc, {})
await writeFile(output, svg)
const paths = raw.layers.reduce((n, l) => n + l.p.length, 0)
console.log(
  `${info.width}×${info.height} · auto=${analysis.kind}/${analysis.colors} cov=${analysis.coverage.toFixed(3)} flat=${analysis.flat.toFixed(3)} · mode=${resolved.mode} ` +
    `colors=${seg.palette.length / 4} layers=${raw.layers.length} paths=${paths} · segment ${(t1 - t0).toFixed(0)}ms vectorize ${(t2 - t1).toFixed(0)}ms · ` +
    `${(svg.length / 1024).toFixed(0)} KB → ${output}`
)
const png = flag('png')
if (png) await sharp(Buffer.from(svg)).png().toFile(png)
