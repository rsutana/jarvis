<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Automation } from '@shared/types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Toggle from '@/components/Toggle.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'
import { timeShort } from '@/components/status'

const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()
const list = computed(() => data.snap?.automations ?? [])
const selId = computed(() => (route.params.automationId as string) ?? list.value[0]?.id)

/** Human text for the cron presets the editor offers; anything else shows raw. */
const PRESETS: { label: string; build: (h: number, m: number) => string; match: RegExp }[] = [
  { label: 'Every weekday', build: (h, m) => `${m} ${h} * * 1-5`, match: /^\d+ \d+ \* \* 1-5$/ },
  { label: 'Every day', build: (h, m) => `${m} ${h} * * *`, match: /^\d+ \d+ \* \* \*$/ },
  { label: 'Weekly (Mondays)', build: (h, m) => `${m} ${h} * * 1`, match: /^\d+ \d+ \* \* 1$/ }
]
const SHORT: Record<string, string> = { 'Every weekday': 'Weekdays', 'Every day': 'Every day', 'Weekly (Mondays)': 'Mondays' }
function describe(a: Automation): string {
  const t = a.trigger
  if (t.type === 'email') return `New email · ${data.snap?.integrations.find((i) => i.id === t.integrationId)?.name ?? 'integration'}`
  if (t.type === 'git') return `Git ${t.event}`
  if (t.type === 'webhook') return `Webhook ${t.path}`
  const [m, h] = t.cron.split(' ')
  const p = PRESETS.find((x) => x.match.test(t.cron))
  const time = /^\d+$/.test(h) && /^\d+$/.test(m) ? new Date(2000, 0, 1, Number(h), Number(m)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
  return p ? `${SHORT[p.label]} ${time}` : t.cron
}
const target = (a: Automation) => (a.target === 'jarvis' ? 'Jarvis' : (data.workspace(a.target.workspaceId)?.name ?? '?'))
const LAST: Record<string, string> = { succeeded: 'text-status-working', failed: 'text-status-danger', waiting: 'text-status-review' }

const draft = ref<Automation | null>(null)
const preset = ref('custom')
const time = ref('09:00')
watch([selId, () => list.value.find((a) => a.id === selId.value)], ([id, a]) => {
  if (draft.value?.id === id && draft.value.id) return
  draft.value = a ? JSON.parse(JSON.stringify(a)) : null
  syncPreset()
}, { immediate: true })
function syncPreset(): void {
  const t = draft.value?.trigger
  if (t?.type !== 'schedule') return
  const [m, h] = t.cron.split(' ')
  preset.value = PRESETS.find((p) => p.match.test(t.cron))?.label ?? 'custom'
  if (/^\d+$/.test(h) && /^\d+$/.test(m)) time.value = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}
watch([preset, time], () => {
  const t = draft.value?.trigger
  if (t?.type !== 'schedule' || preset.value === 'custom') return
  const [h, m] = time.value.split(':').map(Number)
  t.cron = PRESETS.find((p) => p.label === preset.value)!.build(h, m)
})
function setTrigger(type: Automation['trigger']['type']): void {
  if (!draft.value) return
  draft.value.trigger =
    type === 'schedule' ? { type, cron: '0 9 * * 1-5' } : type === 'email' ? { type, integrationId: data.snap?.integrations.find((i) => i.type === 'gmail')?.id ?? '' } : type === 'git' ? { type, event: 'merge' } : { type, path: '/hooks/' + Math.random().toString(36).slice(2, 8) }
  syncPreset()
}
const targetValue = computed({
  get: () => (draft.value?.target === 'jarvis' ? 'jarvis' : (draft.value?.target.workspaceId ?? '')),
  set: (v: string) => draft.value && (draft.value.target = v === 'jarvis' ? 'jarvis' : { workspaceId: v })
})
function create(): void {
  draft.value = { id: '', name: 'New automation', trigger: { type: 'schedule', cron: '0 9 * * 1-5' }, target: data.workspaces[0] ? { workspaceId: data.workspaces[0].id } : 'jarvis', prompt: '', overLimit: 'ask', enabled: true }
  syncPreset()
}
async function save(): Promise<void> {
  if (!draft.value) return
  const a = await ui.act(() => invoke('automation:save', draft.value!), 'Automation saved')
  if (a) {
    draft.value = null
    router.replace(`/automations/${a.id}`)
  }
}
const toggle = (a: Automation, on: boolean) => ui.act(() => invoke('automation:save', { ...a, enabled: on }), on ? `${a.name} on` : `${a.name} off`)
const runNow = () => draft.value?.id && ui.act(() => invoke('automation:runNow', draft.value!.id), 'Started')
async function remove(): Promise<void> {
  if (!draft.value?.id) return
  await ui.act(() => invoke('automation:delete', draft.value!.id), 'Deleted')
  router.replace('/automations')
}
const TRIGS: [Automation['trigger']['type'], string, string][] = [['schedule', 'Schedule', 'Day, week, cron'], ['email', 'New email', 'From an integration'], ['git', 'Git event', 'Push, merge, tag'], ['webhook', 'Webhook', 'Any app can call it']]
</script>

<template>
  <DrawerPanel label="Automations" close-to="/">
    <template #header>
      <h1 class="m-0 text-title">Automations <span class="text-[13px] font-normal text-ink-faint">Missions that start on a schedule or an event</span></h1>
      <div class="flex-1" />
      <button class="btn btn-sm btn-pri" type="button" @click="create">+ New automation</button>
    </template>
    <div class="flex min-h-0 flex-1 flex-wrap overflow-auto">
      <section aria-label="Automation list" class="min-w-0 flex-[999_1_400px]">
        <div v-for="a in list" :key="a.id" class="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3.5" :class="draft?.id === a.id ? 'bg-accent-active/50' : ''">
          <Toggle :model-value="a.enabled" :label="`Enable ${a.name}`" @update:model-value="toggle(a, $event)" />
          <div class="min-w-[180px] flex-1"><div class="font-medium">{{ a.name }}</div><div class="text-small text-ink-faint">{{ describe(a) }} · {{ target(a) }}</div></div>
          <div class="text-right text-xs">
            <div class="text-ink-muted">{{ a.trigger.type === 'schedule' ? (a.enabled ? 'Scheduled' : 'Off') : a.trigger.type === 'email' || a.trigger.type === 'webhook' ? 'On event (run manually for now)' : 'On event' }}</div>
            <div :class="a.lastRun ? LAST[a.lastRun.result] : 'text-ink-faint'">Last: {{ a.lastRun ? `${timeShort(a.lastRun.at)} · ${a.lastRun.result}` : 'never run' }}</div>
          </div>
          <RouterLink class="btn btn-sm" :to="`/automations/${a.id}`">Edit</RouterLink>
        </div>
        <p v-if="!list.length" class="p-6 text-center text-ink-faint">No automations yet.</p>
      </section>
      <section v-if="draft" aria-label="Edit automation" class="flex flex-[1_1_340px] flex-col gap-3.5 border-l border-line-soft bg-sidebar px-[18px] py-4">
        <div class="lbl">{{ draft.id ? 'Edit automation' : 'New automation' }}</div>
        <div><label class="field-label" for="an">Name</label><input id="an" v-model="draft.name" class="field" /></div>
        <div>
          <span class="field-label">Trigger</span>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="[t, l, s] in TRIGS" :key="t" type="button" :aria-pressed="draft.trigger.type === t" class="flex min-h-14 cursor-pointer flex-col gap-0.5 rounded-row border bg-transparent px-3 py-2.5 text-left text-ink" :class="draft.trigger.type === t ? 'border-accent bg-accent-tint' : 'border-line-strong'" @click="setTrigger(t)">
              <span class="text-[13px] font-medium">{{ l }}</span><span class="text-xs text-ink-faint">{{ s }}</span>
            </button>
          </div>
        </div>
        <div v-if="draft.trigger.type === 'schedule'" class="grid grid-cols-2 gap-2.5">
          <div><label class="field-label" for="ar">Repeat</label><select id="ar" v-model="preset" class="field"><option v-for="p in PRESETS" :key="p.label">{{ p.label }}</option><option value="custom">Custom cron</option></select></div>
          <div v-if="preset !== 'custom'"><label class="field-label" for="at">At</label><input id="at" v-model="time" type="time" class="field" /></div>
          <div v-else><label class="field-label" for="ac">Cron</label><input id="ac" v-model="draft.trigger.cron" class="field mono" /></div>
        </div>
        <div v-else-if="draft.trigger.type === 'email'"><label class="field-label" for="ai">Integration</label>
          <select id="ai" v-model="draft.trigger.integrationId" class="field"><option v-for="i in data.snap?.integrations" :key="i.id" :value="i.id">{{ i.name }}</option></select></div>
        <div v-else-if="draft.trigger.type === 'git'"><label class="field-label" for="ag">Event</label>
          <select id="ag" v-model="draft.trigger.event" class="field"><option value="push">Push</option><option value="merge">Merge</option><option value="tag">Tag</option></select></div>
        <div v-else><span class="field-label">Path</span><span class="mono text-small">{{ draft.trigger.path }}</span></div>
        <p v-if="draft.trigger.type !== 'schedule'" class="m-0 text-xs text-ink-faint">Event triggers are saved now and run with “Run now”; listening for events comes with live integrations.</p>
        <div><label class="field-label" for="aw">Send to</label>
          <select id="aw" v-model="targetValue" class="field"><option v-for="w in data.workspaces" :key="w.id" :value="w.id">{{ w.name }} → orchestrator</option><option value="jarvis">Jarvis (decides workspace)</option></select></div>
        <div><label class="field-label" for="ap">Mission prompt</label><textarea id="ap" v-model="draft.prompt" class="field resize-y" rows="3" /></div>
        <div><label class="field-label" for="aa">If the plan has more than {{ data.snap?.jarvis.limits.maxPlanTasks }} tasks</label>
          <select id="aa" v-model="draft.overLimit" class="field"><option value="ask">Ask me first</option><option value="run">Run anyway</option><option value="skip">Skip this run</option></select></div>
        <div class="mt-auto flex gap-2">
          <button class="btn btn-pri flex-1" type="button" @click="save">Save</button>
          <button v-if="draft.id" class="btn" type="button" @click="runNow">Run now</button>
          <button v-if="draft.id" class="btn btn-ghost btn-danger" type="button" @click="remove">Delete</button>
        </div>
      </section>
    </div>
  </DrawerPanel>
</template>
