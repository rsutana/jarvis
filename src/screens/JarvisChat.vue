<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Mission } from '@shared/types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import ChatThread from '@/components/ChatThread.vue'
import Composer from '@/components/Composer.vue'
import Avatar from '@/components/Avatar.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'
import { useConversation } from '@/composables/useConversation'

const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()
const cid = computed(() => route.params.conversationId as string | undefined)
const { conversations, current, messages, typing, send, create } = useConversation(cid)
const composer = ref<InstanceType<typeof Composer>>()
const jarvis = computed(() => data.snap!.jarvis)

/** Plan on the right: ?mission=, else the latest mission card in this conversation. */
const mission = computed(() => {
  const id = (route.query.mission as string) ?? [...messages.value].reverse().find((m) => m.missionId)?.missionId
  return data.snap?.missions.find((m) => m.id === id) as (Mission & { schedule?: string }) | undefined
})
const ws = computed(() => data.workspace(mission.value?.workspaceId))
const statusTone: Record<string, string> = { awaiting_approval: 'text-status-review', draft: 'text-status-review', running: 'text-status-working', done: 'text-status-done', failed: 'text-status-danger' }
const perms = computed(() => {
  if (!mission.value) return []
  const ids = new Set(mission.value.steps.map((s) => s.assigneeId))
  const out: { label: string; policy: string }[] = []
  for (const id of ids) {
    for (const link of data.agent(id)?.integrations ?? []) {
      const integ = data.snap?.integrations.find((i) => i.id === link.integrationId)
      if (integ) out.push({ label: `${integ.name} · ${data.nameOf(id)}`, policy: link.policy })
    }
  }
  return out
})
const policyText: Record<string, [string, string]> = { allowed: ['Allowed', 'text-status-working'], ask: ['Ask me', 'text-status-review'], off: ['Off', 'text-ink-faint'] }

function pickConv(id: string): void {
  router.replace(`/jarvis/${id}`)
}
async function newChat(): Promise<void> {
  const id = await create()
  if (id) router.replace(`/jarvis/${id}`)
}
const approve = () => mission.value && ui.act(() => invoke('mission:approve', mission.value!.id), mission.value.schedule ? 'Approved and scheduled' : 'Mission approved')
const runOnce = () => mission.value && ui.act(() => invoke('mission:runOnce', mission.value!.id), 'Running once')
</script>

<template>
  <DrawerPanel label="Jarvis chat" close-to="/">
    <template #header>
      <Avatar name="Jarvis" square :size="30" />
      <h1 class="m-0 text-title">Jarvis <span class="text-[13px] font-normal text-ink-faint">Main assistant</span></h1>
      <label for="conv" class="sr-only">Conversation</label>
      <select id="conv" class="field min-h-9 w-[260px] text-[13px]" :value="current?.id" @change="pickConv(($event.target as HTMLSelectElement).value)">
        <option v-for="c in conversations" :key="c.id" :value="c.id">{{ c.title }}</option>
      </select>
      <button class="btn btn-sm" type="button" @click="newChat">+ New chat</button>
      <div class="flex-1" />
      <span class="chip mono">{{ jarvis.model }} · {{ jarvis.thinking }}</span>
    </template>
    <div class="flex min-h-0 flex-1 flex-wrap">
      <section aria-label="Conversation" class="flex min-h-full min-w-0 flex-[999_1_460px] flex-col">
        <ChatThread :messages="messages" :typing="typing" roomy />
        <div class="border-t border-line-soft px-6 pt-2.5 pb-[18px]">
          <div class="mb-2.5 flex flex-wrap gap-1.5">
            <button v-for="s in ['@workspace', '@agent', '/plan', '/status']" :key="s" class="chip min-h-8 cursor-pointer hover:border-accent" type="button" @click="composer?.insert(s)">{{ s }}</button>
          </div>
          <Composer id="cmsg" ref="composer" placeholder="Message Jarvis… use @ to target a workspace or agent" :disabled="typing" @send="send" />
        </div>
      </section>

      <section aria-label="Mission plan" class="flex max-h-full flex-[1_1_340px] flex-col gap-3.5 overflow-auto border-l border-line-soft bg-sidebar p-[18px]">
        <template v-if="mission">
          <div>
            <div class="lbl" :class="statusTone[mission.status]">Mission {{ mission.id }} · {{ mission.status.replace('_', ' ') }}</div>
            <h2 class="m-0 mt-1 text-title">{{ mission.title }}</h2>
          </div>
          <dl class="m-0 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <dt class="text-ink-faint">Workspace</dt><dd class="m-0">{{ ws?.name ?? '—' }}</dd>
            <dt class="text-ink-faint">Schedule</dt><dd class="m-0 mono">{{ mission.schedule ?? 'Once' }}</dd>
            <dt class="text-ink-faint">Est. usage</dt><dd class="m-0">≈ {{ mission.estUsagePct ?? 1 }}% / run</dd>
          </dl>
          <div>
            <div v-for="(s, i) in mission.steps" :key="i" class="flex items-start gap-2.5 border-b border-line-soft py-2.5">
              <span class="mono w-3.5 pt-1.5 text-xs text-ink-faint">{{ i + 1 }}</span>
              <Avatar :name="data.nameOf(s.assigneeId)" :color="data.agent(s.assigneeId)?.look.color" :size="28" />
              <div class="min-w-0 flex-1">
                <div class="text-[13px] font-medium">{{ s.title }}</div>
                <div class="text-xs text-ink-faint">{{ data.nameOf(s.assigneeId) }} · {{ s.model }}</div>
              </div>
              <span v-if="s.gate" class="chip border-status-review/50 text-status-review">Approval</span>
            </div>
          </div>
          <div v-if="perms.length" class="card p-3 text-small">
            <div class="lbl mb-1.5">Permissions used</div>
            <div v-for="p in perms" :key="p.label" class="flex justify-between py-0.5">
              <span>{{ p.label }}</span><span :class="policyText[p.policy][1]">{{ policyText[p.policy][0] }}</span>
            </div>
          </div>
          <div class="mt-auto flex flex-wrap gap-2">
            <template v-if="mission.status === 'awaiting_approval' || mission.status === 'draft'">
              <button class="btn btn-pri flex-1" type="button" @click="approve">{{ mission.schedule ? 'Approve & schedule' : 'Approve' }}</button>
              <button v-if="mission.schedule" class="btn" type="button" @click="runOnce">Run once</button>
            </template>
            <RouterLink class="btn btn-ghost" :to="`/w/${mission.workspaceId}/orchestrator?mission=${mission.id}`">Open in orchestrator</RouterLink>
          </div>
        </template>
        <div v-else class="m-auto max-w-[260px] text-center text-ink-faint">
          When you ask for work, Jarvis drafts a mission here. Nothing runs until you approve it.
        </div>
      </section>
    </div>
  </DrawerPanel>
</template>
