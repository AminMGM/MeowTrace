import { rawToDocument } from '@shared/document'
import type { VDoc } from '@shared/document'
import type { Segmentation } from '@shared/engine'
import { DEFAULT_SETTINGS, lockedPaletteBytes, resolveSettings, toOptionArray } from '@shared/settings'
import type { TraceSettings } from '@shared/settings'
import { toSvg } from '@shared/exporters/svg'
import type { AdobeApp } from '@shared/api'
import { CancelledError, engine } from '../engine/pool'
import { baseName, decodeImage } from './image'
import { exportDoc, filtersFor } from './exporting'
import type { ExportSettings } from './exporting'
import { toPng } from './render'
import { getState, setState, toast } from './store'
import type { Snapshot } from './store'

const HISTORY_LIMIT = 60

// Settings that only affect the vectorize stage (the segmentation is kept).
const VECTOR_ONLY: (keyof TraceSettings)[] = [
  'cornerThreshold',
  'curveTolerance',
  'optimize',
  'curves',
  'stacked',
  'removeBackground',
  'precision',
  'lineTolerance'
]

function snapshot(): Snapshot {
  const s = getState()
  return { doc: s.doc, seg: s.seg, segEdited: s.segEdited }
}

function pushHistory(): void {
  setState((s) => ({ past: [...s.past.slice(-HISTORY_LIMIT + 1), snapshot()], future: [] }))
}

export function undo(): void {
  const s = getState()
  const prev = s.past[s.past.length - 1]
  if (!prev) return
  setState({ past: s.past.slice(0, -1), future: [snapshot(), ...s.future], ...prev, selection: null })
}

export function redo(): void {
  const s = getState()
  const next = s.future[0]
  if (!next) return
  setState({ future: s.future.slice(1), past: [...s.past, snapshot()], ...next, selection: null })
}

export function commitDoc(doc: VDoc): void {
  pushHistory()
  setState({ doc })
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function resolved(): TraceSettings {
  const s = getState()
  const r = resolveSettings(s.settings, s.analysis)
  // Small sources trace noticeably smoother after a 2× upscale.
  if (s.settings.kind === 'auto' && s.source && s.source.pw * s.source.ph < 250_000 && r.mode !== 'pixel') {
    return { ...r, upscale: true }
  }
  return r
}

let traceSeq = 0

/** Segments (unless `vectorOnly`) and vectorizes the current source. */
export async function retrace(vectorOnly = false): Promise<void> {
  const st = getState()
  const src = st.source
  if (!src) return
  const seq = ++traceSeq
  const r = resolved()
  const opts = toOptionArray(r, src.pw, src.ph, src.scale)
  try {
    let seg = st.seg
    let segEdited = st.segEdited
    const t0 = performance.now()
    if (!vectorOnly || !seg) {
      setState({ busy: 'segmenting', error: null, resolved: r })
      seg = await engine.segment(src.rgba, src.pw, src.ph, opts, lockedPaletteBytes(r))
      if (seq !== traceSeq) return
      segEdited = false
    }
    const t1 = performance.now()
    setState({ busy: 'vectorizing', resolved: r })
    const raw = await engine.vectorize(seg, opts)
    if (seq !== traceSeq) return
    const t2 = performance.now()
    const doc = rawToDocument(raw)
    if (getState().doc) pushHistory()
    setState((s) => ({
      seg,
      segEdited,
      doc,
      busy: 'idle',
      selection: null,
      activeLabel: Math.min(s.activeLabel, Math.max(0, seg!.palette.length / 4 - 1)),
      timings: { segment: vectorOnly ? s.timings.segment : t1 - t0, vectorize: t2 - t1 }
    }))
  } catch (e) {
    if (e instanceof CancelledError || seq !== traceSeq) return
    setState({ busy: 'idle', error: errorText(e) })
    toast(`Tracing failed: ${errorText(e)}`, 'error')
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null

export function updateSettings(patch: Partial<TraceSettings>, immediate = false): void {
  const before = getState().settings
  const next = { ...before, ...patch }
  setState({ settings: next })
  if (!getState().source) return
  const keys = Object.keys(patch) as (keyof TraceSettings)[]
  const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]))
  if (!changed.length) return
  const vectorOnly = changed.every((k) => VECTOR_ONLY.includes(k))
  if (!vectorOnly && getState().segEdited) toast('Segmentation edits were replaced by a fresh trace (Ctrl+Z to go back).')
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void retrace(vectorOnly), immediate ? 0 : 180)
}

export async function openImage(bytes: Uint8Array | Blob, name: string, path?: string): Promise<void> {
  setState({ busy: 'loading', error: null, page: 'trace' })
  try {
    const old = getState().source
    const src = await decodeImage(bytes, name, path)
    if (old) URL.revokeObjectURL(old.url)
    setState({ source: src, seg: null, doc: null, past: [], future: [], selection: null, analysis: null, segEdited: false })
    const analysis = await engine.analyze(src.rgba, src.pw, src.ph)
    setState({ analysis, zoomCommand: { kind: 'fit', n: Date.now() } })
    if (src.scale > 1.001) toast(`Large image: traced at ${src.pw}×${src.ph}, output keeps the original ${src.width}×${src.height} size.`)
    await retrace(false)
  } catch (e) {
    if (e instanceof CancelledError) return
    setState({ busy: 'idle', error: errorText(e) })
    toast(errorText(e), 'error')
  }
}

export async function openPath(path: string): Promise<void> {
  try {
    const f = await window.meow.readFile(path)
    await openImage(f.bytes, f.name, f.path)
  } catch (e) {
    toast(errorText(e), 'error')
  }
}

export async function openDialog(): Promise<void> {
  const files = await window.meow.openImages(false)
  if (files[0]) await openImage(files[0].bytes, files[0].name, files[0].path)
}

/** Replaces the segmentation (after an edit) and re-vectorizes. */
export async function commitSeg(seg: Segmentation): Promise<void> {
  pushHistory()
  setState({ seg, segEdited: true })
  const st = getState()
  const src = st.source
  if (!src) return
  const seq = ++traceSeq
  const r = resolved()
  try {
    setState({ busy: 'vectorizing' })
    const t = performance.now()
    const raw = await engine.vectorize(seg, toOptionArray(r, src.pw, src.ph, src.scale))
    if (seq !== traceSeq) return
    setState((s) => ({ doc: rawToDocument(raw), busy: 'idle', timings: { ...s.timings, vectorize: performance.now() - t } }))
  } catch (e) {
    if (e instanceof CancelledError || seq !== traceSeq) return
    setState({ busy: 'idle' })
    toast(`Vectorize failed: ${errorText(e)}`, 'error')
  }
}

function title(): string {
  return baseName(getState().source?.name ?? 'trace')
}

export async function saveAs(settings?: ExportSettings): Promise<void> {
  const st = getState()
  if (!st.doc) return
  const s = settings ?? st.exportSettings
  try {
    const data = await exportDoc(st.doc, s, title())
    const saved = await window.meow.saveFile(`${title()}.${s.format}`, filtersFor(s.format), data)
    if (saved) toast(`Saved ${saved.split(/[\\/]/).pop()}`, 'ok', { label: 'Show', run: () => void window.meow.reveal(saved) })
  } catch (e) {
    toast(`Export failed: ${errorText(e)}`, 'error')
  }
}

export async function copySvg(): Promise<void> {
  const st = getState()
  if (!st.doc) return
  const svg = toSvg(st.doc, { precision: st.exportSettings.precision, mergePaths: st.exportSettings.mergePaths })
  const png = await toPng(st.doc, { scale: 1, background: null })
  await window.meow.copy({ text: svg, png })
  toast('Copied SVG to the clipboard (paste into Illustrator, Figma, Inkscape…)', 'ok')
}

export async function sendTo(app: AdobeApp): Promise<void> {
  const st = getState()
  if (!st.doc) return
  const s: ExportSettings =
    app === 'illustrator'
      ? { ...st.exportSettings, format: 'svg', scale: 1 }
      : { ...st.exportSettings, format: 'psd', scale: Math.max(1, st.exportSettings.scale) }
  try {
    const data = await exportDoc(st.doc, s, title())
    const res = await window.meow.sendToAdobe(app, `${title()}.${s.format}`, data)
    toast(res.message, res.ok ? 'ok' : 'error')
  } catch (e) {
    toast(`Send failed: ${errorText(e)}`, 'error')
  }
}

export function resetSettings(): void {
  updateSettings({ ...DEFAULT_SETTINGS, palette: getState().settings.palette }, true)
}

// Keys the image-type presets control. Changing one while the type is
// "Auto" first locks in the detected type so the edit is not overridden.
const PRESET_KEYS: (keyof TraceSettings)[] = [
  'mode',
  'colors',
  'denoise',
  'sharpen',
  'snapEdges',
  'smoothPasses',
  'cornerThreshold',
  'removeBackground',
  'speckle',
  'upscale'
]

export function tweak(patch: Partial<TraceSettings>, immediate = false): void {
  const s = getState()
  const touchesPreset = (Object.keys(patch) as (keyof TraceSettings)[]).some((k) => PRESET_KEYS.includes(k))
  if (s.settings.kind === 'auto' && touchesPreset && s.source) {
    const kind = s.analysis?.kind ?? 'logo-aa'
    updateSettings({ ...resolved(), kind, ...patch }, immediate)
  } else {
    updateSettings(patch, immediate)
  }
}
