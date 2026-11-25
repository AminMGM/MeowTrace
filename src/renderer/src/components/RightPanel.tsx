import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { docStats } from '@shared/document'
import type { VDoc, VLayer } from '@shared/document'
import { toSvg } from '@shared/exporters/svg'
import type { AdobeApps } from '@shared/api'
import { commitDoc, commitSeg, copySvg, saveAs, sendTo, updateSettings } from '../lib/actions'
import { FORMATS, formatBytes } from '../lib/exporting'
import type { ExportFormat } from '../lib/exporting'
import { addColor, cloneSeg, mergeColor, paletteHex, setColor } from '../lib/labels'
import { getState, setState, toast, useStore } from '../lib/store'
import { Icon } from './Icon'
import { Section, Segmented, Slider, Toggle } from './ui'

function updateLayer(id: string, patch: Partial<VLayer>): void {
  const doc = getState().doc
  if (!doc) return
  commitDoc({ ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
}

function LayerRow({ layer, index, count, selected }: { layer: VLayer; index: number; count: number; selected: boolean }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const doc = useStore((s) => s.doc) as VDoc

  const move = (dir: 1 | -1): void => {
    const layers = doc.layers.slice()
    const j = index + dir
    if (j < 0 || j >= layers.length) return
    ;[layers[index], layers[j]] = [layers[j], layers[index]]
    commitDoc({ ...doc, layers })
  }
  const remove = (): void => {
    commitDoc({ ...doc, layers: doc.layers.filter((l) => l.id !== layer.id) })
    if (getState().selection?.layerId === layer.id) setState({ selection: null })
  }
  const mergeDown = (): void => {
    if (index === 0) return
    const below = doc.layers[index - 1]
    commitDoc({
      ...doc,
      layers: doc.layers
        .filter((l) => l.id !== layer.id)
        .map((l) => (l.id === below.id ? { ...l, paths: [...l.paths, ...layer.paths], area: l.area + layer.area } : l))
    })
    toast(`Merged “${layer.name}” into “${below.name}”`, 'ok')
  }

  return (
    <li className={`layer ${selected ? 'selected' : ''} ${layer.visible ? '' : 'hidden'}`}>
      <label className="layer-swatch" style={{ background: layer.color }} title="Change colour">
        <input type="color" value={layer.color} onChange={(e) => updateLayer(layer.id, { color: e.target.value })} />
      </label>
      <div className="layer-main" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <input
            autoFocus
            defaultValue={layer.name}
            onBlur={(e) => {
              setEditing(false)
              const v = e.target.value.trim()
              if (v && v !== layer.name) updateLayer(layer.id, { name: v })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span className="layer-name" title="Double-click to rename">
            {layer.name}
          </span>
        )}
        <span className="layer-meta">
          {layer.paths.length} {layer.paths.length === 1 ? 'shape' : 'shapes'}
          {layer.stroke ? ` · ${layer.strokeWidth.toFixed(1)}px stroke` : ''} · {layer.color}
        </span>
      </div>
      <div className="layer-actions">
        <button className="icon-btn" title="Move up" disabled={index === count - 1} onClick={() => move(1)}>
          <Icon name="up" size={14} />
        </button>
        <button className="icon-btn" title="Move down" disabled={index === 0} onClick={() => move(-1)}>
          <Icon name="down" size={14} />
        </button>
        <button className="icon-btn" title="Merge into layer below" disabled={index === 0} onClick={mergeDown}>
          <Icon name="merge" size={14} />
        </button>
        <button className="icon-btn" title={layer.locked ? 'Unlock' : 'Lock'} onClick={() => updateLayer(layer.id, { locked: !layer.locked })}>
          <Icon name={layer.locked ? 'lock' : 'unlock'} size={14} />
        </button>
        <button className="icon-btn" title={layer.visible ? 'Hide (not exported)' : 'Show'} onClick={() => updateLayer(layer.id, { visible: !layer.visible })}>
          <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={14} />
        </button>
        <button className="icon-btn danger" title="Delete layer" onClick={remove}>
          <Icon name="trash" size={14} />
        </button>
      </div>
    </li>
  )
}

function LayersSection(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  if (!doc) return <p className="muted small">Layers appear here after tracing.</p>
  const stats = docStats(doc)
  const layers = doc.layers.map((l, i) => ({ l, i })).reverse()
  return (
    <>
      <div className="stats">
        <span>
          <b>{stats.layers}</b> layers
        </span>
        <span>
          <b>{stats.paths}</b> shapes
        </span>
        <span>
          <b>{stats.nodes.toLocaleString()}</b> nodes
        </span>
      </div>
      <ul className="layers">
        {layers.map(({ l, i }) => (
          <LayerRow key={l.id} layer={l} index={i} count={doc.layers.length} selected={selection?.layerId === l.id} />
        ))}
      </ul>
      {selection && (
        <div className="row-buttons">
          <button
            className="btn ghost small"
            onClick={() => {
              const d = getState().doc
              if (!d) return
              commitDoc({
                ...d,
                layers: d.layers.map((l) => (l.id === selection.layerId ? { ...l, paths: l.paths.filter((p) => p.id !== selection.pathId) } : l))
              })
              setState({ selection: null })
            }}
          >
            <Icon name="trash" size={14} /> Delete shape
          </button>
          <select
            className="select small"
            value=""
            onChange={(e) => {
              const d = getState().doc
              const target = e.target.value
              if (!d || !target) return
              const from = d.layers.find((l) => l.id === selection.layerId)
              const path = from?.paths.find((p) => p.id === selection.pathId)
              if (!path) return
              commitDoc({
                ...d,
                layers: d.layers.map((l) =>
                  l.id === selection.layerId
                    ? { ...l, paths: l.paths.filter((p) => p.id !== path.id) }
                    : l.id === target
                      ? { ...l, paths: [...l.paths, path] }
                      : l
                )
              })
              setState({ selection: { layerId: target, pathId: path.id } })
            }}
          >
            <option value="">Move shape to…</option>
            {doc.layers
              .filter((l) => l.id !== selection.layerId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </div>
      )}
    </>
  )
}

function PaletteSection(): JSX.Element | null {
  const seg = useStore((s) => s.seg)
  const active = useStore((s) => s.activeLabel)
  const brush = useStore((s) => s.brush)
  const tool = useStore((s) => s.tool)
  const segEdited = useStore((s) => s.segEdited)
  const [mergeFrom, setMergeFrom] = useState<number | null>(null)
  const counts = useMemo(() => {
    if (!seg) return []
    const c = new Array<number>(seg.palette.length / 4).fill(0)
    const labels = seg.labels
    for (let i = 0; i < labels.length; i++) if (labels[i] < c.length) c[labels[i]]++
    return c
  }, [seg])
  if (!seg) return null
  const colors = paletteHex(seg)
  const total = seg.labels.length

  return (
    <Section title="Segments" aside={segEdited ? <span className="chip warn">edited</span> : null}>
      <p className="muted small">
        Paint, fill or zap regions, then the vectors update instantly — fix what the tracer got wrong without starting over.
      </p>
      <div className="seg-palette">
        {colors.map((c, i) => (
          <button
            key={i}
            className={`seg-color ${i === active ? 'on' : ''} ${mergeFrom === i ? 'merging' : ''}`}
            style={{ ['--c' as string]: c }}
            title={`${c} · ${((counts[i] / total) * 100).toFixed(1)}%${mergeFrom !== null ? ' — click to merge into this' : ''}`}
            onClick={() => {
              if (mergeFrom !== null && mergeFrom !== i) {
                const next = cloneSeg(seg)
                mergeColor(next, mergeFrom, i)
                setMergeFrom(null)
                void commitSeg(next)
                return
              }
              setState({ activeLabel: i })
            }}
          >
            <span className="dot" />
            <span className="pct">{((counts[i] / total) * 100).toFixed(counts[i] / total < 0.1 ? 1 : 0)}%</span>
          </button>
        ))}
        <label className="seg-color add" title="Add a colour to paint with">
          <Icon name="plus" size={14} />
          <input
            type="color"
            onChange={(e) => {
              const { seg: next, index } = addColor(cloneSeg(seg), e.target.value)
              setState({ seg: next, activeLabel: index })
            }}
          />
        </label>
      </div>
      <div className="row-buttons">
        <label className="btn ghost small color-btn">
          Recolour
          <input
            type="color"
            value={colors[active] ?? '#000000'}
            onChange={(e) => {
              const next = cloneSeg(seg)
              setColor(next, active, e.target.value)
              void commitSeg(next)
            }}
          />
        </label>
        <button className={`btn ghost small ${mergeFrom !== null ? 'on' : ''}`} onClick={() => setMergeFrom(mergeFrom === null ? active : null)}>
          {mergeFrom !== null ? 'Pick target…' : 'Merge into…'}
        </button>
        <button className="btn ghost small" onClick={() => updateSettings({ palette: colors, lockPalette: true })} title="Use these colours as a locked palette">
          Lock these
        </button>
      </div>
      {tool === 'paint' && <Slider label="Brush size" min={1} max={80} value={brush} format={(v) => `${v}px`} onChange={(v) => setState({ brush: v })} />}
    </Section>
  )
}

function ExportSection(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const ex = useStore((s) => s.exportSettings)
  const source = useStore((s) => s.source)
  const [adobe, setAdobe] = useState<AdobeApps | null>(null)
  useEffect(() => {
    void window.meow.adobeApps().then(setAdobe)
  }, [])
  const set = (patch: Partial<typeof ex>): void => setState({ exportSettings: { ...ex, ...patch } })

  const svgSize = useMemo(() => {
    if (!doc) return 0
    return toSvg(doc, { precision: ex.precision, mergePaths: ex.mergePaths }).length
  }, [doc, ex.precision, ex.mergePaths])

  const raster = ex.format === 'png' || ex.format === 'psd'
  const outW = source ? Math.round(source.width * ex.scale) : 0
  const outH = source ? Math.round(source.height * ex.scale) : 0

  return (
    <Section title="Export">
      <div className="formats">
        {FORMATS.map((f) => (
          <button key={f.id} className={`fmt ${ex.format === f.id ? 'on' : ''}`} title={f.hint} onClick={() => set({ format: f.id as ExportFormat })}>
            {f.label}
          </button>
        ))}
      </div>
      <p className="muted small">{FORMATS.find((f) => f.id === ex.format)?.hint}</p>
      <span className="field-label">
        Size {source && <b className="muted">{outW}×{outH}{raster ? ' px' : ex.format === 'svg' ? ' px' : ' pt'}</b>}
      </span>
      <Segmented
        small
        value={ex.scale}
        onChange={(v) => set({ scale: v })}
        options={[
          { value: 0.5, label: '½×' },
          { value: 1, label: '1×' },
          { value: 2, label: '2×' },
          { value: 4, label: '4×' },
          { value: 8, label: '8×' }
        ]}
      />
      <span className="field-label">Background</span>
      <div className="bg-row">
        <Segmented
          small
          value={ex.background === null ? 'none' : ex.background === '#ffffff' ? 'white' : 'custom'}
          onChange={(v) => set({ background: v === 'none' ? null : v === 'white' ? '#ffffff' : (ex.background ?? '#111111') })}
          options={[
            { value: 'none', label: 'Transparent' },
            { value: 'white', label: 'White' },
            { value: 'custom', label: 'Colour' }
          ]}
        />
        {ex.background && ex.background !== '#ffffff' && (
          <input type="color" className="mini-color" value={ex.background} onChange={(e) => set({ background: e.target.value })} />
        )}
      </div>
      {ex.format === 'svg' && (
        <>
          <Toggle label="Optimise: one path per layer" checked={ex.mergePaths} onChange={(v) => set({ mergePaths: v })} />
          <Slider label="Precision" min={0} max={4} value={ex.precision} format={(v) => `${v} dp`} onChange={(v) => set({ precision: v })} />
          <p className="muted small">≈ {formatBytes(svgSize)} SVG</p>
        </>
      )}
      <Toggle label="Include hidden layers" checked={ex.includeHidden} onChange={(v) => set({ includeHidden: v })} />
      <div className="export-actions">
        <button className="btn primary" disabled={!doc} onClick={() => void saveAs()}>
          <Icon name="save" size={16} /> Save {ex.format.toUpperCase()}
        </button>
        <button className="btn ghost" disabled={!doc} onClick={() => void copySvg()} title="Copy SVG (Ctrl+Shift+C)">
          <Icon name="copy" size={16} /> Copy
        </button>
      </div>
      <div className="send-row">
        <button className="btn send ai" disabled={!doc} onClick={() => void sendTo('illustrator')} title={adobe?.illustrator ?? 'Illustrator not found — opens with the default app'}>
          <span className="badge-ai">Ai</span> Send to Illustrator
        </button>
        <button className="btn send ps" disabled={!doc} onClick={() => void sendTo('photoshop')} title={adobe?.photoshop ?? 'Photoshop not found — opens with the default app'}>
          <span className="badge-ps">Ps</span> Send to Photoshop
        </button>
      </div>
    </Section>
  )
}

export function RightPanel(): JSX.Element {
  const view = useStore((s) => s.view)
  const tool = useStore((s) => s.tool)
  const segMode = view === 'segments' || tool === 'paint' || tool === 'fill' || tool === 'zap' || tool === 'pick'
  return (
    <aside className="panel right glass">
      <div className="panel-scroll">
        {segMode && <PaletteSection />}
        <Section title="Layers" aside={<Icon name="layers" size={14} />}>
          <LayersSection />
        </Section>
        <ExportSection />
      </div>
    </aside>
  )
}
