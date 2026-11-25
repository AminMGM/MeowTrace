// Worker pool around the WASM core.
// - `interactive` lane: one worker; a newer request cancels the running one
//   (by terminating the worker), so slider drags never queue up stale work.
// - `batch` lanes: several workers processing a queue in parallel.

import { CORE_WASM_BASE64 } from './core-wasm'
import EngineWorker from './worker?worker&inline'
import type { Analysis, RawTrace, Segmentation } from '@shared/engine'
import type { TraceSettings } from '@shared/settings'
import type { WorkerRequest, WorkerResponse } from './worker'

let modulePromise: Promise<WebAssembly.Module> | null = null

function wasmModule(): Promise<WebAssembly.Module> {
  if (!modulePromise) {
    const bin = atob(CORE_WASM_BASE64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    modulePromise = WebAssembly.compile(bytes)
  }
  return modulePromise
}

type Payload = DistributiveOmit<WorkerRequest, 'id'>
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
  }
}

class Lane {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private active = 0
  /** Set by the batch pool to reserve the lane before run() starts. */
  reserved = false
  get busy(): boolean {
    return this.active > 0 || this.reserved
  }

  private spawn(): Promise<void> {
    const w = new EngineWorker()
    this.worker = w
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.result)
      else {
        p.reject(new Error(e.data.error))
        // Recreate after a failure so a trapped instance is never reused.
        this.reset()
      }
    }
    w.onerror = (e) => {
      const err = new Error(e.message || 'Engine crashed')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.reset()
    }
    this.ready = wasmModule().then((module) => this.raw({ type: 'init', module }).then(() => undefined))
    return this.ready
  }

  private raw(msg: Payload, transfer: Transferable[] = []): Promise<unknown> {
    const worker = this.worker
    if (!worker) return Promise.reject(new CancelledError())
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ ...msg, id }, transfer)
    })
  }

  async run<T>(msg: Payload, transfer: Transferable[] = []): Promise<T> {
    this.active++
    this.reserved = false
    try {
      if (!this.worker) await this.spawn()
      else await this.ready
      return (await this.raw(msg, transfer)) as T
    } finally {
      this.active--
    }
  }

  /** Kills the worker; anything running rejects with CancelledError. */
  reset(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    for (const p of this.pending.values()) p.reject(new CancelledError())
    this.pending.clear()
  }
}

const interactive = new Lane()

export const engine = {
  /** Cancels whatever the interactive lane is doing. */
  cancel(): void {
    if (interactive.busy) interactive.reset()
  },
  analyze(rgba: Uint8ClampedArray, width: number, height: number): Promise<Analysis> {
    return interactive.run({ type: 'analyze', rgba, width, height })
  },
  segment(rgba: Uint8ClampedArray, width: number, height: number, options: Float64Array, palette: Uint8Array): Promise<Segmentation> {
    if (interactive.busy) interactive.reset()
    return interactive.run({ type: 'segment', rgba, width, height, options, palette })
  },
  vectorize(seg: Segmentation, options: Float64Array): Promise<RawTrace> {
    if (interactive.busy) interactive.reset()
    return interactive.run({ type: 'vectorize', seg, options })
  },
  warmup(): Promise<void> {
    return wasmModule().then(() => undefined)
  }
}

export class BatchPool {
  private lanes: Lane[]
  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    this.lanes = Array.from({ length: size }, () => new Lane())
  }
  get size(): number {
    return this.lanes.length
  }
  /** Runs `fn` with a free lane (waits for one). */
  private async free(): Promise<Lane> {
    for (;;) {
      const lane = this.lanes.find((l) => !l.busy)
      if (lane) {
        lane.reserved = true
        return lane
      }
      await new Promise((r) => setTimeout(r, 15))
    }
  }
  async trace(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    settings: TraceSettings,
    scale: number
  ): Promise<{ analysis: Analysis; raw: RawTrace }> {
    const lane = await this.free()
    return lane.run({ type: 'trace', rgba, width, height, settings, scale }, [rgba.buffer])
  }
  dispose(): void {
    for (const l of this.lanes) l.reset()
  }
}
