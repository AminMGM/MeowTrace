import type { VDoc } from '../document'
import { flatten, parsePath } from '../path'
import { exportLayers, num } from './common'
import type { ExportOptions } from './common'

// AutoCAD Color Index entries 1–9 plus greys, enough for a sensible match.
const ACI: [number, [number, number, number]][] = [
  [1, [255, 0, 0]],
  [2, [255, 255, 0]],
  [3, [0, 255, 0]],
  [4, [0, 255, 255]],
  [5, [0, 0, 255]],
  [6, [255, 0, 255]],
  [7, [0, 0, 0]],
  [8, [128, 128, 128]],
  [9, [192, 192, 192]],
  [30, [255, 127, 0]],
  [250, [51, 51, 51]],
  [251, [80, 80, 80]],
  [252, [105, 105, 105]],
  [253, [130, 130, 130]],
  [254, [190, 190, 190]],
  [255, [255, 255, 255]]
]

function aci(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  let best = 7
  let bd = Infinity
  for (const [i, a] of ACI) {
    const d = (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

function dxfName(name: string, used: Set<string>): string {
  let base = name.replace(/[^A-Za-z0-9_-]+/g, '_').toUpperCase() || 'LAYER'
  let n = base
  let k = 2
  while (used.has(n)) n = `${base}_${k++}`
  used.add(n)
  return n
}

/**
 * AutoCAD R12 ASCII DXF: curves flattened to POLYLINEs, one DXF layer per
 * colour. Readable by laser/CNC software, AutoCAD, Fusion, LightBurn, etc.
 */
export function toDxf(doc: VDoc, o: ExportOptions & { tolerance?: number } = {}): string {
  const s = o.scale ?? 1
  const H = doc.height * s
  const tol = o.tolerance ?? 0.1
  const layers = exportLayers(doc, o)
  const used = new Set<string>()
  const names = layers.map((l) => dxfName(l.name, used))
  const L: string[] = []
  const g = (code: number, value: string | number): void => {
    L.push(String(code), typeof value === 'number' ? num(value, 4) : value)
  }
  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSUNITS')
  g(70, '0')
  g(9, '$EXTMIN')
  g(10, 0)
  g(20, 0)
  g(9, '$EXTMAX')
  g(10, doc.width * s)
  g(20, H)
  g(0, 'ENDSEC')
  g(0, 'SECTION')
  g(2, 'TABLES')
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, String(layers.length))
  layers.forEach((l, i) => {
    g(0, 'LAYER')
    g(2, names[i])
    g(70, '0')
    g(62, String(aci(l.color)))
    g(6, 'CONTINUOUS')
  })
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')
  g(0, 'SECTION')
  g(2, 'ENTITIES')
  layers.forEach((l, i) => {
    for (const p of l.paths) {
      for (const poly of flatten(parsePath(p.d), tol / s)) {
        const pts = poly.pts
        if (poly.closed && pts.length > 1) {
          const a = pts[0]
          const b = pts[pts.length - 1]
          if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) pts.pop()
        }
        if (pts.length < 2) continue
        g(0, 'POLYLINE')
        g(8, names[i])
        g(66, '1')
        g(70, poly.closed ? '1' : '0')
        g(10, 0)
        g(20, 0)
        g(30, 0)
        for (const pt of pts) {
          g(0, 'VERTEX')
          g(8, names[i])
          g(10, pt.x * s)
          g(20, H - pt.y * s)
          g(30, 0)
        }
        g(0, 'SEQEND')
        g(8, names[i])
      }
    }
  })
  g(0, 'ENDSEC')
  g(0, 'EOF')
  return L.join('\n') + '\n'
}
