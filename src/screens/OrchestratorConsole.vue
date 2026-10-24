<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Orchestrator } from '@shared/types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Avatar from '@/components/Avatar.vue'
import Icon from '@/components/Icon.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'
import { timeShort } from '@/components/status'

const route = useRoute()
const data = useData()
const ui = useUi()
const id = computed(() => route.params.id as string)
const orch = computed(() => data.orchestratorOf(id.value) as Orchestrator | undefined)
const paused = computed(() => data.snap?.paused.includes(id.value) ?? false)
const missions = computed(() => [...(data.snap?.missions ?? [])].filter((m) => m.workspaceId === id.value).reverse())
const missionId = ref<string>((route.query.mission as string) ?? '')
watch(missions, (ms) => {
  if (!ms.some((m) => m.id === missionId.value)) missionId.value = (ms.find((m) => m.status === 'running') ?? ms[0])?.id ?? ''
}, { immediate: true })
const mission = computed(() => missions.value.find((m) => m.id === missionId.value))

type Node = { id: string; title: string; who: string; color?: string; st: string; tone: string; ring: boolean; dep: string; to?: string }
const ST: Record<string, [string, string]> = {
  done: ['Done', 'bg-status-done text-status-done'],
  in_progress: ['Running', 'bg-status-working text-status-working'],
  todo: ['Queued', 'bg-status-idle text-ink-faint'],
  review: ['Needs you', 'bg-status-review text-status-review'],
  blocked: ['Blocked', 'bg-status-blocked text-status-blocked'],
  planned: ['Planned', 'bg-status-idle text-ink-faint']
}
const lanes = computed(() => {
  const m = mission.value
  if (!m) return []
  const buckets: Record<string, Node[]> = { Research: [], Build: [], QA: [], Approve: [] }
  m.steps.forEach((s) => {
    const t = s.taskId ? data.task(s.taskId) : undefined
    const a = data.agent(s.assigneeId)
    const role = a?.role ?? ''
    const lane = s.gate ? 'Approve' : /qa|test/i.test(role) ? 'QA' : /research|market/i.test(role) ? 'Research' : 'Build'
    const st = t?.status ?? 'planned'
    buckets[lane].push({
      id: t?.id ?? '—', title: s.title, who: data.nameOf(s.assigneeId), color: a?.look.color, st: ST[st][0], tone: ST[st][1],
      ring: st === 'in_progress', dep: (t?.dependsOn ?? s.dependsOn ?? []).length ? '← ' + (t?.dependsOn ?? s.dependsOn ?? []).join(', ') : '',
      to: t ? `/w/${id.value}/tasks/${t.id}` : undefined
    })
  })
  return Object.entries(buckets).filter(([, n]) => n.length).map(([name, nodes]) => ({ name, nodes }))
})

const log = computed(() => (data.snap?.delegation ?? []).filter((e) => e.workspaceId === id.value).slice(-80))
const logBox = ref<HTMLDivElement>()
watch(() => log.value.length, async () => {
  await nextTick()
  logBox.value?.scrollTo({ top: logBox.value.scrollHeight })
}, { immediate: true })
const steer = ref('')
const sending = ref(false)
async function send(): Promise<void> {
  const t = steer.value.trim()
  if (!t) return
  steer.value = ''
  sending.value = true
  await ui.act(() => invoke('orchestrator:message', id.value, t))
  sending.value = false
}

const planning = ref(false)
const showNew = ref(false)
const prompt = ref('')
async function plan(): Promise<void> {
  const p = prompt.value.trim()
  if (!p) return
  planning.value = true
  const m = await ui.act(() => invoke('mission:plan', id.value, p, 'user'))
  planning.value = false
  if (m) {
    missionId.value = m.id
    showNew.value = false
    prompt.value = ''
  }
}
const togglePause = () => ui.act(() => invoke('orchestrator:setPaused', id.value, !paused.value))

// routing rules + limits edit the orchestrator record
const team = computed(() => data.agentsIn(id.value))
const newRule = ref<{ match: string; assignee: string; then: string } | null>(null)
async function save(patch: Partial<Orchestrator>): Promise<void> {
  if (!orch.value) return
  await ui.act(() => invoke('orchestrator:save', { ...orch.value!, ...patch }))
}
async function addRule(): Promise<void> {
  const r = newRule.value
  if (!r || !r.match || !r.assignee || !orch.value) return
  await save({ routingRules: [...orch.value.routingRules, { match: r.match, assigneeIds: [r.assignee], then: r.then || undefined }] })
  newRule.value = null
}
const removeRule = (i: number) => orch.value && save({ routingRules: orch.value.routingRules.filter((_, k) => k !== i) })
const missionApprove = () => mission.value && ui.act(() => invoke('mission:approve', mission.value!.id), 'Mission started')
</script>

<template>
  <DrawerPanel label="Orchestrator console" :close-to="`/w/${id}`">
    <template #header>
      <template v-if="orch">
        <Avatar :name="orch.name" :color="orch.look.color" :size="30" square />
        <h1 class="m-0 text-title">{{ orch.name }} <span class="text-[13px] font-normal text-ink-faint">Orchestrator</span></h1>
        <span class="chip mono">{{ orch.model }} · {{ orch.thinking }}</span>
      </template>
      <h1 v-else class="m-0 text-title">No orchestrator</h1>
      <div class="flex-1" />
      <button class="btn btn-sm" type="button" :aria-pressed="paused" @click="togglePause">{{ paused ? 'Resume' : 'Pause' }}</button>
      <button class="btn btn-sm btn-pri" type="button" :disabled="!orch" @click="showNew = !showNew">+ New mission</button>
    </template>
    <div v-if="!orch" class="p-6 text-ink-muted">This workspace has no orchestrator. <RouterLink :to="`/w/${id}/settings`">Set one up</RouterLink>.</div>
    <div v-else class="flex min-h-0 flex-1 flex-wrap overflow-auto">
      <section aria-label="Mission plan" class="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px] px-5 py-[18px]">
        <form v-if="showNew" class="card flex flex-col gap-2 border-accent-ring p-3" @submit.prevent="plan">
          <label for="np" class="field-label">What should {{ orch.name }} get done?</label>
          <textarea id="np" v-model="prompt" class="field" rows="3" placeholder="e.g. Add a dark mode toggle to the settings page and test it" />
          <div class="flex gap-2"><button class="btn btn-pri" type="submit" :disabled="planning">{{ planning ? 'Planning…' : 'Plan mission' }}</button><button class="btn btn-ghost" type="button" @click="showNew = false">Cancel</button></div>
        </form>
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[240px] flex-1">
            <div v-if="mission" class="lbl" :class="mission.status === 'running' ? '!text-status-working' : mission.status === 'awaiting_approval' ? '!text-status-review' : ''">
              Mission {{ mission.id }} · {{ mission.status.replace('_', ' ') }} · from {{ mission.source }}
            </div>
            <h2 class="m-0 mt-1 text-[19px] font-semibold">{{ mission?.title ?? 'No missions yet' }}</h2>
          </div>
          <label v-if="missions.length" class="flex items-center gap-1.5 text-small text-ink-muted">
            Mission
            <select v-model="missionId" class="field min-h-9 w-auto"><option v-for="m in missions" :key="m.id" :value="m.id">{{ m.id }} {{ m.title }}</option></select>
          </label>
        </div>
        <div v-if="mission" class="card overflow-x-auto p-3.5">
          <div class="grid min-w-[640px]" :style="{ gridTemplateColumns: `repeat(${lanes.length}, minmax(150px, 1fr))` }">
            <div v-for="(l, li) in lanes" :key="l.name" class="flex flex-col gap-2.5 px-2" :class="li ? 'border-l border-dashed border-line' : ''">
              <div class="flex justify-between"><span class="lbl">{{ l.name }}</span><span v-if="li < lanes.length - 1" class="text-xs text-ink-faint">→</span></div>
              <component :is="n.to ? 'RouterLink' : 'div'" v-for="n in l.nodes" :key="n.id + n.title" :to="n.to" class="flex flex-col gap-1.5 rounded-row border bg-sidebar p-2.5 text-ink no-underline hover:text-ink" :class="n.ring ? 'border-status-working/50' : 'border-line'">
                <span class="flex items-center gap-1.5"><span class="mono text-[11px] text-ink-faint">{{ n.id }}</span><span class="flex-1" /><span class="dot" :class="n.tone.split(' ')[0]" /><span class="text-[11px]" :class="n.tone.split(' ')[1]">{{ n.st }}</span></span>
                <span class="text-[13px] font-medium">{{ n.title }}</span>
                <span class="flex items-center gap-1.5 text-xs"><Avatar :name="n.who" :color="n.color" :size="20" /><span class="text-ink-faint">{{ n.who }}</span><span class="flex-1" /><span class="mono text-[11px] text-ink-faint">{{ n.dep }}</span></span>
              </component>
            </div>
          </div>
          <div v-if="mission.status === 'awaiting_approval' || mission.status === 'draft'" class="mt-3 flex gap-2"><button class="btn btn-sm btn-pri" type="button" @click="missionApprove">Approve &amp; start</button></div>
        </div>
        <div class="flex flex-wrap gap-3.5">
          <div class="card flex-[2_1_320px] overflow-x-auto">
            <div class="flex items-center justify-between px-3 pt-2.5 pb-0.5"><h3 class="lbl m-0">Routing rules</h3><button class="btn btn-sm btn-ghost" type="button" @click="newRule = { match: '', assignee: team[0]?.id ?? '', then: '' }">+ Rule</button></div>
            <table class="w-full border-collapse text-[13px]">
              <thead><tr class="text-left"><th class="lbl px-3 py-2">When a task is about…</th><th class="lbl px-3 py-2">Send to</th><th class="lbl px-3 py-2">Then</th><th><span class="sr-only">Remove</span></th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in orch.routingRules" :key="i" class="border-t border-line-soft">
                  <td class="px-3 py-2">{{ r.match }}</td>
                  <td class="px-3 py-2">{{ r.assigneeIds.map(data.nameOf).join(', ') }}</td>
                  <td class="px-3 py-2 text-ink-muted">{{ r.then ?? '—' }}</td>
                  <td class="pr-2"><button type="button" class="x-close size-7 cursor-pointer border-0 bg-transparent text-base" :aria-label="`Remove rule ${r.match}`" @click="removeRule(i)">×</button></td>
                </tr>
                <tr v-if="newRule" class="border-t border-line-soft">
                  <td class="p-1.5"><input v-model="newRule.match" aria-label="Topic" class="field min-h-8" placeholder="Topic" /></td>
                  <td class="p-1.5"><select v-model="newRule.assignee" aria-label="Agent" class="field min-h-8"><option v-for="a in team" :key="a.id" :value="a.id">{{ a.name }}</option></select></td>
                  <td class="p-1.5"><input v-model="newRule.then" aria-label="Then" class="field min-h-8" placeholder="e.g. QA by Kei" /></td>
                  <td class="pr-1.5"><button class="btn btn-sm btn-pri" type="button" @click="addRule">Add</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card flex flex-[1_1_200px] flex-col gap-2 px-3.5 py-3 text-[13px]">
            <h3 class="lbl m-0">Limits</h3>
            <label class="flex items-center justify-between"><span class="text-ink-muted">Parallel agents</span>
              <select class="field min-h-8 w-16" :value="orch.parallelLimit" @change="save({ parallelLimit: Number(($event.target as HTMLSelectElement).value) })"><option v-for="n in [1, 2, 3, 4, 6, 9]" :key="n" :value="n">{{ n }}</option></select></label>
            <label class="flex items-center justify-between"><span class="text-ink-muted">Retries / task</span>
              <select class="field min-h-8 w-16" :value="orch.retriesPerTask" @change="save({ retriesPerTask: Number(($event.target as HTMLSelectElement).value) })"><option v-for="n in [0, 1, 2, 3]" :key="n" :value="n">{{ n }}</option></select></label>
            <label class="flex items-center justify-between"><span class="text-ink-muted">Autonomy</span>
              <select class="field min-h-8 w-auto" :value="orch.autonomy" @change="save({ autonomy: ($event.target as HTMLSelectElement).value as Orchestrator['autonomy'] })">
                <option value="propose_only">Propose only</option><option value="run_small_plans">Small plans</option><option value="autopilot">Autopilot</option></select></label>
            <div class="flex justify-between"><span class="text-ink-muted">Auto-start up to</span><b>{{ data.snap?.jarvis.limits.maxPlanTasks }} tasks</b></div>
          </div>
        </div>
      </section>
      <section aria-label="Delegation log and chat" class="flex flex-[1_1_300px] flex-col border-l border-line-soft bg-sidebar">
        <div class="lbl px-4 pt-3.5 pb-1.5">Decisions &amp; delegation</div>
        <div ref="logBox" class="flex max-h-[calc(100vh-330px)] flex-1 flex-col gap-3 overflow-auto px-4 pt-1.5 pb-3">
          <template v-for="e in log" :key="e.id">
            <div v-if="e.tone === 'user'" class="max-w-[88%] self-end rounded-[12px_12px_2px_12px] bg-accent-active px-3 py-2 text-small">{{ e.text }}</div>
            <div v-else-if="e.tone === 'orchestrator'" class="max-w-[94%] rounded-[12px_12px_12px_2px] border border-line bg-card px-3 py-2 text-small">{{ e.text }}</div>
            <div v-else class="flex gap-2.5 text-small">
              <span class="mono w-[38px] flex-none pt-px text-[11px] text-ink-faint">{{ timeShort(e.t) }}</span>
              <span class="flex-1" :class="{ 'text-status-working': e.tone === 'good', 'text-accent-link': e.tone === 'merge', 'text-status-danger': e.tone === 'bad', 'text-ink-muted': e.tone === 'info' }">{{ e.text }}</span>
            </div>
          </template>
          <div v-if="sending" class="text-small text-ink-faint">{{ orch.name }} is thinking…</div>
        </div>
        <form class="flex gap-2 border-t border-line-soft px-3.5 pt-2.5 pb-3.5" @submit.prevent="send">
          <label for="omsg" class="sr-only">Message the orchestrator</label>
          <input id="omsg" v-model="steer" class="field" placeholder="Steer this mission…" />
          <button class="btn btn-icon btn-pri" type="submit" aria-label="Send" :disabled="sending"><Icon name="send" :size="16" /></button>
        </form>
      </section>
    </div>
  </DrawerPanel>
</template>
