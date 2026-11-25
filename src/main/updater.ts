import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdaterStatus } from '../shared/api'

let status: UpdaterStatus = { state: 'idle' }
let manualCheck = false

function broadcast(next: UpdaterStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:status', next)
  }
}

export function initUpdater(autoCheck = true): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowDowngrade = false
  // Differential downloads (block map deltas) are on by default; keep it explicit
  // because a full installer re-download is never acceptable for this app.
  autoUpdater.disableDifferentialDownload = false

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    broadcast({ state: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', (info: UpdateInfo) =>
    broadcast({ state: 'not-available', version: info?.version })
  )
  autoUpdater.on('download-progress', (progress: ProgressInfo) =>
    broadcast({
      state: 'downloading',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  )
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    broadcast({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (error: Error) => {
    broadcast({ state: 'error', message: error.message })
    if (manualCheck) {
      dialog.showErrorBox('Update check failed', error.message)
    }
  })

  if (app.isPackaged && autoCheck) {
    setTimeout(() => {
      void checkForUpdates(false)
    }, 5000)
  } else if (!app.isPackaged) {
    broadcast({ state: 'not-available', message: 'Development build — updates are disabled.' })
  }
}

export function currentUpdaterStatus(): UpdaterStatus {
  return status
}

export async function checkForUpdates(manual = true): Promise<UpdaterStatus> {
  if (!app.isPackaged) {
    const info: UpdaterStatus = {
      state: 'not-available',
      message: 'Development build — updates are disabled.'
    }
    if (manual) broadcast(info)
    return info
  }
  manualCheck = manual
  broadcast({ state: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    broadcast({ state: 'error', message })
  }
  return status
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}
