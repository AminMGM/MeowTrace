// Canvas: zoom/pan, view modes, selection/move, segmentation painting and
// the node editor overlay.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { VDoc, VLayer } from '@shared/document'
import type { Segmentation } from '@shared/engine'
import { parsePath, serializePath } from '@shared/path'
import { translate } from '@shared/nodes'
import type { Pt } from '@shared/path'
import { commitDoc, commitSeg, openDialog } from '../lib/actions'
import { cloneSeg, fillRegion, labelAt, paintStroke, segToImageData, zapRegion, TRANSPARENT } from '../lib/labels'
import { getState, setState, useStore } from '../lib/store'
import type { Tool, ViewMode } from '../lib/store'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { NodeOverlay } from './NodeOverlay'
import markUrl from '../assets/mark.png'

const VIEWS: { id: ViewMode; label: string; key: string; icon: IconName }[] = [
  { id: 'vector', label: 'Vector', key: '1', icon: 'sparkle' },
  { id: 'original', label: 'Original', key: '2', icon: 'image' },
  { id: 'split', label: 'Split', key: '3', icon: 'split' },
  { id: 'overlay', label: 'Overlay', key: '4', icon: 'layers' },
  { id: 'outline', label: 'Outline', key: '5', icon: 'outline' },
  { id: 'segments', label: 'Segments', key: '6', icon: 'fill' }
]

const TOOLS: { id: Tool; label: string; key: string; icon: IconName; seg?: boolean }[] = [
  { id: 'select', label: 'Select & move (V)', key: 'v', icon: 'select' },
  { id: 'node', label: 'Edit nodes (A)', key: 'a', icon: 'node' },
  { id: 'pan', label: 'Pan (H, or hold Space)', key: 'h', icon: 'pan' },
  { id: 'paint', label: 'Paint segments (B)', key: 'b', icon: 'brush', seg: true },
  { id: 'fill', label: 'Fill region (G)', key: 'g', icon: 'fill', seg: true },
  { id: 'zap', label: 'Zap region — merge into neighbours (X)', key: 'x', icon: 'zap', seg: true },
  { id: 'pick', label: 'Pick colour (I)', key: 'i', icon: 'pick', seg: true }
]

export { VIEWS, TOOLS }

const LayerG = memo(function LayerG({
  layer,
  outline,
  moving
}: {
  layer: VLayer
  outline: boolean
  moving: { pathId: string; dx: number; dy: number } | null
}): JSX.Element | null {
  if (!layer.visible) return null
  const paint = outline
    ? { fill: 'none', stroke: 'var(--outline)', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const }
    : layer.stroke
      ? { fill: 'none', stroke: layer.color, strokeWidth: layer.strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
      : { fill: layer.color, fillRule: 'evenodd' as const }
  return (
    <g {...paint} data-layer={layer.id}>
      {layer.paths.map((p) => (
        <path
          key={p.id}
          d={p.d}
          data-path={p.id}
          transform={moving && moving.pathId === p.id ? `translate(${moving.dx} ${moving.dy})` : undefined}
        />
      ))}
    </g>
  )
})

function SegCanvas({ seg, canvasRef }: { seg: Segmentation; canvasRef: React.RefObject<HTMLCanvasElement | null> }): JSX.Element {
  useLayoutEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = seg.width
    c.height = seg.height
    c.getContext('2d')!.putImageData(segToImageData(seg), 0, 0)
  }, [seg, canvasRef])
  return <canvas ref={canvasRef} className="seg-canvas" />
}

export function Viewer(): JSX.Element {
  const source = useStore((s) => s.source)
  const doc = useStore((s) => s.doc)
  const seg = useStore((s) => s.seg)
  const view = useStore((s) => s.view)
  const split = useStore((s) => s.split)
  const tool = useStore((s) => s.tool)
  const selection = useStore((s) => s.selection)
  const busy = useStore((s) => s.busy)
  const brush = useStore((s) => s.brush)
  const zoomCommand = useStore((s) => s.zoomCommand)
  const activeLabel = useStore((s) => s.activeLabel)

  const wrap = useRef<HTMLDivElement>(null)
  const segCanvas = useRef<HTMLCanvasElement>(null)
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 })
  const camRef = useRef(cam)
  camRef.current = cam
  const [spaceDown, setSpaceDown] = useState(false)
  const [moving, setMoving] = useState<{ layerId: string; pathId: string; dx: number; dy: number } | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const gesture = useRef<
    | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
    | { kind: 'move'; start: Pt; layerId: string; pathId: string }
    | { kind: 'paint'; seg: Segmentation; last: Pt }
    | { kind: 'split' }
    | null
  >(null)

  const W = doc?.width ?? source?.width ?? 1
  const H = doc?.height ?? source?.height ?? 1

  const fit = useCallback(() => {
    const el = wrap.current
    if (!el) return
    const pad = 48
    const z = Math.min((el.clientWidth - pad * 2) / W, (el.clientHeight - pad * 2) / H, 8)
    setCam({ z, x: (el.clientWidth - W * z) / 2, y: (el.clientHeight - H * z) / 2 })
  }, [W, H])

  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const el = wrap.current
    if (!el) return
    const c = camRef.current
    const z = Math.min(64, Math.max(0.02, c.z * factor))
    const ox = px ?? el.clientWidth / 2
    const oy = py ?? el.clientHeight / 2
    setCam({ z, x: ox - ((ox - c.x) * z) / c.z, y: oy - ((oy - c.y) * z) / c.z })
  }, [])

  useEffect(() => {
    if (!zoomCommand) return
    if (zoomCommand.kind === 'fit') requestAnimationFrame(fit)
    else if (zoomCommand.kind === 'actual') zoomAt(1 / camRef.current.z)
    else zoomAt(zoomCommand.kind === 'in' ? 1.25 : 0.8)
  }, [zoomCommand, fit, zoomAt])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (getState().source && camRef.current.z === 1 && camRef.current.x === 0) fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input, textarea, button')) {
        setSpaceDown(true)
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        if (!e.ctrlKey && e.shiftKey) {
          setCam((c) => ({ ...c, x: c.x - e.deltaY }))
          return
        }
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top)
      } else {
        setCam((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const toDoc = useCallback((clientX: number, clientY: number): Pt => {
    const rect = wrap.current!.getBoundingClientRect()
    const c = camRef.current
    return { x: (clientX - rect.left - c.x) / c.z, y: (clientY - rect.top - c.y) / c.z }
  }, [])

  const toLabel = (p: Pt, s: Segmentation): Pt => ({ x: (p.x / W) * s.width, y: (p.y / H) * s.height })

  const redrawSeg = (s: Segmentation): void => {
    const c = segCanvas.current
    if (c) c.getContext('2d')!.putImageData(segToImageData(s), 0, 0)
  }

  const segTool = tool === 'paint' || tool === 'fill' || tool === 'zap' || tool === 'pick'

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!source) return
    const panning = e.button === 1 || tool === 'pan' || spaceDown
    if (panning) {
      e.preventDefault()
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }
      return
    }
    if (e.button !== 0) return
    const p = toDoc(e.clientX, e.clientY)

    if (segTool && seg) {
      const lp = toLabel(p, seg)
      const lx = Math.floor(lp.x)
      const ly = Math.floor(lp.y)
      if (tool === 'pick') {
        const l = labelAt(seg, lx, ly)
        if (l !== TRANSPARENT) setState({ activeLabel: l })
        return
      }
      if (tool === 'fill' || tool === 'zap') {
        const next = cloneSeg(seg)
        const changed = tool === 'fill' ? fillRegion(next, lx, ly, activeLabel) : zapRegion(next, lx, ly)
        if (changed) void commitSeg(next)
        return
      }
      // paint
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      const work = cloneSeg(seg)
      const radius = brush * (seg.width / W)
      paintStroke(work, lp.x, lp.y, lp.x, lp.y, radius, activeLabel)
      redrawSeg(work)
      gesture.current = { kind: 'paint', seg: work, last: lp }
      return
    }

    const target = e.target as Element
    const pathId = target.getAttribute?.('data-path')
    const layerId = target.parentElement?.getAttribute('data-layer')
    if (tool === 'select' || tool === 'node') {
      if (pathId && layerId) {
        const layer = doc?.layers.find((l) => l.id === layerId)
        setState({ selection: { layerId, pathId } })
        if (tool === 'select' && layer && !layer.locked) {
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          gesture.current = { kind: 'move', start: p, layerId, pathId }
        }
      } else if (!target.closest('.node-overlay')) {
        setState({ selection: null })
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const g = gesture.current
    if (segTool && seg) setCursor(toDoc(e.clientX, e.clientY))
    if (!g) return
    if (g.kind === 'pan') {
      setCam((c) => ({ ...c, x: g.cx + e.clientX - g.sx, y: g.cy + e.clientY - g.sy }))
    } else if (g.kind === 'move') {
      const p = toDoc(e.clientX, e.clientY)
      setMoving({ layerId: g.layerId, pathId: g.pathId, dx: p.x - g.start.x, dy: p.y - g.start.y })
    } else if (g.kind === 'paint' && seg) {
      const lp = toLabel(toDoc(e.clientX, e.clientY), g.seg)
      paintStroke(g.seg, g.last.x, g.last.y, lp.x, lp.y, brush * (g.seg.width / W), activeLabel)
      g.last = lp
      redrawSeg(g.seg)
    } else if (g.kind === 'split') {
      const rect = wrap.current!.getBoundingClientRect()
      setState({ split: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) })
    }
  }

  const onPointerUp = (): void => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (g.kind === 'move' && moving && doc && (Math.abs(moving.dx) > 0.01 || Math.abs(moving.dy) > 0.01)) {
      const prec = Math.max(2, getState().settings.precision)
      const next: VDoc = {
        ...doc,
        layers: doc.layers.map((l) =>
          l.id !== moving.layerId
            ? l
            : { ...l, paths: l.paths.map((p) => (p.id === moving.pathId ? { ...p, d: serializePath(translate(parsePath(p.d), moving.dx, moving.dy), prec) } : p)) }
        )
      }
      commitDoc(next)
    }
    if (g.kind === 'paint') void commitSeg(g.seg)
    setMoving(null)
  }

  if (!source) {
    return (
      <main className="viewer empty" ref={wrap}>
        <div className="welcome glass">
          <img src={markUrl} alt="" className="welcome-mark" />
          <h1>
            Meow<span>Trace</span>
          </h1>
          <p>Turn any bitmap into clean, editable vectors — logos, photos, scans and line art.</p>
          <button className="btn primary big" onClick={() => void openDialog()}>
            <Icon name="open" /> Open image
          </button>
          <p className="muted small">or drop a file here · paste with Ctrl+V · PNG, JPG, WebP, BMP, GIF, AVIF</p>
        </div>
      </main>
    )
  }

  const showOriginal = view === 'original' || view === 'split' || view === 'overlay' || view === 'outline'
  const showVector = view !== 'original' && view !== 'segments'
  const selLayer = selection && doc?.layers.find((l) => l.id === selection.layerId)
  const selPath = selLayer?.paths.find((p) => p.id === selection?.pathId)
  const clip = view === 'split' ? `inset(0 0 0 ${split * 100}%)` : undefined
  const cursorClass = spaceDown || tool === 'pan' ? 'grab' : segTool ? 'crosshair' : tool === 'node' ? 'node' : 'default'

  return (
    <main
      className={`viewer cursor-${cursorClass} view-${view}`}
      ref={wrap}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
    >
      <div className="stage" style={{ width: W, height: H, transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
        <div className={`checker ${view === 'original' ? 'hidden' : ''}`} />
        {showOriginal && (
          <img
            className={`original ${cam.z > 2 ? 'pixelated' : ''} ${view === 'outline' ? 'faded' : ''}`}
            src={source.url}
            width={W}
            height={H}
            draggable={false}
            alt=""
          />
        )}
        {view === 'segments' && seg && <SegCanvas seg={seg} canvasRef={segCanvas} />}
        {showVector && doc && (
          <svg
            className={`vector ${view === 'overlay' ? 'overlay' : ''}`}
            viewBox={`0 0 ${doc.width} ${doc.height}`}
            width={W}
            height={H}
            style={{ clipPath: clip }}
          >
            {doc.layers.map((l) => (
              <LayerG key={l.id} layer={l} outline={view === 'outline'} moving={moving && moving.layerId === l.id ? moving : null} />
            ))}
            {selPath && tool !== 'node' && (
              <path
                className="sel-outline"
                d={selPath.d}
                transform={moving && moving.pathId === selPath.id ? `translate(${moving.dx} ${moving.dy})` : undefined}
              />
            )}
          </svg>
        )}
        {tool === 'node' && doc && selection && view !== 'segments' && (
          <NodeOverlay doc={doc} sel={selection} zoom={cam.z} toDoc={toDoc} host={wrap.current} />
        )}
        {segTool && tool === 'paint' && cursor && (
          <div
            className="brush-cursor"
            style={{ left: cursor.x - brush, top: cursor.y - brush, width: brush * 2, height: brush * 2, borderWidth: 1.5 / cam.z }}
          />
        )}
      </div>

      {view === 'split' && (
        <div
          className="split-handle"
          style={{ left: `${split * 100}%` }}
          onPointerDown={(e) => {
            e.stopPropagation()
            ;(e.currentTarget.parentElement as Element).setPointerCapture(e.pointerId)
            gesture.current = { kind: 'split' }
          }}
        >
          <span>
            <Icon name="split2" size={14} />
          </span>
        </div>
      )}
      {view === 'split' && (
        <>
          <span className="split-label left">Original</span>
          <span className="split-label right">Vector</span>
        </>
      )}

      {busy !== 'idle' && (
        <div className="busy glass">
          <span className="spinner" /> {busy === 'loading' ? 'Opening…' : busy === 'segmenting' ? 'Finding colours…' : 'Fitting curves…'}
        </div>
      )}

      <div className="toolbar glass" onPointerDown={(e) => e.stopPropagation()}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`icon-btn ${tool === t.id ? 'on' : ''} ${t.seg ? 'seg-tool' : ''}`}
            title={t.label}
            aria-label={t.label}
            onClick={() => setState({ tool: t.id, ...(t.seg ? { view: 'segments' as ViewMode } : {}) })}
          >
            <Icon name={t.icon} size={17} />
          </button>
        ))}
      </div>

      <div className="viewbar glass" onPointerDown={(e) => e.stopPropagation()}>
        {VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? 'on' : ''} title={`${v.label} (${v.key})`} onClick={() => setState({ view: v.id })}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="zoombar glass" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="Zoom out (−)" onClick={() => zoomAt(0.8)}>
          <Icon name="minus" size={15} />
        </button>
        <button className="zoom-val" title="Actual size (Ctrl+1)" onClick={() => zoomAt(1 / cam.z)}>
          {Math.round(cam.z * 100)}%
        </button>
        <button className="icon-btn" title="Zoom in (+)" onClick={() => zoomAt(1.25)}>
          <Icon name="plus" size={15} />
        </button>
        <button className="icon-btn" title="Fit (Ctrl+0)" onClick={fit}>
          <Icon name="fit" size={15} />
        </button>
      </div>
    </main>
  )
}
