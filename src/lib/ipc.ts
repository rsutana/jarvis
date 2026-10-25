import { toRaw } from 'vue'
import type { IpcEvents, IpcInvoke } from '@shared/app-types'

/**
 * IPC uses structured clone, which throws "An object could not be cloned" on Vue
 * proxies (e.g. a ref'd draft, or a spread of one whose nested objects are still
 * reactive). Copy them into plain data; unlike a JSON round-trip, `undefined` survives.
 */
function plain(v: unknown): unknown {
  const r = toRaw(v)
  if (Array.isArray(r)) return r.map(plain)
  if (r && typeof r === 'object' && Object.getPrototypeOf(r) === Object.prototype) return Object.fromEntries(Object.entries(r).map(([k, x]) => [k, plain(x)]))
  return r
}

/** Typed bridge to the main process (see electron/preload.ts). */
export function invoke<K extends keyof IpcInvoke>(channel: K, ...args: Parameters<IpcInvoke[K]>): Promise<Awaited<ReturnType<IpcInvoke[K]>>> {
  return window.jarvis.invoke(channel, ...(args.map(plain) as Parameters<IpcInvoke[K]>))
}

export function on<K extends keyof IpcEvents>(event: K, cb: (payload: IpcEvents[K]) => void): () => void {
  return window.jarvis.on(event, cb)
}
