// Rasterises a vector document with canvas (PNG export, PSD layers, clipboard).

import type { VDoc, VLayer } from '@shared/document'
import { pathBox, visibleLayers } from '@shared/document'
import type { PsdLayer } from '@shared/exporters/psd'

function paintLayer(ctx: OffscreenCanvasRenderingContext2D, layer: VLayer): void {
  if (layer.stroke) {
    ctx.strokeStyle = layer.color
    ctx.lineWidth = layer.strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const p of layer.paths) ctx.stroke(new Path2D(p.d))
  } else {
    ctx.fillStyle = layer.color
    for (const p of layer.paths) ctx.fill(new Path2D(p.d), 'evenodd')
  }
}

export interface RasterOptions {
  scale: number
  background?: string | null
  includeHidden?: boolean
}

export function rasterize(doc: VDoc, o: RasterOptions): OffscreenCanvas {
  const w = Math.max(1, Math.round(doc.width * o.scale))
  const h = Math.max(1, Math.round(doc.height * o.scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  if (o.background) {
    ctx.fillStyle = o.background
    ctx.fillRect(0, 0, w, h)
  }
  ctx.scale(o.scale, o.scale)
  for (const l of visibleLayers(doc, o.includeHidden)) paintLayer(ctx, l)
  return canvas
}

export async function toPng(doc: VDoc, o: RasterOptions): Promise<Uint8Array> {
  const blob = await rasterize(doc, o).convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Renders each layer into its own cropped pixel block for the PSD writer. */
export function psdLayers(doc: VDoc, o: RasterOptions): { width: number; height: number; layers: PsdLayer[]; composite: Uint8ClampedArray } {
  const W = Math.max(1, Math.round(doc.width * o.scale))
  const H = Math.max(1, Math.round(doc.height * o.scale))
  const layers: PsdLayer[] = []
  for (const l of visibleLayers(doc, true)) {
    if (!o.includeHidden && !l.visible) continue
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const p of l.paths) {
      const b = pathBox(p.d)
      x0 = Math.min(x0, b.x0)
      y0 = Math.min(y0, b.y0)
      x1 = Math.max(x1, b.x1)
      y1 = Math.max(y1, b.y1)
    }
    const pad = l.stroke ? l.strokeWidth : 1
    const left = Math.max(0, Math.floor((x0 - pad) * o.scale))
    const top = Math.max(0, Math.floor((y0 - pad) * o.scale))
    const right = Math.min(W, Math.ceil((x1 + pad) * o.scale))
    const bottom = Math.min(H, Math.ceil((y1 + pad) * o.scale))
    if (right <= left || bottom <= top) continue
    const c = new OffscreenCanvas(right - left, bottom - top)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.translate(-left, -top)
    ctx.scale(o.scale, o.scale)
    paintLayer(ctx, l)
    layers.push({
      name: l.name,
      visible: l.visible,
      left,
      top,
      width: c.width,
      height: c.height,
      rgba: ctx.getImageData(0, 0, c.width, c.height).data
    })
  }
  const comp = rasterize(doc, { scale: o.scale, background: o.background, includeHidden: false })
  const composite = comp.getContext('2d')!.getImageData(0, 0, W, H).data
  if (o.background) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(o.background!.slice(i, i + 2), 16))
    layers.unshift({ name: 'Background', visible: true, left: 0, top: 0, width: W, height: H, rgba: solid(W, H, r, g, b) })
  }
  return { width: W, height: H, layers, composite }
}

function solid(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r
    out[i + 1] = g
    out[i + 2] = b
    out[i + 3] = 255
  }
  return out
}
