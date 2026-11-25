import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bbox, deleteAnchor, flatten, insertAnchor, parsePath, serializePath, fmt } from './path'
import { anchorCount, anchorPos, makeCorner, makeSmooth, moveAnchor, setSegmentKind } from './nodes'
import { colorName, docStats, rawToDocument } from './document'
import type { VDoc } from './document'
import { toSvg } from './exporters/svg'
import { toEps } from './exporters/eps'
import { toPdf } from './exporters/pdf'
import { toDxf } from './exporters/dxf'
import { packBits, toPsd } from './exporters/psd'
import { Core } from './engine'
import { DEFAULT_SETTINGS, hexToRgb, lockedPaletteBytes, presetFor, resolveSettings, toOptionArray } from './settings'

const square = 'M0 0L10 0L10 10L0 10Z'
const blob = 'M0 0C5 -5 15 -5 20 0C25 5 25 15 20 20L0 20Z'

function sampleDoc(): VDoc {
  return rawToDocument({
    w: 40,
    h: 30,
    layers: [
      { c: '#ffffff', k: 0, sw: 0, a: 1200, p: ['M0 0L40 0L40 30L0 30Z'] },
      { c: '#c61a08', k: 0, sw: 0, a: 300, p: [square + 'M2 2L8 2L8 8L2 8Z', blob] },
      { c: '#111111', k: 1, sw: 2.5, a: 40, p: ['M5 25C10 20 20 20 30 25'] }
    ]
  })
}

test('path: parse/serialize round trip', () => {
  const subs = parsePath(square)
  assert.equal(subs.length, 1)
  assert.equal(subs[0].closed, true)
  assert.equal(subs[0].segs.length, 4)
  assert.equal(serializePath(subs), square)
  assert.equal(serializePath(parsePath(blob)), blob)
})

test('path: relative, H/V, S, Q and compact numbers', () => {
  const subs = parsePath('m1 1h10v10h-10z M.5.5 l1-1 q2 2 4 0 t4 0 s1 1 2 0')
  assert.equal(subs.length, 2)
  assert.deepEqual(subs[0].segs[1].p, { x: 11, y: 11 })
  assert.equal(subs[1].start.x, 0.5)
  assert.equal(subs[1].segs.filter((s) => s.kind === 'C').length, 3)
  assert.equal(fmt(-0.0001), '0')
  assert.equal(fmt(0.25), '.25')
})

test('path: bbox, flatten, insert and delete anchors', () => {
  const subs = parsePath(blob)
  const b = bbox(subs)
  assert.equal(b.x0, 0)
  assert.equal(b.y1, 20)
  const poly = flatten(subs, 0.5)
  assert.ok(poly[0].pts.length > 6)
  const more = insertAnchor(subs, 0, 0, 0.5)
  assert.equal(more[0].segs.length, subs[0].segs.length + 1)
  const fewer = deleteAnchor(more, 0, 1)
  assert.equal(fewer[0].segs.length, subs[0].segs.length)
  const sq = deleteAnchor(parsePath(square), 0, 2)
  assert.equal(sq[0].segs.length, 3)
})

test('nodes: move/corner/smooth/segment kind', () => {
  const subs = parsePath(square)
  assert.equal(anchorCount(subs[0]), 4)
  const moved = moveAnchor(subs, { sub: 0, idx: 0 }, { x: -2, y: -2 })
  assert.deepEqual(moved[0].start, { x: -2, y: -2 })
  assert.deepEqual(moved[0].segs[3].p, { x: -2, y: -2 }, 'closing segment follows the start anchor')
  const curved = setSegmentKind(subs, { sub: 0, idx: 1 }, 'C')
  assert.equal(curved[0].segs[1].kind, 'C')
  const smooth = makeSmooth(subs, { sub: 0, idx: 2 })
  assert.equal(smooth[0].segs[1].kind, 'C')
  assert.equal(smooth[0].segs[2].kind, 'C')
  const corner = makeCorner(smooth, { sub: 0, idx: 2 })
  assert.deepEqual(corner[0].segs[1].c2, anchorPos(corner[0], 2))
})

test('document: names, stats', () => {
  assert.equal(colorName('#000000'), 'Black')
  assert.equal(colorName('#c61a08'), 'Red')
  assert.equal(colorName('#7a7a7a'), 'Gray')
  const doc = sampleDoc()
  assert.deepEqual(
    doc.layers.map((l) => l.name),
    ['White', 'Red', 'Black']
  )
  const s = docStats(doc)
  assert.equal(s.paths, 4)
})

test('svg export: layers, scale and precision', () => {
  const doc = sampleDoc()
  const svg = toSvg(doc, {})
  assert.match(svg, /<svg [^>]*viewBox="0 0 40 30"/)
  assert.match(svg, /<g id="Red" inkscape:groupmode="layer"/)
  assert.match(svg, /stroke-width="2.5"/)
  const big = toSvg(doc, { scale: 2, mergePaths: true })
  assert.match(big, /width="80" height="60"/)
  assert.equal((big.match(/<path /g) ?? []).length, 3)
  doc.layers[0].visible = false
  assert.ok(!toSvg(doc, {}).includes('id="White"'))
})

test('eps export is well formed', () => {
  const eps = toEps(sampleDoc(), { scale: 1 })
  assert.ok(eps.startsWith('%!PS-Adobe-3.0 EPSF-3.0'))
  assert.match(eps, /%%BoundingBox: 0 0 40 30/)
  assert.match(eps, /eofill/)
  assert.match(eps, /stroke/)
  assert.ok(eps.trimEnd().endsWith('%%EOF'))
})

test('pdf export: valid xref and layers', async () => {
  const pdf = await toPdf(sampleDoc(), { title: 'Test' })
  const text = new TextDecoder('latin1').decode(pdf)
  assert.ok(text.startsWith('%PDF-1.5'))
  assert.match(text, /\/OCProperties/)
  assert.equal((text.match(/\/Type \/OCG/g) ?? []).length, 3)
  // every xref offset must point at "N 0 obj"
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1])
  assert.ok(text.slice(xrefAt).startsWith('xref'))
  const rows = text.slice(xrefAt).split('\n').slice(3)
  rows.slice(0, 5).forEach((row, i) => {
    const off = Number(row.slice(0, 10))
    assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`)
  })
})

test('dxf export: layers and closed polylines', () => {
  const dxf = toDxf(sampleDoc(), {})
  assert.match(dxf, /AC1009/)
  assert.ok(dxf.includes('\nRED\n'))
  assert.ok((dxf.match(/\nPOLYLINE\n/g) ?? []).length >= 4)
  assert.ok(dxf.trimEnd().endsWith('EOF'))
})

test('psd: packbits and structure', () => {
  assert.deepEqual([...packBits(Uint8Array.from([1, 1, 1, 1, 2, 3]))], [253, 1, 1, 2, 3])
  const w = 4
  const h = 3
  const layer = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) layer.set([200, 20, 10, i % 2 ? 255 : 0], i * 4)
  const psd = toPsd(w, h, [{ name: 'Red', visible: true, left: 0, top: 0, width: w, height: h, rgba: layer }], layer)
  const dv = new DataView(psd.buffer)
  assert.equal(new TextDecoder().decode(psd.slice(0, 4)), '8BPS')
  assert.equal(dv.getUint32(14), h)
  assert.equal(dv.getUint32(18), w)
  // header(26) + mode(4) + resources(4) → layer & mask section length
  const lmLen = dv.getUint32(34)
  const imageData = 38 + lmLen
  assert.equal(dv.getUint16(imageData), 1, 'composite is RLE')
  assert.equal(dv.getInt16(42), -1, 'one layer')
})

test('settings: presets, auto resolve, option layout', () => {
  assert.deepEqual(hexToRgb('#abc'), [170, 187, 204])
  const auto = resolveSettings(DEFAULT_SETTINGS, { kind: 'lineart', colors: 2 })
  assert.equal(auto.mode, 'bw')
  const photo = resolveSettings(DEFAULT_SETTINGS, { kind: 'photo', colors: 0 })
  assert.equal(photo.colors, 16)
  assert.equal(presetFor('pixel').mode, 'pixel')
  const opts = toOptionArray({ ...DEFAULT_SETTINGS, mode: 'gray', stacked: false }, 100, 100, 2)
  assert.equal(opts.length, 21)
  assert.equal(opts[0], 1)
  assert.equal(opts[12], 0)
  assert.equal(opts[17], 2)
  assert.equal(opts[20], 1, 'edge snapping on by default')
  assert.equal(lockedPaletteBytes({ ...DEFAULT_SETTINGS, lockPalette: true, palette: ['#ff0000', 'nope'] }).length, 4)
})

test('engine: wasm core traces a synthetic logo', async () => {
  const wasm = readFileSync(resolve('src/renderer/src/engine/meowtrace_core.wasm'))
  const core = await Core.create(wasm)
  const w = 64
  const h = 64
  const rgba = new Uint8Array(w * h * 4).fill(255)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - 32, y - 32)
      if (r < 20 && r > 8) rgba.set([200, 20, 10, 255], (y * w + x) * 4)
    }
  const a = core.analyze(rgba, w, h)
  assert.ok(a.kind === 'logo' || a.kind === 'logo-aa', a.kind)
  const s = resolveSettings(DEFAULT_SETTINGS, a)
  const opts = toOptionArray(s, w, h)
  const seg = core.segment(rgba, w, h, opts)
  assert.equal(seg.palette.length / 4, 2)
  assert.equal(seg.labels.length, seg.width * seg.height)
  assert.equal(seg.width, w * seg.upscale)
  const raw = core.vectorize(seg, opts)
  assert.equal(raw.w, 64)
  assert.equal(raw.layers.length, 2)
  const ring = raw.layers.find((l) => l.c !== '#ffffff')!
  assert.equal(ring.p.length, 1)
  assert.equal((ring.p[0].match(/M/g) ?? []).length, 2, 'ring keeps its hole')
  // transparency: fully transparent image produces no layers
  const empty = core.segment(new Uint8Array(16 * 16 * 4), 16, 16, opts)
  assert.equal(core.vectorize(empty, opts).layers.length, 0)
})
