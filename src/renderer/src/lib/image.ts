// Image decoding. Very large images are downscaled for tracing; `scale` maps
// traced coordinates back to the original pixel size.

export interface SourceImage {
  name: string
  path?: string
  /** Original pixel size. */
  width: number
  height: number
  /** Processed (traced) pixel size. */
  pw: number
  ph: number
  /** original / processed */
  scale: number
  rgba: Uint8ClampedArray
  /** Object URL for display. */
  url: string
  bytes: number
}

export const MAX_TRACE_PIXELS = 16_000_000

export async function decodeImage(bytes: Uint8Array | Blob, name: string, path?: string): Promise<SourceImage> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart])
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'default', premultiplyAlpha: 'none' })
  } catch {
    throw new Error(`Could not decode ${name}. Supported: PNG, JPEG, WebP, BMP, GIF, AVIF, ICO.`)
  }
  const { width, height } = bitmap
  const ratio = Math.min(1, Math.sqrt(MAX_TRACE_PIXELS / (width * height)))
  const pw = Math.max(1, Math.round(width * ratio))
  const ph = Math.max(1, Math.round(height * ratio))
  const canvas = new OffscreenCanvas(pw, ph)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, pw, ph)
  bitmap.close()
  const rgba = ctx.getImageData(0, 0, pw, ph).data
  return {
    name,
    path,
    width,
    height,
    pw,
    ph,
    scale: width / pw,
    rgba,
    url: URL.createObjectURL(blob),
    bytes: blob.size
  }
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'trace'
}

/** Small preview thumbnail as a data URL. */
export async function thumbnail(bytes: Uint8Array, size = 72): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), { resizeWidth: size, resizeQuality: 'medium' })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return URL.createObjectURL(blob)
}
