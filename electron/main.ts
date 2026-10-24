import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { openDb } from './services/db'
import { registerIpc } from './ipc'
import { recoverInterrupted, stopAll } from './services/runner'
import { scheduleAll } from './services/automations'
import { schedule } from './services/orchestrator'
import { tickAccounts } from './services/accounts'

const dir = import.meta.dirname
let win: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0B0D10',
    title: 'Jarvis',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(dir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  // links in agent output open in the browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file:')) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(dir, '../renderer/index.html'))
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(dir, '../../resources/icon.png'))
  if (icon.isEmpty()) return
  tray = new Tray(icon.resize({ width: 18, height: 18 }))
  tray.setToolTip('Jarvis')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Jarvis', click: () => (win ? win.show() : createWindow()) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
}

app.whenReady().then(async () => {
  await openDb()
  registerIpc()
  recoverInterrupted()
  scheduleAll()
  createWindow()
  createTray()
  setInterval(tickAccounts, 60_000)
  setTimeout(schedule, 2000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => stopAll())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
