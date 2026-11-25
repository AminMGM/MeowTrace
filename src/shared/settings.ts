// Trace settings shared by the UI, the batch queue and the CLI.

export type TraceMode = 'color' | 'gray' | 'bw' | 'centerline' | 'pixel'
export type ImageKind = 'auto' | 'photo' | 'logo' | 'logo-aa' | 'lineart' | 'centerline' | 'pixel'
export type Detail = 'low' | 'medium' | 'high'

export interface TraceSettings {
  kind: ImageKind
  mode: TraceMode
  /** 0 = automatic */
  colors: number
  /** Locked brand colours (#rrggbb). Used when lockPalette is on. */
  palette: string[]
  lockPalette: boolean
  detail: Detail
  /** -1 = automatic (Otsu) */
  threshold: number
  invert: boolean
  /** 0 off, 1 median, 2 edge-preserving */
  denoise: 0 | 1 | 2
  upscale: boolean
  smoothPasses: number
  /** Minimum region size in px; -1 = derive from detail */
  speckle: number
  cornerThreshold: number
  curveTolerance: number
  optimize: boolean
  curves: boolean
  stacked: boolean
  removeBackground: boolean
  precision: number
  merge: number
  lineTolerance: number
  /** Edge sharpening before tracing, 0 (off) … 2 */
  sharpen: number
  /** Snap anti-aliased edge pixels to the colours they blend between */
  snapEdges: boolean
}

export const DEFAULT_SETTINGS: TraceSettings = {
  kind: 'auto',
  mode: 'color',
  colors: 0,
  palette: [],
  lockPalette: false,
  detail: 'medium',
  threshold: -1,
  invert: false,
  denoise: 0,
  upscale: false,
  smoothPasses: 1,
  speckle: -1,
  cornerThreshold: 1.0,
  curveTolerance: 0.2,
  optimize: true,
  curves: true,
  stacked: true,
  removeBackground: false,
  precision: 2,
  merge: 0.04,
  lineTolerance: 1.0,
  sharpen: 0,
  snapEdges: true
}

export const KIND_LABELS: Record<ImageKind, string> = {
  auto: 'Auto detect',
  photo: 'Photo / painting',
  logo: 'Logo — sharp edges',
  'logo-aa': 'Logo — blurry / anti-aliased',
  lineart: 'Line art / B&W scan',
  centerline: 'Centerline (single strokes)',
  pixel: 'Pixel art (exact squares)'
}

/** Mode and filter defaults for each image type. */
export function presetFor(kind: Exclude<ImageKind, 'auto'>): Partial<TraceSettings> {
  switch (kind) {
    case 'photo':
      return { mode: 'color', colors: 16, denoise: 2, sharpen: 0.4, snapEdges: true, smoothPasses: 1, cornerThreshold: 1.1, removeBackground: false }
    case 'logo':
      return { mode: 'color', denoise: 0, sharpen: 0, snapEdges: true, upscale: true, smoothPasses: 1, cornerThreshold: 0.9 }
    case 'logo-aa':
      return { mode: 'color', denoise: 0, sharpen: 0.6, snapEdges: true, upscale: true, smoothPasses: 1, cornerThreshold: 1.0 }
    case 'lineart':
      return { mode: 'bw', colors: 2, denoise: 1, sharpen: 0.5, upscale: true, smoothPasses: 1, cornerThreshold: 1.0, removeBackground: true }
    case 'centerline':
      return { mode: 'centerline', colors: 2, denoise: 1, sharpen: 0.5, smoothPasses: 1, removeBackground: true }
    case 'pixel':
      return { mode: 'pixel', denoise: 0, sharpen: 0, snapEdges: false, smoothPasses: 0, speckle: 0, upscale: false }
  }
}

export interface AnalysisLike {
  kind: 'photo' | 'logo' | 'logo-aa' | 'lineart'
  colors: number
}

/** Applies the image-type preset (resolving "auto" from an analysis). */
export function resolveSettings(s: TraceSettings, analysis?: AnalysisLike | null): TraceSettings {
  if (s.kind !== 'auto') return s
  const kind = analysis?.kind ?? 'logo-aa'
  const preset = presetFor(kind)
  const colors = kind === 'photo' ? s.colors || 16 : s.colors
  return { ...s, ...preset, colors, kind: 'auto' }
}

const DETAIL: Record<Detail, { area: number; min: number; tol: number; line: number }> = {
  low: { area: 0.00016, min: 8, tol: 0.5, line: 1.6 },
  medium: { area: 0.00002, min: 2, tol: 0.25, line: 1.0 },
  high: { area: 0.000005, min: 1, tol: 0.12, line: 0.6 }
}

export function autoSpeckle(detail: Detail, width: number, height: number): number {
  const d = DETAIL[detail]
  return Math.round(Math.min(2000, Math.max(d.min, width * height * d.area)))
}

const MODE_INDEX: Record<TraceMode, number> = { color: 0, gray: 1, bw: 2, centerline: 3, pixel: 4 }

/**
 * Flattens settings to the numeric layout read by `Options::from_slice` in
 * core-rs/src/lib.rs. `scale` maps processed pixels back to source pixels.
 */
export function toOptionArray(s: TraceSettings, width: number, height: number, scale = 1): Float64Array {
  const d = DETAIL[s.detail]
  const speckle = s.speckle >= 0 ? s.speckle : s.mode === 'pixel' ? 0 : autoSpeckle(s.detail, width, height)
  const bwLike = s.mode === 'bw' || s.mode === 'centerline'
  return new Float64Array([
    MODE_INDEX[s.mode],
    bwLike && !s.lockPalette ? 2 : s.colors,
    s.threshold,
    s.invert ? 1 : 0,
    s.denoise,
    s.upscale ? 2 : 1,
    s.smoothPasses,
    speckle,
    s.cornerThreshold,
    // The detail level scales the user's curve tolerance.
    s.curveTolerance * (d.tol / 0.25),
    s.optimize ? 1 : 0,
    s.curves ? 1 : 0,
    s.stacked ? 1 : 0,
    s.removeBackground ? 1 : 0,
    s.precision,
    s.merge,
    128,
    scale,
    s.lineTolerance * d.line,
    s.sharpen ?? 0,
    s.snapEdges === false ? 0 : 1
  ])
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Locked palette as RGBA bytes for the core (empty when not locked). */
export function lockedPaletteBytes(s: TraceSettings): Uint8Array {
  if (!s.lockPalette) return new Uint8Array(0)
  const cols = s.palette.map(hexToRgb).filter((c): c is [number, number, number] => !!c)
  const out = new Uint8Array(cols.length * 4)
  cols.forEach((c, i) => out.set([c[0], c[1], c[2], 255], i * 4))
  return out
}
