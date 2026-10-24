<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'

const route = useRoute()
const data = useData()
const ui = useUi()
const ws = computed(() => (route.meta.world === 'office' ? data.workspace(route.params.id as string) : undefined))
const away = computed(() => data.snap?.jarvis.awayMode ?? false)
const status = computed(() => {
  if (ws.value) {
    const working = data.countByStatus(ws.value.id, 'working')
    return `${working} working · ${data.agentsIn(ws.value.id).length - working} idle`
  }
  return `${data.workspaces.length} workspace${data.workspaces.length === 1 ? '' : 's'}`
})
const anyWorking = computed(() => data.agents.some((a) => a.status === 'working'))
const toggleAway = () => ui.act(() => invoke('jarvis:setAway', !away.value))
const pill = 'pointer-events-auto flex min-h-control items-center gap-2 rounded-hud border border-line-strong bg-hud px-3.5'
</script>

<template>
  <header class="pointer-events-none absolute top-hud right-hud left-hud z-30 flex flex-wrap items-center gap-2 text-[13.5px]">
    <RouterLink to="/" aria-label="Jarvis home" class="pointer-events-auto flex size-10 items-center justify-center rounded-hud bg-accent font-bold text-app shadow-tag hover:text-app">J</RouterLink>
    <nav aria-label="Breadcrumb" :class="pill">
      <RouterLink to="/" class="text-ink-muted hover:text-ink">Jarvis</RouterLink>
      <template v-if="ws">
        <span aria-hidden="true" class="text-status-idle">›</span>
        <RouterLink :to="`/w/${ws.id}`" class="text-ink-muted hover:text-ink">{{ ws.name }}</RouterLink>
      </template>
      <span aria-hidden="true" class="text-status-idle">›</span>
      <span aria-current="page" class="font-semibold text-accent-link">{{ route.meta.page }}</span>
    </nav>
    <button type="button" :class="pill" class="cursor-pointer text-ink-muted" @click="ui.searchOpen = true">
      Search <span class="rounded border border-line-strong px-1.5 font-mono text-[11px] text-ink-muted">Ctrl K</span>
    </button>
    <button
      type="button"
      :aria-pressed="away"
      :class="[pill, away ? 'border-status-working/60' : '']"
      class="cursor-pointer border-[1.5px] font-semibold text-ink"
      @click="toggleAway"
    >
      I'm away
      <span class="rounded-md px-1.5 py-px text-[10.5px] font-bold" :class="away ? 'bg-status-working text-app' : 'bg-line-strong text-ink-muted'">{{ away ? 'ON' : 'OFF' }}</span>
    </button>
    <div class="flex-1" />
    <span :class="pill" class="font-semibold">
      <span class="dot" :class="anyWorking ? 'bg-status-working' : 'bg-status-idle'" aria-hidden="true" />{{ status }}
    </span>
  </header>
</template>
