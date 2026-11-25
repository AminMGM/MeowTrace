import type { VDoc, VLayer } from '../document'
import { visibleLayers } from '../document'

export interface ExportOptions {
  /** Output size multiplier (1 = source pixels map to 1 px / 1 pt). */
  scale?: number
  /** Decimal places for coordinates. */
  precision?: number
  includeHidden?: boolean
  /** Solid background colour placed under everything, or null. */
  background?: string | null
  /** One <path> per layer instead of one per shape (smaller files). */
  mergePaths?: boolean
  title?: string
}

export function exportLayers(doc: VDoc, o: ExportOptions): VLayer[] {
  return visibleLayers(doc, o.includeHidden)
}

export function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function num(v: number, prec = 3): string {
  const f = 10 ** prec
  let r = Math.round(v * f) / f
  if (Object.is(r, -0)) r = 0
  return String(r)
}

export function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string)
}

/** Unique, XML-safe ids derived from layer names. */
export function layerIds(layers: VLayer[]): string[] {
  const used = new Set<string>()
  return layers.map((l) => {
    let base = l.name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Layer'
    if (/^[0-9-]/.test(base)) base = 'L_' + base
    let id = base
    let k = 2
    while (used.has(id)) id = `${base}_${k++}`
    used.add(id)
    return id
  })
}

export const encoder = new TextEncoder()
