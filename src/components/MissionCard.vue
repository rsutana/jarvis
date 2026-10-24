<script setup lang="ts">
import { computed } from 'vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'

const props = defineProps<{ missionId: string; compact?: boolean }>()
const data = useData()
const ui = useUi()
const m = computed(() => data.snap?.missions.find((x) => x.id === props.missionId))
const ws = computed(() => data.workspace(m.value?.workspaceId))
const agentsCount = computed(() => new Set(m.value?.steps.map((s) => s.assigneeId)).size)
const gates = computed(() => m.value?.steps.filter((s) => s.gate).length ?? 0)
const schedule = computed(() => (m.value as { schedule?: string } | undefined)?.schedule)
const approve = () => ui.act(() => invoke('mission:approve', props.missionId), schedule.value ? 'Scheduled' : 'Mission approved')
const statusLabel: Record<string, string> = { draft: 'draft', awaiting_approval: 'awaiting approval', running: 'running', done: 'done', failed: 'rejected' }
</script>

<template>
  <div v-if="m" class="card flex flex-col gap-2 border-accent-ring p-3">
    <div class="lbl !text-accent-link">Mission {{ m.id }} · {{ statusLabel[m.status] }}<template v-if="ws"> · {{ ws.name }}</template></div>
    <div class="font-semibold">{{ m.title }}</div>
    <ol v-if="compact" class="m-0 flex flex-col gap-1 pl-[18px] text-small text-ink-muted">
      <li v-for="(s, i) in m.steps" :key="i">{{ s.title }} <span class="text-ink-faint">· {{ data.nameOf(s.assigneeId) }}</span></li>
    </ol>
    <div v-else class="text-small text-ink-faint">
      {{ m.steps.length }} steps · {{ agentsCount }} agents · {{ gates }} approval gate{{ gates === 1 ? '' : 's' }}<template v-if="schedule"> · <span class="mono">{{ schedule }}</span></template>
    </div>
    <div v-if="m.status === 'awaiting_approval' || m.status === 'draft'" class="mt-1 flex flex-wrap gap-2">
      <button class="btn btn-sm btn-pri" type="button" @click="approve">{{ schedule ? 'Approve & schedule' : 'Approve' }}</button>
      <RouterLink class="btn btn-sm" :to="`/jarvis?mission=${m.id}`">Open plan</RouterLink>
    </div>
    <RouterLink v-else-if="m.status === 'running'" class="text-small" :to="`/w/${m.workspaceId}/orchestrator?mission=${m.id}`">Open in orchestrator →</RouterLink>
  </div>
</template>
