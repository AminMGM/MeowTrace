import { BrowserWindow, Menu, app, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { IMAGE_EXTENSIONS } from '../shared/api'
import { registerAnimeIpc } from './anime'
import { applyBridge, registerIpc } from './ipc'
import { loadSettings } from './settings'
import { initUpdater } from './updater'

let mainWindow: BrowserWindow | null = null
let pendingFiles: string[] = []
let rendererReady = false

function imageArgs(argv: string[]): string[] {
  return argv
    .slice(1)
    .filter((a) => !a.startsWith('-') && IMAGE_EXTENSIONS.includes(path.extname(a).slice(1).toLowerCase()) && existsSync(a))
}

function deliverFiles(files: string[]): void {
  if (!files.length) return
  if (mainWindow && rendererReady) mainWindow.webContents.send('app:openFiles', files)
  else pendingFiles.push(...files)
}

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'resources', 'icon.png')
    : path.join(__dirname, '../../resources/icon.png')
}

function createWindow(): void {
  const icon = iconPath()
  const isWin11 = process.platform === 'win32' && Number(process.getSystemVersion().split('.')[2] ?? 0) >= 22000
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'MeowTrace',
    icon: existsSync(icon) ? icon : undefined,
    backgroundColor: isWin11 ? '#00000000' : '#120d10',
    backgroundMaterial: isWin11 ? 'acrylic' : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#f2e9ea', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (!devUrl || !url.startsWith(devUrl)) event.preventDefault()
  })
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) mainWindow?.webContents.toggleDevTools()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

// The e2e harness runs against a throwaway profile so it never touches real settings.
if (process.env['MEOW_E2E'] === '1' && process.env['MEOW_USER_DATA']) app.setPath('userData', process.env['MEOW_USER_DATA'])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    deliverFiles(imageArgs(argv))
  })

  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.aminmgm.meowtrace')
    Menu.setApplicationMenu(null)
    registerIpc()
    registerAnimeIpc()
    // The renderer asks for files passed on the command line once it is listening.
    ipcMain.handle('app:takePendingFiles', () => {
      rendererReady = true
      const files = pendingFiles
      pendingFiles = []
      return files
    })
    pendingFiles = imageArgs(process.argv)
    createWindow()
    const settings = loadSettings()
    await applyBridge(settings)
    if (settings.checkUpdates) initUpdater()
    else initUpdater(false)
  })

  app.on('window-all-closed', () => app.quit())
}
