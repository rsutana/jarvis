<script setup lang="ts">
// "Chats" button + popover: open a chat, delete one, or clear out old / all other chats.
// Deleting takes a second click, like removing an account.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Conversation } from '@shared/app-types'

const props = defineProps<{ conversations: Conversation[]; currentId?: string; busy: Record<string, boolean> }>()
const emit = defineEmits<{ pick: [id: string]; remove: [ids: string[]] }>()

const OLD_DAYS = 30
const open = ref(false)
const armed = ref<string>() // conversation id, 'old' or 'others', waiting for the confirming click
const root = ref<HTMLElement>()
const uid = `chats-${Math.random().toString(36).slice(2, 8)}`

const free = (c: Conversation) => !props.busy[c.id]
const old = computed(() => {
  const cutoff = new Date(Date.now() - OLD_DAYS * 864e5).toISOString()
  return props.conversations.filter((c) => c.updatedAt < cutoff && c.id !== props.currentId && free(c))
})
const others = computed(() => props.conversations.filter((c) => c.id !== props.currentId && free(c)))

function when(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 864e5)
  if (days < 1) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function ask(key: string, ids: string[]): void {
  if (armed.value !== key) {
    armed.value = key
    return
  }
  armed.value = undefined
  emit('remove', ids)
}
function pick(id: string): void {
  emit('pick', id)
  open.value = false
}

// close on outside click / Escape; forget a half-confirmed delete whenever it closes
const outside = (e: PointerEvent) => {
  if (!root.value?.contains(e.target as Node)) open.value = false
}
const esc = (e: KeyboardEvent) => {
  if (e.key === 'Escape') open.value = false
}
watch(open, (o) => {
  armed.value = undefined
  if (o) {
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', esc)
  } else {
    document.removeEventListener('pointerdown', outside)
    document.removeEventListener('keydown', esc)
  }
})
onBeforeUnmount(() => (open.value = false))
</script>

<template>
  <div ref="root" class="relative flex-none">
    <button type="button" class="btn btn-sm min-h-9" :aria-expanded="open" :aria-controls="uid" @click="open = !open">
      Chats <span class="mono text-[11px] text-ink-faint">{{ conversations.length }}</span>
    </button>
    <div v-if="open" :id="uid" role="dialog" aria-label="Manage chats" class="absolute top-full right-0 z-40 mt-1.5 flex max-h-[420px] w-[320px] flex-col overflow-hidden rounded-row border border-line-strong bg-hud shadow-tag">
      <div class="flex items-center justify-between border-b border-line-soft px-3.5 py-2.5">
        <span class="lbl">Chats</span>
        <span class="text-xs text-ink-faint">{{ conversations.length }} total</span>
      </div>
      <ul class="m-0 flex-1 list-none overflow-y-auto p-1.5">
        <li v-for="c in conversations" :key="c.id" class="group flex items-center gap-1 rounded-row" :class="c.id === currentId ? 'bg-raised' : 'hover:bg-raised'">
          <button type="button" class="flex min-h-control min-w-0 flex-1 cursor-pointer flex-col items-start border-0 bg-transparent px-2.5 py-1.5 text-left text-ink" :aria-current="c.id === currentId ? 'true' : undefined" @click="pick(c.id)">
            <span class="w-full truncate text-[13px] font-medium">{{ c.title }}</span>
            <span class="text-[11px] text-ink-faint">{{ c.id === currentId ? 'Open now · ' : '' }}{{ busy[c.id] ? 'Jarvis is answering' : when(c.updatedAt) }}</span>
          </button>
          <button
            v-if="armed === c.id"
            type="button"
            class="btn btn-sm btn-danger mr-1 flex-none"
            @click="ask(c.id, [c.id])"
          >Delete?</button>
          <button
            v-else
            type="button"
            class="x-close mr-1 size-8 flex-none cursor-pointer border-0 bg-transparent text-base opacity-60 group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
            :disabled="!!busy[c.id]"
            :aria-label="`Delete chat ${c.title}`"
            :title="busy[c.id] ? 'Jarvis is still answering' : 'Delete chat'"
            @click="ask(c.id, [c.id])"
          >×</button>
        </li>
        <li v-if="!conversations.length" class="px-2.5 py-3 text-small text-ink-faint">No chats yet.</li>
      </ul>
      <div v-if="old.length || others.length" class="flex flex-col gap-1.5 border-t border-line-soft p-2.5">
        <button v-if="old.length" type="button" class="btn btn-sm w-full" :class="armed === 'old' ? 'btn-danger' : ''" @click="ask('old', old.map((c) => c.id))">
          {{ armed === 'old' ? `Click again to delete ${old.length}` : `Delete chats older than ${OLD_DAYS} days (${old.length})` }}
        </button>
        <button v-if="others.length" type="button" class="btn btn-sm btn-ghost w-full" :class="armed === 'others' ? 'btn-danger' : ''" @click="ask('others', others.map((c) => c.id))">
          {{ armed === 'others' ? `Click again to delete ${others.length}` : `Delete all other chats (${others.length})` }}
        </button>
      </div>
    </div>
  </div>
</template>
