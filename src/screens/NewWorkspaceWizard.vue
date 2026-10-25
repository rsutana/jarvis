<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Agent, Orchestrator, Repo, RepoStatus, Workspace } from '@shared/types'
import { MODELS } from '@shared/app-types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Avatar from '@/components/Avatar.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'

const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()
const editId = computed(() => route.params.id as string | undefined)
const existing = computed(() => data.workspace(editId.value))
const orch = computed(() => data.orchestratorOf(editId.value) as Orchestrator | undefined)

const step = ref(0)
const names = ['Basics', 'Folder & Git', 'Orchestrator', 'Team']
const COLORS: [Workspace['color'], string, string][] = [['clay', 'Clay', '#D7655A'], ['blue', 'Blue', '#4A7FE0'], ['teal', 'Green', '#34B394'], ['purple', 'Purple', '#8A6FE0'], ['amber', 'Amber', '#E0A33A']]
const anthropic = computed(() => data.snap?.accounts.find((a) => a.provider === 'anthropic')?.id ?? '')

const f = reactive({
  name: '', goal: '', color: 'clay' as Workspace['color'], folderPath: '',
  baseBranch: 'main', branchPattern: 'agent/{agent}/{task-id}-{slug}', mergePolicy: 'ask' as Workspace['git']['mergePolicy'],
  oName: '', oAccount: '', oModel: 'Opus 5.5', oThinking: 'medium' as Agent['thinking'], autonomy: 'run_small_plans' as Orchestrator['autonomy'],
  agentIds: [] as string[]
})
watch(existing, (w) => {
  if (!w) {
    Object.assign(f, { oAccount: anthropic.value })
    return
  }
  Object.assign(f, {
    name: w.name, goal: w.goal, color: w.color, folderPath: w.folderPath, baseBranch: w.git.baseBranch, branchPattern: w.git.branchPattern, mergePolicy: w.git.mergePolicy,
    oName: orch.value?.name ?? '', oAccount: orch.value?.accountId ?? anthropic.value, oModel: orch.value?.model ?? 'Opus 5.5', oThinking: orch.value?.thinking ?? 'medium',
    autonomy: orch.value?.autonomy ?? 'run_small_plans', agentIds: data.agentsIn(w.id).map((a) => a.id)
  })
}, { immediate: true })

// the folder is one repo, or holds several (e.g. web/, mobile/, api/) that agents get together
const found = ref<(RepoStatus & { include: boolean })[]>([])
const scanning = ref(false)
const gitErr = ref('')
const rootRepo = computed(() => found.value.length === 1 && found.value[0].path === '')
async function checkGit(): Promise<void> {
  found.value = []
  gitErr.value = ''
  if (!f.folderPath) return
  scanning.value = true
  try {
    const saved = existing.value?.folderPath === f.folderPath ? (existing.value.repos ?? []) : []
    const list = await invoke('workspace:scanRepos', f.folderPath, f.baseBranch)
    found.value = list.map((r) => {
      const s = saved.find((x) => x.path === r.path)
      return { ...r, name: s?.name ?? r.name, baseBranch: s?.baseBranch ?? r.baseBranch, include: saved.length ? !!s : true }
    })
    if (rootRepo.value && !existing.value) f.baseBranch = found.value[0].branch
  } catch (e) {
    gitErr.value = (e as Error).message.replace(/^.*?: /, '')
  } finally {
    scanning.value = false
  }
}
/** What to save; keeps the saved repos when the folder could not be scanned. */
const reposCfg = (): Repo[] | undefined =>
  !found.value.length ? existing.value?.repos : rootRepo.value ? [] : found.value.filter((r) => r.include).map((r) => ({ name: r.name, path: r.path, baseBranch: r.baseBranch }))
watch(() => f.folderPath, checkGit, { immediate: true })
async function pick(): Promise<void> {
  const p = await ui.act(() => invoke('workspace:pickFolder'))
  if (p) f.folderPath = p
}

const pool = computed(() => data.agents.filter((a) => a.kind === 'agent'))
const toggleAgent = (id: string) => (f.agentIds = f.agentIds.includes(id) ? f.agentIds.filter((x) => x !== id) : [...f.agentIds, id])
const canNext = computed(() => [f.name.trim().length > 0, !!f.folderPath && (rootRepo.value || found.value.some((r) => r.include)), !!f.oName.trim(), true][step.value])
const busy = ref(false)

async function finish(): Promise<void> {
  busy.value = true
  const gitCfg = { baseBranch: f.baseBranch, branchPattern: f.branchPattern, mergePolicy: f.mergePolicy }
  if (!existing.value) {
    const w = await ui.act(() =>
      invoke('workspace:createFull', {
        name: f.name.trim(), goal: f.goal, color: f.color, folderPath: f.folderPath, repos: reposCfg(), git: gitCfg,
        orchestrator: { name: f.oName.trim(), accountId: f.oAccount, model: f.oModel, thinking: f.oThinking, autonomy: f.autonomy }, agentIds: f.agentIds
      }), `${f.name} created`)
    busy.value = false
    if (w) router.push(`/w/${w.id}`)
    return
  }
  const id = existing.value.id
  await ui.act(() => invoke('workspace:update', id, { name: f.name.trim(), goal: f.goal, color: f.color, folderPath: f.folderPath, repos: reposCfg(), git: gitCfg }))
  if (orch.value) await ui.act(() => invoke('orchestrator:save', { ...orch.value!, name: f.oName.trim() || orch.value!.name, accountId: f.oAccount, model: f.oModel, thinking: f.oThinking, autonomy: f.autonomy }))
  else if (f.oName.trim()) {
    const o = await ui.act(() =>
      invoke('agent:create', {
        name: f.oName.trim(), role: 'Orchestrator', kind: 'orchestrator', pronouns: 'they/them', look: { color: '#4FD1B5', hair: '#1F1A17', skin: '#D6A27E', glasses: false },
        accountId: f.oAccount, model: f.oModel, thinking: f.oThinking, pinnedToAccount: false, instructions: 'You plan missions for this workspace and route each step to the best agent.',
        skillIds: [], integrations: [], guardrails: { fileAccess: 'read', maxRunMinutes: 10 }, workspaceId: id, status: 'idle',
        ...({ autonomy: f.autonomy, parallelLimit: 3, retriesPerTask: 2, routingRules: [] } as object)
      } as Omit<Agent, 'id'>))
    if (o) await invoke('workspace:update', id, { orchestratorId: o.id })
  }
  const before = new Set(data.agentsIn(id).map((a) => a.id))
  for (const a of pool.value) {
    const want = f.agentIds.includes(a.id)
    if (want !== before.has(a.id)) await ui.act(() => invoke('agent:save', { ...(a as Agent), workspaceId: want ? id : undefined, deskSlot: want ? undefined : a.deskSlot }))
  }
  busy.value = false
  ui.toast('Workspace saved', 'good')
}
</script>

<template>
  <DrawerPanel :label="existing ? 'Workspace settings' : 'New workspace'" :close-to="existing ? `/w/${existing.id}` : '/'">
    <template #header>
      <h1 class="m-0 text-title">{{ existing ? `${existing.name} settings` : 'New workspace' }}</h1>
      <span class="text-[13px] text-ink-faint">One folder · one orchestrator · one team</span>
      <div class="flex-1" />
      <RouterLink v-if="!existing" class="btn btn-sm btn-ghost" to="/jarvis">Describe it to Jarvis instead</RouterLink>
    </template>
    <nav aria-label="Steps" class="flex flex-wrap gap-1 border-b border-line-soft px-4 py-2.5">
      <button v-for="(n, i) in names" :key="n" type="button" :aria-current="i === step ? 'step' : undefined" class="flex min-h-touch cursor-pointer items-center gap-2.5 rounded-row border-0 px-2.5 py-1.5 text-left" :class="i === step ? 'bg-raised text-ink' : 'bg-transparent text-ink-muted hover:bg-raised'" @click="step = i">
        <span class="inline-flex size-[26px] flex-none items-center justify-center rounded-full border-[1.5px] text-xs font-semibold" :class="i < step ? 'border-accent bg-accent text-app' : i === step ? 'border-accent' : 'border-line-strong'">{{ i < step ? '✓' : i + 1 }}</span>
        <span class="text-[13.5px] font-medium">{{ n }}</span>
      </button>
    </nav>
    <div class="flex flex-1 flex-col gap-[18px] overflow-auto px-[26px] py-[22px]">
      <template v-if="step === 0">
        <div><label class="field-label" for="wn">Workspace name</label><input id="wn" v-model="f.name" class="field" placeholder="e.g. Alumni website" /></div>
        <div><label class="field-label" for="wg">Goal (Jarvis and the orchestrator read this)</label><textarea id="wg" v-model="f.goal" class="field" rows="4" /></div>
        <div>
          <span class="field-label">Building roof colour</span>
          <div class="flex gap-2.5" role="radiogroup" aria-label="Building colour">
            <button v-for="[c, n, hex] in COLORS" :key="c" type="button" role="radio" :aria-checked="f.color === c" :aria-label="n" class="size-9 cursor-pointer rounded-[9px] border-2" :class="f.color === c ? 'border-ink' : 'border-transparent'" :style="{ background: hex }" @click="f.color = c" />
          </div>
          <div class="mt-1.5 text-xs text-ink-faint">{{ existing ? 'Changes the roof and office trim.' : 'The new building appears on the empty plot in the lobby.' }}</div>
        </div>
      </template>
      <template v-else-if="step === 1">
        <div><label class="field-label" for="pf">Project folder</label>
          <div class="flex gap-2"><input id="pf" v-model.lazy="f.folderPath" class="field mono text-[13px]" placeholder="/path/to/your/repo or a folder of repos" /><button class="btn" type="button" @click="pick">Choose…</button></div></div>
        <div v-if="scanning" class="card px-3.5 py-3 text-[13px] text-ink-faint">Looking for git repositories…</div>
        <div v-else-if="rootRepo" class="card flex flex-wrap items-center gap-3 px-3.5 py-3">
          <span class="dot bg-status-working" /><span class="flex-1 text-[13px]">Git repository found · branch <span class="mono">{{ found[0].branch }}</span> · {{ found[0].clean ? 'clean' : 'uncommitted changes' }}</span>
          <span v-if="found[0].remote" class="mono text-xs text-ink-faint">{{ found[0].remote }}</span>
        </div>
        <fieldset v-else-if="found.length" class="m-0 flex flex-col gap-2 border-0 p-0">
          <legend class="field-label">{{ found.length }} git repositories found · every task gets all ticked repos, each on its own task branch</legend>
          <div v-for="r in found" :key="r.path" class="flex flex-wrap items-center gap-3 rounded-row border px-3.5 py-2.5" :class="r.include ? 'border-accent' : 'border-line-strong'">
            <input :id="`repo-${r.path}`" v-model="r.include" type="checkbox" class="size-4" />
            <label :for="`repo-${r.path}`" class="min-w-[160px] flex-1 cursor-pointer">
              <span class="mono block text-[13px]">{{ r.path }}/</span>
              <span class="text-xs text-ink-faint">on <span class="mono">{{ r.branch }}</span> · {{ r.clean ? 'clean' : 'uncommitted changes' }}</span>
            </label>
            <label class="flex items-center gap-1.5 text-xs text-ink-faint">Base
              <select v-model="r.baseBranch" class="field mono w-auto py-1 text-[12.5px]" :disabled="!r.include"><option v-for="b in r.branches" :key="b">{{ b }}</option></select>
            </label>
          </div>
        </fieldset>
        <div v-else-if="gitErr" class="card flex items-center gap-3 border-status-review/50 px-3.5 py-3 text-[13px]"><span class="dot bg-status-review" /><span>{{ gitErr }}.<template v-if="gitErr.startsWith('No git repository')"> Run <span class="mono">git init</span> in the folder and make a first commit, then pick it again.</template></span></div>
        <div class="grid grid-cols-2 gap-3.5">
          <div v-if="!found.length || rootRepo"><label class="field-label" for="bb">Base branch</label><input id="bb" v-model="f.baseBranch" class="field mono text-[13px]" /></div>
          <div><label class="field-label" for="bn">Task branch pattern</label><input id="bn" v-model="f.branchPattern" class="field mono text-[13px]" /></div>
        </div>
        <fieldset class="m-0 flex flex-col gap-2.5 border-0 p-0">
          <legend class="field-label">When QA passes</legend>
          <label class="flex cursor-pointer items-start gap-3 rounded-row border px-3.5 py-3" :class="f.mergePolicy === 'ask' ? 'border-accent' : 'border-line-strong'"><input v-model="f.mergePolicy" type="radio" value="ask" class="mt-1" /><span><b class="font-semibold">Ask me to merge</b><br /><span class="text-small text-ink-faint">Changes wait in Inbox for one-click approval.</span></span></label>
          <label class="flex cursor-pointer items-start gap-3 rounded-row border px-3.5 py-3" :class="f.mergePolicy === 'auto_with_revert' ? 'border-accent' : 'border-line-strong'"><input v-model="f.mergePolicy" type="radio" value="auto_with_revert" class="mt-1" /><span><b class="font-semibold">Auto-merge, keep revert button</b><br /><span class="text-small text-ink-faint">Good for low-risk repos. You can revert from Changes.</span></span></label>
        </fieldset>
      </template>
      <template v-else-if="step === 2">
        <p class="m-0 text-ink-muted">The orchestrator turns Jarvis's missions into tasks and assigns them to agents. It gets the head desk in the office.</p>
        <div class="grid grid-cols-2 gap-3.5">
          <div><label class="field-label" for="on">Name</label><input id="on" v-model="f.oName" class="field" placeholder="e.g. Alma" /></div>
          <div><label class="field-label" for="oa">AI account</label><select id="oa" v-model="f.oAccount" class="field"><option v-for="a in data.snap?.accounts" :key="a.id" :value="a.id">{{ a.name }} · {{ a.provider === 'anthropic' ? 'Anthropic' : 'OpenAI' }}</option></select></div>
          <div><label class="field-label" for="om">Model</label><select id="om" v-model="f.oModel" class="field"><option v-for="m in MODELS.filter((x) => x.provider === 'anthropic')" :key="m.name">{{ m.name }}</option></select></div>
          <div><label class="field-label" for="ot">Thinking</label><select id="ot" v-model="f.oThinking" class="field"><option value="medium">Medium</option><option value="high">High</option><option value="default">Default</option></select></div>
        </div>
        <fieldset class="m-0 flex flex-col gap-2.5 border-0 p-0">
          <legend class="field-label">Autonomy</legend>
          <label v-for="[v, t, d] in ([['propose_only', 'Propose only', 'Every plan waits for you.'], ['run_small_plans', 'Run small plans', `Plans of ${data.snap?.jarvis.limits.maxPlanTasks} tasks or fewer start on their own. Sending, merging and deleting still ask.`], ['autopilot', 'Full autopilot', 'Within budget limits. Integration policies still apply.']] as const)" :key="v" class="flex cursor-pointer items-start gap-3 rounded-row border px-3.5 py-3" :class="f.autonomy === v ? 'border-accent' : 'border-line-strong'">
            <input v-model="f.autonomy" type="radio" :value="v" class="mt-1" /><span><b class="font-semibold">{{ t }}</b><br /><span class="text-small text-ink-faint">{{ d }}</span></span>
          </label>
        </fieldset>
      </template>
      <template v-else>
        <div class="grid grid-cols-2 gap-3.5">
          <label v-for="a in pool" :key="a.id" class="flex cursor-pointer items-center gap-3 rounded-row border px-3.5 py-3" :class="f.agentIds.includes(a.id) ? 'border-accent' : 'border-line-strong'">
            <input type="checkbox" class="size-4" :checked="f.agentIds.includes(a.id)" @change="toggleAgent(a.id)" />
            <Avatar :name="a.name" :color="a.look.color" />
            <span class="min-w-0 flex-1"><span class="block font-medium">{{ a.name }}</span><span class="text-xs text-ink-faint">{{ a.role }} · {{ a.model }}</span></span>
            <span class="chip">{{ a.workspaceId ? (a.workspaceId === editId ? 'Here' : data.workspace(a.workspaceId)?.name) : 'In pool' }}</span>
          </label>
        </div>
        <p class="m-0 text-xs text-ink-faint">Agents from another workspace move here. Each office has 9 desks.</p>
        <RouterLink class="btn self-start" to="/agents/new">+ Create a new agent</RouterLink>
      </template>
    </div>
    <div class="flex gap-2 border-t border-line-soft px-5 py-3.5">
      <button class="btn" type="button" :disabled="step === 0" @click="step--">Back</button>
      <div class="flex-1" />
      <button v-if="existing" class="btn" type="button" :disabled="busy" @click="finish">Save</button>
      <button v-if="step < 3" class="btn btn-pri" type="button" :disabled="!existing && !canNext" @click="step++">Continue</button>
      <button v-else-if="!existing" class="btn btn-pri" type="button" :disabled="busy || !f.name || !f.folderPath || !f.oName" @click="finish">Create workspace</button>
    </div>
  </DrawerPanel>
</template>
