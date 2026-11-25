import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings } from '../shared/api'

const DEFAULTS: AppSettings = {
  bridgeEnabled: false,
  bridgePort: 47811,
  checkUpdates: true,
  recent: []
}

let cache: AppSettings | null = null

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  if (cache) return cache
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<AppSettings>
    cache = { ...DEFAULTS, ...raw }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next: AppSettings = { ...loadSettings(), ...patch }
  next.bridgePort = Math.min(65535, Math.max(1024, Math.round(Number(next.bridgePort) || DEFAULTS.bridgePort)))
  next.recent = (next.recent ?? []).filter((p) => typeof p === 'string').slice(0, 12)
  cache = next
  await mkdir(path.dirname(file()), { recursive: true })
  await writeFile(file(), JSON.stringify(next, null, 2))
  return next
}
