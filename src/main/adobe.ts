// "Send to Illustrator / Photoshop" (phase 1, file based): write the export to
// a temp folder and open it in the newest installed Adobe app, falling back
// to the OS default handler.

import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AdobeApp, AdobeApps, SendResult } from '../shared/api'
import { publishToBridge } from './bridge'

function adobeRoots(): string[] {
  const roots = [process.env['ProgramFiles'], process.env['ProgramW6432'], 'C:\\Program Files']
    .filter((r): r is string => !!r)
    .map((r) => path.join(r, 'Adobe'))
  return [...new Set(roots)].filter((r) => existsSync(r))
}

function newest(prefix: string, exeFor: (dir: string) => string): string | null {
  const found: { name: string; exe: string }[] = []
  for (const root of adobeRoots()) {
    let entries: string[] = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.startsWith(prefix)) continue
      const exe = exeFor(path.join(root, name))
      if (existsSync(exe)) found.push({ name, exe })
    }
  }
  // "Adobe Photoshop 2026" > "Adobe Photoshop 2025" > "Adobe Photoshop CC 2019"
  found.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
  return found[0]?.exe ?? null
}

let cached: AdobeApps | null = null

export function findAdobeApps(): AdobeApps {
  if (process.platform !== 'win32') return { illustrator: null, photoshop: null }
  if (!cached) {
    cached = {
      illustrator: newest('Adobe Illustrator', (d) => path.join(d, 'Support Files', 'Contents', 'Windows', 'Illustrator.exe')),
      photoshop: newest('Adobe Photoshop', (d) => path.join(d, 'Photoshop.exe'))
    }
  }
  return cached
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').slice(0, 120) || 'meowtrace'
}

export async function sendToAdobe(target: AdobeApp, name: string, data: Uint8Array | string): Promise<SendResult> {
  const dir = path.join(app.getPath('temp'), 'MeowTrace')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, safeName(name))
  await writeFile(file, typeof data === 'string' ? data : Buffer.from(data))
  publishToBridge(path.basename(file), data, target)

  const exe = findAdobeApps()[target]
  const label = target === 'illustrator' ? 'Illustrator' : 'Photoshop'
  if (exe) {
    try {
      const child = spawn(exe, [file], { detached: true, stdio: 'ignore', windowsHide: false })
      child.on('error', () => undefined)
      child.unref()
      return { ok: true, path: file, message: `Opened in ${label}` }
    } catch {
      // fall through to the default handler
    }
  }
  const err = await shell.openPath(file)
  if (err) return { ok: false, path: file, message: `${label} was not found and the file could not be opened: ${err}` }
  return { ok: true, path: file, message: `${label} not found — opened with the default app` }
}
