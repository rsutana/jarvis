import type { IpcEvents, IpcInvoke } from '@shared/app-types'

/** Typed bridge to the main process (see electron/preload.ts). */
export function invoke<K extends keyof IpcInvoke>(channel: K, ...args: Parameters<IpcInvoke[K]>): Promise<Awaited<ReturnType<IpcInvoke[K]>>> {
  return window.jarvis.invoke(channel, ...args)
}

export function on<K extends keyof IpcEvents>(event: K, cb: (payload: IpcEvents[K]) => void): () => void {
  return window.jarvis.on(event, cb)
}
