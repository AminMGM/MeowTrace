// Layered Photoshop document writer (8-bit RGB, PackBits-compressed channels).
// Layer pixels are supplied by the caller (the renderer rasterises each colour
// layer with canvas), so this module stays pure and testable.

export interface PsdLayer {
  name: string
  visible: boolean
  /** Placement of the pixel block on the canvas. */
  left: number
  top: number
  width: number
  height: number
  /** width × height RGBA pixels. */
  rgba: Uint8Array | Uint8ClampedArray
}

/** PackBits run-length encoding of one row. */
export function packBits(row: Uint8Array): Uint8Array {
  const out: number[] = []
  const n = row.length
  let i = 0
  while (i < n) {
    // Run of identical bytes?
    let run = 1
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++
    if (run >= 2) {
      out.push(257 - run, row[i])
      i += run
      continue
    }
    // Literal run until the next repeat of ≥2 bytes.
    let lit = 1
    while (i + lit < n && lit < 128 && !(i + lit + 1 < n && row[i + lit] === row[i + lit + 1])) lit++
    out.push(lit - 1)
    for (let k = 0; k < lit; k++) out.push(row[i + k])
    i += lit
  }
  return Uint8Array.from(out)
}

class Writer {
  private buf: Uint8Array
  len = 0
  constructor(size = 1 << 16) {
    this.buf = new Uint8Array(size)
  }
  private grow(n: number): void {
    if (this.len + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.len + n) size *= 2
    const b = new Uint8Array(size)
    b.set(this.buf.subarray(0, this.len))
    this.buf = b
  }
  u8(v: number): void {
    this.grow(1)
    this.buf[this.len++] = v & 255
  }
  u16(v: number): void {
    this.u8(v >> 8)
    this.u8(v)
  }
  i16(v: number): void {
    this.u16(v & 0xffff)
  }
  u32(v: number): void {
    this.u16((v >>> 16) & 0xffff)
    this.u16(v & 0xffff)
  }
  bytes(b: Uint8Array): void {
    this.grow(b.length)
    this.buf.set(b, this.len)
    this.len += b.length
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i))
  }
  setU32(at: number, v: number): void {
    this.buf[at] = (v >>> 24) & 255
    this.buf[at + 1] = (v >>> 16) & 255
    this.buf[at + 2] = (v >>> 8) & 255
    this.buf[at + 3] = v & 255
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

interface Rect {
  top: number
  left: number
  bottom: number
  right: number
}

function alphaBounds(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Rect | null {
  let top = h
  let left = w
  let bottom = -1
  let right = -1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (rgba[row + x * 4 + 3] !== 0) {
        if (y < top) top = y
        if (y > bottom) bottom = y
        if (x < left) left = x
        if (x > right) right = x
      }
    }
  }
  return bottom < 0 ? null : { top, left, bottom: bottom + 1, right: right + 1 }
}

/** Encodes one channel (RLE) of the given rect; returns [byteCounts+data]. */
function encodeChannel(rgba: Uint8Array | Uint8ClampedArray, w: number, r: Rect, c: number): Uint8Array {
  const rw = r.right - r.left
  const rows: Uint8Array[] = []
  const row = new Uint8Array(rw)
  for (let y = r.top; y < r.bottom; y++) {
    const base = (y * w + r.left) * 4 + c
    for (let x = 0; x < rw; x++) row[x] = rgba[base + x * 4]
    rows.push(packBits(row))
  }
  const wr = new Writer(rows.reduce((n, b) => n + b.length + 2, 2))
  wr.u16(1) // RLE
  for (const b of rows) wr.u16(b.length)
  for (const b of rows) wr.bytes(b)
  return wr.result()
}

function pascalName(name: string): Uint8Array {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').slice(0, 255)
  const total = Math.ceil((ascii.length + 1) / 4) * 4
  const b = new Uint8Array(total)
  b[0] = ascii.length
  for (let i = 0; i < ascii.length; i++) b[i + 1] = ascii.charCodeAt(i)
  return b
}

function unicodeName(name: string): Uint8Array {
  const w = new Writer(32 + name.length * 2)
  w.ascii('8BIM')
  w.ascii('luni')
  const len = 4 + name.length * 2
  w.u32(len + (len % 4 ? 4 - (len % 4) : 0))
  w.u32(name.length)
  for (let i = 0; i < name.length; i++) w.u16(name.charCodeAt(i))
  while ((w.len - 12) % 4) w.u8(0)
  return w.result()
}

/** Writes a PSD with the given layers (bottom first) and a flattened composite. */
export function toPsd(width: number, height: number, layers: PsdLayer[], composite: Uint8Array | Uint8ClampedArray): Uint8Array {
  const w = new Writer(1 << 20)
  // Header
  w.ascii('8BPS')
  w.u16(1)
  for (let i = 0; i < 6; i++) w.u8(0)
  w.u16(4)
  w.u32(height)
  w.u32(width)
  w.u16(8)
  w.u16(3)
  // Colour mode data, image resources
  w.u32(0)
  w.u32(0)

  // Layer and mask information
  const lmStart = w.len
  w.u32(0)
  const liStart = w.len
  w.u32(0)
  // Trim each block to its opaque pixels; rect is in block coordinates.
  const prepared = layers
    .map((l) => ({ l, rect: alphaBounds(l.rgba, l.width, l.height) }))
    .filter((p): p is { l: PsdLayer; rect: Rect } => p.rect !== null)
  w.i16(-prepared.length) // negative: first alpha channel is the merged transparency
  const channelData: Uint8Array[][] = []
  for (const { l, rect } of prepared) {
    const chans = [3, 0, 1, 2].map((c) => encodeChannel(l.rgba, l.width, rect, c))
    channelData.push(chans)
    w.u32(l.top + rect.top)
    w.u32(l.left + rect.left)
    w.u32(l.top + rect.bottom)
    w.u32(l.left + rect.right)
    w.u16(4)
    const ids = [-1, 0, 1, 2]
    chans.forEach((ch, i) => {
      w.i16(ids[i])
      w.u32(ch.length)
    })
    w.ascii('8BIM')
    w.ascii('norm')
    w.u8(255)
    w.u8(0)
    w.u8(l.visible ? 0 : 2)
    w.u8(0)
    const name = pascalName(l.name)
    const uni = unicodeName(l.name)
    w.u32(4 + 4 + name.length + uni.length)
    w.u32(0)
    w.u32(0)
    w.bytes(name)
    w.bytes(uni)
  }
  for (const chans of channelData) for (const ch of chans) w.bytes(ch)
  if ((w.len - liStart) % 2) w.u8(0)
  while ((w.len - liStart - 4) % 4) w.u8(0)
  w.setU32(liStart, w.len - liStart - 4)
  w.u32(0) // global layer mask info
  w.setU32(lmStart, w.len - lmStart - 4)

  // Composite image (RLE, planar R, G, B, A)
  const full: Rect = { top: 0, left: 0, bottom: height, right: width }
  const comp = [0, 1, 2, 3].map((c) => encodeChannel(composite, width, full, c))
  w.u16(1)
  for (const ch of comp) {
    // byte counts start after the 2-byte compression marker
    w.bytes(ch.subarray(2, 2 + height * 2))
  }
  for (const ch of comp) w.bytes(ch.subarray(2 + height * 2))
  return w.result()
}
