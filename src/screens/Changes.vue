<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FileDiff } from '@shared/app-types'
import type { RepoStatus } from '@shared/types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Avatar from '@/components/Avatar.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'
import { ago } from '@/components/status'

const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()
const id = computed(() => route.params.id as string)
const ws = computed(() => data.workspace(id.value))
const filter = ref<'open' | 'merged'>('open')
const all = computed(() => (data.snap?.changes ?? []).filter((c) => c.workspaceId === id.value).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const list = computed(() => all.value.filter((c) => (filter.value === 'open' ? c.state === 'open' : c.state !== 'open')))
const cur = computed(() => all.value.find((c) => c.branch === route.params.branch) ?? list.value[0])
watch(cur, (c) => {
  if (c && c.state !== 'open') filter.value = 'merged'
}, { immediate: true })

const git = ref<RepoStatus[] | null>(null)
const gitErr = ref('')
async function loadGit(): Promise<void> {
  gitErr.value = ''
  git.value = await invoke('workspace:gitStatus', id.value).catch((e: Error) => ((gitErr.value = e.message.replace(/^.*?: /, '')), null))
}
watch(() => [id.value, ws.value?.folderPath, ws.value?.repos?.length, data.snap?.changes.length], loadGit, { immediate: true })
const baseOf = (repo: string) => ws.value?.repos?.find((r) => r.name === repo)?.baseBranch ?? ws.value?.git.baseBranch

const diffs = ref<FileDiff[]>([])
const diffErr = ref('')
const fileIdx = ref(0)
watch(cur, async (c) => {
  diffs.value = []
  diffErr.value = ''
  fileIdx.value = 0
  if (!c) return
  diffs.value = await invoke('change:diff', id.value, c.branch).catch((e: Error) => ((diffErr.value = 'Diff unavailable: ' + e.message.replace(/^.*?: /, '')), []))
}, { immediate: true })
const file = computed(() => diffs.value[fileIdx.value])
const lines = computed(() => {
  const p = file.value?.patch ?? ''
  const out: { n: string; code: string; kind: 'add' | 'del' | 'ctx' | 'hunk' }[] = []
  let n = 0
  for (const l of p.replace(/\n$/, '').split('\n')) {
    if (l.startsWith('\\')) continue // "\ No newline at end of file"
    if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(l)) continue
    if (l.startsWith('@@')) {
      const m = l.match(/\+(\d+)/)
      n = m ? Number(m[1]) - 1 : n
      out.push({ n: '…', code: l, kind: 'hunk' })
    } else if (l.startsWith('+')) out.push({ n: String(++n), code: l, kind: 'add' })
    else if (l.startsWith('-')) out.push({ n: '', code: l, kind: 'del' })
    else out.push({ n: String(++n), code: l, kind: 'ctx' })
    if (out.length > 1500) break
  }
  return out
})
const agent = computed(() => data.agent(cur.value?.agentId))
const qaAgent = computed(() => data.agentsIn(id.value).find((a) => /qa|test/i.test(a.role)))
const ST = (c: NonNullable<typeof cur.value>) =>
  c.state === 'merged' ? ['Merged', 'text-status-done border-status-done/50'] : c.state === 'closed' ? ['Reverted', 'text-ink-faint'] : [c.qa === 'passed' ? 'Open · ready' : `Open · QA ${c.qa}`, 'text-status-review border-status-review/50']
const QA: Record<string, string> = { passed: 'text-status-working border-status-working/50', failed: 'text-status-danger border-status-blocked/50', running: 'text-ink-faint', pending: 'text-ink-faint' }
const pendingMerge = computed(() => data.pendingApprovals.find((a) => a.kind === 'merge' && a.title === `Merge ${cur.value?.branch}`))

const merge = () => cur.value && ui.act(() => invoke('change:merge', cur.value!.branch))
const revert = () => cur.value && ui.act(() => invoke('change:revert', cur.value!.branch))
const qa = () => cur.value && ui.act(() => invoke('change:requestQa', id.value, cur.value!.branch), 'QA started')
const asking = ref(false)
const feedback = ref('')
async function requestChanges(): Promise<void> {
  if (!cur.value || !feedback.value.trim()) return
  await ui.act(() => invoke('change:requestChanges', id.value, cur.value!.branch, feedback.value.trim()), 'Sent back to the agent')
  asking.value = false
  feedback.value = ''
}
const pick = (b: string) => router.replace(`/w/${id.value}/changes/${b}`)
</script>

<template>
  <DrawerPanel label="Changes" :close-to="`/w/${id}`">
    <template #header>
      <h1 class="m-0 text-title">Changes</h1>
      <template v-if="git">
        <span v-for="r in git" :key="r.path" class="chip mono"><span class="dot" :class="r.clean ? 'bg-status-working' : 'bg-status-review'" />{{ git.length > 1 ? `${r.name}: ` : '' }}{{ r.branch }} · {{ r.clean ? 'clean' : 'uncommitted changes' }}</span>
      </template>
      <span v-else class="chip text-status-review">{{ gitErr || 'checking git…' }}</span>
    </template>
    <div class="flex min-h-0 flex-1 flex-wrap overflow-auto">
      <section aria-label="Branches" class="flex max-w-full flex-[1_1_280px] flex-col gap-2 border-r border-line-soft p-3.5">
        <div class="seg" role="group" aria-label="Filter">
          <button type="button" class="flex-1" :aria-pressed="filter === 'open'" @click="filter = 'open'">Open {{ all.filter((c) => c.state === 'open').length }}</button>
          <button type="button" class="flex-1" :aria-pressed="filter === 'merged'" @click="filter = 'merged'">Merged {{ all.filter((c) => c.state !== 'open').length }}</button>
        </div>
        <button
          v-for="c in list"
          :key="c.branch"
          type="button"
          :aria-pressed="cur?.branch === c.branch"
          class="flex w-full cursor-pointer flex-col gap-1.5 rounded-row border bg-card p-2.5 text-left text-ink hover:border-line-strong"
          :class="cur?.branch === c.branch ? 'border-accent' : 'border-line'"
          @click="pick(c.branch)"
        >
          <span class="mono text-xs break-all">{{ c.branch }}</span>
          <span class="flex flex-wrap items-center gap-2"><span class="chip" :class="ST(c)[1]">{{ ST(c)[0] }}</span><span class="text-xs text-ink-faint">{{ c.taskId ?? 'Auto' }} · {{ data.nameOf(c.agentId) }}</span></span>
          <span v-if="c.repos?.length" class="mono text-xs text-ink-faint">{{ c.repos.map((r) => r.name).join(' · ') }}</span>
          <span class="flex justify-between text-xs"><span class="text-ink-faint">{{ ago(c.mergedAt ?? c.createdAt) }}</span><span class="mono"><span class="text-status-working">+{{ c.additions }}</span> <span class="text-status-danger">−{{ c.deletions }}</span></span></span>
        </button>
        <p v-if="!list.length" class="p-4 text-center text-ink-faint">No {{ filter }} branches.</p>
      </section>
      <section v-if="cur" aria-label="Change detail" class="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5 px-5 py-4">
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-[240px] flex-1">
            <div class="mono text-[13.5px] break-all">{{ cur.branch }}</div>
            <div class="mt-1 text-small text-ink-faint">{{ data.nameOf(cur.agentId) }} · {{ cur.taskId ?? 'Auto' }}<template v-if="!cur.repos?.length"> → {{ ws?.git.baseBranch }}</template> · {{ cur.commits }} commits · <span class="text-status-working">+{{ cur.additions }}</span> <span class="text-status-danger">−{{ cur.deletions }}</span></div>
            <div class="mt-2 flex flex-wrap gap-1.5"><span class="chip" :class="ST(cur)[1]">{{ ST(cur)[0] }}</span><span class="chip" :class="QA[cur.qa]">QA {{ cur.qa }}</span></div>
            <div v-if="cur.repos?.length" class="mt-2 flex flex-wrap gap-1.5">
              <span v-for="r in cur.repos" :key="r.name" class="chip mono">{{ r.name }} → {{ baseOf(r.name) }} · <span class="text-status-working">+{{ r.additions }}</span> <span class="text-status-danger">−{{ r.deletions }}</span><template v-if="r.mergeCommit"> · {{ r.mergeCommit.slice(0, 7) }}</template></span>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <RouterLink v-if="cur.taskId && data.task(cur.taskId)" class="btn btn-sm" :to="`/w/${id}/tasks/${cur.taskId}`">Open task</RouterLink>
            <template v-if="cur.state === 'open'">
              <button v-if="cur.qa !== 'running' && qaAgent" class="btn btn-sm" type="button" @click="qa">Run QA ({{ qaAgent.name }})</button>
              <button class="btn btn-sm" type="button" @click="asking = !asking">Request changes</button>
              <RouterLink v-if="pendingMerge" class="btn btn-sm btn-pri" :to="`/inbox/${pendingMerge.id}`">Waiting in Inbox</RouterLink>
              <button v-else class="btn btn-sm btn-pri" type="button" @click="merge">{{ cur.qa === 'passed' ? 'Approve & merge' : 'Request merge' }}</button>
            </template>
            <button v-else-if="cur.state === 'merged'" class="btn btn-sm" type="button" @click="revert">Revert merge</button>
          </div>
        </div>
        <form v-if="asking" class="card flex gap-2 p-2" @submit.prevent="requestChanges">
          <label for="fb" class="sr-only">What should change?</label>
          <input id="fb" v-model="feedback" class="field" :placeholder="`Tell ${agent?.name} what to change…`" autofocus />
          <button class="btn btn-pri" type="submit">Send back</button>
        </form>
        <div v-if="cur.qaNote" class="card flex flex-wrap items-center gap-2.5 px-3 py-2.5 text-[13px]">
          <Avatar :name="qaAgent?.name ?? 'QA'" :color="qaAgent?.look.color" :size="26" />
          <span class="min-w-[200px] flex-1"><b>{{ qaAgent?.name ?? 'QA' }} · QA:</b> <span class="text-ink-muted">{{ cur.qaNote }}</span></span>
        </div>
        <p v-if="diffErr" class="m-0 text-small text-ink-faint">{{ diffErr }}</p>
        <div v-if="diffs.length" class="flex flex-wrap gap-3">
          <div class="card flex-[1_1_190px] self-start p-1.5">
            <div class="lbl px-2.5 py-1.5">Files · {{ diffs.length }}</div>
            <button v-for="(f, i) in diffs" :key="f.path" type="button" class="mono flex w-full cursor-pointer justify-between gap-2 rounded-md border-0 px-3 py-[7px] text-left text-xs text-ink" :class="i === fileIdx ? 'bg-accent-active' : 'bg-transparent hover:bg-raised'" @click="fileIdx = i">
              <span class="truncate">{{ f.path.split('/').pop() }}</span><span class="text-status-working">+{{ f.additions }}</span>
            </button>
          </div>
          <div v-if="file" class="card min-w-0 flex-[999_1_360px] overflow-hidden">
            <div class="mono flex justify-between gap-2 border-b border-line-soft px-3 py-2 text-xs"><span class="break-all">{{ file.path }}</span><span class="text-ink-faint">{{ file.status }}</span></div>
            <div class="mono max-h-[560px] overflow-auto py-1.5 text-[12.5px] leading-[1.7]">
              <div v-for="(l, i) in lines" :key="i" class="flex whitespace-pre" :class="{ 'bg-status-working/10 text-ink': l.kind === 'add', 'bg-status-blocked/10 text-ink': l.kind === 'del', 'text-ink-muted': l.kind === 'ctx', 'text-accent-link': l.kind === 'hunk' }">
                <span class="w-10 flex-none pr-3 text-right text-ink-label select-none">{{ l.n }}</span>{{ l.code }}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </DrawerPanel>
</template>
