// The editable vector document: colour layers holding compound paths.

import type { RawTrace } from './engine'
import { bbox, countNodes, parsePath } from './path'

export interface VPath {
  id: string
  d: string
}

export interface VLayer {
  id: string
  name: string
  color: string
  stroke: boolean
  strokeWidth: number
  visible: boolean
  locked: boolean
  area: number
  paths: VPath[]
}

export interface VDoc {
  width: number
  height: number
  layers: VLayer[]
}

let counter = 0
export const uid = (p = 'id'): string => `${p}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`

function hsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return [h, s, l]
}

/** Human-friendly colour name used for layer names ("Dark Red", "Gray"…). */
export function colorName(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 'Colour'
  const [h, s, l] = hsl(hex)
  if (l < 0.09) return 'Black'
  if (l > 0.94) return 'White'
  if (s < 0.12) return l < 0.35 ? 'Dark Gray' : l > 0.7 ? 'Light Gray' : 'Gray'
  const names: [number, string][] = [
    [15, 'Red'],
    [40, 'Orange'],
    [65, 'Yellow'],
    [160, 'Green'],
    [195, 'Cyan'],
    [255, 'Blue'],
    [290, 'Purple'],
    [335, 'Pink'],
    [361, 'Red']
  ]
  let base = names.find(([lim]) => h < lim)?.[1] ?? 'Red'
  if (base === 'Orange' && l < 0.4) base = 'Brown'
  const tone = l < 0.3 ? 'Dark ' : l > 0.75 ? 'Light ' : ''
  return tone + base
}

export function rawToDocument(raw: RawTrace): VDoc {
  const seen = new Map<string, number>()
  const layers: VLayer[] = raw.layers.map((l) => {
    let name = colorName(l.c)
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    if (n > 1) name = `${name} ${n}`
    return {
      id: uid('L'),
      name,
      color: l.c,
      stroke: l.k === 1,
      strokeWidth: l.sw,
      visible: true,
      locked: false,
      area: l.a,
      paths: l.p.map((d) => ({ id: uid('p'), d }))
    }
  })
  return { width: raw.w, height: raw.h, layers }
}

export interface DocStats {
  layers: number
  paths: number
  nodes: number
}

export function docStats(doc: VDoc): DocStats {
  let paths = 0
  let nodes = 0
  for (const l of doc.layers) {
    paths += l.paths.length
    for (const p of l.paths) nodes += countNodes(p.d)
  }
  return { layers: doc.layers.length, paths, nodes }
}

/** Splits each multi-subpath shape into separate paths (holes stay with nothing — use with care). */
export function splitPathData(d: string): string[] {
  const parts = d.split(/(?=[Mm])/).filter((s) => s.trim())
  return parts
}

export function pathBox(d: string): { x0: number; y0: number; x1: number; y1: number } {
  return bbox(parsePath(d))
}

export function visibleLayers(doc: VDoc, includeHidden = false): VLayer[] {
  return doc.layers.filter((l) => (includeHidden || l.visible) && l.paths.length > 0)
}
