<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Integration, Policy } from '@shared/types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Avatar from '@/components/Avatar.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'

const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()
const list = computed(() => data.snap?.integrations ?? [])
const cur = computed(() => list.value.find((i) => i.id === route.params.integrationId) ?? list.value[0])
const connected = computed(() => list.value.filter((i) => i.status === 'connected').length)
const POL: Record<Policy, [string, string]> = { allowed: ['Allowed', 'text-status-working'], ask: ['Ask before sending', 'text-status-review'], off: ['Off', 'text-ink-faint'] }
const summary = (i: Integration) => {
  const ask = i.tools.some((t) => t.policy === 'ask')
  return `${i.tools.length} tools · ${i.agentIds.length} agent${i.agentIds.length === 1 ? '' : 's'}${ask ? ' · ask before sending' : ''}`
}
const AVAILABLE: { name: string; type: Integration['type']; short: string }[] = [
  { name: 'Slack', type: 'slack', short: 'S' },
  { name: 'GitHub', type: 'github', short: 'GH' },
  { name: 'HubSpot', type: 'hubspot', short: 'HS' }
]
const save = (i: Integration) => ui.act(() => invoke('integration:save', i))
async function add(name: string, type: Integration['type']): Promise<void> {
  const i = await ui.act(() => invoke('integration:save', { id: '', name, type, tools: [], agentIds: [], workspaceScope: 'all', status: 'disconnected' }), `${name} added`)
  if (i) router.replace(`/integrations/${i.id}`)
}
const setPolicy = (tool: string, p: Policy) => cur.value && ui.act(() => invoke('integration:setPolicy', cur.value!.id, tool, p))
const addAgent = ref('')
function addUser(): void {
  if (!cur.value || !addAgent.value) return
  save({ ...cur.value, agentIds: [...new Set([...cur.value.agentIds, addAgent.value])] })
  addAgent.value = ''
}
const removeUser = (id: string) => cur.value && save({ ...cur.value, agentIds: cur.value.agentIds.filter((x) => x !== id) })
const newTool = ref({ name: '', description: '' })
function addTool(): void {
  if (!cur.value || !newTool.value.name.trim()) return
  save({ ...cur.value, tools: [...cur.value.tools, { name: newTool.value.name.trim(), description: newTool.value.description, policy: 'ask' }] })
  newTool.value = { name: '', description: '' }
}
const scope = computed(() => (cur.value?.workspaceScope === 'all' ? 'all' : (cur.value?.workspaceScope[0] ?? 'all')))
const setScope = (v: string) => cur.value && save({ ...cur.value, workspaceScope: v === 'all' ? 'all' : [v] })
const toggleConn = () => cur.value && save({ ...cur.value, status: cur.value.status === 'connected' ? 'disconnected' : 'connected' })
</script>

<template>
  <DrawerPanel label="Integrations" close-to="/">
    <template #header>
      <h1 class="m-0 text-title">Integrations <span class="text-[13px] font-normal text-ink-faint">{{ connected }} connected</span></h1>
      <div class="flex-1" />
      <button class="btn btn-sm btn-pri" type="button" @click="add('Custom MCP', 'mcp')">+ Add integration</button>
    </template>
    <div class="flex min-h-0 flex-1 flex-wrap overflow-auto">
      <section aria-label="Integration list" class="flex max-w-full flex-[1_1_270px] flex-col gap-2 border-r border-line-soft p-3.5">
        <div class="card border-accent-ring bg-accent-tint px-3 py-2.5 text-small text-ink-muted">
          Connect outside apps so your agents can use them as tools. You choose what each can do, who can use it, and when it asks you. Agents never call a tool set to “ask”: they hand you the content in Inbox.
        </div>
        <div class="lbl px-0.5 pt-2 pb-0.5">Your integrations</div>
        <RouterLink v-for="i in list" :key="i.id" :to="`/integrations/${i.id}`" class="flex items-center gap-3 rounded-card border p-3 text-ink no-underline hover:text-ink" :class="cur?.id === i.id ? 'border-accent bg-accent-tint' : 'border-line bg-card'">
          <span class="inline-flex size-[34px] flex-none items-center justify-center rounded-[9px] bg-raised text-[13px] font-bold">{{ i.name[0] }}</span>
          <span class="min-w-0 flex-1"><span class="block font-medium">{{ i.name }}</span><span class="text-xs text-ink-faint">{{ summary(i) }}</span></span>
          <span class="dot" :class="i.status === 'connected' ? 'bg-status-working' : 'bg-status-idle'" :aria-label="i.status" />
        </RouterLink>
        <div class="lbl px-0.5 pt-2.5 pb-0.5">Available</div>
        <div class="grid grid-cols-2 gap-2">
          <button v-for="a in AVAILABLE" :key="a.name" type="button" class="flex cursor-pointer items-center gap-2.5 rounded-card border border-line bg-card p-2.5 text-[13px] text-ink hover:border-line-strong" @click="add(a.name, a.type)">
            <span class="inline-flex size-[26px] items-center justify-center rounded-md bg-raised text-[10px] font-bold">{{ a.short }}</span>{{ a.name }}
          </button>
          <button type="button" class="flex cursor-pointer items-center gap-2.5 rounded-card border border-line bg-card p-2.5 text-[13px] text-ink hover:border-line-strong" @click="add('Custom MCP', 'mcp')">
            <span class="inline-flex size-[26px] items-center justify-center rounded-md border border-dashed border-accent text-accent-link">+</span>Custom MCP
          </button>
        </div>
      </section>
      <section v-if="cur" aria-label="Integration detail" class="flex min-w-0 flex-[999_1_460px] flex-col gap-3.5 px-5 py-[18px]">
        <div class="flex flex-wrap items-center gap-3">
          <span class="inline-flex size-11 items-center justify-center rounded-[11px] bg-raised text-[17px] font-bold">{{ cur.name[0] }}</span>
          <div class="min-w-[180px] flex-1">
            <label for="iname" class="sr-only">Name</label>
            <input id="iname" class="w-full border-0 bg-transparent p-0 text-lg font-semibold text-ink outline-none" :value="cur.name" @change="save({ ...cur, name: ($event.target as HTMLInputElement).value })" />
            <div class="text-small text-ink-muted uppercase">{{ cur.type }}</div>
          </div>
          <span class="chip" :class="cur.status === 'connected' ? 'border-status-working/50 text-status-working' : ''"><span class="dot" :class="cur.status === 'connected' ? 'bg-status-working' : 'bg-status-idle'" />{{ cur.status === 'connected' ? 'Connected' : 'Not connected' }}</span>
        </div>
        <div class="card overflow-x-auto">
          <table class="w-full border-collapse text-[13px]">
            <thead><tr class="text-left"><th class="lbl px-3 py-2">Tool</th><th class="lbl px-3 py-2">What it does</th><th class="lbl px-3 py-2">Policy</th></tr></thead>
            <tbody>
              <tr v-for="t in cur.tools" :key="t.name" class="border-t border-line-soft">
                <td class="mono px-3 py-2 text-xs">{{ t.name }}</td>
                <td class="px-3 py-2 text-ink-muted">{{ t.description }}</td>
                <td class="px-3 py-1.5">
                  <select class="field min-h-8 w-auto px-2 py-1 text-small" :class="POL[t.policy][1]" :aria-label="`Policy for ${t.name}`" :value="t.policy" @change="setPolicy(t.name, ($event.target as HTMLSelectElement).value as Policy)">
                    <option value="allowed">Allowed</option><option value="ask">Ask before sending</option><option value="off">Off</option>
                  </select>
                </td>
              </tr>
              <tr class="border-t border-line-soft">
                <td class="p-1.5"><input v-model="newTool.name" aria-label="Tool name" class="field mono min-h-8 text-xs" placeholder="tool_name" /></td>
                <td class="p-1.5"><input v-model="newTool.description" aria-label="Tool description" class="field min-h-8" placeholder="What it does" /></td>
                <td class="p-1.5"><button class="btn btn-sm" type="button" @click="addTool">+ Tool</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card flex flex-col gap-2.5 p-3.5">
          <span class="lbl">Who can use it</span>
          <div class="flex flex-wrap items-center gap-1.5">
            <span v-for="aid in cur.agentIds" :key="aid" class="chip py-[3px] pr-1 pl-[3px]">
              <Avatar :name="data.nameOf(aid)" :color="data.agent(aid)?.look.color" :size="22" />{{ data.nameOf(aid) }}
              <button type="button" class="cursor-pointer border-0 bg-transparent px-1 text-ink-faint hover:text-ink" :aria-label="`Remove ${data.nameOf(aid)}`" @click="removeUser(aid)">×</button>
            </span>
            <label for="addag" class="sr-only">Add agent</label>
            <select id="addag" v-model="addAgent" class="field min-h-8 w-auto text-small" @change="addUser"><option value="">+ Agent</option><option v-for="a in data.agents.filter((x) => !cur!.agentIds.includes(x.id))" :key="a.id" :value="a.id">{{ a.name }}</option></select>
          </div>
          <div><label class="field-label" for="ws">Workspaces</label>
            <select id="ws" class="field" :value="scope" @change="setScope(($event.target as HTMLSelectElement).value)"><option value="all">All workspaces</option><option v-for="w in data.workspaces" :key="w.id" :value="w.id">{{ w.name }} only</option></select></div>
        </div>
        <div class="card flex flex-wrap items-center gap-2.5 px-3.5 py-3">
          <div class="min-w-[220px] flex-1">
            <div class="text-[13px] font-medium">Connection</div>
            <div class="text-xs text-ink-faint">{{ cur.id === 'web-search' ? 'Built in: maps to Claude Code WebSearch / WebFetch tools.' : 'Live connector not wired yet: approved actions are copied to your clipboard to send by hand.' }}</div>
          </div>
          <button class="btn btn-sm btn-ghost" :class="cur.status === 'connected' ? 'btn-danger' : ''" type="button" @click="toggleConn">{{ cur.status === 'connected' ? 'Disconnect' : 'Mark connected' }}</button>
        </div>
      </section>
    </div>
  </DrawerPanel>
</template>
