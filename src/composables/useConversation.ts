import { computed, watch, type Ref } from 'vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'

/** Current Jarvis conversation + send/new helpers shared by the dock and the chat screen. */
export function useConversation(id: Ref<string | undefined>) {
  const data = useData()
  const ui = useUi()
  const conversations = computed(() => [...(data.snap?.conversations ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  const current = computed(() => conversations.value.find((c) => c.id === id.value) ?? conversations.value[0])
  const messages = computed(() => (current.value ? (data.messages[current.value.id] ?? []) : []))
  const typing = computed(() => (current.value ? !!data.typing[current.value.id] : false))

  watch(
    () => current.value?.id,
    (cid) => {
      if (cid && !data.messages[cid]) data.loadMessages(cid)
    },
    { immediate: true }
  )

  async function send(text: string): Promise<void> {
    let cid: string | undefined = current.value?.id
    if (!cid) cid = (await ui.act(() => invoke('jarvis:newConversation')))?.id
    if (!cid) return
    if (!data.messages[cid]) await data.loadMessages(cid)
    await ui.act(() => invoke('jarvis:send', cid!, text))
  }
  async function create(): Promise<string | undefined> {
    const c = await ui.act(() => invoke('jarvis:newConversation'))
    if (c) data.messages[c.id] = []
    return c?.id
  }
  return { conversations, current, messages, typing, send, create }
}
