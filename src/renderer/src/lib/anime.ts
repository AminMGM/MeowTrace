// "Turn into anime" actions: resize for the model, run it in the main
// process, scale the result back and open it as the new source image.
import { ANIME_STYLES, animeInputSize } from '@shared/anime'
import type { AnimeStyleId } from '@shared/anime'
import { baseName } from './image'
import { errorText, openImage } from './actions'
import { getState, setState, toast } from './store'

/** Draws `src` into a w×h canvas (letterboxed on white when `fit`). */
function drawTo(src: CanvasImageSource, sw: number, sh: number, w: number, h: number, fit: boolean): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  if (fit) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    const k = Math.min(w / sw, h / sh)
    ctx.drawImage(src, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k)
  } else {
    ctx.drawImage(src, 0, 0, w, h)
  }
  return c
}

export async function convertToAnime(id: AnimeStyleId): Promise<void> {
  const s = getState()
  const style = ANIME_STYLES.find((x) => x.id === id)
  if (!s.source || !style) return
  const src = s.source
  setState({ busy: 'loading' })
  try {
    // Always start from the original, so switching styles does not stack them.
    const original = s.animeOriginal ?? { blob: await (await fetch(src.url)).blob(), name: src.name, path: src.path, style: id }
    const bitmap = await createImageBitmap(original.blob)
    const { w, h } = animeInputSize(bitmap.width, bitmap.height, style)
    const square = style.layout === 'nchw'
    const input = drawTo(bitmap, bitmap.width, bitmap.height, w, h, square)
    const rgba = input.getContext('2d')!.getImageData(0, 0, w, h).data
    const out = await window.meow.animeRun(id, new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), w, h)

    // Back to the original aspect, at most 2048 px: the model works at about
    // 1024 px, so scaling further only adds blur and slows tracing down.
    const result = new OffscreenCanvas(w, h)
    result.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out), w, h), 0, 0)
    const k0 = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    const fw = Math.max(1, Math.round(bitmap.width * k0))
    const fh = Math.max(1, Math.round(bitmap.height * k0))
    const final = new OffscreenCanvas(fw, fh)
    const fctx = final.getContext('2d')!
    fctx.imageSmoothingQuality = 'high'
    if (square) {
      const k = Math.min(w / bitmap.width, h / bitmap.height)
      const cw = bitmap.width * k
      const ch = bitmap.height * k
      fctx.drawImage(result, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, fw, fh)
    } else {
      fctx.drawImage(result, 0, 0, fw, fh)
    }
    bitmap.close()
    const blob = await final.convertToBlob({ type: 'image/png' })
    const name = `${baseName(original.name)} (${style.name}).png`
    await openImage(blob, name)
    setState({ animeOriginal: { ...original, style: id }, showAnime: false })
    toast(`Converted to the ${style.name} anime style`, 'ok')
  } catch (e) {
    setState({ busy: 'idle' })
    toast(errorText(e), 'error')
  }
}

export async function backToOriginal(): Promise<void> {
  const o = getState().animeOriginal
  if (!o) return
  await openImage(o.blob, o.name, o.path)
  setState({ animeOriginal: null })
}
