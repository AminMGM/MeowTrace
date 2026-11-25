import { BrowserWindow, ClipboardItem, app, clipboard, dialog, ipcMain, shell } from 'electron'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AdobeApp, AppSettings, FileFilter, OpenedFile } from '../shared/api'
import { IMAGE_EXTENSIONS } from '../shared/api'
import { findAdobeApps, sendToAdobe } from './adobe'
import { startBridge, stopBridge } from './bridge'
import { loadSettings, saveSettings } from './settings'
import { checkForUpdates, currentUpdaterStatus, installUpdate } from './updater'

const MAX_IMAGE_BYTES = 256 * 1024 * 1024

function isImage(p: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.extname(p).slice(1).toLowerCase())
}

async function readImage(p: string): Promise<OpenedFile> {
  if (!isImage(p)) throw new Error(`Not a supported image: ${path.basename(p)}`)
  const info = await stat(p)
  if (info.size > MAX_IMAGE_BYTES) throw new Error(`${path.basename(p)} is larger than 256 MB`)
  const buf = await readFile(p)
  await remember(p)
  return { path: p, name: path.basename(p), bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) }
}

async function remember(p: string): Promise<void> {
  const s = loadSettings()
  await saveSettings({ recent: [p, ...s.recent.filter((r) => r !== p)] })
}

function toBuffer(data: Uint8Array | string): Buffer | string {
  return typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

function safeName(name: string): string {
  return path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_') || 'output'
}

export async function applyBridge(s: AppSettings): Promise<void> {
  try {
    if (s.bridgeEnabled) await startBridge(s.bridgePort)
    else await stopBridge()
  } catch (error) {
    console.error('bridge:', error)
  }
}

export function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    electron: process.versions.electron
  }))

  ipcMain.handle('file:openImages', async (event, multi: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const res = await dialog.showOpenDialog(win as BrowserWindow, {
      title: multi ? 'Add images' : 'Open image',
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }]
    })
    if (res.canceled) return []
    const out: OpenedFile[] = []
    for (const p of res.filePaths) out.push(await readImage(p))
    return out
  })

  ipcMain.handle('file:read', (_e, p: string) => readImage(p))

  ipcMain.handle('file:pickFolder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) as BrowserWindow
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('file:listImages', async (_e, folder: string) => {
    const out: string[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const p = path.join(dir, e.name)
        if (e.isDirectory() && depth < 3 && !e.name.startsWith('.')) await walk(p, depth + 1)
        else if (e.isFile() && isImage(p)) out.push(p)
      }
    }
    await walk(folder, 0)
    return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  })

  ipcMain.handle('file:save', async (event, defaultName: string, filters: FileFilter[], data: Uint8Array | string) => {
    const win = BrowserWindow.fromWebContents(event.sender) as BrowserWindow
    const res = await dialog.showSaveDialog(win, { defaultPath: safeName(defaultName), filters })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, toBuffer(data))
    return res.filePath
  })

  ipcMain.handle('file:writeOutput', async (_e, folder: string, name: string, data: Uint8Array | string) => {
    await mkdir(folder, { recursive: true })
    const target = path.join(folder, safeName(name))
    await writeFile(target, toBuffer(data))
    return target
  })

  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:open', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('shell:external', (_e, url: string) => {
    if (/^https:\/\//i.test(url)) return shell.openExternal(url)
    return undefined
  })

  ipcMain.handle('clipboard:copy', async (_e, payload: { text?: string; png?: Uint8Array }) => {
    const items: Record<string, string | Blob> = {}
    if (payload.text) items['text/plain'] = payload.text
    if (payload.png) items['image/png'] = new Blob([Buffer.from(payload.png)], { type: 'image/png' })
    try {
      await clipboard.write([new ClipboardItem(items)])
    } catch {
      // Fall back to text only if the platform rejects the image flavour.
      if (payload.text) await clipboard.writeText(payload.text)
    }
  })

  ipcMain.handle('adobe:apps', () => findAdobeApps())
  ipcMain.handle('adobe:send', (_e, target: AdobeApp, name: string, data: Uint8Array | string) => sendToAdobe(target, name, data))

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', async (_e, patch: Partial<AppSettings>) => {
    const next = await saveSettings(patch)
    if ('bridgeEnabled' in patch || 'bridgePort' in patch) await applyBridge(next)
    return next
  })

  ipcMain.handle('updater:check', () => checkForUpdates(true))
  ipcMain.handle('updater:status', () => currentUpdaterStatus())
  ipcMain.handle('updater:install', () => installUpdate())
}
