<script setup lang="ts">
import { computed, ref } from 'vue'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import ChatThread from '@/components/ChatThread.vue'
import Composer from '@/components/Composer.vue'
import Avatar from '@/components/Avatar.vue'
import { useData } from '@/stores/data'
import { useConversation } from '@/composables/useConversation'

const data = useData()
const selected = ref<string>()
const { conversations, current, messages, typing, send, create } = useConversation(selected)
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
const suggestions = ['What can you do?', 'Create a workspace…', 'Status of all workspaces']
async function newChat(): Promise<void> {
  selected.value = await create()
}
function suggest(s: string): void {
  if (s.endsWith('…')) composer.value?.set(s.replace('…', ' for '))
  else send(s)
}
const stat = 'flex min-h-control items-center justify-between border-b border-line-soft py-2 text-ink no-underline hover:text-accent-link'
</script>

<template>
  <section aria-label="Today" class="pointer-events-auto absolute top-drawer-top left-hud z-20 w-[250px] max-w-[calc(100%-32px)] rounded-dock border border-line-strong bg-hud px-4 py-3.5">
    <div class="lbl mb-1">Today</div>
    <RouterLink :class="stat" to="/inbox"><span>Needs you</span><b class="text-status-review">{{ data.pendingApprovals.length }}</b></RouterLink>
    <RouterLink :class="stat" :to="busiestWs ? `/w/${busiestWs.id}` : '/workspaces/new'"><span>Agents working</span><b class="text-status-working">{{ working }} / {{ totalAgents }}</b></RouterLink>
    <RouterLink :class="stat" :to="busiestWs ? `/w/${busiestWs.id}/tasks` : '/'"><span>Tasks done</span><b>{{ doneToday }}</b></RouterLink>
    <RouterLink :class="stat" class="border-b-0" to="/accounts"><span>Budget used</span><b>{{ budget }}%</b></RouterLink>
  </section>

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
      <Composer id="jmsg" ref="composer" placeholder="Message Jarvis…" :disabled="typing" @send="send" />
    </div>
  </DrawerPanel>
  <button v-else type="button" class="pointer-events-auto absolute top-drawer-top right-hud z-20 btn btn-pri" @click="open = true">Open Jarvis</button>
</template>
