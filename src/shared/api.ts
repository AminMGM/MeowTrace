// IPC contract between the renderer and the main process.

import type { AnimeModelStatus, AnimeProgress, AnimeStyleId } from './anime'

export interface AppInfo {
  version: string
  platform: string
  isPackaged: boolean
  electron: string
}

export interface OpenedFile {
  path: string
  name: string
  bytes: Uint8Array
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export type AdobeApp = 'illustrator' | 'photoshop'

export interface AdobeApps {
  illustrator: string | null
  photoshop: string | null
}

export interface SendResult {
  ok: boolean
  path?: string
  message: string
}

export interface AppSettings {
  /** Serve the latest "Send" over http://127.0.0.1:<port> for the UXP plugin. */
  bridgeEnabled: boolean
  bridgePort: number
  checkUpdates: boolean
  recent: string[]
}

export type UpdaterState = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdaterStatus {
  state: UpdaterState
  version?: string
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  message?: string
}

export interface MeowApi {
  appInfo(): Promise<AppInfo>
  openImages(multi: boolean): Promise<OpenedFile[]>
  readFile(path: string): Promise<OpenedFile>
  pickFolder(): Promise<string | null>
  listImages(folder: string): Promise<string[]>
  saveFile(defaultName: string, filters: FileFilter[], data: Uint8Array | string): Promise<string | null>
  writeOutput(folder: string, name: string, data: Uint8Array | string): Promise<string>
  reveal(path: string): Promise<void>
  openPath(path: string): Promise<string>
  copy(payload: { text?: string; png?: Uint8Array }): Promise<void>
  adobeApps(): Promise<AdobeApps>
  sendToAdobe(app: AdobeApp, name: string, data: Uint8Array | string): Promise<SendResult>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  checkForUpdates(): Promise<UpdaterStatus>
  updaterStatus(): Promise<UpdaterStatus>
  installUpdate(): Promise<void>
  openExternal(url: string): Promise<void>
  onUpdaterStatus(cb: (s: UpdaterStatus) => void): () => void
  takePendingFiles(): Promise<string[]>
  onOpenFiles(cb: (paths: string[]) => void): () => void
  onMenu(cb: (command: string) => void): () => void
  animeStatus(): Promise<AnimeModelStatus[]>
  animeDownload(id: AnimeStyleId): Promise<void>
  animeDelete(id: AnimeStyleId): Promise<void>
  /** RGBA in, RGBA out, at the model's working size. */
  animeRun(id: AnimeStyleId, rgba: Uint8Array, width: number, height: number): Promise<Uint8Array>
  onAnimeProgress(cb: (p: AnimeProgress) => void): () => void
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif', 'ico']
