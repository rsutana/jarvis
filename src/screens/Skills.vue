<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Skill, SkillStore } from '@shared/app-types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'

const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()
const skills = computed(() => data.snap?.skills ?? [])
const shared = computed(() => skills.value.filter((s) => s.origin === 'shared'))
const own = computed(() => skills.value.filter((s) => s.origin !== 'shared'))
const usedBy = (id: string) => data.agents.filter((a) => a.skillIds.includes(id)).map((a) => a.name)
const where = (s: Skill) => s.location?.split(' · ').slice(0, -1).join(' · ') ?? ''
const link = (s: Skill) => `/skills/${encodeURIComponent(s.id)}`

// app skills: editable here; shared skills: read-only, their SKILL.md lives in the shared folder
const draft = ref<Skill | null>(null)
const viewing = ref<Skill | null>(null)
const skillMd = ref('')
watch([() => route.params.skillId, skills], async ([id]) => {
  const s = skills.value.find((x) => x.id === id)
  draft.value = id === 'new' ? { id: '', name: '', description: '', instructions: '' } : s && s.origin !== 'shared' ? { ...s } : null
  if (s?.origin === 'shared') {
    if (viewing.value?.id !== s.id) skillMd.value = await invoke('skill:read', s.id).catch((e: Error) => `Could not read SKILL.md: ${e.message}`)
    viewing.value = s
  } else viewing.value = null
}, { immediate: true })
async function save(): Promise<void> {
  if (!draft.value?.name.trim()) return
  const s = await ui.act(() => invoke('skill:save', draft.value!), 'Skill saved')
  if (s) router.replace(`/skills/${s.id}`)
}

// shared folders: found automatically (this PC + WSL homes) plus any you add
const stores = ref<SkillStore[]>([])
const scanning = ref(false)
const loadStores = async () => (stores.value = await invoke('skill:stores'))
onMounted(async () => {
  await loadStores()
  // the startup scan may still be running (WSL takes a moment); scan now if nothing is known yet
  if (!stores.value.length) stores.value = await invoke('skill:scan', false)
})
// every scan (startup, install, rescan) commits 'skills'; keep the folder list in step with it
watch(() => data.snap?.skills, loadStores)
async function rescan(): Promise<void> {
  scanning.value = true
  const s = await ui.act(() => invoke('skill:scan', true), 'Skill folders rescanned')
  scanning.value = false
  if (s) stores.value = s
}
const newDir = ref('')
const custom = computed(() => data.snap?.settings.skillDirs ?? [])
async function setDirs(dirs: string[]): Promise<void> {
  const s = await ui.act(() => invoke('skill:setDirs', dirs))
  if (s) stores.value = s
  newDir.value = ''
}

// install from skills.sh with `npx skills add`
const installing = ref(false)
const showInstall = ref(false)
const form = ref({ source: '', skill: '', store: '' })
const targets = computed(() => stores.value.filter((s) => s.canonical && !s.error))
watch(targets, (t) => {
  if (!t.some((s) => s.path === form.value.store)) form.value.store = (t.find((s) => s.wsl) ?? t[0])?.path ?? ''
}, { immediate: true })
const output = ref('')
async function install(): Promise<void> {
  if (!form.value.source.trim() || !form.value.store) return
  installing.value = true
  output.value = ''
  const out = await ui.act(() => invoke('skill:install', form.value.source, form.value.skill || undefined, form.value.store), 'Skill installed')
  installing.value = false
  if (out !== undefined && out !== null) {
    output.value = out
    form.value.source = ''
    form.value.skill = ''
    stores.value = await invoke('skill:stores')
  }
}
</script>

<template>
  <DrawerPanel label="Skills" close-to="/">
    <template #header>
      <h1 class="m-0 text-title">Skills <span class="text-[13px] font-normal text-ink-faint">Reusable know-how you give agents</span></h1>
      <div class="flex-1" />
      <button class="btn btn-sm" type="button" :aria-expanded="showInstall" @click="showInstall = !showInstall; router.push('/skills')">Add from skills.sh</button>
      <RouterLink class="btn btn-sm btn-pri" to="/skills/new">+ New skill</RouterLink>
    </template>

    <form v-if="draft" class="flex flex-1 flex-col gap-3.5 overflow-auto px-5 py-4" @submit.prevent="save">
      <RouterLink to="/skills" class="text-[13px]">‹ All skills</RouterLink>
      <div><label class="field-label" for="sn">Name</label><input id="sn" v-model="draft.name" class="field" /></div>
      <div><label class="field-label" for="sd">Short description</label><input id="sd" v-model="draft.description" class="field" /></div>
      <div><label class="field-label" for="si">Instructions (added to the agent's prompt)</label><textarea id="si" v-model="draft.instructions" class="field resize-y" rows="8" /></div>
      <div class="flex gap-2"><div class="flex-1" /><button class="btn btn-pri" type="submit">Save skill</button></div>
    </form>

    <div v-else-if="viewing" class="flex flex-1 flex-col gap-3 overflow-auto px-5 py-4">
      <RouterLink to="/skills" class="text-[13px]">‹ All skills</RouterLink>
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-[220px] flex-1">
          <h2 class="m-0 text-[17px] font-semibold">{{ viewing.name }}</h2>
          <p class="m-0 mt-1 text-small text-ink-muted">{{ viewing.description }}</p>
        </div>
        <a v-if="viewing.url" class="btn btn-sm" :href="viewing.url" target="_blank" rel="noopener">View on skills.sh ↗</a>
        <button v-if="viewing.path" class="btn btn-sm" type="button" @click="ui.act(() => invoke('app:openPath', viewing!.path!))">Open folder</button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span class="chip">Shared · {{ where(viewing) }}</span>
        <span v-if="viewing.source" class="chip mono">{{ viewing.source }}</span>
        <span class="chip">{{ usedBy(viewing.id).length ? `Used by ${usedBy(viewing.id).join(', ')}` : 'Not given to any agent yet' }}</span>
      </div>
      <p class="m-0 text-xs text-ink-faint">Shared skills are read from <span class="mono break-all">{{ viewing.path }}</span>, the same copy Claude Code and other AI tools use. Give one to an agent in its Skills list; edit SKILL.md in the folder.</p>
      <pre class="card mono m-0 max-h-[60vh] overflow-auto p-3 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted">{{ skillMd }}</pre>
    </div>

    <div v-else class="flex flex-1 flex-col gap-3 overflow-auto p-3">
      <form v-if="showInstall" class="card flex flex-col gap-3 border-accent-ring p-3.5" @submit.prevent="install">
        <div class="flex items-center gap-2">
          <span class="font-semibold">Add from skills.sh</span>
          <div class="flex-1" />
          <a class="text-small" href="https://skills.sh" target="_blank" rel="noopener">Browse skills.sh ↗</a>
        </div>
        <div><label class="field-label" for="ss">Skill source</label><input id="ss" v-model="form.source" class="field mono text-small" placeholder="vercel-labs/agent-skills · a skills.sh link · npx skills add …" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="field-label" for="sk">Only this skill (optional)</label><input id="sk" v-model="form.skill" class="field mono text-small" placeholder="e.g. frontend-design" /></div>
          <div><label class="field-label" for="st">Install into</label>
            <select id="st" v-model="form.store" class="field" :disabled="!targets.length">
              <option v-if="!targets.length" value="">Looking for skill folders…</option>
              <option v-for="s in targets" :key="s.path" :value="s.path">{{ s.label }}</option>
            </select></div>
        </div>
        <p class="m-0 text-xs text-ink-faint">Runs <span class="mono">npx skills add &lt;source&gt; -g -y</span> {{ targets.find((t) => t.path === form.store)?.wsl ? 'inside WSL as you' : 'on this PC' }}, so the skill lands in the shared folder and is linked into Claude Code and your other AI tools. Needs Node.js there.</p>
        <div class="flex items-center gap-2"><div class="flex-1" /><button class="btn btn-pri" type="submit" :disabled="installing || !form.source.trim() || !form.store">{{ installing ? 'Installing…' : 'Install' }}</button></div>
        <pre v-if="output" class="mono m-0 max-h-40 overflow-auto rounded-row bg-raised p-2 text-[11.5px] whitespace-pre-wrap text-ink-muted">{{ output }}</pre>
      </form>

      <section aria-label="Shared skills">
        <div class="flex items-center gap-2 px-3 pt-1 pb-1.5">
          <span class="lbl">Shared skills · {{ shared.length }}</span>
          <div class="flex-1" />
          <button class="btn btn-sm btn-ghost" type="button" :disabled="scanning" @click="rescan">{{ scanning ? 'Scanning…' : 'Rescan' }}</button>
        </div>
        <RouterLink v-for="s in shared" :key="s.id" :to="link(s)" class="flex flex-col gap-0.5 rounded-row px-3 py-2.5 text-ink no-underline hover:bg-raised hover:text-ink">
          <span class="flex flex-wrap items-center gap-2"><span class="font-medium">{{ s.name }}</span><span class="chip text-[11px]">{{ where(s) }}</span><span v-if="s.source" class="mono text-[11px] text-ink-faint">{{ s.source }}</span></span>
          <span class="line-clamp-2 text-small text-ink-faint">{{ s.description }}<template v-if="usedBy(s.id).length"> · used by {{ usedBy(s.id).join(', ') }}</template></span>
        </RouterLink>
        <p v-if="!shared.length" class="px-3 py-2 text-small text-ink-faint">No shared skills found. Install one from skills.sh, or Rescan (also checks stopped WSL distros).</p>
      </section>

      <section aria-label="App skills">
        <div class="lbl px-3 pt-2 pb-1.5">App skills · {{ own.length }}</div>
        <RouterLink v-for="s in own" :key="s.id" :to="link(s)" class="flex flex-col gap-0.5 rounded-row px-3 py-2.5 text-ink no-underline hover:bg-raised hover:text-ink">
          <span class="font-medium">{{ s.name }}</span>
          <span class="text-small text-ink-faint">{{ s.description }}<template v-if="usedBy(s.id).length"> · used by {{ usedBy(s.id).join(', ') }}</template></span>
        </RouterLink>
        <p v-if="!own.length" class="px-3 py-2 text-small text-ink-faint">No app skills yet.</p>
      </section>

      <details class="card px-3.5 py-2.5">
        <summary class="cursor-pointer text-[13px] text-ink-muted">Skill folders · {{ stores.length }}</summary>
        <div v-for="s in stores" :key="s.path" class="mt-2 flex items-center gap-2.5 border-t border-line-soft pt-2 text-small">
          <span class="dot" :class="s.error ? 'bg-status-review' : s.count ? 'bg-status-working' : 'bg-status-idle'" />
          <span class="min-w-0 flex-1"><span class="block">{{ s.label }}</span><span class="mono block truncate text-xs text-ink-faint">{{ s.path }}</span></span>
          <span class="text-xs text-ink-faint">{{ s.error ? `can't read (${s.error})` : `${s.count} skill${s.count === 1 ? '' : 's'}` }}</span>
          <button v-if="s.custom" class="btn btn-sm btn-ghost" type="button" @click="setDirs(custom.filter((d) => d !== s.path))">Remove</button>
        </div>
        <form class="mt-3 flex gap-2" @submit.prevent="newDir.trim() && setDirs([...custom, newDir])">
          <label for="nd" class="sr-only">Add a skills folder</label>
          <input id="nd" v-model="newDir" class="field mono text-small" placeholder="Another skills folder, e.g. \\wsl.localhost\Ubuntu\home\me\project\.agents\skills" />
          <button class="btn" type="submit">Add</button>
        </form>
        <p class="m-0 mt-2 text-xs text-ink-faint">Found automatically: ~/.agents/skills (the shared store skills.sh installs into) and ~/.claude/skills, on this PC and in each running WSL distro's home.</p>
      </details>
    </div>
  </DrawerPanel>
</template>
