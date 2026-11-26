// Minimal external store (useSyncExternalStore) — no state library needed.
import { useSyncExternalStore } from 'react'
import type { Analysis, Segmentation } from '@shared/engine'
import type { VDoc } from '@shared/document'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { TraceSettings } from '@shared/settings'
import type { AnimeStyleId } from '@shared/anime'
import type { SourceImage } from './image'
import { DEFAULT_EXPORT } from './exporting'
import type { ExportSettings } from './exporting'

export type ViewMode = 'vector' | 'original' | 'split' | 'overlay' | 'outline' | 'segments'
export type Tool = 'pan' | 'select' | 'node' | 'paint' | 'fill' | 'zap' | 'pick'
export type Busy = 'idle' | 'loading' | 'segmenting' | 'vectorizing'

export interface Snapshot {
  doc: VDoc | null
  seg: Segmentation | null
  segEdited: boolean
}

export interface Toast {
  id: number
  kind: 'info' | 'ok' | 'error'
  text: string
  action?: { label: string; run: () => void }
}

export interface Selection {
  layerId: string
  pathId: string
}

export interface State {
  page: 'trace' | 'batch'
  source: SourceImage | null
  analysis: Analysis | null
  settings: TraceSettings
  resolved: TraceSettings | null
  seg: Segmentation | null
  segEdited: boolean
  doc: VDoc | null
  past: Snapshot[]
  future: Snapshot[]
  busy: Busy
  error: string | null
  timings: { segment?: number; vectorize?: number }
  view: ViewMode
  split: number
  tool: Tool
  selection: Selection | null
  activeLabel: number
  brush: number
  exportSettings: ExportSettings
  toasts: Toast[]
  showSettings: boolean
  showAnime: boolean
  /** The image an anime conversion replaced, for "Back to original". */
  animeOriginal: { blob: Blob; name: string; path?: string; style: AnimeStyleId } | null
  zoomCommand: { kind: 'fit' | 'actual' | 'in' | 'out'; n: number } | null
}

const savedSettings = ((): TraceSettings => {
  try {
    const raw = localStorage.getItem('meowtrace.settings')
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<TraceSettings>) }
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS
})()

const savedExport = ((): ExportSettings => {
  try {
    const raw = localStorage.getItem('meowtrace.export')
    if (raw) return { ...DEFAULT_EXPORT, ...(JSON.parse(raw) as Partial<ExportSettings>) }
  } catch {
    /* ignore */
  }
  return DEFAULT_EXPORT
})()

let state: State = {
  page: 'trace',
  source: null,
  analysis: null,
  settings: savedSettings,
  resolved: null,
  seg: null,
  segEdited: false,
  doc: null,
  past: [],
  future: [],
  busy: 'idle',
  error: null,
  timings: {},
  view: 'vector',
  split: 0.5,
  tool: 'select',
  selection: null,
  activeLabel: 0,
  brush: 4,
  exportSettings: savedExport,
  toasts: [],
  showSettings: false,
  showAnime: false,
  animeOriginal: null,
  zoomCommand: null
}

const listeners = new Set<() => void>()

export function getState(): State {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  if ('settings' in next) localStorage.setItem('meowtrace.settings', JSON.stringify(state.settings))
  if ('exportSettings' in next) localStorage.setItem('meowtrace.export', JSON.stringify(state.exportSettings))
  for (const l of listeners) l()
}

export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

let toastSeq = 0
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 3800): void {
  const id = ++toastSeq
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text, action }] }))
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms)
}
