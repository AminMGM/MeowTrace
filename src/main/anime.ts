// "Turn into anime": model downloads (verified by SHA-256) and inference in a
// worker thread. Models live in <userData>/models, or in MEOW_ANIME_MODELS
// when the end-to-end test points at a local copy.
import { app, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import workerPath from './anime-worker?modulePath'
import { ANIME_STYLES } from '../shared/anime'
import type { AnimeModelStatus, AnimeStyle, AnimeStyleId } from '../shared/anime'

function modelsDir(): string {
  return process.env['MEOW_ANIME_MODELS'] || path.join(app.getPath('userData'), 'models')
}

function styleOf(id: AnimeStyleId): AnimeStyle {
  const s = ANIME_STYLES.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown anime style: ${id}`)
  return s
}

function modelPath(s: AnimeStyle): string {
  return path.join(modelsDir(), s.file)
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}

const downloads = new Map<AnimeStyleId, Promise<void>>()

async function download(s: AnimeStyle, sender: WebContents): Promise<void> {
  await mkdir(modelsDir(), { recursive: true })
  const final = modelPath(s)
  const part = `${final}.part`
  const res = await fetch(s.url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status} ${res.statusText})`)
  const total = Number(res.headers.get('content-length')) || s.bytes
  const out = createWriteStream(part)
  let received = 0
  let last = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      const now = Date.now()
      if (now - last > 120) {
        last = now
        if (!sender.isDestroyed()) sender.send('anime:progress', { id: s.id, received, total })
      }
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
    const hash = await sha256(part)
    if (hash !== s.sha256) throw new Error('The downloaded model did not match its checksum, so it was discarded. Please try again.')
    await rename(part, final)
  } catch (error) {
    out.destroy()
    await rm(part, { force: true })
    throw error
  }
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: Uint8Array) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  // Packaged: the worker (and onnxruntime-web) are unpacked from the asar,
  // because worker threads cannot start from inside the archive.
  const w = new Worker(workerPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`))
  w.on('message', (msg: { id: number; rgba?: Uint8Array; error?: string }) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.rgba) p.resolve(msg.rgba)
    else p.reject(new Error(msg.error ?? 'Anime conversion failed'))
  })
  w.on('error', (e: Error) => {
    for (const p of pending.values()) p.reject(e)
    pending.clear()
    worker = null
  })
  w.on('exit', () => {
    worker = null
  })
  worker = w
  return w
}

export function registerAnimeIpc(): void {
  ipcMain.handle('anime:status', (): AnimeModelStatus[] =>
    ANIME_STYLES.map((s) => ({ id: s.id, downloaded: existsSync(modelPath(s)) }))
  )

  ipcMain.handle('anime:download', async (event, id: AnimeStyleId) => {
    const s = styleOf(id)
    if (existsSync(modelPath(s))) return
    let job = downloads.get(id)
    if (!job) {
      job = download(s, event.sender).finally(() => downloads.delete(id))
      downloads.set(id, job)
    }
    await job
  })

  ipcMain.handle('anime:delete', async (_event, id: AnimeStyleId) => {
    await rm(modelPath(styleOf(id)), { force: true })
  })

  ipcMain.handle('anime:run', async (_event, id: AnimeStyleId, rgba: Uint8Array, width: number, height: number) => {
    const s = styleOf(id)
    const model = modelPath(s)
    if (!existsSync(model)) throw new Error(`The ${s.name} model is not downloaded yet.`)
    if (rgba.byteLength !== width * height * 4) throw new Error('Bad image buffer')
    const reqId = nextId++
    return new Promise<Uint8Array>((resolve, reject) => {
      pending.set(reqId, { resolve, reject })
      getWorker().postMessage({ id: reqId, model, layout: s.layout, width, height, rgba })
    })
  })
}
