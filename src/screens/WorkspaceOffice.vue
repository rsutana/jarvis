<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Avatar from '@/components/Avatar.vue'
import StatusChip from '@/components/StatusChip.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'
import { statusBg } from '@/components/status'

const route = useRoute()
const data = useData()
const ui = useUi()
const id = computed(() => route.params.id as string)
const ws = computed(() => data.workspace(id.value))
const orch = computed(() => data.orchestratorOf(id.value))
const team = computed(() => data.agentsIn(id.value))
const tasks = computed(() => data.tasksIn(id.value))
const active = computed(() => tasks.value.filter((t) => t.status === 'in_progress').length)
const review = computed(() => tasks.value.filter((t) => t.status === 'review').length)
const openPrs = computed(() => data.snap?.changes.filter((c) => c.workspaceId === id.value && c.state === 'open').length ?? 0)
const initials = computed(() => (ws.value?.name ?? '').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase())
const ROOF: Record<string, string> = { teal: '#34B394', blue: '#4A7FE0', clay: '#D7655A', purple: '#8A6FE0', amber: '#E0A33A' }

watch(id, () => ui.selectAgent(undefined))
const agent = computed(() => {
  const a = data.agent(ui.selectedAgentId)
  return a && a.workspaceId === id.value ? a : undefined
})
const current = computed(() => data.task(agent.value?.currentTaskId))
const run = computed(() => [...(data.snap?.runs ?? [])].reverse().find((r) => r.taskId === current.value?.id))
const live = computed(() => !!(run.value as { live?: boolean } | undefined)?.live)
const pct = computed(() => Math.round(((agent.value && data.progress[agent.value.id]) ?? current.value?.progress ?? 0) * 100))
const recent = computed(() => tasks.value.filter((t) => t.assigneeId === agent.value?.id && t.status === 'done').sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')).slice(0, 3))
const skills = computed(() => data.snap?.skills.filter((s) => agent.value?.skillIds.includes(s.id)) ?? [])
const integrations = computed(() =>
  (agent.value?.integrations ?? []).map((l) => ({ name: data.snap?.integrations.find((i) => i.id === l.integrationId)?.name ?? l.integrationId, policy: l.policy }))
)
const mode = ref<'none' | 'assign' | 'message'>('none')
const text = ref('')
watch(agent, () => ((mode.value = 'none'), (text.value = '')))
async function submit(): Promise<void> {
  const t = text.value.trim()
  if (!t || !agent.value) return
  if (mode.value === 'message' && run.value) await ui.act(() => invoke('run:steer', run.value!.id, t), `Sent to ${agent.value!.name}`)
  else await ui.act(() => invoke('agent:assignTask', agent.value!.id, t), `Assigned to ${agent.value!.name}`)
  mode.value = 'none'
  text.value = ''
}
</script>

<template>
  <section v-if="ws" aria-label="Workspace summary" class="pointer-events-auto absolute top-drawer-top left-hud z-20 flex w-[260px] max-w-[calc(100%-32px)] flex-col gap-2.5 rounded-dock border border-line-strong bg-hud px-4 py-3.5">
    <div class="flex items-center gap-2.5">
      <span class="inline-flex size-[30px] items-center justify-center rounded-control text-xs font-bold text-app" :style="{ background: ROOF[ws.color] }">{{ initials }}</span>
      <div>
        <div class="font-semibold">{{ ws.name }}</div>
        <div class="text-xs text-ink-faint">{{ team.length }} agents · {{ orch ? `orchestrator ${orch.name}` : 'no orchestrator' }}</div>
      </div>
    </div>
    <div class="grid grid-cols-3 gap-1.5 text-center text-xs">
      <RouterLink :to="`/w/${id}/tasks`" class="card px-1 py-2 text-ink no-underline hover:text-ink"><b class="block text-base">{{ active }}</b><span class="text-ink-faint">active</span></RouterLink>
      <RouterLink :to="`/w/${id}/inbox`" class="card px-1 py-2 text-ink no-underline hover:text-ink"><b class="block text-base text-status-review">{{ review }}</b><span class="text-ink-faint">review</span></RouterLink>
      <RouterLink :to="`/w/${id}/changes`" class="card px-1 py-2 text-ink no-underline hover:text-ink"><b class="block text-base">{{ openPrs }}</b><span class="text-ink-faint">open PRs</span></RouterLink>
    </div>
    <div v-if="!ws.folderPath" class="rounded-row border border-status-review/40 bg-raised p-2.5 text-small">
      No project folder yet, so agents can't run. <RouterLink :to="`/w/${id}/settings`">Choose one</RouterLink>
    </div>
    <RouterLink class="btn btn-pri" :to="`/w/${id}/tasks?new=1`">+ New task</RouterLink>
  </section>

  <DrawerPanel v-if="agent" label="Agent quick view" bare>
    <div class="flex items-center gap-3 px-4 pt-4 pb-3">
      <Avatar :name="agent.name" :color="agent.look.color" :size="48" />
      <div class="min-w-0 flex-1">
        <div class="text-title">{{ agent.name }}</div>
        <div class="text-small text-ink-faint">{{ agent.role }}</div>
      </div>
      <button type="button" class="x-close cursor-pointer border-0 bg-transparent" aria-label="Close" @click="ui.selectAgent(undefined)">×</button>
    </div>
    <div class="flex flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
      <div class="flex flex-wrap gap-1.5">
        <StatusChip :status="agent.status" />
        <span class="chip mono">{{ agent.model }}</span>
        <span class="chip">{{ data.account(agent.accountId)?.name ?? agent.accountId }}</span>
      </div>
      <div class="card p-3">
        <div class="lbl">Now</div>
        <div class="mt-1 text-[13.5px]">{{ current ? `${current.id} · ${current.title}${current.note ? ', ' + current.note : ''}` : 'Idle' }}</div>
        <div class="mt-2.5 h-1 rounded-sm bg-line"><div class="h-1 rounded-sm" :class="statusBg[agent.status]" :style="{ width: pct + '%' }" /></div>
      </div>
      <div>
        <div class="lbl mb-1.5">Recent</div>
        <div class="flex flex-col gap-2 text-small">
          <RouterLink v-for="t in recent" :key="t.id" :to="`/w/${id}/tasks/${t.id}`" class="flex gap-2 text-ink no-underline hover:text-accent-link">
            <span class="mono text-ink-faint">{{ t.id }}</span><span class="flex-1">{{ t.title }}</span><span class="text-status-done">Done</span>
          </RouterLink>
          <span v-if="!recent.length" class="text-ink-faint">No finished tasks yet</span>
        </div>
      </div>
      <div v-if="skills.length"><div class="lbl mb-1.5">Skills</div><div class="flex flex-wrap gap-1.5"><span v-for="s in skills" :key="s.id" class="chip">{{ s.name }}</span></div></div>
      <div>
        <div class="lbl mb-1.5">Integrations</div>
        <div class="flex flex-wrap gap-1.5">
          <span v-for="i in integrations" :key="i.name" class="chip">{{ i.name }} · {{ i.policy }}</span>
          <span class="chip">Files · {{ agent.guardrails.fileAccess === 'read' ? 'read only' : 'read & write' }}</span>
        </div>
      </div>
      <form v-if="mode !== 'none'" class="flex gap-2" @submit.prevent="submit">
        <label for="qv" class="sr-only">{{ mode === 'message' ? 'Message' : 'Task title' }}</label>
        <input id="qv" v-model="text" class="field" :placeholder="mode === 'message' ? `Steer ${agent.name}…` : 'What should they do?'" autofocus />
        <button class="btn btn-pri" type="submit">Send</button>
      </form>
    </div>
    <div class="flex flex-col gap-2 border-t border-line-soft px-4 pt-3 pb-4">
      <RouterLink v-if="current" class="btn btn-pri" :to="`/w/${id}/tasks/${current.id}`">Open current run</RouterLink>
      <div class="flex gap-2">
        <button class="btn flex-1" type="button" :disabled="!live" :title="live ? '' : 'Only while a run is active'" @click="mode = 'message'">Message</button>
        <button class="btn flex-1" type="button" @click="mode = 'assign'">Assign task</button>
        <RouterLink class="btn flex-1" :to="`/w/${id}/agents/${agent.id}`">Edit</RouterLink>
      </div>
    </div>
  </DrawerPanel>
</template>
