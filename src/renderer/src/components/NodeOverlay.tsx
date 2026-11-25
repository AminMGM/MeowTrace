// Node editor overlay: drag anchors and handles, insert/delete anchors,
// corner/smooth/line/curve conversion. Lives inside the zoomed stage, so
// sizes are divided by the zoom factor to stay constant on screen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { deleteAnchor, insertAnchor, nearestOnPath, parsePath, serializePath } from '@shared/path'
import type { Pt, SubPath } from '@shared/path'
import {
  anchorCount,
  anchorPos,
  handles,
  makeCorner,
  makeSmooth,
  moveAnchor,
  moveHandle,
  setSegmentKind
} from '@shared/nodes'
import type { AnchorRef, HandleSide } from '@shared/nodes'
import type { VDoc } from '@shared/document'
import { uid } from '@shared/document'
import { commitDoc } from '../lib/actions'
import { getState, setState, toast } from '../lib/store'
import type { Selection } from '../lib/store'
import { Icon } from './Icon'

type Drag = { kind: 'anchor'; ref: AnchorRef } | { kind: 'handle'; ref: AnchorRef; side: HandleSide }

export function NodeOverlay({
  doc,
  sel,
  zoom,
  toDoc,
  host
}: {
  doc: VDoc
  sel: Selection
  zoom: number
  toDoc: (clientX: number, clientY: number) => Pt
  host: HTMLElement | null
}): JSX.Element | null {
  const layer = doc.layers.find((l) => l.id === sel.layerId)
  const path = layer?.paths.find((p) => p.id === sel.pathId)
  const original = useMemo(() => (path ? parsePath(path.d) : []), [path])
  const [subs, setSubs] = useState<SubPath[]>(original)
  const [active, setActive] = useState<AnchorRef | null>(null)
  const drag = useRef<Drag | null>(null)
  const dirty = useRef(false)
  const subsRef = useRef(subs)
  subsRef.current = subs

  useEffect(() => {
    setSubs(original)
    setActive(null)
  }, [original])

  const precision = getState().settings.precision

  const commit = (next: SubPath[]): void => {
    if (!layer || !path) return
    const d = serializePath(next, Math.max(2, precision))
    const st = getState()
    if (!st.doc) return
    const newDoc: VDoc = {
      ...st.doc,
      layers: st.doc.layers.map((l) =>
        l.id !== layer.id
          ? l
          : { ...l, paths: next.length ? l.paths.map((p) => (p.id === path.id ? { ...p, d } : p)) : l.paths.filter((p) => p.id !== path.id) }
      )
    }
    commitDoc(newDoc)
    if (!next.length) setState({ selection: null })
  }

  const apply = (fn: (s: SubPath[], r: AnchorRef) => SubPath[]): void => {
    if (!active) return
    const next = fn(subsRef.current, active)
    setSubs(next)
    commit(next)
  }

  const removeActive = (): void => {
    if (!active) return
    const next = deleteAnchor(subsRef.current, active.sub, active.idx)
    setActive(null)
    setSubs(next)
    commit(next)
  }

  const breakApart = (): void => {
    if (!layer || !path || subs.length < 2) return
    const st = getState()
    if (!st.doc) return
    const parts = subs.map((s) => ({ id: uid('p'), d: serializePath([s], Math.max(2, precision)) }))
    const newDoc: VDoc = {
      ...st.doc,
      layers: st.doc.layers.map((l) => {
        if (l.id !== layer.id) return l
        const idx = l.paths.findIndex((p) => p.id === path.id)
        const paths = l.paths.slice()
        paths.splice(idx, 1, ...parts)
        return { ...l, paths }
      })
    }
    commitDoc(newDoc)
    setState({ selection: { layerId: layer.id, pathId: parts[0].id } })
    toast(`Split into ${parts.length} paths`, 'ok')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && active) {
        e.preventDefault()
        e.stopPropagation()
        removeActive()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!layer || !path) return null

  const r = 4.5 / zoom
  const sw = 1.25 / zoom
  const d = serializePath(subs, 3)

  const startDrag = (e: React.PointerEvent, dg: Drag): void => {
    if (layer.locked) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = dg
    dirty.current = false
    setActive(dg.ref)
  }

  const onMove = (e: React.PointerEvent): void => {
    const dg = drag.current
    if (!dg) return
    const p = toDoc(e.clientX, e.clientY)
    dirty.current = true
    setSubs((cur) => (dg.kind === 'anchor' ? moveAnchor(cur, dg.ref, p) : moveHandle(cur, dg.ref, dg.side, p, e.altKey)))
  }

  const onUp = (): void => {
    if (drag.current && dirty.current) commit(subsRef.current)
    drag.current = null
  }

  const onDouble = (e: React.MouseEvent): void => {
    if (layer.locked) return
    e.stopPropagation()
    const q = toDoc(e.clientX, e.clientY)
    const hit = nearestOnPath(subs, q)
    if (!hit || hit.dist > 8 / zoom) return
    const next = insertAnchor(subs, hit.sub, hit.seg, hit.t)
    setSubs(next)
    setActive({ sub: hit.sub, idx: hit.seg + 1 })
    commit(next)
  }

  const activeHandles = active && subs[active.sub] ? handles(subs[active.sub], active.idx) : null
  const activePos = active && subs[active.sub] ? anchorPos(subs[active.sub], active.idx) : null

  return (
    <>
      <svg className="node-overlay" viewBox={`0 0 ${doc.width} ${doc.height}`} width={doc.width} height={doc.height} onPointerMove={onMove} onPointerUp={onUp}>
        <path d={d} fill="none" stroke="transparent" strokeWidth={10 / zoom} onDoubleClick={onDouble} style={{ cursor: 'copy' }} />
        <path d={d} fill="none" className="node-outline" strokeWidth={sw} pointerEvents="none" />
        {activePos && activeHandles && (
          <g className="node-handles">
            {(['in', 'out'] as HandleSide[]).map((side) => {
              const h = activeHandles[side]
              if (!h) return null
              return (
                <g key={side}>
                  <line x1={activePos.x} y1={activePos.y} x2={h.x} y2={h.y} strokeWidth={sw} />
                  <circle cx={h.x} cy={h.y} r={r * 0.85} strokeWidth={sw} onPointerDown={(e) => startDrag(e, { kind: 'handle', ref: active!, side })} />
                </g>
              )
            })}
          </g>
        )}
        {subs.map((s, si) =>
          Array.from({ length: anchorCount(s) }, (_, idx) => {
            const p = anchorPos(s, idx)
            const on = active?.sub === si && active.idx === idx
            return (
              <rect
                key={`${si}-${idx}`}
                className={`node-anchor ${on ? 'on' : ''}`}
                x={p.x - r}
                y={p.y - r}
                width={r * 2}
                height={r * 2}
                strokeWidth={sw}
                onPointerDown={(e) => startDrag(e, { kind: 'anchor', ref: { sub: si, idx } })}
              />
            )
          })
        )}
      </svg>
      {host && createPortal(
      <div className="node-toolbar glass" onPointerDown={(e) => e.stopPropagation()}>
        <span className="muted small">{layer.name}</span>
        <button className="icon-btn" title="Sharp corner" disabled={!active} onClick={() => apply(makeCorner)}>
          <Icon name="corner" size={16} />
        </button>
        <button className="icon-btn" title="Smooth node" disabled={!active} onClick={() => apply(makeSmooth)}>
          <Icon name="smooth" size={16} />
        </button>
        <button className="icon-btn" title="Straight segment" disabled={!active} onClick={() => apply((s, r2) => setSegmentKind(s, r2, 'L'))}>
          <Icon name="line" size={16} />
        </button>
        <button className="icon-btn" title="Curved segment" disabled={!active} onClick={() => apply((s, r2) => setSegmentKind(s, r2, 'C'))}>
          <Icon name="smooth" size={16} className="flip" />
        </button>
        <button className="icon-btn" title="Delete node (Del)" disabled={!active} onClick={removeActive}>
          <Icon name="minus" size={16} />
        </button>
        <span className="sep" />
        <button className="icon-btn" title="Break apart into separate paths" disabled={subs.length < 2} onClick={breakApart}>
          <Icon name="scissors" size={16} />
        </button>
        <span className="muted small">Double-click the outline to add a node · Alt-drag mirrors handles</span>
      </div>, host)}
    </>
  )
}
