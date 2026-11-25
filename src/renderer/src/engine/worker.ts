/// <reference lib="webworker" />
// Runs the WASM tracing core off the UI thread.
import { Core } from '@shared/engine'
import type { Segmentation } from '@shared/engine'
import { lockedPaletteBytes, resolveSettings, toOptionArray } from '@shared/settings'
import type { TraceSettings } from '@shared/settings'

export type WorkerRequest =
  | { id: number; type: 'init'; module: WebAssembly.Module }
  | { id: number; type: 'analyze'; rgba: Uint8ClampedArray; width: number; height: number }
  | { id: number; type: 'segment'; rgba: Uint8ClampedArray; width: number; height: number; options: Float64Array; palette: Uint8Array }
  | { id: number; type: 'vectorize'; seg: Segmentation; options: Float64Array }
  | { id: number; type: 'trace'; rgba: Uint8ClampedArray; width: number; height: number; settings: TraceSettings; scale: number }

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

const scope = self as unknown as DedicatedWorkerGlobalScope
let core: Core | null = null

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  try {
    let result: unknown
    const transfer: Transferable[] = []
    if (msg.type === 'init') {
      core = await Core.create(msg.module)
      result = true
    } else {
      if (!core) throw new Error('Engine not initialised')
      switch (msg.type) {
        case 'analyze':
          result = core.analyze(msg.rgba, msg.width, msg.height)
          break
        case 'segment': {
          const seg = core.segment(msg.rgba, msg.width, msg.height, msg.options, msg.palette)
          transfer.push(seg.labels.buffer, seg.palette.buffer)
          result = seg
          break
        }
        case 'vectorize':
          result = core.vectorize(msg.seg, msg.options)
          break
        case 'trace': {
          const analysis = core.analyze(msg.rgba, msg.width, msg.height)
          const s = resolveSettings(msg.settings, analysis)
          const opts = toOptionArray(s, msg.width, msg.height, msg.scale)
          const seg = core.segment(msg.rgba, msg.width, msg.height, opts, lockedPaletteBytes(s))
          result = { analysis, raw: core.vectorize(seg, opts) }
          break
        }
      }
    }
    scope.postMessage({ id: msg.id, ok: true, result } satisfies WorkerResponse, transfer)
  } catch (error) {
    // A trap leaves the instance in an unknown state; the pool recreates us.
    scope.postMessage({ id: msg.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse)
  }
}
