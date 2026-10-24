<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'

const data = useData()
const ui = useUi()
const router = useRouter()
const q = ref('')
const input = ref<HTMLInputElement>()
const sel = ref(0)

const results = computed(() => {
  const s = q.value.trim().toLowerCase()
  const all: { kind: string; label: string; sub: string; to: string }[] = [
    ...data.workspaces.map((w) => ({ kind: 'Workspace', label: w.name, sub: w.goal, to: `/w/${w.id}` })),
    ...data.agents.map((a) => ({ kind: 'Agent', label: a.name, sub: a.role, to: a.workspaceId ? `/w/${a.workspaceId}/agents/${a.id}` : `/agents/${a.id}` })),
    ...data.tasks.map((t) => ({ kind: 'Task', label: `${t.id} ${t.title}`, sub: data.workspace(t.workspaceId)?.name ?? '', to: `/w/${t.workspaceId}/tasks/${t.id}` })),
    ...data.pendingApprovals.map((a) => ({ kind: 'Inbox', label: a.title, sub: data.nameOf(a.requestedBy), to: `/inbox/${a.id}` })),
    ...(data.snap?.conversations ?? []).map((c) => ({ kind: 'Chat', label: c.title, sub: 'Jarvis', to: `/jarvis/${c.id}` }))
  ]
  return (s ? all.filter((r) => (r.label + ' ' + r.sub).toLowerCase().includes(s)) : all).slice(0, 12)
})

watch(
  () => ui.searchOpen,
  async (o) => {
    if (!o) return
    q.value = ''
    sel.value = 0
    await nextTick()
    input.value?.focus()
  }
)
watch(q, () => (sel.value = 0))

function go(i: number): void {
  const r = results.value[i]
  if (!r) return
  ui.searchOpen = false
  router.push(r.to)
}
function key(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') sel.value = Math.min(results.value.length - 1, sel.value + 1)
  else if (e.key === 'ArrowUp') sel.value = Math.max(0, sel.value - 1)
  else if (e.key === 'Enter') go(sel.value)
  else if (e.key === 'Escape') ui.searchOpen = false
  else return
  e.preventDefault()
  e.stopPropagation()
}
</script>

<template>
  <div v-if="ui.searchOpen" class="absolute inset-0 z-50 flex items-start justify-center bg-app/60 pt-24" @click.self="ui.searchOpen = false">
    <div role="dialog" aria-label="Search" class="w-[560px] max-w-[calc(100%-32px)] overflow-hidden rounded-drawer border border-line-strong bg-drawer shadow-drawer">
      <label for="search" class="sr-only">Search</label>
      <input id="search" ref="input" v-model="q" class="w-full border-0 border-b border-line bg-transparent px-4 py-3.5 text-title text-ink outline-none" placeholder="Search workspaces, agents, tasks…" @keydown="key" />
      <ul role="listbox" class="m-0 max-h-[420px] list-none overflow-auto p-1.5">
        <li v-for="(r, i) in results" :key="r.to + r.label" role="option" :aria-selected="i === sel">
          <button type="button" class="flex w-full cursor-pointer items-center gap-3 rounded-row border-0 px-3 py-2 text-left text-ink" :class="i === sel ? 'bg-accent-active' : 'bg-transparent'" @mouseenter="sel = i" @click="go(i)">
            <span class="lbl w-20 flex-none">{{ r.kind }}</span>
            <span class="min-w-0 flex-1 truncate">{{ r.label }}</span>
            <span class="max-w-[40%] truncate text-small text-ink-faint">{{ r.sub }}</span>
          </button>
        </li>
        <li v-if="!results.length" class="px-3 py-4 text-ink-faint">Nothing found</li>
      </ul>
    </div>
  </div>
</template>
