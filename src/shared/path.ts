// SVG path geometry: parse, serialize, transform, flatten, split and hit-test.
// The tracer emits only absolute M/L/C/Z, but the parser accepts the full
// command set (relative, H/V/S/Q/T; arcs are approximated by lines).

export interface Pt {
  x: number
  y: number
}

export interface Seg {
  kind: 'L' | 'C'
  c1: Pt
  c2: Pt
  p: Pt
}

export interface SubPath {
  start: Pt
  segs: Seg[]
  closed: boolean
}

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const CMD = /[MmLlHhVvCcSsQqTtAaZz]/

export function parsePath(d: string): SubPath[] {
  const subs: SubPath[] = []
  let i = 0
  const n = d.length
  let cmd = ''
  let cur: SubPath | null = null
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let lastC2: Pt | null = null
  let lastQ: Pt | null = null

  const skip = (): void => {
    while (i < n && (d[i] === ' ' || d[i] === ',' || d[i] === '\n' || d[i] === '\t' || d[i] === '\r')) i++
  }
  const num = (): number => {
    skip()
    NUM.lastIndex = i
    const m = NUM.exec(d)
    if (!m) throw new Error(`Bad path data near "${d.slice(i, i + 12)}"`)
    i = NUM.lastIndex
    return parseFloat(m[0])
  }
  const flag = (): number => {
    skip()
    const c = d[i++]
    return c === '1' ? 1 : 0
  }
  const hasNum = (): boolean => {
    skip()
    return i < n && !CMD.test(d[i])
  }
  const ensure = (): SubPath => {
    if (!cur) {
      cur = { start: { x, y }, segs: [], closed: false }
      subs.push(cur)
    }
    return cur
  }
  const line = (nx: number, ny: number): void => {
    ensure().segs.push({ kind: 'L', c1: { x, y }, c2: { x: nx, y: ny }, p: { x: nx, y: ny } })
    x = nx
    y = ny
  }
  const cubic = (c1: Pt, c2: Pt, p: Pt): void => {
    ensure().segs.push({ kind: 'C', c1, c2, p })
    x = p.x
    y = p.y
  }

  while (true) {
    skip()
    if (i >= n) break
    if (CMD.test(d[i])) {
      cmd = d[i++]
    } else if (!cmd) {
      throw new Error('Path data must start with a command')
    }
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    switch (C) {
      case 'M': {
        const nx = num() + ox
        const ny = num() + oy
        cur = { start: { x: nx, y: ny }, segs: [], closed: false }
        subs.push(cur)
        x = sx = nx
        y = sy = ny
        cmd = rel ? 'l' : 'L'
        lastC2 = lastQ = null
        break
      }
      case 'L':
        line(num() + ox, num() + oy)
        lastC2 = lastQ = null
        break
      case 'H':
        line(num() + ox, y)
        lastC2 = lastQ = null
        break
      case 'V':
        line(x, num() + oy)
        lastC2 = lastQ = null
        break
      case 'C': {
        const c1 = { x: num() + ox, y: num() + oy }
        const c2 = { x: num() + ox, y: num() + oy }
        const p = { x: num() + ox, y: num() + oy }
        cubic(c1, c2, p)
        lastC2 = c2
        lastQ = null
        break
      }
      case 'S': {
        const c1 = lastC2 ? { x: 2 * x - lastC2.x, y: 2 * y - lastC2.y } : { x, y }
        const c2 = { x: num() + ox, y: num() + oy }
        const p = { x: num() + ox, y: num() + oy }
        cubic(c1, c2, p)
        lastC2 = c2
        lastQ = null
        break
      }
      case 'Q':
      case 'T': {
        const q: Pt = C === 'Q' ? { x: num() + ox, y: num() + oy } : lastQ ? { x: 2 * x - lastQ.x, y: 2 * y - lastQ.y } : { x, y }
        const p = { x: num() + ox, y: num() + oy }
        cubic(
          { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) },
          { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
          p
        )
        lastQ = q
        lastC2 = null
        break
      }
      case 'A': {
        num()
        num()
        num()
        flag()
        flag()
        line(num() + ox, num() + oy)
        lastC2 = lastQ = null
        break
      }
      case 'Z': {
        if (cur) {
          if (x !== sx || y !== sy) line(sx, sy)
          cur.closed = true
        }
        x = sx
        y = sy
        cur = null
        lastC2 = lastQ = null
        break
      }
    }
    if (C === 'Z') continue
    // Implicit repeats are handled by looping with the same cmd while numbers follow.
    if (!hasNum()) continue
  }
  // Drop the closing segment that merely returns to start (Z handles it).
  for (const s of subs) {
    if (!s.closed || s.segs.length < 2) continue
    const last = s.segs[s.segs.length - 1]
    if (last.kind === 'L' && near(last.p, s.start)) {
      const prev = s.segs[s.segs.length - 2]
      if (near(prev.p, s.start)) s.segs.pop()
    }
  }
  return subs
}

function near(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
}

export function fmt(v: number, prec = 2): string {
  const f = 10 ** prec
  let r = Math.round(v * f) / f
  if (Object.is(r, -0)) r = 0
  let s = String(r)
  if (s.includes('e')) s = r.toFixed(prec)
  if (s.startsWith('0.')) return s.slice(1)
  if (s.startsWith('-0.')) return '-' + s.slice(2)
  return s
}

export function serializePath(subs: SubPath[], prec = 2): string {
  let out = ''
  const pt = (p: Pt): string => `${fmt(p.x, prec)} ${fmt(p.y, prec)}`
  for (const s of subs) {
    out += 'M' + pt(s.start)
    const segs = s.segs
    for (let k = 0; k < segs.length; k++) {
      const g = segs[k]
      // The final straight segment back to the start is implied by Z.
      if (s.closed && k === segs.length - 1 && g.kind === 'L' && near(g.p, s.start)) continue
      out += g.kind === 'L' ? 'L' + pt(g.p) : `C${pt(g.c1)} ${pt(g.c2)} ${pt(g.p)}`
    }
    if (s.closed) out += 'Z'
  }
  return out
}

export function mapPoints(subs: SubPath[], f: (p: Pt) => Pt): SubPath[] {
  return subs.map((s) => ({
    start: f(s.start),
    closed: s.closed,
    segs: s.segs.map((g) => ({ kind: g.kind, c1: f(g.c1), c2: f(g.c2), p: f(g.p) }))
  }))
}

export function transformPath(d: string, f: (p: Pt) => Pt, prec = 2): string {
  return serializePath(mapPoints(parsePath(d), f), prec)
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function bbox(subs: SubPath[]): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const add = (p: Pt): void => {
    if (p.x < b.x0) b.x0 = p.x
    if (p.y < b.y0) b.y0 = p.y
    if (p.x > b.x1) b.x1 = p.x
    if (p.y > b.y1) b.y1 = p.y
  }
  for (const s of subs) {
    add(s.start)
    for (const g of s.segs) {
      add(g.p)
      if (g.kind === 'C') {
        add(g.c1)
        add(g.c2)
      }
    }
  }
  return b
}

export function cubicAt(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const s = 1 - t
  const a = s * s * s
  const b = 3 * s * s * t
  const c = 3 * s * t * t
  const d = t * t * t
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y }
}

/** de Casteljau split of a cubic at t. */
export function splitCubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): [Seg, Seg] {
  const lerp = (a: Pt, b: Pt): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  const a = lerp(p0, c1)
  const b = lerp(c1, c2)
  const c = lerp(c2, p3)
  const ab = lerp(a, b)
  const bc = lerp(b, c)
  const m = lerp(ab, bc)
  return [
    { kind: 'C', c1: a, c2: ab, p: m },
    { kind: 'C', c1: bc, c2: c, p: p3 }
  ]
}

/** Flattens to polylines with roughly `tol` units of chord error. */
export function flatten(subs: SubPath[], tol = 0.25): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = []
  for (const s of subs) {
    const pts: Pt[] = [s.start]
    let cur = s.start
    for (const g of s.segs) {
      if (g.kind === 'L') {
        pts.push(g.p)
      } else {
        const len =
          Math.hypot(g.c1.x - cur.x, g.c1.y - cur.y) +
          Math.hypot(g.c2.x - g.c1.x, g.c2.y - g.c1.y) +
          Math.hypot(g.p.x - g.c2.x, g.p.y - g.c2.y)
        const steps = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / Math.max(tol, 1e-3)))))
        for (let k = 1; k <= steps; k++) pts.push(cubicAt(cur, g.c1, g.c2, g.p, k / steps))
      }
      cur = g.p
    }
    out.push({ pts, closed: s.closed })
  }
  return out
}

export interface Hit {
  sub: number
  seg: number
  t: number
  point: Pt
  dist: number
}

/** Closest point on the outline to `q` (sampled). */
export function nearestOnPath(subs: SubPath[], q: Pt): Hit | null {
  let best: Hit | null = null
  subs.forEach((s, si) => {
    let cur = s.start
    s.segs.forEach((g, gi) => {
      const steps = g.kind === 'L' ? 1 : 24
      let prev = cur
      for (let k = 1; k <= steps; k++) {
        const t1 = k / steps
        const p = g.kind === 'L' ? g.p : cubicAt(cur, g.c1, g.c2, g.p, t1)
        // project q onto chord prev→p
        const dx = p.x - prev.x
        const dy = p.y - prev.y
        const l2 = dx * dx + dy * dy
        const u = l2 ? Math.max(0, Math.min(1, ((q.x - prev.x) * dx + (q.y - prev.y) * dy) / l2)) : 0
        const proj = { x: prev.x + dx * u, y: prev.y + dy * u }
        const dist = Math.hypot(q.x - proj.x, q.y - proj.y)
        if (!best || dist < best.dist) {
          best = { sub: si, seg: gi, t: (k - 1 + u) / steps, point: proj, dist }
        }
        prev = p
      }
      cur = g.p
    })
  })
  return best
}

/** Start point of segment `i` in a sub-path. */
export function segStart(s: SubPath, i: number): Pt {
  return i === 0 ? s.start : s.segs[i - 1].p
}

/** Inserts an anchor at parameter t of segment `seg`. */
export function insertAnchor(subs: SubPath[], sub: number, seg: number, t: number): SubPath[] {
  const out = clone(subs)
  const s = out[sub]
  const g = s.segs[seg]
  const p0 = segStart(s, seg)
  if (g.kind === 'L') {
    const m = { x: p0.x + (g.p.x - p0.x) * t, y: p0.y + (g.p.y - p0.y) * t }
    s.segs.splice(seg, 1, { kind: 'L', c1: p0, c2: m, p: m }, { kind: 'L', c1: m, c2: g.p, p: g.p })
  } else {
    const [a, b] = splitCubic(p0, g.c1, g.c2, g.p, t)
    s.segs.splice(seg, 1, a, b)
  }
  return out
}

/**
 * Removes anchor `idx` of a sub-path, where anchor 0 is the start point and
 * anchor k (k ≥ 1) is the end of segment k-1. The two neighbouring segments
 * are merged, keeping their outer handles.
 */
export function deleteAnchor(subs: SubPath[], sub: number, idx: number): SubPath[] {
  const out = clone(subs)
  const s = out[sub]
  const n = s.segs.length
  if (n <= (s.closed ? 2 : 1)) {
    out.splice(sub, 1)
    return out
  }
  if (idx === 0) {
    if (s.closed) {
      // Merge last segment (ending at start) with first.
      const first = s.segs[0]
      const lastIdx = n - 1
      const last = s.segs[lastIdx]
      const merged: Seg =
        first.kind === 'L' && last.kind === 'L'
          ? { kind: 'L', c1: first.p, c2: first.p, p: first.p }
          : { kind: 'C', c1: last.kind === 'C' ? last.c1 : segStart(s, lastIdx), c2: first.kind === 'C' ? first.c2 : first.p, p: first.p }
      s.start = segStart(s, lastIdx)
      s.segs.splice(lastIdx, 1)
      s.segs[0] = merged
      // Rotate so the new start is consistent: segments now go from old prev anchor.
      return out
    }
    s.start = s.segs[0].p
    s.segs.shift()
    return out
  }
  const i = idx - 1 // segment ending at the anchor
  if (i === n - 1) {
    if (!s.closed) {
      s.segs.pop()
      return out
    }
    // In a closed path the last anchor may coincide with start: treat as 0.
    return deleteAnchor(subs, sub, 0)
  }
  const a = s.segs[i]
  const b = s.segs[i + 1]
  const merged: Seg =
    a.kind === 'L' && b.kind === 'L'
      ? { kind: 'L', c1: b.p, c2: b.p, p: b.p }
      : { kind: 'C', c1: a.kind === 'C' ? a.c1 : segStart(s, i), c2: b.kind === 'C' ? b.c2 : b.p, p: b.p }
  s.segs.splice(i, 2, merged)
  return out
}

export function clone(subs: SubPath[]): SubPath[] {
  return subs.map((s) => ({
    start: { ...s.start },
    closed: s.closed,
    segs: s.segs.map((g) => ({ kind: g.kind, c1: { ...g.c1 }, c2: { ...g.c2 }, p: { ...g.p } }))
  }))
}

export function countNodes(d: string): number {
  let n = 0
  for (let i = 0; i < d.length; i++) {
    const c = d.charCodeAt(i)
    // M, L, C (and lowercase) each introduce one anchor
    if (c === 77 || c === 76 || c === 67 || c === 109 || c === 108 || c === 99) n++
  }
  return n
}

/** Signed area of a closed polyline (for orientation tests). */
export function polygonArea(pts: Pt[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y)
  return a / 2
}
