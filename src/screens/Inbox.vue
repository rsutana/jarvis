<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ApprovalRequest } from '@shared/types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Avatar from '@/components/Avatar.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'
import { timeShort } from '@/components/status'

const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()
const wsFilter = computed(() => route.params.id as string | undefined)
const base = computed(() => (wsFilter.value ? `/w/${wsFilter.value}/inbox` : '/inbox'))
const tab = ref<'approve' | 'questions' | 'updates' | 'failures'>('approve')

const inScope = <T extends { workspaceId?: string }>(xs: T[]) => (wsFilter.value ? xs.filter((x) => x.workspaceId === wsFilter.value) : xs)
const approvals = computed(() => inScope(data.pendingApprovals).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const questions = computed(() => inScope(data.tasks.filter((t) => t.status === 'blocked')))
const updates = computed(() => inScope(data.snap?.delegation ?? []).slice(-60).reverse())
const failures = computed(() => (data.snap?.automations ?? []).filter((a) => a.lastRun?.result === 'failed'))
const total = computed(() => approvals.value.length + questions.value.length)

const KIND: Record<ApprovalRequest['kind'], [string, string, string]> = {
  send_email: ['Send email', 'text-status-review border-status-review/50', 'Approve & send'],
  merge: ['Merge', 'text-accent border-accent/50', 'Approve & merge'],
  plan: ['Plan', 'text-status-working border-status-working/50', 'Approve plan'],
  publish: ['Publish', 'text-status-review border-status-review/50', 'Approve & publish'],
  spend: ['Spend', 'text-status-blocked border-status-blocked/50', 'Approve spend'],
  delete: ['Delete', 'text-status-blocked border-status-blocked/50', 'Approve delete'],
  folder: ['Folder', 'text-status-review border-status-review/50', 'Approve']
}

const cur = computed(() => approvals.value.find((a) => a.id === route.params.approvalId) ?? approvals.value[0])
const note = ref('')
const always = ref(false)
const editing = ref(false)
const body = ref('')
const busy = ref(false)
watch(cur, (a) => {
  note.value = ''
  always.value = false
  editing.value = false
  body.value = a?.body ?? ''
}, { immediate: true })
const isTask = computed(() => cur.value?.taskId && data.task(cur.value.taskId))
const who = (id: string) => data.nameOf(id)

async function decide(d: 'approve' | 'reject'): Promise<void> {
  const a = cur.value
  if (!a) return
  busy.value = true
  if (editing.value && body.value !== a.body) await ui.act(() => invoke('approval:update', a.id, body.value))
  await ui.act(() => invoke('approval:decide', a.id, d, note.value || undefined, always.value), d === 'approve' ? 'Approved' : 'Sent back')
  busy.value = false
  router.replace(base.value)
}
const restart = (id: string) => ui.act(() => invoke('task:start', id), 'Started again')
</script>

<template>
  <DrawerPanel label="Inbox" :close-to="wsFilter ? `/w/${wsFilter}` : '/'">
    <template #header>
      <h1 class="m-0 text-title">Inbox <span class="text-[13px] font-normal text-ink-faint">{{ total }} need you · {{ updates.length }} updates</span></h1>
      <div class="flex-1" />
      <div class="seg" role="group" aria-label="Filter">
        <button type="button" :aria-pressed="tab === 'approve'" @click="tab = 'approve'">Needs approval {{ approvals.length }}</button>
        <button type="button" :aria-pressed="tab === 'questions'" @click="tab = 'questions'">Questions {{ questions.length }}</button>
        <button type="button" :aria-pressed="tab === 'updates'" @click="tab = 'updates'">Updates</button>
        <button type="button" :aria-pressed="tab === 'failures'" @click="tab = 'failures'">Failures {{ failures.length }}</button>
      </div>
    </template>

    <div v-if="tab === 'approve'" class="flex min-h-0 flex-1 flex-wrap overflow-auto">
      <section aria-label="Queue" class="min-w-0 flex-[1_1_320px] border-r border-line-soft">
        <RouterLink
          v-for="a in approvals"
          :key="a.id"
          :to="`${base}/${a.id}`"
          :aria-current="cur?.id === a.id ? 'true' : undefined"
          class="flex w-full items-start gap-3 border-b border-line-soft px-4 py-3.5 text-left text-ink no-underline hover:bg-raised hover:text-ink"
          :class="cur?.id === a.id ? 'bg-accent-active/60' : ''"
        >
          <Avatar :name="who(a.requestedBy)" :color="data.agent(a.requestedBy)?.look.color" :size="30" />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex justify-between gap-2"><span class="text-[13.5px] font-semibold">{{ a.title }}</span><span class="mono text-[11px] text-ink-faint">{{ timeShort(a.createdAt) }}</span></span>
            <span class="text-small text-ink-faint">{{ who(a.requestedBy) }} · {{ data.workspace(a.workspaceId)?.name ?? 'Global' }}</span>
            <span class="mt-0.5 flex"><span class="chip" :class="KIND[a.kind][1]">{{ KIND[a.kind][0] }}</span></span>
          </span>
        </RouterLink>
        <p v-if="!approvals.length" class="p-6 text-center text-ink-faint">Nothing waiting for you.</p>
      </section>
      <section v-if="cur" aria-label="Approval detail" class="flex min-w-0 flex-[999_1_460px] flex-col gap-4 px-[22px] py-5">
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-[240px] flex-1">
            <div class="lbl" :class="KIND[cur.kind][1].split(' ')[0]">{{ KIND[cur.kind][0] }}<template v-if="cur.taskId"> · {{ cur.taskId }}</template></div>
            <h2 class="m-0 mt-1 text-[19px] font-semibold">{{ cur.title }}</h2>
            <div class="mt-1 text-[13px] text-ink-muted">Requested by {{ who(cur.requestedBy) }} via {{ cur.via }} · policy “{{ cur.policy }}”</div>
          </div>
          <RouterLink v-if="isTask" class="btn btn-sm" :to="`/w/${cur.workspaceId}/tasks/${cur.taskId}`">Open task run</RouterLink>
          <RouterLink v-else-if="cur.kind === 'plan'" class="btn btn-sm" :to="`/jarvis?mission=${cur.taskId}`">Open plan</RouterLink>
        </div>
        <div class="card overflow-hidden">
          <div v-if="cur.fields.length" class="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 border-b border-line-soft px-4 py-3 text-[13px]">
            <template v-for="f in cur.fields" :key="f.label"><span class="text-ink-faint">{{ f.label }}</span><span class="break-all">{{ f.value }}</span></template>
          </div>
          <label v-if="editing" for="abody" class="sr-only">Content</label>
          <textarea v-if="editing" id="abody" v-model="body" class="block min-h-[180px] w-full resize-y border-0 bg-transparent p-4 text-[13.5px] text-ink outline-none" />
          <div v-else class="min-h-[180px] p-4 text-[13.5px] whitespace-pre-line text-ink">{{ cur.body }}</div>
        </div>
        <div>
          <label for="note" class="field-label">Note to the agent (optional)</label>
          <textarea id="note" v-model="note" class="field resize-y" rows="2" placeholder="e.g. make it shorter and sign as Roy" />
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="btn btn-pri" type="button" :disabled="busy" @click="decide('approve')">{{ KIND[cur.kind][2] }}</button>
          <button class="btn" type="button" :aria-pressed="editing" @click="editing = !editing">{{ editing ? 'Done editing' : 'Edit first' }}</button>
          <button class="btn btn-ghost btn-danger" type="button" :disabled="busy" @click="decide('reject')">Reject &amp; send back</button>
          <div class="flex-1" />
          <label v-if="cur.requestedBy !== 'jarvis' && cur.kind !== 'merge' && cur.kind !== 'plan'" class="flex items-center gap-2 text-small text-ink-muted">
            <input v-model="always" type="checkbox" class="size-4" /> Always allow for {{ who(cur.requestedBy) }}
          </label>
        </div>
      </section>
    </div>

    <div v-else-if="tab === 'questions'" class="flex-1 overflow-auto">
      <div v-for="t in questions" :key="t.id" class="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3.5">
        <Avatar :name="who(t.assigneeId)" :color="data.agent(t.assigneeId)?.look.color" :size="30" />
        <div class="min-w-[220px] flex-1">
          <div class="font-semibold">{{ t.id }} · {{ t.title }}</div>
          <div class="text-small text-status-danger">{{ t.note ?? 'Blocked' }}</div>
        </div>
        <RouterLink class="btn btn-sm" :to="`/w/${t.workspaceId}/tasks/${t.id}`">Open</RouterLink>
        <button class="btn btn-sm btn-pri" type="button" @click="restart(t.id)">Try again</button>
      </div>
      <p v-if="!questions.length" class="p-6 text-center text-ink-faint">No agent is blocked.</p>
    </div>

    <div v-else-if="tab === 'updates'" class="flex flex-1 flex-col gap-2.5 overflow-auto px-5 py-4 text-[13px]">
      <div v-for="e in updates" :key="e.id" class="flex gap-3">
        <span class="mono w-[70px] flex-none text-[11px] text-ink-faint">{{ timeShort(e.t) }}</span>
        <span class="w-[110px] flex-none truncate text-ink-faint">{{ data.workspace(e.workspaceId)?.name }}</span>
        <span class="flex-1" :class="{ 'text-status-working': e.tone === 'good', 'text-accent-link': e.tone === 'merge', 'text-status-danger': e.tone === 'bad' }">{{ e.text }}</span>
      </div>
    </div>

    <div v-else class="flex-1 overflow-auto">
      <div v-for="a in failures" :key="a.id" class="flex items-center gap-3 border-b border-line-soft px-5 py-3.5">
        <div class="flex-1"><div class="font-semibold">{{ a.name }}</div><div class="text-small text-status-danger">Last run failed · {{ timeShort(a.lastRun?.at) }}</div></div>
        <RouterLink class="btn btn-sm" :to="`/automations/${a.id}`">Open automation</RouterLink>
      </div>
      <p v-if="!failures.length" class="p-6 text-center text-ink-faint">No failures.</p>
    </div>
  </DrawerPanel>
</template>
