import type { VDoc } from '../document'
import { parsePath, serializePath, mapPoints } from '../path'
import { exportLayers, layerIds, num, xmlEscape } from './common'
import type { ExportOptions } from './common'

/** SVG with one named group (Illustrator/Inkscape layer) per colour. */
export function toSvg(doc: VDoc, o: ExportOptions = {}): string {
  const scale = o.scale ?? 1
  const prec = o.precision ?? 2
  const layers = exportLayers(doc, o)
  const ids = layerIds(layers)
  const W = doc.width * scale
  const H = doc.height * scale
  const reformat = scale !== 1 || o.precision !== undefined
  const fix = (d: string): string =>
    reformat ? serializePath(mapPoints(parsePath(d), (p) => ({ x: p.x * scale, y: p.y * scale })), prec) : d

  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push('<!-- Traced with MeowTrace · https://github.com/AminMGM/MeowTrace -->')
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
      `width="${num(W)}" height="${num(H)}" viewBox="0 0 ${num(W)} ${num(H)}">`
  )
  if (o.title) out.push(`<title>${xmlEscape(o.title)}</title>`)
  if (o.background) out.push(`<rect id="Background" width="100%" height="100%" fill="${o.background}"/>`)
  layers.forEach((l, i) => {
    const label = xmlEscape(l.name)
    const paint = l.stroke
      ? `fill="none" stroke="${l.color}" stroke-width="${num(l.strokeWidth * scale)}" stroke-linecap="round" stroke-linejoin="round"`
      : `fill="${l.color}" fill-rule="evenodd"`
    out.push(`<g id="${ids[i]}" inkscape:groupmode="layer" inkscape:label="${label}" ${paint}>`)
    if (o.mergePaths) {
      out.push(`<path d="${l.paths.map((p) => fix(p.d)).join('')}"/>`)
    } else {
      for (const p of l.paths) out.push(`<path d="${fix(p.d)}"/>`)
    }
    out.push('</g>')
  })
  out.push('</svg>')
  return out.join(o.mergePaths ? '' : '\n')
}
