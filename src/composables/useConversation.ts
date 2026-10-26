import { computed, watch, type Ref } from 'vue'
import type { ChatUpload } from '@shared/app-types'
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

  async function send(text: string, files: ChatUpload[] = []): Promise<void> {
    let cid: string | undefined = current.value?.id
    if (!cid) cid = (await ui.act(() => invoke('jarvis:newConversation')))?.id
    if (!cid) return
    if (!data.messages[cid]) await data.loadMessages(cid)
    await ui.act(() => (files.length ? invoke('jarvis:sendWithFiles', cid!, text, files) : invoke('jarvis:send', cid!, text)))
  }
  async function create(): Promise<string | undefined> {
    const c = await ui.act(() => invoke('jarvis:newConversation'))
    if (c) data.messages[c.id] = []
    return c?.id
  }
  /** Delete chats (a chat Jarvis is answering is kept); returns how many went. */
  async function remove(ids: string[]): Promise<number> {
    const n = await ui.act(() => invoke('jarvis:deleteConversations', ids))
    if (!n) return 0
    for (const cid of ids) if (!data.typing[cid]) delete data.messages[cid]
    ui.toast(n === 1 ? 'Chat deleted' : `${n} chats deleted`, 'good')
    return n
  }
  return { conversations, current, messages, typing, send, create, remove }
}
