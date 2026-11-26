// Runs an AnimeGAN model off the main thread (Node worker_threads).
// Input and output are RGBA at the model's working size; the renderer does
// the resizing with canvas.
import { parentPort } from 'node:worker_threads'
import { cpus } from 'node:os'
import { readFile } from 'node:fs/promises'
import * as ort from 'onnxruntime-web'

interface RunRequest {
  id: number
  model: string
  layout: 'nhwc' | 'nchw'
  width: number
  height: number
  rgba: Uint8Array
}

ort.env.wasm.numThreads = Math.max(1, Math.min(8, cpus().length - 1))

const sessions = new Map<string, Promise<ort.InferenceSession>>()

function session(model: string): Promise<ort.InferenceSession> {
  let s = sessions.get(model)
  if (!s) {
    s = readFile(model).then((bytes) => ort.InferenceSession.create(bytes))
    s.catch(() => sessions.delete(model))
    sessions.set(model, s)
  }
  return s
}

async function run(req: RunRequest): Promise<Uint8Array> {
  const { width: w, height: h, rgba, layout } = req
  const n = w * h
  const input = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = rgba[i * 4 + c] / 127.5 - 1
      if (layout === 'nhwc') input[i * 3 + c] = v
      else input[c * n + i] = v
    }
  }
  const s = await session(req.model)
  const dims = layout === 'nhwc' ? [1, h, w, 3] : [1, 3, h, w]
  const result = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, dims) })
  const out = result[s.outputNames[0]].data as Float32Array
  const px = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = layout === 'nhwc' ? out[i * 3 + c] : out[c * n + i]
      px[i * 4 + c] = Math.max(0, Math.min(255, Math.round((v + 1) * 127.5)))
    }
    px[i * 4 + 3] = rgba[i * 4 + 3]
  }
  return px
}

parentPort?.on('message', (req: RunRequest) => {
  run(req).then(
    (rgba) => parentPort?.postMessage({ id: req.id, rgba }, [rgba.buffer as ArrayBuffer]),
    (error: unknown) => parentPort?.postMessage({ id: req.id, error: error instanceof Error ? error.message : String(error) })
  )
})
