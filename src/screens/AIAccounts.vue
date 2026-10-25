<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { LimitPolicy } from '@shared/types'
import { MODELS, isConnected, type PlanWindow, type StoredAccount } from '@shared/app-types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Avatar from '@/components/Avatar.vue'
import Toggle from '@/components/Toggle.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'
import { ago, timeShort, until } from '@/components/status'

const route = useRoute()
const data = useData()
const ui = useUi()
const all = computed(() => data.snap?.accounts ?? [])
const accounts = computed(() => all.value.filter(isConnected))
const offline = computed(() => all.value.filter((a) => !isConnected(a)))
const whyOffline = (a: StoredAccount) => (a.auth === 'api_key' ? 'No API key yet' : 'Codex runner not available yet')
const planRows = (a: StoredAccount): [string, PlanWindow][] => {
  const rows: [string, PlanWindow | undefined][] = [['Session (5h)', a.plan?.session], ['Weekly (7 day)', a.plan?.weekly]]
  return rows.filter((r): r is [string, PlanWindow] => !!r[1])
}
// ask Anthropic for fresh plan numbers whenever the screen opens (main throttles repeats)
onMounted(() => invoke('account:refreshUsage').catch(() => undefined))
const policy = computed(() => data.snap!.limitPolicy)
const jarvis = computed(() => data.snap!.jarvis)
const setPolicy = (p: Partial<LimitPolicy>) => ui.act(() => invoke('account:setLimitPolicy', { ...policy.value, ...p }))
const setJarvis = (p: Partial<typeof jarvis.value>) => ui.act(() => invoke('jarvis:setConfig', p))
const pauseAll = () => ui.act(() => invoke('account:pauseAll'), 'All agents paused')
const moved = computed(() => data.snap?.movedAgents)
const moveBack = () => ui.act(() => invoke('account:moveBack'), 'Agents moved back')

const usedBy = (id: string) => {
  const n = data.agents.filter((a) => a.accountId === id).length
  const j = jarvis.value.accountId === id
  return [j ? 'Jarvis' : '', n ? `${n} agent${n === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ') || 'unused'
}
const tone = (p: number) => (p >= policy.value.stopAt ? 'bg-status-blocked text-status-blocked' : p >= policy.value.warnAt ? 'bg-status-review text-status-review' : 'bg-status-working text-status-working')
const AUTH: Record<StoredAccount['auth'], string> = { claude_code: 'Claude Code sign-in', codex: 'Codex sign-in', api_key: 'API key' }
const WIN: Record<StoredAccount['window'], string> = { '5h': '5-hour window', weekly: 'Weekly', monthly: 'Monthly' }

// add / edit account; apiKey is write-only (the saved key never comes back, only keyHint)
type Draft = StoredAccount & { apiKey?: string }
const editing = ref<Draft | null>(null)
const blank = (): Draft => ({ id: '', name: '', provider: 'anthropic', auth: 'claude_code', window: '5h', usagePct: 0, budgetTokens: 2_000_000, windowTokens: 0, configDir: '', apiKey: '' })
const edit = (a: StoredAccount) => (editing.value = { ...a, apiKey: '' })
const saving = ref(false)
async function saveAccount(): Promise<void> {
  const a = editing.value
  if (!a?.name.trim()) return ui.toast('Give the account a name', 'bad')
  if (a.auth === 'api_key' && !a.hasKey && !a.apiKey?.trim()) return ui.toast('Paste the API key', 'bad')
  saving.value = true
  const ok = await ui.act(() => invoke('account:save', a), a.apiKey?.trim() ? 'API key saved' : 'Account saved')
  saving.value = false
  if (ok) editing.value = null
}
const removing = ref<string | null>(null)
async function remove(a: StoredAccount): Promise<boolean> {
  if (removing.value !== a.id) {
    removing.value = a.id // first click asks, second removes
    return false
  }
  removing.value = null
  return !!(await ui.act(() => invoke('account:delete', a.id), `${a.name} removed`))
}
async function removeEditing(): Promise<void> {
  if (editing.value && (await remove(editing.value))) editing.value = null
}
/** Connected accounts, plus the current pick so a select never shows blank. */
const choices = (current?: string) => [...accounts.value, ...offline.value.filter((a) => a.id === current)]

// usage chart: last 7 days, stacked by workspace (+ Jarvis); colour follows the entity
const ROOF: Record<string, string> = { teal: '#34B394', blue: '#4A7FE0', clay: '#D7655A', purple: '#8A6FE0', amber: '#E0A33A' }
const series = computed(() => [
  ...data.workspaces.map((w) => ({ id: w.id, name: w.name, color: ROOF[w.color] })),
  { id: 'jarvis', name: 'Jarvis', color: '#8C9BFF' }
])
const days = computed(() => {
  const out: { key: string; label: string; values: Record<string, number>; total: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000)
    const key = d.toISOString().slice(0, 10)
    const values: Record<string, number> = {}
    for (const u of data.snap?.usage ?? []) if (u.day === key) values[u.scope] = (values[u.scope] ?? 0) + u.tokens
    out.push({ key, label: d.toLocaleDateString([], { weekday: 'short' }), values, total: Object.values(values).reduce((a, b) => a + b, 0) })
  }
  return out
})
const peak = computed(() => Math.max(1, ...days.value.map((d) => d.total)))
const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1000) + 'k')
const hover = ref<{ day: string; name: string; v: number } | null>(null)
const showTable = ref(false)
const usageBox = ref<HTMLElement>()
watch(() => route.name, (n) => n === 'usage' && setTimeout(() => usageBox.value?.scrollIntoView({ behavior: 'smooth' }), 50), { immediate: true })
</script>

<template>
  <DrawerPanel label="AI accounts" close-to="/">
    <template #header>
      <h1 class="m-0 text-title">AI Accounts <span class="text-[13px] font-normal text-ink-faint">{{ accounts.length }} connected</span></h1>
      <div class="flex-1" />
      <button class="btn btn-sm btn-pri" type="button" @click="editing = blank()">+ Add account</button>
    </template>
    <div class="flex flex-1 flex-col gap-3.5 overflow-auto px-[18px] pt-4 pb-5">
      <p class="m-0 text-[13px] text-ink-muted">Where your agents get their intelligence.</p>

      <form v-if="editing" class="card grid grid-cols-2 gap-3 border-accent-ring p-3.5" @submit.prevent="saveAccount">
        <div class="col-span-2 font-semibold">{{ editing.id ? 'Edit account' : 'Add account' }}</div>
        <div><label class="field-label" for="an">Name</label><input id="an" v-model="editing.name" class="field" placeholder="e.g. Claude Code Work" /></div>
        <div><label class="field-label" for="ap">Provider</label><select id="ap" v-model="editing.provider" class="field"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></div>
        <div><label class="field-label" for="aa">Sign-in</label><select id="aa" v-model="editing.auth" class="field"><option value="claude_code">Claude Code sign-in</option><option value="codex">Codex sign-in</option><option value="api_key">API key</option></select></div>
        <div><label class="field-label" for="aw">Limit window</label><select id="aw" v-model="editing.window" class="field"><option value="5h">5 hours</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
        <div><label class="field-label" for="ab">Tokens per window (= 100%)</label><input id="ab" v-model.number="editing.budgetTokens" type="number" min="1000" step="100000" class="field" /></div>
        <div v-if="editing.auth === 'claude_code'"><label class="field-label" for="ad">Claude config folder (optional)</label><input id="ad" v-model="editing.configDir" class="field mono text-small" placeholder="~/.claude-work" /></div>
        <p v-if="editing.auth === 'claude_code'" class="col-span-2 m-0 text-xs text-ink-faint">Each folder holds its own Claude Code login (CLAUDE_CONFIG_DIR). Leave empty to use your default sign-in.</p>
        <div v-if="editing.auth === 'api_key'" class="col-span-2">
          <label class="field-label" for="ak">API key</label>
          <input
            id="ak"
            v-model="editing.apiKey"
            type="password"
            autocomplete="off"
            spellcheck="false"
            class="field mono text-small"
            :placeholder="editing.hasKey ? `Saved (${editing.keyHint}) · paste a new key to replace it` : editing.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'"
          />
          <p class="m-0 mt-1.5 text-xs text-ink-faint">
            Create one at <span class="mono">{{ editing.provider === 'anthropic' ? 'console.anthropic.com → API keys' : 'platform.openai.com → API keys' }}</span>.
            Jarvis checks it with {{ editing.provider === 'anthropic' ? 'Anthropic' : 'OpenAI' }}, encrypts it with your system keychain, and never shows it again.
            <template v-if="editing.provider === 'openai'"> Agents can't run on OpenAI models until the Codex runner ships.</template>
          </p>
        </div>
        <div class="col-span-2 flex justify-end gap-2">
          <button v-if="editing.id" class="btn btn-ghost mr-auto" type="button" @click="removeEditing">{{ removing === editing.id ? 'Click again to remove' : 'Remove account' }}</button>
          <button class="btn btn-ghost" type="button" @click="editing = null">Cancel</button>
          <button class="btn btn-pri" type="submit" :disabled="saving">{{ saving ? (editing.apiKey ? 'Checking key…' : 'Saving…') : 'Save' }}</button>
        </div>
      </form>

      <div class="card flex flex-col gap-3 border-status-working/40 px-4 py-3.5">
        <div class="flex items-start gap-3">
          <Avatar name="Jarvis" square :size="30" />
          <div class="flex-1"><div class="font-semibold">Jarvis watches your limits</div><div class="text-small text-ink-faint">When an account is close to running out, he can move its agents to one with room.</div></div>
          <button class="btn btn-sm btn-danger border-status-blocked/40" type="button" @click="pauseAll">Pause all agents</button>
        </div>
        <div class="grid grid-cols-3 gap-2.5">
          <div><label class="field-label !text-xs" for="l1">When close</label>
            <select id="l1" class="field" :value="policy.whenClose" @change="setPolicy({ whenClose: ($event.target as HTMLSelectElement).value as LimitPolicy['whenClose'] })"><option value="switch">Switch automatically</option><option value="ask">Ask me</option><option value="pause">Pause agents</option></select></div>
          <div><label class="field-label !text-xs" for="l2">Warn at</label>
            <select id="l2" class="field" :value="policy.warnAt" @change="setPolicy({ warnAt: Number(($event.target as HTMLSelectElement).value) })"><option v-for="n in [70, 75, 80, 85, 90]" :key="n" :value="n">{{ n }}%</option></select></div>
          <div><label class="field-label !text-xs" for="l3">Stop using at</label>
            <select id="l3" class="field" :value="policy.stopAt" @change="setPolicy({ stopAt: Number(($event.target as HTMLSelectElement).value) })"><option v-for="n in [85, 89, 92, 95, 99]" :key="n" :value="n">{{ n }}%</option></select></div>
        </div>
        <div class="flex items-center gap-2.5 text-[13px]"><Toggle :model-value="policy.switchBack" label="Switch back after reset" @update:model-value="setPolicy({ switchBack: $event })" />Switch back after the limit resets</div>
      </div>

      <div v-if="moved && moved.agentIds.length" class="card flex flex-wrap items-center gap-3 border-accent-ring bg-accent-tint px-3.5 py-3">
        <span class="min-w-[240px] flex-1 text-[13px]"><b>Jarvis (safe limit) moved {{ moved.agentIds.length }} agent{{ moved.agentIds.length === 1 ? '' : 's' }}</b> <span class="text-ink-muted">{{ data.account(moved.from)?.name }} → {{ data.account(moved.to)?.name }} · {{ timeShort(moved.at) }}</span></span>
        <button class="btn btn-sm" type="button" @click="moveBack">Move back</button>
      </div>

      <div class="flex flex-col gap-2">
        <div v-for="a in accounts" :key="a.id" class="card flex flex-col gap-2 px-3.5 py-3">
          <div class="flex items-center gap-2.5">
            <span class="inline-flex size-7 items-center justify-center rounded-control bg-raised text-xs font-bold">{{ a.auth === 'api_key' ? 'K' : a.provider === 'anthropic' ? 'A' : 'O' }}</span>
            <div class="min-w-0 flex-1"><div class="text-[13.5px] font-semibold">{{ a.name }}</div><div class="text-xs text-ink-faint">{{ AUTH[a.auth] }}<span v-if="a.keyHint" class="mono"> · {{ a.keyHint }}</span> · {{ usedBy(a.id) }}</div></div>
            <b class="text-sm" :class="tone(a.usagePct).split(' ')[1]">{{ a.usagePct }}%</b>
            <button class="btn btn-sm btn-ghost" type="button" @click="edit(a)">Edit</button>
          </div>
          <template v-if="a.plan">
            <!-- real subscription limits, same as Claude Code's /usage and the IDE panel -->
            <div v-for="[label, w] in planRows(a)" :key="label" class="flex flex-col gap-1">
              <div class="flex justify-between text-xs"><span class="text-ink-muted">{{ label }}</span><span :class="tone(w.pct).split(' ')[1]">{{ w.pct }}%</span></div>
              <div class="relative h-2 rounded bg-line" role="meter" :aria-valuenow="w.pct" aria-valuemin="0" aria-valuemax="100" :aria-label="`${a.name} ${label} usage`">
                <div class="h-2 rounded" :class="tone(w.pct).split(' ')[0]" :style="{ width: Math.min(100, w.pct) + '%' }" />
                <span class="absolute -top-[3px] h-3.5 w-0.5 bg-status-review" :style="{ left: policy.warnAt + '%' }" aria-hidden="true" />
                <span class="absolute -top-[3px] h-3.5 w-0.5 bg-status-blocked" :style="{ left: policy.stopAt + '%' }" aria-hidden="true" />
              </div>
              <div v-if="w.resetsAt" class="text-xs text-ink-faint">{{ until(w.resetsAt) }}</div>
            </div>
            <div class="text-xs text-ink-faint">From Anthropic · updated {{ ago(a.plan.at) }} · includes use outside Jarvis</div>
          </template>
          <template v-else>
            <div class="relative h-2 rounded bg-line" role="meter" :aria-valuenow="a.usagePct" aria-valuemin="0" aria-valuemax="100" :aria-label="`${a.name} usage`">
              <div class="h-2 rounded" :class="tone(a.usagePct).split(' ')[0]" :style="{ width: Math.min(100, a.usagePct) + '%' }" />
              <span class="absolute -top-[3px] h-3.5 w-0.5 bg-status-review" :style="{ left: policy.warnAt + '%' }" aria-hidden="true" />
              <span class="absolute -top-[3px] h-3.5 w-0.5 bg-status-blocked" :style="{ left: policy.stopAt + '%' }" aria-hidden="true" />
            </div>
            <div class="text-xs text-ink-faint">{{ WIN[a.window] }} · {{ a.window === '5h' ? until(a.resetAt) : a.window === 'weekly' ? 'resets weekly' : 'month to date' }} · {{ fmt(a.windowTokens) }} / {{ fmt(a.budgetTokens) }} tokens · estimated from Jarvis's own runs</div>
          </template>
        </div>
        <p v-if="!accounts.length" class="m-0 rounded-row border border-dashed border-line-strong p-4 text-center text-small text-ink-faint">No connected accounts yet. Add a Claude Code sign-in or an API key.</p>
        <details v-if="offline.length" class="card px-3.5 py-2.5">
          <summary class="cursor-pointer text-[13px] text-ink-muted">Not connected · {{ offline.length }}</summary>
          <div v-for="a in offline" :key="a.id" class="mt-2 flex items-center gap-2.5 border-t border-line-soft pt-2">
            <span class="inline-flex size-7 items-center justify-center rounded-control bg-raised text-xs font-bold text-ink-faint">{{ a.auth === 'api_key' ? 'K' : a.provider === 'anthropic' ? 'A' : 'O' }}</span>
            <div class="min-w-0 flex-1"><div class="text-[13.5px] font-medium">{{ a.name }}</div><div class="text-xs text-ink-faint">{{ AUTH[a.auth] }} · {{ whyOffline(a) }} · {{ usedBy(a.id) }}</div></div>
            <button v-if="a.auth === 'api_key'" class="btn btn-sm" type="button" @click="edit(a)">Add key</button>
            <button class="btn btn-sm btn-ghost" type="button" @click="remove(a)">{{ removing === a.id ? 'Click again to remove' : 'Remove' }}</button>
          </div>
        </details>
      </div>

      <div class="card flex flex-col gap-3 px-4 py-3.5">
        <div><div class="font-semibold">Jarvis's brain</div><div class="text-small text-ink-faint">Who answers Jarvis and plans your tasks.</div></div>
        <div class="grid grid-cols-3 gap-2.5">
          <div><label class="field-label !text-xs" for="j1">Jarvis uses</label>
            <select id="j1" class="field" :value="jarvis.accountId" @change="setJarvis({ accountId: ($event.target as HTMLSelectElement).value })"><option v-for="a in choices(jarvis.accountId)" :key="a.id" :value="a.id">{{ a.name }}{{ isConnected(a) ? '' : ' (not connected)' }}</option></select></div>
          <div><label class="field-label !text-xs" for="j2">Model</label>
            <select id="j2" class="field" :value="jarvis.model" @change="setJarvis({ model: ($event.target as HTMLSelectElement).value })"><option v-for="m in MODELS" :key="m.name" :value="m.name">{{ m.name }}</option></select></div>
          <div><label class="field-label !text-xs" for="j3">Thinking</label>
            <select id="j3" class="field" :value="jarvis.thinking" @change="setJarvis({ thinking: ($event.target as HTMLSelectElement).value as 'medium' })"><option value="default">Default</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        </div>
        <label class="flex items-start gap-2.5 text-[13px]">
          <input type="checkbox" class="mt-0.5 size-4" :checked="jarvis.canStartOnOwn" @change="setJarvis({ canStartOnOwn: ($event.target as HTMLInputElement).checked })" />
          <span>Let Jarvis start tasks and plans on his own <span class="block text-xs text-ink-faint">Within {{ jarvis.limits.budgetPct }}% of budgets, up to {{ jarvis.limits.perHour }} times an hour, plans of {{ jarvis.limits.maxPlanTasks }} tasks or fewer. Merging, deleting, billing, folders and sending still ask you.</span></span>
        </label>
      </div>

      <div ref="usageBox" class="card px-4 py-3.5">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span class="font-semibold">Usage · last 7 days</span>
          <div class="flex flex-wrap gap-3 text-xs text-ink-muted">
            <span v-for="s in series" :key="s.id" class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm" :style="{ background: s.color }" />{{ s.name }}</span>
            <button class="cursor-pointer border-0 bg-transparent p-0 text-xs text-accent-link" type="button" :aria-pressed="showTable" @click="showTable = !showTable">{{ showTable ? 'Chart' : 'Table' }}</button>
          </div>
        </div>
        <template v-if="!showTable">
          <div class="relative grid h-[130px] grid-cols-7 items-end gap-3 border-b border-line-strong" role="img" :aria-label="`Daily token usage by workspace; peak ${fmt(peak)} tokens`" @mouseleave="hover = null">
            <div v-for="d in days" :key="d.key" class="flex h-full flex-col-reverse gap-0.5">
              <template v-for="s in series" :key="s.id">
                <div
                  v-if="d.values[s.id]"
                  class="first:rounded-none last:rounded-t"
                  :style="{ height: (d.values[s.id] / peak) * 100 + '%', background: s.color }"
                  @mouseenter="hover = { day: d.label, name: s.name, v: d.values[s.id] }"
                />
              </template>
            </div>
            <div v-if="hover" class="pointer-events-none absolute -top-2 right-0 rounded-control border border-line-strong bg-drawer px-2 py-1 text-xs shadow-tag">{{ hover.day }} · {{ hover.name }} · <b>{{ fmt(hover.v) }}</b></div>
          </div>
          <div class="mt-1.5 grid grid-cols-7 gap-3"><span v-for="d in days" :key="d.key" class="text-center text-xs text-ink-faint">{{ d.label }}</span></div>
        </template>
        <table v-else class="w-full text-small">
          <thead><tr><th class="lbl py-1 text-left">Day</th><th v-for="s in series" :key="s.id" class="lbl py-1 text-right">{{ s.name }}</th></tr></thead>
          <tbody><tr v-for="d in days" :key="d.key" class="border-t border-line-soft"><td class="py-1">{{ d.label }}</td><td v-for="s in series" :key="s.id" class="py-1 text-right">{{ fmt(d.values[s.id] ?? 0) }}</td></tr></tbody>
        </table>
      </div>
    </div>
  </DrawerPanel>
</template>
