<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Icon, { type IconName } from '@/components/Icon.vue'
import { useData } from '@/stores/data'
import { invoke } from '@/lib/ipc'
import { useUi } from '@/stores/ui'

const route = useRoute()
const data = useData()
const ui = useUi()
type Item = { label: string; to?: string; icon: IconName; badge?: number; action?: () => void } | null

const items = computed<Item[]>(() => {
  const inbox = data.pendingApprovals.length
  if (route.meta.dock === 'workspace') {
    const id = route.params.id as string
    const ws = data.workspace(id)
    const open = data.snap?.changes.filter((c) => c.workspaceId === id && c.state === 'open').length ?? 0
    return [
      { label: 'Lobby', to: '/', icon: 'back' },
      null,
      { label: 'Inbox', to: `/w/${id}/inbox`, icon: 'inbox', badge: data.pendingApprovals.filter((a) => a.workspaceId === id).length },
      { label: 'Overview', to: `/w/${id}`, icon: 'home' },
      { label: 'Orchestrator', to: `/w/${id}/orchestrator`, icon: 'orch' },
      { label: 'Tasks', to: `/w/${id}/tasks`, icon: 'tasks' },
      { label: 'Changes', to: `/w/${id}/changes`, icon: 'branch', badge: open },
      { label: 'Activity', to: `/w/${id}/activity`, icon: 'pulse' },
      { label: 'Agents', to: `/w/${id}/agents`, icon: 'agent' },
      {
        label: 'Files',
        icon: 'folder',
        action: () => (ws?.folderPath ? ui.act(() => invoke('app:openPath', ws.folderPath)) : ui.toast('Set a project folder in workspace Settings first', 'bad'))
      },
      { label: 'Settings', to: `/w/${id}/settings`, icon: 'gear' }
    ]
  }
  return [
    { label: 'Inbox', to: '/inbox', icon: 'inbox', badge: inbox },
    { label: 'Chat', to: '/jarvis', icon: 'chat' },
    { label: 'Workspaces', to: '/workspaces/new', icon: 'ws' },
    null,
    { label: 'AI Accounts', to: '/accounts', icon: 'acct' },
    { label: 'Agents', to: '/agents', icon: 'agent' },
    { label: 'Skills', to: '/skills', icon: 'skill' },
    { label: 'Integrations', to: '/integrations', icon: 'plug' },
    { label: 'Usage', to: '/usage', icon: 'usage' },
    null,
    { label: 'Automations', to: '/automations', icon: 'clock' },
    { label: 'Settings', to: '/settings', icon: 'gear' }
  ]
})
const cls = (on: boolean) =>
  [
    'relative flex min-h-[52px] min-w-16 cursor-pointer flex-col items-center justify-center gap-[3px] rounded-row border-0 px-2 py-1 text-tiny font-medium whitespace-nowrap no-underline',
    on ? 'bg-accent-active text-accent-link' : 'bg-transparent text-ink-muted hover:bg-raised hover:text-ink'
  ].join(' ')
</script>

<template>
  <nav
    aria-label="Dock"
    class="pointer-events-auto absolute bottom-hud left-1/2 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-stretch gap-0.5 overflow-x-auto rounded-dock border border-line-strong bg-hud p-1.5 shadow-dock"
  >
    <template v-for="(d, i) in items" :key="i">
      <span v-if="!d" aria-hidden="true" class="mx-1 my-2 w-px bg-line-strong" />
      <RouterLink v-else-if="d.to" :to="d.to" :aria-current="route.meta.active === d.label ? 'page' : undefined" :class="cls(route.meta.active === d.label)">
        <Icon :name="d.icon" />{{ d.label }}
        <span v-if="d.badge" class="absolute top-0.5 right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-review px-1 text-[10px] font-bold text-app">{{ d.badge }}</span>
      </RouterLink>
      <button v-else type="button" :class="cls(false)" @click="d.action?.()"><Icon :name="d.icon" />{{ d.label }}</button>
    </template>
  </nav>
</template>
