import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { MeowApi } from '../shared/api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: MeowApi = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  openImages: (multi) => ipcRenderer.invoke('file:openImages', multi),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  pickFolder: () => ipcRenderer.invoke('file:pickFolder'),
  listImages: (folder) => ipcRenderer.invoke('file:listImages', folder),
  saveFile: (name, filters, data) => ipcRenderer.invoke('file:save', name, filters, data),
  writeOutput: (folder, name, data) => ipcRenderer.invoke('file:writeOutput', folder, name, data),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  copy: (payload) => ipcRenderer.invoke('clipboard:copy', payload),
  adobeApps: () => ipcRenderer.invoke('adobe:apps'),
  sendToAdobe: (app, name, data) => ipcRenderer.invoke('adobe:send', app, name, data),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  updaterStatus: () => ipcRenderer.invoke('updater:status'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  openExternal: (url) => ipcRenderer.invoke('shell:external', url),
  onUpdaterStatus: (cb) => subscribe('updater:status', cb),
  takePendingFiles: () => ipcRenderer.invoke('app:takePendingFiles'),
  onOpenFiles: (cb) => subscribe('app:openFiles', cb),
  onMenu: (cb) => subscribe('app:menu', cb)
}

contextBridge.exposeInMainWorld('meow', api)
// Dropped File objects no longer carry .path; resolve it here.
contextBridge.exposeInMainWorld('meowFiles', {
  pathFor: (file: File): string => webUtils.getPathForFile(file),
  // Only true when the end-to-end test harness launches the app.
  e2e: process.env['MEOW_E2E'] === '1'
})
