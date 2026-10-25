import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { openDb } from './services/db'
import { registerIpc } from './ipc'
import { recoverInterrupted, stopAll } from './services/runner'
import { scheduleAll } from './services/automations'
import { schedule } from './services/orchestrator'
import { refreshPlans, tickAccounts } from './services/accounts'
import { scanSkills } from './services/skills'
import { scanLocalMcps } from './services/claudeMcp'

const dir = import.meta.dirname
// WSL, VMs and remote desktops often have blocklisted GPUs; the iso scene is light enough for software GL
app.commandLine.appendSwitch('ignore-gpu-blocklist')
const res = (): string => (app.isPackaged ? join(process.resourcesPath, 'resources') : join(dir, '../../resources'))
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
    icon: join(res(), 'icon.png'),
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
  const icon = nativeImage.createFromPath(join(res(), 'icon.png'))
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
  // real plan usage (same numbers as Claude Code's /usage) on start and every 3 minutes
  const plans = () => refreshPlans(true).catch(() => undefined)
  plans()
  setInterval(plans, 180_000)
  // shared Agent Skills (~/.agents/skills here and in running WSL distros)
  scanSkills().catch(() => undefined)
  // MCP servers Claude Code is set up with (claude mcp add, .mcp.json, plugins)
  scanLocalMcps().catch(() => undefined)
  setTimeout(schedule, 2000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => stopAll())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
