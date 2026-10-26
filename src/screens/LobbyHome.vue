<script setup lang="ts">
import { computed, ref } from 'vue'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import ChatThread from '@/components/ChatThread.vue'
import Composer from '@/components/Composer.vue'
import Avatar from '@/components/Avatar.vue'
import ChatManager from '@/components/ChatManager.vue'
import { useData } from '@/stores/data'
import { useConversation } from '@/composables/useConversation'
import { ROOF } from '@/scene/colors'
import { MAX_WORKSPACES } from '@shared/app-types'

const data = useData()
const selected = ref<string>()
const { conversations, current, messages, typing, send, create, remove } = useConversation(selected)
const composer = ref<InstanceType<typeof Composer>>()
const open = ref(true)

const jarvis = computed(() => data.snap!.jarvis)
const totalAgents = computed(() => data.agents.filter((a) => a.kind === 'agent').length)
const working = computed(() => data.agents.filter((a) => a.kind === 'agent' && a.status === 'working').length)
const busiestWs = computed(() => data.workspaces.find((w) => data.countByStatus(w.id, 'working') > 0) ?? data.workspaces[0])
const today = new Date().toDateString()
const doneToday = computed(() => data.tasks.filter((t) => t.status === 'done' && t.doneAt && new Date(t.doneAt).toDateString() === today).length)
const budget = computed(() => data.account(jarvis.value.accountId)?.usagePct ?? 0)
const away = computed(() => {
  const since = data.snap?.awaySince
  if (!jarvis.value.awayMode || !since) return null
  const done = data.tasks.filter((t) => t.doneAt && t.doneAt > since).length
  const waiting = data.pendingApprovals.filter((a) => a.createdAt > since).length
  return { done, waiting }
})
const campus = computed(() =>
  data.workspaces.map((w) => {
    const agents = data.agentsIn(w.id).length
    const busy = data.countByStatus(w.id, 'working')
    // same rules as the building label in LobbyWorld
    const dot = !w.orchestratorId ? 'bg-status-review' : busy ? 'bg-status-working' : 'bg-status-idle'
    return { id: w.id, name: w.name, roof: ROOF[w.color], agents, busy, dot, setup: !w.orchestratorId }
  })
)
const full = computed(() => data.workspaces.length >= MAX_WORKSPACES)
const suggestions = ['What can you do?', 'Create a workspace…', 'Status of all workspaces']
async function newChat(): Promise<void> {
  selected.value = await create()
}
async function removeChats(ids: string[]): Promise<void> {
  // deleting the open chat falls back to the most recent one left
  if ((await remove(ids)) && selected.value && ids.includes(selected.value)) selected.value = undefined
}
function suggest(s: string): void {
  if (s.endsWith('…')) composer.value?.set(s.replace('…', ' for '))
  else send(s)
}
const stat = 'flex min-h-control items-center justify-between border-b border-line-soft py-2 text-ink no-underline hover:text-accent-link'
</script>

<template>
  <div class="pointer-events-none absolute top-drawer-top bottom-[76px] left-hud z-20 flex w-[250px] max-w-[calc(100%-32px)] flex-col gap-3 overflow-y-auto">
    <section aria-label="Today" class="pointer-events-auto flex-none rounded-dock border border-line-strong bg-hud px-4 py-3.5">
      <div class="lbl mb-1">Today</div>
      <RouterLink :class="stat" to="/inbox"><span>Needs you</span><b class="text-status-review">{{ data.pendingApprovals.length }}</b></RouterLink>
      <RouterLink :class="stat" :to="busiestWs ? `/w/${busiestWs.id}` : '/workspaces/new'"><span>Agents working</span><b class="text-status-working">{{ working }} / {{ totalAgents }}</b></RouterLink>
      <RouterLink :class="stat" :to="busiestWs ? `/w/${busiestWs.id}/tasks` : '/'"><span>Tasks done</span><b>{{ doneToday }}</b></RouterLink>
      <RouterLink :class="stat" class="border-b-0" to="/accounts"><span>Budget used</span><b>{{ budget }}%</b></RouterLink>
    </section>

    <section aria-labelledby="ws-h" class="pointer-events-auto flex-none rounded-dock border border-line-strong bg-hud px-4 py-3.5">
      <div class="mb-1 flex items-center justify-between">
        <h2 id="ws-h" class="lbl m-0">Workspaces</h2>
        <span class="mono text-[11px] text-ink-faint" :aria-label="`${campus.length} of ${MAX_WORKSPACES} plots used`">{{ campus.length }} / {{ MAX_WORKSPACES }}</span>
      </div>
      <div class="mb-2 flex gap-1" aria-hidden="true">
        <span v-for="i in MAX_WORKSPACES" :key="i" class="h-1 flex-1 rounded-full" :class="i <= campus.length ? '' : 'bg-line-strong'" :style="i <= campus.length ? { background: campus[i - 1].roof } : undefined" />
      </div>
      <RouterLink v-for="w in campus" :key="w.id" :class="stat" class="gap-2.5 last-of-type:border-b-0" :to="`/w/${w.id}`">
        <span class="size-3 flex-none rounded-[3px]" :style="{ background: w.roof }" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ w.name }}</span>
        <span class="dot flex-none" :class="w.dot" aria-hidden="true" />
        <b v-if="w.setup" class="text-xs font-semibold text-status-review">Setup</b>
        <b v-else class="mono text-xs" :class="w.busy ? 'text-status-working' : 'text-ink-faint'" :aria-label="`${w.busy} of ${w.agents} agents working`">{{ w.busy }}/{{ w.agents }}</b>
      </RouterLink>
      <p v-if="!campus.length" class="m-0 py-2 text-small text-ink-faint">No workspaces yet. Each one gets a building on the campus.</p>
      <RouterLink v-if="!full" class="btn btn-sm mt-2.5 w-full" to="/workspaces/new">+ New workspace</RouterLink>
      <button v-else type="button" class="btn btn-sm mt-2.5 w-full" disabled :title="`The campus has room for ${MAX_WORKSPACES} workspaces`">Campus full ({{ MAX_WORKSPACES }}/{{ MAX_WORKSPACES }})</button>
    </section>
  </div>

  <DrawerPanel v-if="open" label="Jarvis chat" bare>
    <div class="flex items-center gap-3 border-b border-line px-[18px] py-3.5">
      <Avatar name="Jarvis" square :size="30" />
      <div class="min-w-0 flex-1">
        <div class="font-semibold">Jarvis <span class="text-small font-normal text-ink-faint">Main assistant</span></div>
        <div class="mono text-[11px] text-ink-faint">{{ jarvis.model }} · {{ jarvis.thinking }}</div>
      </div>
      <RouterLink class="btn btn-sm btn-ghost" :to="current ? `/jarvis/${current.id}` : '/jarvis'">Expand</RouterLink>
      <button type="button" class="x-close cursor-pointer border-0 bg-transparent" aria-label="Close" @click="open = false">×</button>
    </div>
    <div class="flex gap-2 px-4 pt-3">
      <label for="conv" class="sr-only">Conversation</label>
      <select id="conv" class="field min-h-9 text-[13px]" :value="current?.id" @change="selected = ($event.target as HTMLSelectElement).value">
        <option v-for="c in conversations" :key="c.id" :value="c.id">{{ c.title }}</option>
        <option v-if="!conversations.length" value="">No conversations yet</option>
      </select>
      <button class="btn btn-sm min-h-9" type="button" @click="newChat">+ New</button>
      <ChatManager :conversations="conversations" :current-id="current?.id" :busy="data.typing" @pick="selected = $event" @remove="removeChats" />
    </div>
    <div v-if="away" class="mx-4 mt-3 flex items-center gap-2.5 rounded-row border border-accent-ring bg-accent-tint p-3 text-[13px]">
      <span class="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-bold text-app">AWAY</span>
      <span class="flex-1"><b class="font-semibold text-accent-hover">While you were away:</b> <span class="text-ink-muted">{{ away.done }} tasks finished · {{ away.waiting }} waiting for you</span></span>
      <RouterLink class="btn btn-sm" to="/inbox">Review</RouterLink>
    </div>
    <ChatThread :messages="messages" :typing="typing" />
    <div class="flex flex-wrap gap-1.5 px-4 pb-2">
      <button v-for="s in suggestions" :key="s" class="chip min-h-8 cursor-pointer hover:border-accent" type="button" @click="suggest(s)">{{ s }}</button>
    </div>
    <div class="border-t border-line-soft px-4 pt-2.5 pb-4">
      <Composer id="jmsg" ref="composer" placeholder="Message Jarvis… (paste or drop files)" :disabled="typing" @send="send" />
    </div>
  </DrawerPanel>
  <button v-else type="button" class="pointer-events-auto absolute top-drawer-top right-hud z-20 btn btn-pri" @click="open = true">Open Jarvis</button>
</template>
