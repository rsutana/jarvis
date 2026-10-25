<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Integration, McpConfig, Policy } from '@shared/types'
import { MCP_REDIRECT_URL } from '@shared/app-types'
import { ago } from '@/components/status'
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
  // a custom MCP starts with connection settings; its tools come from the server once connected
  const mcp: McpConfig | undefined = type === 'mcp' ? { transport: 'http', oauth: 'dcr', headers: [] } : undefined
  const i = await ui.act(() => invoke('integration:save', { id: '', name, type, tools: [], agentIds: [], workspaceScope: 'all', status: 'disconnected', mcp }), `${name} added`)
  if (i) router.replace(`/integrations/${i.id}`)
}

// remove: first click arms the button, second click removes (it also unlinks the integration from agents)
const removing = ref<string | null>(null)
async function remove(i: Integration): Promise<void> {
  if (removing.value !== i.id) return void (removing.value = i.id)
  removing.value = null
  const ok = await ui.act(() => invoke('integration:delete', i.id).then(() => true), `${i.name} removed`)
  if (ok && route.params.integrationId === i.id) router.replace('/integrations')
}

// custom MCP connection form; secret values are write-only (blank = keep the saved one)
const form = reactive({
  name: '', transport: 'http' as McpConfig['transport'], url: '', command: '', args: '', oauth: 'dcr' as McpConfig['oauth'], clientId: '', clientSecret: '',
  headers: [] as { name: string; value: string; set: boolean }[]
})
function loadForm(i?: Integration): void {
  const m = i?.mcp
  if (!i || !m) return
  Object.assign(form, {
    name: i.name, transport: m.transport, url: m.url ?? '', command: m.command ?? '', args: (m.args ?? []).join(' '), oauth: m.oauth, clientId: m.clientId ?? '', clientSecret: '',
    headers: (m.headers ?? []).map((h) => ({ name: h.name, value: '', set: h.set }))
  })
}
watch(() => cur.value?.id, () => loadForm(cur.value), { immediate: true })
const busy = ref<'' | 'save' | 'connect'>('')
async function saveConn(): Promise<boolean> {
  const i = cur.value
  if (!i) return false
  busy.value = 'save'
  if (form.name.trim() && form.name.trim() !== i.name) await save({ ...i, name: form.name.trim() })
  const cfg: McpConfig = {
    transport: form.transport, url: form.url, command: form.command, args: form.args.trim() ? form.args.trim().split(/\s+/) : [], oauth: form.oauth, clientId: form.clientId,
    headers: form.headers.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), set: h.set }))
  }
  const secrets = { headers: Object.fromEntries(form.headers.filter((h) => h.name.trim() && h.value).map((h) => [h.name.trim(), h.value])), clientSecret: form.clientSecret || undefined }
  const r = await ui.act(() => invoke('mcp:configure', i.id, cfg, secrets))
  busy.value = ''
  if (r) loadForm(r)
  return !!r
}
async function connect(): Promise<void> {
  if (!cur.value || !(await saveConn())) return
  busy.value = 'connect'
  const r = await ui.act(() => invoke('mcp:connect', cur.value!.id), 'Connected')
  busy.value = ''
  if (r) ui.toast(`${r.tools.length} tool${r.tools.length === 1 ? '' : 's'} found. Choose what each may do.`, 'good')
}
const signOut = () => cur.value && ui.act(() => invoke('mcp:signOut', cur.value!.id), 'Signed out')
const remote = computed(() => form.transport !== 'stdio')
const showTools = computed(() => !!cur.value && (!cur.value.mcp || cur.value.tools.length > 0))
const STATUS = (i: Integration) => (i.status === 'connected' ? ['Connected', 'border-status-working/50 text-status-working', 'bg-status-working'] : i.status === 'error' ? ['Error', 'border-status-blocked/50 text-status-danger', 'bg-status-blocked'] : [i.mcp && !i.mcp.testedAt ? 'Not tested' : 'Not connected', '', 'bg-status-idle'])
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
        <div v-for="i in list" :key="i.id" class="group flex items-center rounded-card border" :class="cur?.id === i.id ? 'border-accent bg-accent-tint' : 'border-line bg-card'">
          <RouterLink :to="`/integrations/${i.id}`" class="flex min-w-0 flex-1 items-center gap-3 p-3 text-ink no-underline hover:text-ink">
            <span class="inline-flex size-[34px] flex-none items-center justify-center rounded-[9px] bg-raised text-[13px] font-bold">{{ i.name[0] }}</span>
            <span class="min-w-0 flex-1"><span class="block font-medium">{{ i.name }}</span><span class="text-xs text-ink-faint">{{ summary(i) }}</span></span>
            <span class="dot" :class="i.status === 'connected' ? 'bg-status-working' : 'bg-status-idle'" :aria-label="i.status" />
          </RouterLink>
          <button
            v-if="i.id !== 'web-search'"
            type="button"
            class="btn btn-sm btn-ghost mr-1.5 flex-none"
            :class="removing === i.id ? 'btn-danger' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'"
            :aria-label="removing === i.id ? `Confirm removing ${i.name}` : `Remove ${i.name}`"
            @click="remove(i)"
            @blur="removing === i.id && (removing = null)"
          >{{ removing === i.id ? 'Remove?' : '×' }}</button>
        </div>
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
          <span class="chip" :class="STATUS(cur)[1]"><span class="dot" :class="STATUS(cur)[2]" />{{ STATUS(cur)[0] }}</span>
        </div>

        <form v-if="cur.mcp" class="card flex flex-col gap-0 p-0" @submit.prevent="connect">
          <div class="border-b border-line-soft px-3.5 py-2.5"><span class="lbl">Connection</span></div>
          <div class="grid grid-cols-[minmax(140px,190px)_1fr] items-start gap-x-4 gap-y-3.5 px-3.5 py-3.5 max-sm:grid-cols-1">
            <label class="text-[13px] font-medium" for="mn">Name</label>
            <input id="mn" v-model="form.name" class="field" placeholder="e.g. Rocks MCP" />

            <label class="text-[13px] font-medium" for="mt">Transport <span class="text-status-danger">*</span></label>
            <select id="mt" v-model="form.transport" class="field">
              <option value="http">Streamable HTTP</option>
              <option value="sse">SSE (legacy)</option>
              <option value="stdio">Local command (stdio)</option>
            </select>

            <template v-if="remote">
              <label class="text-[13px] font-medium" for="mu">URL <span class="text-status-danger">*</span></label>
              <input id="mu" v-model="form.url" class="field mono text-small" placeholder="https://mcp.example.com/mcp" autocomplete="off" spellcheck="false" />

              <div><div class="text-[13px] font-medium">Headers</div><div class="text-xs text-ink-faint">Sent with every request, e.g. an API key. Values are encrypted and never shown again.</div></div>
              <div class="flex flex-col gap-2">
                <div v-for="(h, k) in form.headers" :key="k" class="flex gap-2">
                  <input v-model="h.name" class="field mono min-h-8 flex-[0_1_40%] text-xs" placeholder="Authorization" :aria-label="`Header ${k + 1} name`" />
                  <input v-model="h.value" type="password" autocomplete="off" class="field mono min-h-8 flex-1 text-xs" :placeholder="h.set ? 'Saved · type to replace' : 'Value'" :aria-label="`Header ${k + 1} value`" />
                  <button type="button" class="btn btn-sm btn-ghost" :aria-label="`Remove header ${h.name || k + 1}`" @click="form.headers.splice(k, 1)">×</button>
                </div>
                <button type="button" class="btn btn-sm self-start" @click="form.headers.push({ name: '', value: '', set: false })">+ Add header</button>
              </div>

              <div><div class="text-[13px] font-medium">OAuth</div><div class="text-xs text-ink-faint">How Jarvis signs in to this server.</div></div>
              <div class="flex flex-col gap-2">
                <select id="mo" v-model="form.oauth" class="field" aria-label="OAuth">
                  <option value="none">None</option>
                  <option value="dcr">Auto-register (dynamic client registration)</option>
                  <option value="client">Bring your own client</option>
                </select>
                <p v-if="form.oauth === 'dcr'" class="m-0 text-xs text-ink-faint">Jarvis registers itself with the server's sign-in and opens your browser to approve it, the first time and whenever the session expires.</p>
                <template v-if="form.oauth === 'client'">
                  <input v-model="form.clientId" class="field mono text-small" placeholder="Client ID" aria-label="OAuth client ID" autocomplete="off" />
                  <input v-model="form.clientSecret" type="password" class="field mono text-small" :placeholder="cur.mcp.hasClientSecret ? 'Client secret saved · type to replace' : 'Client secret (optional)'" aria-label="OAuth client secret" autocomplete="off" />
                  <p class="m-0 text-xs text-ink-faint">Register this redirect URL with the provider: <span class="mono select-all">{{ MCP_REDIRECT_URL }}</span></p>
                </template>
              </div>
            </template>
            <template v-else>
              <label class="text-[13px] font-medium" for="mc">Command <span class="text-status-danger">*</span></label>
              <input id="mc" v-model="form.command" class="field mono text-small" placeholder="npx" autocomplete="off" spellcheck="false" />
              <label class="text-[13px] font-medium" for="ma">Arguments</label>
              <input id="ma" v-model="form.args" class="field mono text-small" placeholder="-y @acme/mcp-server" autocomplete="off" spellcheck="false" />
            </template>
          </div>
          <div class="flex flex-wrap items-center gap-2.5 border-t border-line-soft px-3.5 py-3">
            <span class="min-w-[200px] flex-1 text-xs" :class="cur.mcp.error && !busy ? 'text-status-danger' : 'text-ink-faint'">
              <template v-if="busy === 'connect'">{{ remote && form.oauth !== 'none' ? 'Connecting… if a browser tab opens, sign in there.' : 'Connecting…' }}</template>
              <template v-else-if="cur.mcp.error">Couldn't connect: {{ cur.mcp.error }}</template>
              <template v-else-if="cur.status === 'connected'">Connected to {{ cur.mcp.server?.name ?? 'the server' }}{{ cur.mcp.server?.version ? ` ${cur.mcp.server.version}` : '' }} · {{ cur.tools.length }} tools · checked {{ ago(cur.mcp.testedAt) }}</template>
              <template v-else>Not tested yet. Connecting lists the tools this server offers.</template>
            </span>
            <button v-if="cur.mcp.signedIn" class="btn btn-sm btn-ghost" type="button" :disabled="!!busy" @click="signOut">Sign out</button>
            <button class="btn btn-sm" type="button" :disabled="!!busy" @click="saveConn">{{ busy === 'save' ? 'Saving…' : 'Save' }}</button>
            <button class="btn btn-sm btn-pri" type="submit" :disabled="!!busy">{{ busy === 'connect' ? 'Connecting…' : cur.status === 'connected' ? 'Reconnect & refresh tools' : remote && form.oauth !== 'none' ? 'Sign in & discover tools' : 'Connect & discover tools' }}</button>
          </div>
        </form>

        <p v-if="!showTools" class="card m-0 px-3.5 py-3 text-small text-ink-faint">Tools appear here after you connect: Jarvis asks the server what it offers, then you choose what each one may do and who can use it.</p>
        <div v-if="showTools" class="card overflow-x-auto">
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
              <tr v-if="!cur.mcp" class="border-t border-line-soft">
                <td class="p-1.5"><input v-model="newTool.name" aria-label="Tool name" class="field mono min-h-8 text-xs" placeholder="tool_name" /></td>
                <td class="p-1.5"><input v-model="newTool.description" aria-label="Tool description" class="field min-h-8" placeholder="What it does" /></td>
                <td class="p-1.5"><button class="btn btn-sm" type="button" @click="addTool">+ Tool</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="showTools" class="card flex flex-col gap-2.5 p-3.5">
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
        <div v-if="!cur.mcp" class="card flex flex-wrap items-center gap-2.5 px-3.5 py-3">
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
