import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'good' | 'bad'
}

export const useUi = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const searchOpen = ref(false)
  const selectedAgentId = ref<string | undefined>()
  const hoverLabel = ref<string | undefined>()
  let n = 0

  function toast(text: string, tone: Toast['tone'] = 'info'): void {
    const t = { id: ++n, text, tone }
    toasts.value.push(t)
    setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== t.id)), tone === 'bad' ? 9000 : 5000)
  }

  /** Run an IPC action and surface failures as a toast. */
  async function act<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    try {
      const v = await fn()
      if (ok) toast(ok, 'good')
      return v
    } catch (e) {
      toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'bad')
      return undefined
    }
  }

  function selectAgent(id?: string): void {
    selectedAgentId.value = id
  }

  return { toasts, searchOpen, selectedAgentId, hoverLabel, toast, act, selectAgent }
})
