import { BrowserWindow } from 'electron'
import type { IpcEvents } from '@shared/types'

/** Push a typed event to every renderer window. */
export function emit<K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

export function toast(text: string, tone: 'info' | 'good' | 'bad' = 'info'): void {
  emit('toast', { text, tone })
}
