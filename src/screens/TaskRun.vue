<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Run, RunEvent } from '@shared/types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Avatar from '@/components/Avatar.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke, on } from '@/lib/ipc'
import { duration, md, statusBg, taskLabel, timeShort } from '@/components/status'

const route = useRoute()
const data = useData()
const ui = useUi()
const wsId = computed(() => route.params.id as string)

/** /activity shows the most recent run in the workspace. */
const taskId = computed(() => {
  if (route.params.taskId) return route.params.taskId as string
  const runs = (data.snap?.runs ?? []).filter((r) => data.task(r.taskId)?.workspaceId === wsId.value)
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.taskId
})
const task = computed(() => data.task(taskId.value))
const agent = computed(() => data.agent(task.value?.assigneeId))
const runs = ref<(Run & { live?: boolean; accountId?: string })[]>([])
const runIdx = ref(0)
const run = computed(() => runs.value[runIdx.value])
const live = computed(() => !!run.value?.live)

async function loadRuns(): Promise<void> {
  if (!taskId.value) {
    runs.value = []
    return
  }
  const list = await invoke('run:list', taskId.value).catch(() => [])
  const keep = run.value?.id
  runs.value = [...list].reverse()
  const i = runs.value.findIndex((r) => r.id === keep)
  runIdx.value = i >= 0 ? i : 0
}
watch(taskId, loadRuns, { immediate: true })
// a refetch of the snapshot means run metadata may have changed (ended, report, files)
watch(() => data.snap?.runs.filter((r) => r.taskId === taskId.value).map((r) => [r.id, r.endedAt, r.tokens].join()).join(), loadRuns)
const off = on('run:event', ({ runId, event }) => {
  const r = runs.value.find((x) => x.id === runId)
  const last = r?.events.at(-1)
  if (r && !(last && last.t === event.t && last.title === event.title)) r.events.push(event)
})
onBeforeUnmount(off)

const tab = ref(0)
const files = computed(() => run.value?.filesChanged ?? [])
const views = computed(() => ['Transcript', 'Report', `Files (${files.value.length})`, 'Terminal'])
const DOTC: Record<RunEvent['kind'], string> = {
  received: 'bg-accent', read: 'bg-status-idle', edit: 'bg-status-idle', command: 'bg-status-idle', commit: 'bg-status-done', message: 'bg-accent-link', thinking: 'bg-status-idle'
}
const events = computed(() => run.value?.events.filter((e) => e.kind !== 'thinking' || tab.value === 0) ?? [])
const terminal = computed(() =>
  (run.value?.events ?? [])
    .filter((e) => e.kind === 'command' || e.kind === 'commit' || e.level === 'warn' || e.level === 'error')
    .map((e) => (e.code ? e.code : `# ${e.title}${e.text ? ': ' + e.text : ''}`))
    .join('\n')
)
const blocks = computed(() => data.tasksIn(wsId.value).filter((t) => t.dependsOn.includes(taskId.value ?? '')))
const mission = computed(() => data.snap?.missions.find((m) => m.id === task.value?.missionId))
const deps = computed(() => (task.value?.dependsOn ?? []).map((d) => data.task(d)).filter(Boolean))
const skills = computed(() => data.snap?.skills.filter((s) => agent.value?.skillIds.includes(s.id)) ?? [])
const account = computed(() => data.account(run.value?.accountId ?? agent.value?.accountId))
const usagePct = computed(() => (account.value && run.value ? ((run.value.tokens / account.value.budgetTokens) * 100).toFixed(1) : '0'))

const steer = ref('')
const steerBox = ref<HTMLInputElement>()
async function sendSteer(): Promise<void> {
  const t = steer.value.trim()
  if (!t || !run.value) return
  steer.value = ''
  await ui.act(() => invoke('run:steer', run.value!.id, t), 'Sent at the next step')
}
const start = () => task.value && ui.act(() => invoke('task:start', task.value!.id), 'Run started').then(() => setTimeout(loadRuns, 400))
const stop = () => run.value && ui.act(() => invoke('run:stop', run.value!.id), 'Stopping run')
const reassign = (aid: string) => task.value && ui.act(() => invoke('task:update', task.value!.id, { assigneeId: aid }), `Reassigned to ${data.nameOf(aid)}`)
function toggleCriterion(i: number): void {
  if (!task.value) return
  const criteria = task.value.criteria.map((c, k) => (k === i ? { ...c, done: !c.done } : c))
  ui.act(() => invoke('task:update', task.value!.id, { criteria }))
}
const showReassign = ref(false)
</script>

<template>
  <DrawerPanel label="Task run" :close-to="`/w/${wsId}/tasks`">
    <template #header>
      <template v-if="task">
        <span class="mono text-ink-faint">{{ task.id }}</span>
        <h1 class="m-0 text-title">{{ task.title }}</h1>
        <span class="chip" :class="live ? 'border-status-working/50 text-status-working' : ''">
          <span class="dot" :class="live ? 'bg-status-working' : statusBg[task.status]" />{{ live ? `Running · ${duration(run?.startedAt)}` : taskLabel[task.status] }}
        </span>
        <span class="chip capitalize">{{ task.priority }}</span>
        <div class="flex-1" />
        <button v-if="live" class="btn btn-sm" type="button" @click="steerBox?.focus()">Message {{ agent?.name }}</button>
        <div class="relative">
          <button class="btn btn-sm" type="button" :aria-expanded="showReassign" @click="showReassign = !showReassign">Reassign</button>
          <div v-if="showReassign" class="absolute top-10 right-0 z-10 flex w-56 flex-col rounded-row border border-line-strong bg-drawer p-1 shadow-tag">
            <button v-for="a in data.agentsIn(wsId)" :key="a.id" type="button" class="cursor-pointer rounded-control border-0 bg-transparent px-2.5 py-2 text-left text-ink hover:bg-raised" @click="reassign(a.id), (showReassign = false)">{{ a.name }} <span class="text-ink-faint">· {{ a.role }}</span></button>
          </div>
        </div>
        <button v-if="live" class="btn btn-sm btn-danger border-status-blocked/40" type="button" @click="stop">Stop run</button>
        <button v-else-if="task.status !== 'done'" class="btn btn-sm btn-pri" type="button" @click="start">{{ runs.length ? 'Run again' : 'Start run' }}</button>
      </template>
      <h1 v-else class="m-0 text-title">No runs yet</h1>
    </template>
    <div v-if="task" class="flex min-h-0 flex-1 flex-wrap overflow-auto">
      <section aria-label="Run" class="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5 px-5 pt-1 pb-[18px]">
        <div class="flex items-center gap-2 border-b border-line-soft" role="tablist" aria-label="Run views">
          <button v-for="(v, i) in views" :key="v" type="button" role="tab" :aria-selected="tab === i" class="-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-2 py-3 text-[13px] font-medium" :class="tab === i ? 'border-accent text-ink' : 'border-transparent text-ink-muted'" @click="tab = i">{{ v }}</button>
          <div class="flex-1" />
          <select v-if="runs.length > 1" v-model="runIdx" aria-label="Run" class="field min-h-8 w-auto text-small">
            <option v-for="(r, i) in runs" :key="r.id" :value="i">Run {{ runs.length - i }} · {{ timeShort(r.startedAt) }}</option>
          </select>
        </div>
        <p v-if="!run" class="text-ink-faint">This task hasn't run yet. {{ task.status === 'todo' ? 'Start it, or let the orchestrator pick it up.' : '' }}</p>
        <div v-else-if="tab === 0" class="flex flex-col">
          <div v-for="(e, i) in events" :key="i" class="flex gap-3 pb-3.5">
            <span class="flex flex-col items-center gap-1"><span class="dot mt-[5px] size-2.5" :class="e.level === 'error' ? 'bg-status-blocked' : e.level === 'warn' ? 'bg-status-review' : live && i === events.length - 1 ? 'bg-status-working' : DOTC[e.kind]" /><span class="w-px flex-1 bg-line" /></span>
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <div class="flex items-baseline gap-2"><span class="text-[13.5px] font-medium">{{ e.title }}</span><span class="mono text-[11px] text-ink-faint">{{ live && i === events.length - 1 ? 'now' : timeShort(e.t) }}</span></div>
              <div v-if="e.code" class="term">{{ e.code }}</div>
              <div v-if="e.text" class="text-[13px] whitespace-pre-wrap" :class="e.level === 'error' ? 'text-status-danger' : e.kind === 'message' ? 'text-ink' : 'text-ink-muted'">{{ e.kind === 'thinking' ? e.text.slice(0, 280) : e.text }}</div>
            </div>
          </div>
        </div>
        <div v-else-if="tab === 1" class="card flex flex-col gap-2.5 p-4 text-[13.5px]">
          <div class="lbl">Agent report{{ live ? ' · draft until the run ends' : '' }}</div>
          <div v-if="run.report" class="md" v-html="md(run.report)" />
          <p v-else class="m-0 text-ink-faint">No report yet.</p>
        </div>
        <div v-else-if="tab === 2" class="card mono py-1.5 text-small">
          <RouterLink v-for="f in files" :key="f.path" :to="`/w/${wsId}/changes/${run.branch}`" class="flex justify-between px-3.5 py-2 text-ink no-underline hover:bg-raised">
            <span>{{ f.path }}</span><span><span class="text-status-working">+{{ f.additions }}</span> <span class="text-status-danger">−{{ f.deletions }}</span></span>
          </RouterLink>
          <p v-if="!files.length" class="m-0 px-3.5 py-2 font-sans text-ink-faint">No file changes{{ live ? ' yet' : '' }}.</p>
        </div>
        <div v-else class="term min-h-[280px]">{{ terminal || '(no commands)' }}{{ live ? '\n▌' : '' }}</div>
        <form v-if="live" class="card mt-auto flex items-center gap-2 p-2" @submit.prevent="sendSteer">
          <label for="steer" class="sr-only">Steer this run</label>
          <input id="steer" ref="steerBox" v-model="steer" class="field border-0 bg-transparent" :placeholder="`Steer ${agent?.name} mid-run… (sent at the next step)`" />
          <button class="btn btn-sm btn-pri" type="submit">Send</button>
        </form>
      </section>
      <section aria-label="Task details" class="flex flex-[1_1_280px] flex-col gap-4 border-l border-line-soft bg-sidebar p-[18px]">
        <dl class="m-0 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[13px]">
          <dt class="text-ink-faint">Assignee</dt><dd class="m-0 flex items-center gap-2"><Avatar :name="agent?.name ?? '?'" :color="agent?.look.color" :size="22" />{{ agent?.name ?? '—' }}</dd>
          <dt class="text-ink-faint">Created by</dt><dd class="m-0">{{ data.nameOf(task.createdBy) }}{{ data.agent(task.createdBy)?.kind === 'orchestrator' ? ' (orchestrator)' : '' }}</dd>
          <dt class="text-ink-faint">Mission</dt><dd class="m-0">{{ mission ? `${mission.id} · ${mission.title}` : 'Manual' }}</dd>
          <dt class="text-ink-faint">Branch</dt><dd class="mono m-0 text-xs break-all">{{ task.qaOf ?? task.branch ?? '—' }}</dd>
          <dt class="text-ink-faint">Model</dt><dd class="m-0">{{ agent?.model }} · {{ account?.name }}</dd>
          <dt class="text-ink-faint">Usage</dt><dd class="m-0">{{ run ? `${Math.round(run.tokens / 1000)}k tokens · ≈ ${usagePct}% of limit` : '—' }}</dd>
          <dt class="text-ink-faint">Depends on</dt>
          <dd class="m-0"><template v-for="d in deps" :key="d!.id"><RouterLink :to="`/w/${wsId}/tasks/${d!.id}`" class="mono">{{ d!.id }}</RouterLink> <span class="text-status-done">{{ taskLabel[d!.status].toLowerCase() }}</span>&nbsp;</template><span v-if="!deps.length">—</span></dd>
          <dt class="text-ink-faint">Blocks</dt>
          <dd class="m-0"><template v-for="b in blocks" :key="b.id"><RouterLink :to="`/w/${wsId}/tasks/${b.id}`" class="mono">{{ b.id }}</RouterLink>&nbsp;</template><span v-if="!blocks.length">—</span></dd>
        </dl>
        <div v-if="task.description" class="text-[13px] whitespace-pre-wrap text-ink-muted">{{ task.description }}</div>
        <div v-if="task.criteria.length">
          <div class="lbl mb-2">Acceptance criteria</div>
          <div class="flex flex-col gap-2 text-[13px]">
            <label v-for="(c, i) in task.criteria" :key="i" class="flex gap-2"><input type="checkbox" :checked="c.done" @change="toggleCriterion(i)" /> {{ c.text }}</label>
          </div>
        </div>
        <div>
          <div class="lbl mb-2">Context given</div>
          <div class="flex flex-wrap gap-1.5">
            <span class="chip">Workspace goal</span>
            <span v-for="d in deps" :key="d!.id" class="chip mono">{{ d!.id }} report</span>
            <span v-for="s in skills" :key="s.id" class="chip">{{ s.name }} skill</span>
          </div>
        </div>
        <RouterLink v-if="task.branch || task.qaOf" class="btn mt-auto" :to="`/w/${wsId}/changes/${task.qaOf ?? task.branch}`">View branch in Changes</RouterLink>
      </section>
    </div>
  </DrawerPanel>
</template>
