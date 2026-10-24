<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Task, TaskStatus } from '@shared/types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Avatar from '@/components/Avatar.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'
import { statusBg, taskLabel, ago } from '@/components/status'

const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()
const id = computed(() => route.params.id as string)
const view = ref<'board' | 'list'>('board')
const agentF = ref('')
const missionF = ref('')
const team = computed(() => data.agentsIn(id.value))
const all = computed(() => data.tasksIn(id.value))
const missions = computed(() => [...new Set(all.value.map((t) => t.missionId).filter(Boolean))] as string[])
const tasks = computed(() =>
  all.value.filter((t) => (!agentF.value || t.assigneeId === agentF.value) && (!missionF.value || (missionF.value === 'manual' ? !t.missionId : t.missionId === missionF.value)))
)
const COLS: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'review', 'done']
const cols = computed(() =>
  COLS.map((s) => {
    const items = tasks.value.filter((t) => t.status === s).sort((a, b) => (s === 'done' ? (b.doneAt ?? '').localeCompare(a.doneAt ?? '') : a.id.localeCompare(b.id)))
    return { s, n: items.length, items: s === 'done' ? items.slice(0, 12) : items }
  })
)
const PRI: Record<string, string> = { high: 'text-status-danger', medium: 'text-ink-muted', low: 'text-ink-faint' }
const ring: Partial<Record<TaskStatus, string>> = { in_progress: 'border-status-working/40', blocked: 'border-status-blocked/40', review: 'border-status-review/40' }
const noteTone: Partial<Record<TaskStatus, string>> = { in_progress: 'text-status-working', blocked: 'text-status-danger', review: 'text-status-review' }

const showNew = ref(route.query.new === '1')
const form = reactive({ title: '', assigneeId: team.value[0]?.id ?? '', priority: 'medium' as Task['priority'], description: '', criteria: '', start: true })
async function create(): Promise<void> {
  if (!form.title.trim() || !form.assigneeId) return
  const t = await ui.act(() =>
    invoke('task:create', {
      workspaceId: id.value, title: form.title.trim(), assigneeId: form.assigneeId, status: 'todo', priority: form.priority, dependsOn: [],
      criteria: form.criteria.split('\n').map((c) => c.trim()).filter(Boolean).map((text) => ({ text, done: false }))
    })
  )
  if (!t) return
  if (form.description.trim()) await invoke('task:update', t.id, { description: form.description.trim() })
  if (form.start) await ui.act(() => invoke('task:start', t.id))
  showNew.value = false
  Object.assign(form, { title: '', description: '', criteria: '' })
  router.push(`/w/${id.value}/tasks/${t.id}`)
}
</script>

<template>
  <DrawerPanel label="Task board" :close-to="`/w/${id}`">
    <template #header>
      <h1 class="m-0 text-title">Tasks <span class="text-[13px] font-normal text-ink-faint">{{ all.length }} total</span></h1>
      <div class="seg" role="group" aria-label="View">
        <button type="button" :aria-pressed="view === 'board'" @click="view = 'board'">Board</button>
        <button type="button" :aria-pressed="view === 'list'" @click="view = 'list'">List</button>
      </div>
      <div class="flex-1" />
      <button class="btn btn-sm btn-pri" type="button" @click="showNew = !showNew">+ New task</button>
    </template>
    <div class="flex flex-wrap items-center gap-2.5 border-b border-line-soft px-5 py-2.5">
      <span class="text-[13px] text-ink-muted">Plan, delegate and track work across your AI team.</span>
      <div class="flex-1" />
      <label class="flex items-center gap-1.5 text-small text-ink-muted">Agent
        <select v-model="agentF" class="field min-h-[34px] w-auto"><option value="">All</option><option v-for="a in team" :key="a.id" :value="a.id">{{ a.name }}</option></select></label>
      <label class="flex items-center gap-1.5 text-small text-ink-muted">Mission
        <select v-model="missionF" class="field min-h-[34px] w-auto"><option value="">All</option><option v-for="m in missions" :key="m" :value="m">{{ m }}</option><option value="manual">Manual</option></select></label>
    </div>

    <form v-if="showNew" class="grid grid-cols-2 gap-3 border-b border-line-soft bg-sidebar px-5 py-4" @submit.prevent="create">
      <div class="col-span-2"><label class="field-label" for="nt">Title</label><input id="nt" v-model="form.title" class="field" placeholder="What needs doing?" autofocus /></div>
      <div><label class="field-label" for="na">Assignee</label><select id="na" v-model="form.assigneeId" class="field"><option v-for="a in team" :key="a.id" :value="a.id">{{ a.name }} · {{ a.role }}</option></select></div>
      <div><label class="field-label" for="npr">Priority</label><select id="npr" v-model="form.priority" class="field"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      <div><label class="field-label" for="nd">Details</label><textarea id="nd" v-model="form.description" class="field" rows="3" /></div>
      <div><label class="field-label" for="nc">Acceptance criteria (one per line)</label><textarea id="nc" v-model="form.criteria" class="field" rows="3" /></div>
      <div class="col-span-2 flex items-center gap-3">
        <label class="flex items-center gap-2 text-small text-ink-muted"><input v-model="form.start" type="checkbox" class="size-4" /> Start now</label>
        <div class="flex-1" />
        <button class="btn btn-ghost" type="button" @click="showNew = false">Cancel</button>
        <button class="btn btn-pri" type="submit" :disabled="!form.title.trim()">Create task</button>
      </div>
    </form>

    <div v-if="view === 'board'" class="min-h-0 flex-1 overflow-auto px-4 pt-3.5 pb-[18px]">
      <div class="flex min-w-max items-start gap-2.5">
        <div v-for="c in cols" :key="c.s" class="flex w-[188px] flex-col gap-2 rounded-card border border-line-soft bg-sidebar p-2.5">
          <div class="flex items-center gap-2">
            <span class="dot" :class="statusBg[c.s]" /><span class="lbl !text-ink">{{ taskLabel[c.s] }}</span>
            <span class="rounded-full bg-raised px-1.5 text-[11px] text-ink-muted">{{ c.n }}</span>
          </div>
          <RouterLink v-for="t in c.items" :key="t.id" :to="`/w/${id}/tasks/${t.id}`" class="flex flex-col gap-1.5 rounded-row border bg-card p-2.5 text-ink no-underline hover:border-accent hover:text-ink" :class="ring[t.status] ?? 'border-line'">
            <span class="flex items-center gap-2"><span class="mono text-tiny text-ink-faint">{{ t.id }}</span><span class="flex-1" /><span class="chip px-1.5 text-[11px]">{{ t.missionId ?? (t.qaOf ? 'QA' : 'Manual') }}</span></span>
            <span class="text-[13.5px] font-medium">{{ t.title }}</span>
            <span v-if="t.note" class="text-xs" :class="noteTone[t.status] ?? 'text-ink-faint'">{{ t.note }}</span>
            <span class="flex items-center gap-2">
              <Avatar :name="data.nameOf(t.assigneeId)" :color="data.agent(t.assigneeId)?.look.color" :size="22" />
              <span class="text-xs text-ink-faint">{{ data.nameOf(t.assigneeId) }}</span><span class="flex-1" />
              <span class="text-tiny capitalize" :class="PRI[t.priority]">{{ t.priority }}</span>
            </span>
          </RouterLink>
        </div>
      </div>
    </div>
    <div v-else class="min-h-0 flex-1 overflow-auto">
      <table class="w-full border-collapse text-[13px]">
        <thead class="sticky top-0 bg-drawer"><tr class="text-left"><th class="lbl px-4 py-2">Task</th><th class="lbl px-3 py-2">Status</th><th class="lbl px-3 py-2">Assignee</th><th class="lbl px-3 py-2">Mission</th><th class="lbl px-3 py-2">Created</th></tr></thead>
        <tbody>
          <tr v-for="t in tasks" :key="t.id" class="cursor-pointer border-t border-line-soft hover:bg-raised" @click="router.push(`/w/${id}/tasks/${t.id}`)">
            <td class="px-4 py-2"><RouterLink :to="`/w/${id}/tasks/${t.id}`" class="text-ink"><span class="mono text-ink-faint">{{ t.id }}</span> {{ t.title }}</RouterLink></td>
            <td class="px-3 py-2"><span class="flex items-center gap-1.5"><span class="dot" :class="statusBg[t.status]" />{{ taskLabel[t.status] }}</span></td>
            <td class="px-3 py-2">{{ data.nameOf(t.assigneeId) }}</td>
            <td class="px-3 py-2 text-ink-muted">{{ t.missionId ?? 'Manual' }}</td>
            <td class="px-3 py-2 text-ink-faint">{{ ago(t.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </DrawerPanel>
</template>
