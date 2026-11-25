// Anchor/handle model on top of SubPath for the node editor.
//
// Anchors of a sub-path: index 0 is `start`; index k ≥ 1 is the end of
// segment k-1. In a closed sub-path the last segment ends at `start`, so its
// anchors are 0 … n-1.

import type { Pt, SubPath } from './path'
import { clone } from './path'

export interface AnchorRef {
  sub: number
  idx: number
}

export type HandleSide = 'in' | 'out'

export function anchorCount(s: SubPath): number {
  return s.closed ? s.segs.length : s.segs.length + 1
}

export function anchorPos(s: SubPath, idx: number): Pt {
  return idx === 0 ? s.start : s.segs[idx - 1].p
}

/** Segment index whose c2 is the incoming handle of `idx`, or -1. */
export function inSeg(s: SubPath, idx: number): number {
  if (idx > 0) return idx - 1
  return s.closed ? s.segs.length - 1 : -1
}

/** Segment index whose c1 is the outgoing handle of `idx`, or -1. */
export function outSeg(s: SubPath, idx: number): number {
  return idx < s.segs.length ? idx : -1
}

export function handles(s: SubPath, idx: number): { in: Pt | null; out: Pt | null } {
  const i = inSeg(s, idx)
  const o = outSeg(s, idx)
  return {
    in: i >= 0 && s.segs[i].kind === 'C' ? s.segs[i].c2 : null,
    out: o >= 0 && s.segs[o].kind === 'C' ? s.segs[o].c1 : null
  }
}

export function moveAnchor(subs: SubPath[], ref: AnchorRef, to: Pt): SubPath[] {
  const out = clone(subs)
  const s = out[ref.sub]
  const from = anchorPos(s, ref.idx)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const shift = (p: Pt): void => {
    p.x += dx
    p.y += dy
  }
  if (ref.idx === 0) {
    shift(s.start)
    if (s.closed && s.segs.length) shift(s.segs[s.segs.length - 1].p)
  } else {
    shift(s.segs[ref.idx - 1].p)
  }
  const i = inSeg(s, ref.idx)
  const o = outSeg(s, ref.idx)
  if (i >= 0) {
    const g = s.segs[i]
    if (g.kind === 'C') shift(g.c2)
    else g.c2 = { ...g.p }
  }
  if (o >= 0) {
    const g = s.segs[o]
    if (g.kind === 'C') shift(g.c1)
    else g.c1 = { ...anchorPos(s, ref.idx) }
  }
  return out
}

export function moveHandle(subs: SubPath[], ref: AnchorRef, side: HandleSide, to: Pt, mirror = false): SubPath[] {
  const out = clone(subs)
  const s = out[ref.sub]
  const a = anchorPos(s, ref.idx)
  const i = inSeg(s, ref.idx)
  const o = outSeg(s, ref.idx)
  const own = side === 'in' ? i : o
  const other = side === 'in' ? o : i
  if (own < 0) return subs
  const g = s.segs[own]
  g.kind = 'C'
  if (side === 'in') g.c2 = { ...to }
  else g.c1 = { ...to }
  if (mirror && other >= 0 && s.segs[other].kind === 'C') {
    const h = s.segs[other]
    const cur = side === 'in' ? h.c1 : h.c2
    const len = Math.hypot(cur.x - a.x, cur.y - a.y)
    const dx = a.x - to.x
    const dy = a.y - to.y
    const l = Math.hypot(dx, dy) || 1
    const p = { x: a.x + (dx / l) * len, y: a.y + (dy / l) * len }
    if (side === 'in') h.c1 = p
    else h.c2 = p
  }
  return out
}

/** Retracts both handles into the anchor (sharp corner). */
export function makeCorner(subs: SubPath[], ref: AnchorRef): SubPath[] {
  const out = clone(subs)
  const s = out[ref.sub]
  const a = anchorPos(s, ref.idx)
  const i = inSeg(s, ref.idx)
  const o = outSeg(s, ref.idx)
  if (i >= 0 && s.segs[i].kind === 'C') s.segs[i].c2 = { ...a }
  if (o >= 0 && s.segs[o].kind === 'C') s.segs[o].c1 = { ...a }
  return out
}

/** Makes the handles collinear, tangent to the neighbouring anchors. */
export function makeSmooth(subs: SubPath[], ref: AnchorRef): SubPath[] {
  const out = clone(subs)
  const s = out[ref.sub]
  const n = anchorCount(s)
  const a = anchorPos(s, ref.idx)
  const i = inSeg(s, ref.idx)
  const o = outSeg(s, ref.idx)
  const prev = i >= 0 ? (i === 0 ? s.start : s.segs[i - 1].p) : null
  const next = o >= 0 ? s.segs[o].p : null
  if (!prev && !next) return subs
  const from = prev ?? a
  const to = next ?? a
  let dx = to.x - from.x
  let dy = to.y - from.y
  const l = Math.hypot(dx, dy) || 1
  dx /= l
  dy /= l
  if (i >= 0 && prev) {
    const len = Math.hypot(a.x - prev.x, a.y - prev.y) / 3
    const g = s.segs[i]
    if (g.kind === 'L') {
      g.kind = 'C'
      g.c1 = { x: prev.x + (a.x - prev.x) / 3, y: prev.y + (a.y - prev.y) / 3 }
    }
    g.c2 = { x: a.x - dx * len, y: a.y - dy * len }
  }
  if (o >= 0 && next) {
    const len = Math.hypot(next.x - a.x, next.y - a.y) / 3
    const g = s.segs[o]
    if (g.kind === 'L') {
      g.kind = 'C'
      g.c2 = { x: next.x - (next.x - a.x) / 3, y: next.y - (next.y - a.y) / 3 }
    }
    g.c1 = { x: a.x + dx * len, y: a.y + dy * len }
  }
  void n
  return out
}

/** Turns the segment leaving the anchor into a straight line or a curve. */
export function setSegmentKind(subs: SubPath[], ref: AnchorRef, kind: 'L' | 'C'): SubPath[] {
  const out = clone(subs)
  const s = out[ref.sub]
  const o = outSeg(s, ref.idx)
  if (o < 0) return subs
  const g = s.segs[o]
  const a = anchorPos(s, ref.idx)
  if (kind === 'L') {
    g.kind = 'L'
    g.c1 = { ...a }
    g.c2 = { ...g.p }
  } else if (g.kind === 'L') {
    g.kind = 'C'
    g.c1 = { x: a.x + (g.p.x - a.x) / 3, y: a.y + (g.p.y - a.y) / 3 }
    g.c2 = { x: a.x + ((g.p.x - a.x) * 2) / 3, y: a.y + ((g.p.y - a.y) * 2) / 3 }
  }
  return out
}

export function translate(subs: SubPath[], dx: number, dy: number): SubPath[] {
  const out = clone(subs)
  const sh = (p: Pt): void => {
    p.x += dx
    p.y += dy
  }
  for (const s of out) {
    sh(s.start)
    for (const g of s.segs) {
      sh(g.c1)
      sh(g.c2)
      sh(g.p)
    }
  }
  return out
}
