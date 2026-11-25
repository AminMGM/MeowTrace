// Local HTTP bridge for the optional Adobe UXP plugin (phase 2 "live push").
// Listens on 127.0.0.1 only. The plugin polls GET /latest and downloads
// GET /file/<id> to place the paths into the open document.

import { createServer } from 'node:http'
import type { Server } from 'node:http'

interface Pushed {
  id: string
  name: string
  target: string
  data: Buffer
  at: number
}

let server: Server | null = null
let latest: Pushed | null = null
let port = 0

const TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  ai: 'application/pdf',
  eps: 'application/postscript',
  psd: 'image/vnd.adobe.photoshop',
  png: 'image/png'
}

export function publishToBridge(name: string, data: Uint8Array | string, target: string): void {
  latest = {
    id: Date.now().toString(36),
    name,
    target,
    data: typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data),
    at: Date.now()
  }
}

export function bridgeRunning(): boolean {
  return server !== null
}

export async function startBridge(p: number): Promise<void> {
  if (server && port === p) return
  await stopBridge()
  const s = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'no-store')
    const url = req.url ?? '/'
    if (req.method !== 'GET') {
      res.writeHead(405).end()
      return
    }
    if (url === '/latest') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify(
          latest ? { id: latest.id, name: latest.name, target: latest.target, size: latest.data.length, at: latest.at } : null
        )
      )
      return
    }
    const m = /^\/file\/([a-z0-9]+)$/.exec(url)
    if (m && latest && latest.id === m[1]) {
      const ext = latest.name.split('.').pop()?.toLowerCase() ?? ''
      res.writeHead(200, {
        'Content-Type': TYPES[ext] ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${latest.name.replace(/"/g, '')}"`
      })
      res.end(latest.data)
      return
    }
    if (url === '/' || url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"app":"MeowTrace","ok":true}')
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject)
    s.listen(p, '127.0.0.1', () => resolve())
  })
  server = s
  port = p
}

export async function stopBridge(): Promise<void> {
  const s = server
  server = null
  if (s) await new Promise<void>((r) => s.close(() => r()))
}
