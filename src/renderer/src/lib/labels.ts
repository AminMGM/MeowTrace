// Segmentation (label map) editing: paint, flood fill, zap, recolour, merge.
// All operations return a new Segmentation so history snapshots stay valid.

import type { Segmentation } from '@shared/engine'

export const TRANSPARENT = 255

export function cloneSeg(s: Segmentation): Segmentation {
  return { ...s, labels: s.labels.slice(), palette: s.palette.slice() }
}

export function paletteHex(s: Segmentation): string[] {
  const out: string[] = []
  for (let i = 0; i < s.palette.length; i += 4) {
    out.push('#' + [0, 1, 2].map((k) => s.palette[i + k].toString(16).padStart(2, '0')).join(''))
  }
  return out
}

/** Paints a filled circle (in label-map pixels) along a segment. */
export function paintStroke(s: Segmentation, x0: number, y0: number, x1: number, y1: number, radius: number, label: number): void {
  const { width: w, height: h, labels } = s
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, radius * 0.5)))
  const r2 = radius * radius
  for (let k = 0; k <= steps; k++) {
    const cx = x0 + ((x1 - x0) * k) / steps
    const cy = y0 + ((y1 - y0) * k) / steps
    const xa = Math.max(0, Math.floor(cx - radius))
    const xb = Math.min(w - 1, Math.ceil(cx + radius))
    const ya = Math.max(0, Math.floor(cy - radius))
    const yb = Math.min(h - 1, Math.ceil(cy + radius))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        if (dx * dx + dy * dy <= r2) labels[y * w + x] = label
      }
    }
  }
}

/** 4-connected region containing (x, y); returns pixel indices. */
export function region(s: Segmentation, x: number, y: number): Int32Array {
  const { width: w, height: h, labels } = s
  if (x < 0 || y < 0 || x >= w || y >= h) return new Int32Array(0)
  const start = y * w + x
  const target = labels[start]
  const seen = new Uint8Array(w * h)
  const stack = [start]
  const out: number[] = []
  seen[start] = 1
  while (stack.length) {
    const p = stack.pop()!
    out.push(p)
    const px = p % w
    const nb = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, p - w, p + w]
    for (const q of nb) {
      if (q >= 0 && q < w * h && !seen[q] && labels[q] === target) {
        seen[q] = 1
        stack.push(q)
      }
    }
  }
  return Int32Array.from(out)
}

export function fillRegion(s: Segmentation, x: number, y: number, label: number): boolean {
  const px = region(s, x, y)
  if (!px.length || s.labels[px[0]] === label) return false
  for (const p of px) s.labels[p] = label
  return true
}

/** Merges the clicked region into the neighbouring label it borders most. */
export function zapRegion(s: Segmentation, x: number, y: number): boolean {
  const px = region(s, x, y)
  if (!px.length) return false
  const { width: w, height: h, labels } = s
  const own = labels[px[0]]
  const inRegion = new Set<number>(px)
  const counts = new Map<number, number>()
  for (const p of px) {
    const x0 = p % w
    const nb = [x0 > 0 ? p - 1 : -1, x0 < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p + w < w * h ? p + w : -1]
    for (const q of nb) {
      if (q < 0 || inRegion.has(q)) continue
      const l = labels[q]
      if (l !== own) counts.set(l, (counts.get(l) ?? 0) + 1)
    }
  }
  let best = -1
  let bc = 0
  for (const [l, c] of counts) {
    if (c > bc) {
      bc = c
      best = l
    }
  }
  if (best < 0) return false
  for (const p of px) labels[p] = best
  return true
}

export function labelAt(s: Segmentation, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return TRANSPARENT
  return s.labels[y * s.width + x]
}

/** Relabels every pixel of colour `from` to `to`. */
export function mergeColor(s: Segmentation, from: number, to: number): void {
  const l = s.labels
  for (let i = 0; i < l.length; i++) if (l[i] === from) l[i] = to
}

export function setColor(s: Segmentation, index: number, hex: string): void {
  const n = parseInt(hex.slice(1), 16)
  s.palette[index * 4] = (n >> 16) & 255
  s.palette[index * 4 + 1] = (n >> 8) & 255
  s.palette[index * 4 + 2] = n & 255
  s.palette[index * 4 + 3] = 255
}

/** Appends a colour to the palette; returns its index (max 254 colours). */
export function addColor(s: Segmentation, hex: string): { seg: Segmentation; index: number } {
  const n = s.palette.length / 4
  if (n >= 254) return { seg: s, index: n - 1 }
  const palette = new Uint8Array(s.palette.length + 4)
  palette.set(s.palette)
  const seg = { ...s, palette }
  setColor(seg, n, hex)
  return { seg, index: n }
}

/** Paints the label map into RGBA for display. */
export function segToImageData(s: Segmentation): ImageData {
  const { width: w, height: h, labels, palette } = s
  const img = new ImageData(w, h)
  const d = img.data
  for (let i = 0; i < w * h; i++) {
    const l = labels[i]
    if (l === TRANSPARENT || l * 4 >= palette.length) continue
    d[i * 4] = palette[l * 4]
    d[i * 4 + 1] = palette[l * 4 + 1]
    d[i * 4 + 2] = palette[l * 4 + 2]
    d[i * 4 + 3] = 255
  }
  return img
}
