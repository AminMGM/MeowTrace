// Thin wrapper around the meowtrace-core WebAssembly C ABI (core-rs/src/wasm.rs).
// Environment-agnostic: used by the renderer's Web Workers and by Node scripts.

export interface Analysis {
  kind: 'photo' | 'logo' | 'logo-aa' | 'lineart'
  colors: number
  gray: boolean
  transparent: boolean
  coverage: number
  /** share of pixels in flat areas */
  flat: number
}

export interface Segmentation {
  width: number
  height: number
  upscale: number
  /** n × RGBA */
  palette: Uint8Array
  /** width × height, 255 = transparent */
  labels: Uint8Array
}

export interface RawLayer {
  /** colour #rrggbb */
  c: string
  /** 1 = stroke (centerline), 0 = fill */
  k: 0 | 1
  sw: number
  /** pixel area */
  a: number
  /** path data, one compound path per shape */
  p: string[]
}

export interface RawTrace {
  w: number
  h: number
  layers: RawLayer[]
}

interface Exports {
  memory: WebAssembly.Memory
  mt_alloc(len: number): number
  mt_free(ptr: number, len: number): void
  mt_result_ptr(): number
  mt_result_len(): number
  mt_result_clear(): void
  mt_analyze(img: number, w: number, h: number): number
  mt_segment(img: number, w: number, h: number, opts: number, nopts: number, pal: number, npal: number): number
  mt_vectorize(
    labels: number,
    w: number,
    h: number,
    upscale: number,
    pal: number,
    npal: number,
    opts: number,
    nopts: number
  ): number
}

const decoder = new TextDecoder()

export class Core {
  private constructor(private readonly x: Exports) {}

  static async create(wasm: BufferSource | WebAssembly.Module): Promise<Core> {
    const module = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm)
    const instance = await WebAssembly.instantiate(module, {})
    return new Core(instance.exports as unknown as Exports)
  }

  private put(bytes: ArrayBufferView): [number, number] {
    const len = bytes.byteLength
    const ptr = this.x.mt_alloc(len)
    new Uint8Array(this.x.memory.buffer, ptr, len).set(new Uint8Array(bytes.buffer, bytes.byteOffset, len))
    return [ptr, len]
  }

  private take(code: number): Uint8Array {
    if (code < 0) throw new Error(`meowtrace-core error ${code}`)
    const ptr = this.x.mt_result_ptr()
    const len = this.x.mt_result_len()
    const out = new Uint8Array(this.x.memory.buffer, ptr, len).slice()
    this.x.mt_result_clear()
    return out
  }

  private with<T>(buffers: ArrayBufferView[], fn: (ptrs: number[]) => T): T {
    const allocs = buffers.map((b) => this.put(b))
    try {
      return fn(allocs.map((a) => a[0]))
    } finally {
      for (const [p, l] of allocs) this.x.mt_free(p, l)
    }
  }

  analyze(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Analysis {
    const bytes = this.with([rgba], ([img]) => this.take(this.x.mt_analyze(img, width, height)))
    return JSON.parse(decoder.decode(bytes)) as Analysis
  }

  segment(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    options: Float64Array,
    lockedPalette: Uint8Array = new Uint8Array(0)
  ): Segmentation {
    const out = this.with([rgba, options, lockedPalette], ([img, opts, pal]) =>
      this.take(this.x.mt_segment(img, width, height, opts, options.length, pal, lockedPalette.length / 4))
    )
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    const w = view.getUint32(0, true)
    const h = view.getUint32(4, true)
    const upscale = view.getUint32(8, true)
    const n = view.getUint32(12, true)
    const palette = out.slice(16, 16 + n * 4)
    const labels = out.slice(16 + n * 4, 16 + n * 4 + w * h)
    return { width: w, height: h, upscale, palette, labels }
  }

  vectorize(seg: Segmentation, options: Float64Array): RawTrace {
    const bytes = this.with([seg.labels, seg.palette, options], ([lab, pal, opts]) =>
      this.take(
        this.x.mt_vectorize(lab, seg.width, seg.height, seg.upscale, pal, seg.palette.length / 4, opts, options.length)
      )
    )
    return JSON.parse(decoder.decode(bytes)) as RawTrace
  }
}
