// "Turn into anime": AnimeGANv2-family ONNX models, downloaded on first use.
// MeowTrace does not ship the model weights; each style lists where it comes
// from and its licence, and the app shows that before downloading.

export type AnimeStyleId = 'hayao' | 'shinkai' | 'paprika' | 'facepaint'

export interface AnimeStyle {
  id: AnimeStyleId
  name: string
  blurb: string
  /** File name in the local model folder. */
  file: string
  url: string
  sha256: string
  bytes: number
  /** Tensor layout: NHWC models take any size, NCHW `size` is fixed. */
  layout: 'nhwc' | 'nchw'
  /** Fixed square input size (NCHW models only). */
  size?: number
  licence: string
  commercial: boolean
  source: string
}

export const ANIME_STYLES: AnimeStyle[] = [
  {
    id: 'hayao',
    name: 'Hayao',
    blurb: 'Soft watercolour skies and warm, hand-painted scenery',
    file: 'AnimeGANv2_Hayao.onnx',
    url: 'https://huggingface.co/vumichien/AnimeGANv2_Hayao/resolve/main/AnimeGANv2_Hayao.onnx',
    sha256: '5a84ca468f3c4fd891fe8c883a3a507ed3e463f4f059985735f6449dae7590b5',
    bytes: 8649739,
    layout: 'nhwc',
    licence: 'AnimeGANv2 licence: non-commercial use only',
    commercial: false,
    source: 'https://github.com/TachibanaYoshino/AnimeGANv2'
  },
  {
    id: 'shinkai',
    name: 'Shinkai',
    blurb: 'Crisp light, vivid blues and cinematic contrast',
    file: 'AnimeGANv2_Shinkai.onnx',
    url: 'https://huggingface.co/vumichien/AnimeGANv2_Shinkai/resolve/main/AnimeGANv2_Shinkai.onnx',
    sha256: '4b57475c2bdc71348a52e6d495abc9e346242619fdb0e519a2957c7c7885c4bb',
    bytes: 8649278,
    layout: 'nhwc',
    licence: 'AnimeGANv2 licence: non-commercial use only',
    commercial: false,
    source: 'https://github.com/TachibanaYoshino/AnimeGANv2'
  },
  {
    id: 'paprika',
    name: 'Paprika',
    blurb: 'Bold saturated colour and strong, graphic shading',
    file: 'AnimeGANv2_Paprika.onnx',
    url: 'https://huggingface.co/vumichien/AnimeGANv2_Paprika/resolve/main/AnimeGANv2_Paprika.onnx',
    sha256: 'b0a00eb337092b446e6df9d92f7a5de804880b093b229baf2e9e2ba4696b01a2',
    bytes: 8649729,
    layout: 'nhwc',
    licence: 'AnimeGANv2 licence: non-commercial use only',
    commercial: false,
    source: 'https://github.com/TachibanaYoshino/AnimeGANv2'
  },
  {
    id: 'facepaint',
    name: 'Face Paint',
    blurb: 'Portrait style: big eyes, smooth skin. Best on faces',
    file: 'face_paint_512_v2_0.onnx',
    url: 'https://huggingface.co/akhaliq/AnimeGANv2-ONNX/resolve/main/face_paint_512_v2_0.onnx',
    sha256: '1381b17ed988e14a1f3cf8954d88073c0884ff4b70128ebe599f0d6021bca63e',
    bytes: 8594990,
    layout: 'nchw',
    size: 512,
    licence: 'MIT (animegan2-pytorch by bryandlee)',
    commercial: true,
    source: 'https://github.com/bryandlee/animegan2-pytorch'
  }
]

/** Longest side, in pixels, that free-size styles are run at. */
export const ANIME_MAX_SIDE = 1024

export interface AnimeModelStatus {
  id: AnimeStyleId
  downloaded: boolean
}

export interface AnimeProgress {
  id: AnimeStyleId
  received: number
  total: number
}

/** Size a free-size style runs at: fits ANIME_MAX_SIDE, multiples of 8. */
export function animeInputSize(width: number, height: number, style: AnimeStyle): { w: number; h: number } {
  if (style.layout === 'nchw') return { w: style.size ?? 512, h: style.size ?? 512 }
  const k = Math.min(1, ANIME_MAX_SIDE / Math.max(width, height))
  const round = (v: number): number => Math.max(64, Math.round((v * k) / 8) * 8)
  return { w: round(width), h: round(height) }
}
