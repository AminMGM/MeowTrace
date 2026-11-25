import type { VDoc } from '../document'
import { parsePath } from '../path'
import { encoder, exportLayers, num, rgb01 } from './common'
import type { ExportOptions } from './common'

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function pdfString(s: string): string {
  // UTF-16BE with BOM so layer names keep any characters.
  let hex = 'FEFF'
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 63
    if (c > 0xffff) {
      const v = c - 0x10000
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')
    } else hex += c.toString(16).padStart(4, '0')
  }
  return `<${hex.toUpperCase()}>`
}

/**
 * PDF 1.5 with one optional-content group (layer) per colour. Saved with an
 * .ai extension this is also what Illustrator reads as a PDF-compatible AI file.
 */
export async function toPdf(doc: VDoc, o: ExportOptions = {}): Promise<Uint8Array> {
  const s = o.scale ?? 1
  const W = doc.width * s
  const H = doc.height * s
  const layers = exportLayers(doc, o)

  const ops: string[] = [`1 0 0 -1 0 ${num(H)} cm`]
  if (o.background) {
    const [r, g, b] = rgb01(o.background)
    ops.push(`${num(r)} ${num(g)} ${num(b)} rg 0 0 ${num(W)} ${num(H)} re f`)
  }
  const P = (x: number, y: number): string => `${num(x * s)} ${num(y * s)}`
  layers.forEach((layer, i) => {
    const [r, g, b] = rgb01(layer.color)
    ops.push(`/OC /oc${i} BDC q`)
    if (layer.stroke) ops.push(`${num(r)} ${num(g)} ${num(b)} RG ${num(layer.strokeWidth * s)} w 1 J 1 j`)
    else ops.push(`${num(r)} ${num(g)} ${num(b)} rg`)
    for (const p of layer.paths) {
      const parts: string[] = []
      for (const sub of parsePath(p.d)) {
        parts.push(`${P(sub.start.x, sub.start.y)} m`)
        for (const g2 of sub.segs) {
          if (g2.kind === 'L') parts.push(`${P(g2.p.x, g2.p.y)} l`)
          else parts.push(`${P(g2.c1.x, g2.c1.y)} ${P(g2.c2.x, g2.c2.y)} ${P(g2.p.x, g2.p.y)} c`)
        }
        if (sub.closed) parts.push('h')
      }
      parts.push(layer.stroke ? 'S' : 'f*')
      ops.push(parts.join(' '))
    }
    ops.push('Q EMC')
  })
  const raw = encoder.encode(ops.join('\n'))
  const packed = await deflate(raw)
  const content = packed ?? raw

  // Object numbering: 1 catalog, 2 pages, 3 page, 4 contents, 5 info, 6.. OCGs
  const ocgBase = 6
  const ocgRefs = layers.map((_, i) => `${ocgBase + i} 0 R`).join(' ')
  const objects: (string | Uint8Array[])[] = []
  objects[1] =
    `<< /Type /Catalog /Pages 2 0 R` +
    (layers.length ? ` /OCProperties << /OCGs [${ocgRefs}] /D << /Order [${ocgRefs}] /ON [${ocgRefs}] >> >>` : '') +
    ` >>`
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
  const props = layers.map((_, i) => `/oc${i} ${ocgBase + i} 0 R`).join(' ')
  objects[3] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Contents 4 0 R` +
    ` /Resources << /Properties << ${props} >> >> >>`
  objects[4] = [
    encoder.encode(`<< /Length ${content.length}${packed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`),
    content,
    encoder.encode('\nendstream')
  ]
  const date = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  objects[5] = `<< /Producer (MeowTrace) /Creator (MeowTrace) /Title ${pdfString(o.title ?? 'MeowTrace')} /CreationDate (D:${date}) >>`
  layers.forEach((l, i) => {
    objects[ocgBase + i] = `<< /Type /OCG /Name ${pdfString(l.name)} >>`
  })

  const chunks: Uint8Array[] = []
  let length = 0
  const push = (b: Uint8Array): void => {
    chunks.push(b)
    length += b.length
  }
  push(encoder.encode('%PDF-1.5\n%âãÏÓ\n'))
  const offsets: number[] = []
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = length
    push(encoder.encode(`${n} 0 obj\n`))
    const body = objects[n]
    if (typeof body === 'string') push(encoder.encode(body))
    else body.forEach(push)
    push(encoder.encode('\nendobj\n'))
  }
  const xref = length
  let table = `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let n = 1; n < objects.length; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  table += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  push(encoder.encode(table))

  const out = new Uint8Array(length)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}
