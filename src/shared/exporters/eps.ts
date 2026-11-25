import type { VDoc } from '../document'
import { parsePath } from '../path'
import { exportLayers, num, rgb01 } from './common'
import type { ExportOptions } from './common'

/** Encapsulated PostScript (level 2) — opens in Illustrator, CorelDRAW, Affinity. */
export function toEps(doc: VDoc, o: ExportOptions = {}): string {
  const s = o.scale ?? 1
  const W = doc.width * s
  const H = doc.height * s
  const P = (x: number, y: number): string => `${num(x * s)} ${num(H - y * s)}`
  const out: string[] = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`,
    `%%HiResBoundingBox: 0 0 ${num(W)} ${num(H)}`,
    '%%Creator: MeowTrace (https://github.com/AminMGM/MeowTrace)',
    `%%Title: (${(o.title ?? 'MeowTrace').replace(/[()\\]/g, '')})`,
    `%%CreationDate: (${new Date().toISOString()})`,
    '%%LanguageLevel: 2',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '/m {moveto} bind def /l {lineto} bind def /c {curveto} bind def /h {closepath} bind def',
    '%%EndProlog',
    '%%Page: 1 1',
    'gsave'
  ]
  if (o.background) {
    const [r, g, b] = rgb01(o.background)
    out.push(`${num(r)} ${num(g)} ${num(b)} setrgbcolor 0 0 ${num(W)} ${num(H)} rectfill`)
  }
  for (const layer of exportLayers(doc, o)) {
    const [r, g, b] = rgb01(layer.color)
    out.push(`%%Layer: ${layer.name}`)
    out.push(`${num(r)} ${num(g)} ${num(b)} setrgbcolor`)
    if (layer.stroke) out.push(`${num(layer.strokeWidth * s)} setlinewidth 1 setlinecap 1 setlinejoin`)
    for (const p of layer.paths) {
      const line: string[] = ['newpath']
      for (const sub of parsePath(p.d)) {
        line.push(`${P(sub.start.x, sub.start.y)} m`)
        for (const g2 of sub.segs) {
          if (g2.kind === 'L') line.push(`${P(g2.p.x, g2.p.y)} l`)
          else line.push(`${P(g2.c1.x, g2.c1.y)} ${P(g2.c2.x, g2.c2.y)} ${P(g2.p.x, g2.p.y)} c`)
        }
        if (sub.closed) line.push('h')
      }
      line.push(layer.stroke ? 'stroke' : 'eofill')
      out.push(line.join(' '))
    }
  }
  out.push('grestore', 'showpage', '%%Trailer', '%%EOF', '')
  return out.join('\n')
}
