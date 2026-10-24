<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Agent, Policy } from '@shared/types'
import { MODELS, type AnyAgent } from '@shared/app-types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Avatar from '@/components/Avatar.vue'
import StatusChip from '@/components/StatusChip.vue'
import Toggle from '@/components/Toggle.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'

const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()
const wsId = computed(() => route.params.id as string | undefined)
const base = computed(() => (wsId.value ? `/w/${wsId.value}/agents` : '/agents'))
const agentId = computed(() => route.params.agentId as string | undefined)
const list = computed(() => (wsId.value ? data.agents.filter((a) => a.workspaceId === wsId.value) : data.agents))

const LOOKS: [string, string][] = [['Periwinkle', '#8C9BFF'], ['Teal', '#4FD1B5'], ['Sky', '#7FB2FF'], ['Cyan', '#6FD3E8'], ['Amber', '#F2B544'], ['Coral', '#FF8A7A'], ['Pink', '#FFB3D1'], ['Lime', '#9FE07A'], ['Violet', '#B9A2FF'], ['Sand', '#E8C99A']]
const blank = (): Omit<Agent, 'id'> => ({
  name: '', role: '', kind: 'agent', pronouns: 'they/them', look: { color: '#8C9BFF', hair: '#2B2420', skin: '#D6A27E', glasses: false },
  accountId: data.snap?.accounts.find((a) => a.provider === 'anthropic')?.id ?? '', model: 'Sonnet 5.5', thinking: 'default', pinnedToAccount: false,
  instructions: '', skillIds: [], integrations: [], guardrails: { fileAccess: 'read_write', maxRunMinutes: 30 }, workspaceId: wsId.value, status: 'idle'
})
const draft = ref<AnyAgent | (Omit<Agent, 'id'> & { id?: string }) | null>(null)
const original = ref('')
const dirty = computed(() => JSON.stringify(draft.value) !== original.value)
watch(
  [agentId, () => data.agent(agentId.value)],
  ([aid, a]) => {
    // don't clobber unsaved edits when the store refreshes
    if (draft.value && (draft.value as { id?: string }).id === aid && dirty.value) return
    draft.value = aid === 'new' ? blank() : a ? JSON.parse(JSON.stringify(a)) : null
    original.value = JSON.stringify(draft.value)
  },
  { immediate: true }
)
const integPolicy = (iid: string): Policy | 'none' => draft.value?.integrations.find((i) => i.integrationId === iid)?.policy ?? 'none'
function setInteg(iid: string, p: string): void {
  if (!draft.value) return
  const rest = draft.value.integrations.filter((i) => i.integrationId !== iid)
  draft.value.integrations = p === 'none' ? rest : [...rest, { integrationId: iid, policy: p as Policy }]
}
function toggleSkill(sid: string): void {
  if (!draft.value) return
  const s = draft.value.skillIds
  draft.value.skillIds = s.includes(sid) ? s.filter((x) => x !== sid) : [...s, sid]
}
const capOpts = [0, 10, 15, 25, 50]
async function save(): Promise<void> {
  const d = draft.value
  if (!d || !d.name.trim()) return ui.toast('Give the agent a nickname', 'bad')
  if (!('id' in d) || !d.id) {
    const a = await ui.act(() => invoke('agent:create', d as Omit<Agent, 'id'>), `${d.name} created`)
    if (a) router.replace(`${base.value}/${a.id}`)
    return
  }
  const saved = await ui.act(() => (d.kind === 'orchestrator' ? invoke('orchestrator:save', d as never) : invoke('agent:save', d as Agent)), 'Agent saved')
  if (saved) original.value = JSON.stringify(draft.value)
}
const discard = () => (draft.value = JSON.parse(original.value))
async function removeFromWs(): Promise<void> {
  const d = draft.value as AnyAgent
  if (!d?.id) return
  await ui.act(() => invoke('agent:save', { ...(d as Agent), workspaceId: undefined }), `${d.name} moved to the agent pool`)
  router.push(base.value)
}
const ws = computed(() => data.workspace(draft.value?.workspaceId))
</script>

<template>
  <DrawerPanel label="Agent profile" :close-to="wsId ? `/w/${wsId}` : '/'">
    <template #header>
      <template v-if="draft">
        <h1 class="m-0 text-title">{{ draft.name || 'New agent' }} <span class="text-[13px] font-normal text-ink-faint">{{ draft.kind === 'orchestrator' ? 'Orchestrator' : 'Agent' }}</span></h1>
        <StatusChip v-if="'id' in draft && draft.id" :status="draft.status" />
      </template>
      <h1 v-else class="m-0 text-title">Agents <span class="text-[13px] font-normal text-ink-faint">{{ list.length }}</span></h1>
      <div class="flex-1" />
      <RouterLink v-if="!draft" class="btn btn-sm btn-pri" :to="`${base}/new`">+ New agent</RouterLink>
    </template>

    <div v-if="!draft" class="flex-1 overflow-auto p-3">
      <RouterLink v-for="a in list" :key="a.id" :to="`${base}/${a.id}`" class="flex items-center gap-3 rounded-row px-3 py-2.5 text-ink no-underline hover:bg-raised hover:text-ink">
        <Avatar :name="a.name" :color="a.look.color" :size="32" />
        <span class="min-w-0 flex-1"><span class="block font-medium">{{ a.name }}</span><span class="text-xs text-ink-faint">{{ a.role }} · {{ a.model }}</span></span>
        <span class="chip">{{ data.workspace(a.workspaceId)?.name ?? 'In pool' }}</span>
        <StatusChip :status="a.status" />
      </RouterLink>
    </div>

    <template v-else>
      <div class="flex items-center gap-2.5 border-b border-line-soft px-5 py-2.5">
        <RouterLink :to="base" class="text-[13px]">‹ All agents</RouterLink>
        <div class="flex-1" />
        <span v-if="dirty" class="text-small text-ink-faint">Unsaved changes</span>
      </div>
      <div class="flex-1 overflow-auto">
        <div class="flex flex-col gap-3 border-b border-line-soft px-5 py-4">
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><label for="n1" class="text-[13px] text-ink-muted">Name</label><input id="n1" v-model="draft.role" class="field" placeholder="e.g. Content Writer" /></div>
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><label for="n2" class="text-[13px] text-ink-muted">Nickname</label><input id="n2" v-model="draft.name" class="field" placeholder="e.g. Mika" /></div>
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><label for="n4" class="text-[13px] text-ink-muted">Pronouns</label><select id="n4" v-model="draft.pronouns" class="field"><option>he/him</option><option>she/her</option><option>they/them</option></select></div>
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><label for="n5" class="text-[13px] text-ink-muted">Workspace</label>
            <select id="n5" v-model="draft.workspaceId" class="field" :disabled="draft.kind === 'orchestrator'"><option :value="undefined">Agent pool (unassigned)</option><option v-for="w in data.workspaces" :key="w.id" :value="w.id">{{ w.name }}</option></select></div>
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5">
            <span class="text-[13px] text-ink-muted">Look</span>
            <div class="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Look">
              <button v-for="[n, c] in LOOKS" :key="c" type="button" role="radio" :aria-checked="draft.look.color === c" :aria-label="n" class="size-[30px] cursor-pointer rounded-full border-[3px]" :class="draft.look.color === c ? 'border-ink' : 'border-transparent'" :style="{ background: c }" @click="draft.look.color = c" />
              <label class="ml-1 flex items-center gap-1.5 text-xs text-ink-faint"><input v-model="draft.look.glasses" type="checkbox" /> Glasses</label>
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-3 border-b border-line-soft px-5 py-4">
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><label for="b1" class="text-[13px] text-ink-muted">AI account</label>
            <select id="b1" v-model="draft.accountId" class="field"><option v-for="a in data.snap?.accounts" :key="a.id" :value="a.id">{{ a.name }} · {{ a.provider === 'anthropic' ? 'Anthropic' : 'OpenAI' }}</option></select></div>
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><label for="b2" class="text-[13px] text-ink-muted">Model</label>
            <select id="b2" v-model="draft.model" class="field"><option v-for="m in MODELS" :key="m.name" :value="m.name">{{ m.name }}{{ m.provider === 'openai' ? ' (Codex runner, coming soon)' : '' }}</option></select></div>
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><label for="b3" class="text-[13px] text-ink-muted">Thinking</label>
            <select id="b3" v-model="draft.thinking" class="field"><option value="default">Default</option><option value="medium">Medium</option><option value="high">High</option></select></div>
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><span class="text-[13px] text-ink-muted">Pin account</span>
            <span class="flex items-center gap-2.5 text-small text-ink-faint"><Toggle v-model="draft.pinnedToAccount" label="Pin to this account" />{{ draft.pinnedToAccount ? 'Always runs on this account' : `Off: Jarvis may move ${draft.name || 'this agent'} when the account nears its limit` }}</span></div>
        </div>
        <div class="flex flex-col gap-3 border-b border-line-soft px-5 py-4">
          <label for="ins" class="lbl">Instructions</label>
          <textarea id="ins" v-model="draft.instructions" class="field resize-y" rows="4" />
        </div>
        <div class="flex flex-col gap-3 border-b border-line-soft px-5 py-4">
          <div class="flex items-center justify-between"><span class="lbl">Skills</span><RouterLink class="btn btn-sm btn-ghost" to="/skills">+ Add skill</RouterLink></div>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="s in data.snap?.skills" :key="s.id" type="button" :aria-pressed="draft.skillIds.includes(s.id)" class="chip cursor-pointer" :class="draft.skillIds.includes(s.id) ? 'border-accent text-accent-hover' : ''" @click="toggleSkill(s.id)">
              {{ draft.skillIds.includes(s.id) ? '✓ ' : '' }}{{ s.name }}
            </button>
          </div>
        </div>
        <div class="flex flex-col gap-3 border-b border-line-soft px-5 py-4">
          <div class="flex items-center justify-between"><span class="lbl">Integrations · apps this agent may use</span><RouterLink to="/integrations" class="text-small">Manage</RouterLink></div>
          <div class="flex flex-col gap-2 text-[13px]">
            <div v-for="i in data.snap?.integrations" :key="i.id" class="flex items-center gap-2.5">
              <span class="inline-flex size-[26px] items-center justify-center rounded-md bg-raised text-[11px] font-bold">{{ i.name[0] }}</span>
              <span class="flex-1">{{ i.name }}</span>
              <select class="field min-h-[34px] w-auto text-small" :aria-label="`${i.name} permission`" :value="integPolicy(i.id)" @change="setInteg(i.id, ($event.target as HTMLSelectElement).value)">
                <option value="none">Not used</option><option value="ask">Ask before sending</option><option value="allowed">Allowed</option><option value="off">Off</option>
              </select>
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-3 px-5 py-4">
          <span class="lbl">Guardrails</span>
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><label for="g1" class="text-[13px] text-ink-muted">File access</label>
            <select id="g1" v-model="draft.guardrails.fileAccess" class="field"><option value="read">Read only</option><option value="read_write">Read &amp; write in project folder</option></select></div>
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><label for="g2" class="text-[13px] text-ink-muted">Max run time</label>
            <select id="g2" v-model.number="draft.guardrails.maxRunMinutes" class="field"><option :value="10">10 minutes</option><option :value="30">30 minutes</option><option :value="60">1 hour</option><option :value="120">2 hours</option></select></div>
          <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3.5"><label for="g3" class="text-[13px] text-ink-muted">Weekly cap</label>
            <select id="g3" v-model.number="draft.guardrails.weeklyCapPct" class="field"><option v-for="c in capOpts" :key="c" :value="c || undefined">{{ c ? `${c}% of account` : 'No cap' }}</option></select></div>
        </div>
      </div>
      <div class="flex gap-2 border-t border-line-soft px-5 py-3">
        <button v-if="'id' in draft && draft.id && ws && draft.kind === 'agent'" class="btn btn-ghost btn-danger" type="button" @click="removeFromWs">Remove from workspace</button>
        <div class="flex-1" />
        <button class="btn" type="button" :disabled="!dirty" @click="discard">Discard</button>
        <button class="btn btn-pri" type="button" :disabled="!dirty" @click="save">Save agent</button>
      </div>
    </template>
  </DrawerPanel>
</template>
