import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcEvents, IpcInvoke, JarvisApi } from '@shared/app-types'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const api: JarvisApi = {
  async invoke<K extends keyof IpcInvoke>(channel: K, ...args: Parameters<IpcInvoke[K]>): Promise<Awaited<ReturnType<IpcInvoke[K]>>> {
    const r = (await ipcRenderer.invoke(channel, ...args)) as Result<Awaited<ReturnType<IpcInvoke[K]>>>
    if (!r.ok) throw new Error(r.error)
    return r.value
  },
  on<K extends keyof IpcEvents>(event: K, cb: (payload: IpcEvents[K]) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: IpcEvents[K]): void => cb(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('jarvis', api)
