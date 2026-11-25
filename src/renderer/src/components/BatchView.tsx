// Batch mode: many images, one preset, chosen formats, parallel workers.
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { rawToDocument } from '@shared/document'
import { KIND_LABELS } from '@shared/settings'
import { BatchPool } from '../engine/pool'
import { baseName, decodeImage } from '../lib/image'
import { FORMATS, exportDoc, formatBytes } from '../lib/exporting'
import type { ExportFormat } from '../lib/exporting'
import { getState, toast, useStore } from '../lib/store'
import { Icon } from './Icon'

type Status = 'queued' | 'working' | 'done' | 'error'

interface Item {
  path: string
  name: string
  status: Status
  message?: string
  outputs: string[]
  bytes?: number
  ms?: number
}

export function BatchView(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const ex = useStore((s) => s.exportSettings)
  const [items, setItems] = useState<Item[]>([])
  const [formats, setFormats] = useState<ExportFormat[]>(['svg'])
  const [outDir, setOutDir] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const stop = useRef(false)
  const pool = useRef<BatchPool | null>(null)

  useEffect(() => () => pool.current?.dispose(), [])

  const add = (paths: string[]): void => {
    setItems((cur) => {
      const known = new Set(cur.map((i) => i.path))
      const fresh = paths.filter((p) => !known.has(p)).map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p, status: 'queued' as Status, outputs: [] }))
      return [...cur, ...fresh]
    })
  }

  useEffect(() => {
    const onAdd = (e: Event): void => add((e as CustomEvent<string[]>).detail)
    window.addEventListener('meow:batch-add', onAdd)
    return () => window.removeEventListener('meow:batch-add', onAdd)
  }, [])

  const addFiles = async (): Promise<void> => {
    const files = await window.meow.openImages(true)
    add(files.map((f) => f.path))
  }
  const addFolder = async (): Promise<void> => {
    const dir = await window.meow.pickFolder()
    if (!dir) return
    const list = await window.meow.listImages(dir)
    if (!list.length) toast('No images found in that folder')
    add(list)
  }

  const update = (path: string, patch: Partial<Item>): void => setItems((cur) => cur.map((i) => (i.path === path ? { ...i, ...patch } : i)))

  const run = async (): Promise<void> => {
    const todo = items.filter((i) => i.status !== 'done')
    if (!todo.length) return
    setRunning(true)
    stop.current = false
    pool.current ??= new BatchPool()
    const p = pool.current
    const snapshot = { ...getState().settings }
    let done = 0
    let failed = 0
    const work = async (item: Item): Promise<void> => {
      if (stop.current) return
      update(item.path, { status: 'working', message: undefined })
      const t0 = performance.now()
      try {
        const file = await window.meow.readFile(item.path)
        const img = await decodeImage(file.bytes, file.name, file.path)
        URL.revokeObjectURL(img.url)
        const { raw } = await p.trace(img.rgba, img.pw, img.ph, snapshot, img.scale)
        const doc = rawToDocument(raw)
        const folder = outDir ?? item.path.replace(/[\\/][^\\/]*$/, '')
        const outputs: string[] = []
        let bytes = 0
        for (const f of formats) {
          const data = await exportDoc(doc, { ...ex, format: f }, baseName(file.name))
          bytes += typeof data === 'string' ? data.length : data.length
          outputs.push(await window.meow.writeOutput(folder, `${baseName(file.name)}.${f}`, data))
        }
        done++
        update(item.path, { status: 'done', outputs, bytes, ms: performance.now() - t0 })
      } catch (e) {
        failed++
        update(item.path, { status: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }
    // Feed the pool with as many concurrent jobs as it has lanes.
    const queue = todo.slice()
    const runners = Array.from({ length: p.size }, async () => {
      while (queue.length && !stop.current) await work(queue.shift()!)
    })
    await Promise.all(runners)
    setRunning(false)
    if (stop.current) toast('Batch stopped')
    else toast(`Batch finished: ${done} traced${failed ? `, ${failed} failed` : ''}`, failed ? 'error' : 'ok')
  }

  const total = items.length
  const finished = items.filter((i) => i.status === 'done' || i.status === 'error').length

  return (
    <main
      className="batch"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const paths = [...e.dataTransfer.files].map((f) => window.meowFiles.pathFor(f)).filter(Boolean)
        void (async () => {
          const all: string[] = []
          for (const p of paths) {
            const inside = await window.meow.listImages(p).catch(() => [])
            all.push(...(inside.length ? inside : [p]))
          }
          add(all)
        })()
      }}
    >
      <div className="batch-head glass">
        <div>
          <h2>Batch trace</h2>
          <p className="muted small">
            Uses your current settings ({KIND_LABELS[settings.kind]}, {settings.detail} detail
            {settings.lockPalette ? `, locked ${settings.palette.length}-colour palette` : ''}) on every image.
          </p>
        </div>
        <div className="batch-controls">
          <div className="formats">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                className={`fmt ${formats.includes(f.id) ? 'on' : ''}`}
                onClick={() => setFormats((cur) => (cur.includes(f.id) ? (cur.length > 1 ? cur.filter((x) => x !== f.id) : cur) : [...cur, f.id]))}
                title={f.hint}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button className="btn ghost small" onClick={async () => setOutDir(await window.meow.pickFolder())} title={outDir ?? 'Next to each source image'}>
            <Icon name="folder" size={14} /> {outDir ? `→ ${outDir.split(/[\\/]/).pop()}` : 'Output: next to source'}
          </button>
          {outDir && (
            <button className="icon-btn" title="Save next to each source instead" onClick={() => setOutDir(null)}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="batch-list glass">
        {items.length === 0 ? (
          <div className="batch-empty">
            <Icon name="layers" size={40} />
            <p>Drop images or folders here</p>
            <div className="row-buttons center">
              <button className="btn ghost" onClick={() => void addFiles()}>
                <Icon name="image" size={16} /> Add images
              </button>
              <button className="btn ghost" onClick={() => void addFolder()}>
                <Icon name="folder" size={16} /> Add folder
              </button>
            </div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Image</th>
                <th>Status</th>
                <th>Output</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.path} className={i.status}>
                  <td title={i.path}>{i.name}</td>
                  <td>
                    <span className={`status ${i.status}`}>
                      {i.status === 'working' && <span className="spinner small" />}
                      {i.status === 'done' ? `Done · ${Math.round(i.ms ?? 0)} ms` : i.status === 'error' ? i.message : i.status === 'working' ? 'Tracing…' : 'Queued'}
                    </span>
                  </td>
                  <td>{i.bytes ? formatBytes(i.bytes) : ''}</td>
                  <td className="actions">
                    {i.outputs[0] && (
                      <button className="icon-btn" title="Show in folder" onClick={() => void window.meow.reveal(i.outputs[0])}>
                        <Icon name="folder" size={14} />
                      </button>
                    )}
                    {!running && (
                      <button className="icon-btn" title="Remove" onClick={() => setItems((cur) => cur.filter((x) => x.path !== i.path))}>
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="batch-foot glass">
        <div className="progress">
          <div style={{ width: `${total ? (finished / total) * 100 : 0}%` }} />
        </div>
        <span className="muted small">
          {finished}/{total} · {pool.current?.size ?? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))} parallel workers
        </span>
        <div className="row-buttons">
          <button className="btn ghost small" disabled={running} onClick={() => void addFiles()}>
            <Icon name="plus" size={14} /> Images
          </button>
          <button className="btn ghost small" disabled={running} onClick={() => void addFolder()}>
            <Icon name="folder" size={14} /> Folder
          </button>
          <button className="btn ghost small" disabled={running || !items.length} onClick={() => setItems([])}>
            Clear
          </button>
          {running ? (
            <button className="btn danger" onClick={() => (stop.current = true)}>
              <Icon name="stop" size={14} /> Stop
            </button>
          ) : (
            <button className="btn primary" disabled={!items.some((i) => i.status !== 'done')} onClick={() => void run()}>
              <Icon name="play" size={14} /> Trace {items.filter((i) => i.status !== 'done').length || ''}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
