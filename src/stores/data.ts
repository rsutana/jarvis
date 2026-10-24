import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { AgentStatus, ChatMessage } from '@shared/types'
import type { AnyAgent, Snapshot, StoredTask } from '@shared/app-types'
import { invoke, on } from '@/lib/ipc'
import { useUi } from './ui'

/**
 * Mirror of the main-process database. Main pushes `db:changed` after every
 * mutation and the store refetches; live run/chat events patch in place.
 */
export const useData = defineStore('data', () => {
  const snap = shallowRef<Snapshot | null>(null)
  const messages = ref<Record<string, ChatMessage[]>>({})
  const typing = ref<Record<string, boolean>>({})
  const progress = ref<Record<string, number>>({})
  let refetch: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<void> {
    snap.value = await invoke('app:snapshot')
  }

  function scheduleRefetch(): void {
    if (refetch) return
    refetch = setTimeout(async () => {
      refetch = null
      await load()
    }, 60)
  }

  async function loadMessages(conversationId: string): Promise<void> {
    messages.value[conversationId] = await invoke('jarvis:messages', conversationId)
  }

  function subscribe(): void {
    const ui = useUi()
    on('db:changed', scheduleRefetch)
    on('jarvis:message', (m) => {
      const list = messages.value[m.conversationId]
      if (list && !list.some((x) => x.id === m.id)) list.push(m)
    })
    on('jarvis:typing', ({ conversationId, typing: t }) => (typing.value[conversationId] = t))
    on('agent:status', ({ agentId, progress: p }) => {
      if (p !== undefined) progress.value[agentId] = p
    })
    on('approval:new', (a) => ui.toast(`Needs you: ${a.title}`, 'info'))
    on('toast', ({ text, tone }) => ui.toast(text, tone))
  }

  const workspaces = computed(() => snap.value?.workspaces ?? [])
  const agents = computed(() => snap.value?.agents ?? [])
  const tasks = computed(() => snap.value?.tasks ?? [])
  const approvals = computed(() => snap.value?.approvals ?? [])
  const pendingApprovals = computed(() => approvals.value.filter((a) => a.state === 'pending'))

  const workspace = (id?: string) => workspaces.value.find((w) => w.id === id)
  const agent = (id?: string): AnyAgent | undefined => agents.value.find((a) => a.id === id)
  const agentsIn = (wsId?: string) => agents.value.filter((a) => a.workspaceId === wsId && a.kind === 'agent')
  const orchestratorOf = (wsId?: string) => {
    const ws = workspace(wsId)
    return ws?.orchestratorId ? agent(ws.orchestratorId) : undefined
  }
  const tasksIn = (wsId?: string): StoredTask[] => tasks.value.filter((t) => t.workspaceId === wsId)
  const task = (id?: string) => tasks.value.find((t) => t.id === id)
  const account = (id?: string) => snap.value?.accounts.find((a) => a.id === id)
  const nameOf = (id?: string) => (id === 'jarvis' ? 'Jarvis' : id === 'user' ? 'You' : (agent(id)?.name ?? id ?? ''))
  const countByStatus = (wsId: string, s: AgentStatus) => agentsIn(wsId).filter((a) => a.status === s).length

  return {
    snap, messages, typing, progress, load, loadMessages, subscribe,
    workspaces, agents, tasks, approvals, pendingApprovals,
    workspace, agent, agentsIn, orchestratorOf, tasksIn, task, account, nameOf, countByStatus
  }
})
