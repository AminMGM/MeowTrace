import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { IMAGE_EXTENSIONS } from '@shared/api'
import { commitDoc, copySvg, openDialog, openImage, openPath, redo, saveAs, undo } from './lib/actions'
import { getState, setState, toast, useStore } from './lib/store'
import type { Tool, ViewMode } from './lib/store'
import { engine } from './engine/pool'
import { BatchView } from './components/BatchView'
import { SettingsDialog, TitleBar, Toasts } from './components/Chrome'
import { RightPanel } from './components/RightPanel'
import { Sidebar } from './components/Sidebar'
import { TOOLS, VIEWS, Viewer } from './components/Viewer'
import { Icon } from './components/Icon'

function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '')
}

export function App(): JSX.Element {
  const page = useStore((s) => s.page)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void engine.warmup()
    const handle = (paths: string[]): void => {
      if (paths.length === 1) void openPath(paths[0])
      else if (paths.length > 1) {
        setState({ page: 'batch' })
        setTimeout(() => window.dispatchEvent(new CustomEvent('meow:batch-add', { detail: paths })), 50)
      }
    }
    const off = window.meow.onOpenFiles(handle)
    void window.meow.takePendingFiles().then(handle)
    return off
  }, [])

  // Paste an image from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (file) {
        e.preventDefault()
        void openImage(file, `pasted-image.${file.type.split('/')[1] || 'png'}`)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t?.closest('input, textarea, select')) return
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (ctrl && k === 'o') {
        e.preventDefault()
        void openDialog()
      } else if (ctrl && k === 's') {
        e.preventDefault()
        void saveAs()
      } else if (ctrl && e.shiftKey && k === 'c') {
        e.preventDefault()
        void copySvg()
      } else if (ctrl && (k === 'y' || (e.shiftKey && k === 'z'))) {
        e.preventDefault()
        redo()
      } else if (ctrl && k === 'z') {
        e.preventDefault()
        undo()
      } else if (ctrl && k === '0') {
        e.preventDefault()
        setState({ zoomCommand: { kind: 'fit', n: Date.now() } })
      } else if (ctrl && k === '1') {
        e.preventDefault()
        setState({ zoomCommand: { kind: 'actual', n: Date.now() } })
      } else if (!ctrl && (k === '+' || k === '=')) {
        setState({ zoomCommand: { kind: 'in', n: Date.now() } })
      } else if (!ctrl && k === '-') {
        setState({ zoomCommand: { kind: 'out', n: Date.now() } })
      } else if (k === 'escape') {
        setState({ selection: null })
      } else if ((k === 'delete' || k === 'backspace') && getState().selection && getState().tool === 'select') {
        const sel = getState().selection!
        const doc = getState().doc
        if (doc) {
          commitDoc({ ...doc, layers: doc.layers.map((l) => (l.id === sel.layerId ? { ...l, paths: l.paths.filter((p) => p.id !== sel.pathId) } : l)) })
          setState({ selection: null })
        }
      } else if (!ctrl && !e.altKey && getState().page === 'trace') {
        const view = VIEWS.find((v) => v.key === k)
        if (view) {
          setState({ view: view.id as ViewMode })
          return
        }
        const tool = TOOLS.find((x) => x.key === k)
        if (tool) setState({ tool: tool.id as Tool, ...(tool.seg ? { view: 'segments' as ViewMode } : {}) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (!files.length) return
    if (page === 'batch') return // BatchView handles its own drops
    const images = files.filter((f) => isImageName(f.name))
    if (files.length > 1 || images.length === 0) {
      const paths = files.map((f) => window.meowFiles.pathFor(f)).filter(Boolean)
      setState({ page: 'batch' })
      setTimeout(() => {
        void (async () => {
          const all: string[] = []
          for (const p of paths) {
            const inside = await window.meow.listImages(p).catch(() => [])
            all.push(...(inside.length ? inside : isImageName(p) ? [p] : []))
          }
          window.dispatchEvent(new CustomEvent('meow:batch-add', { detail: all }))
        })()
      }, 50)
      if (images.length === 0 && files.length === 1) toast('Folder added to the batch queue')
      return
    }
    const f = images[0]
    void openImage(f, f.name, window.meowFiles.pathFor(f) || undefined)
  }

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="ambient" aria-hidden="true">
        <i className="a1" />
        <i className="a2" />
        <i className="a3" />
      </div>
      <TitleBar />
      {page === 'trace' ? (
        <div className="workspace">
          <Sidebar />
          <Viewer />
          <RightPanel />
        </div>
      ) : (
        <BatchView />
      )}
      {dragging && page === 'trace' && (
        <div className="drop-hint">
          <div className="glass">
            <Icon name="image" size={36} />
            <span>Drop to trace · drop several files or a folder to batch</span>
          </div>
        </div>
      )}
      <SettingsDialog />
      <Toasts />
    </div>
  )
}
