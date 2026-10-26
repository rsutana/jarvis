<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { CHAT_UPLOAD_LIMITS, type ChatUpload } from '@shared/app-types'
import Icon from './Icon.vue'
import Avatar from './Avatar.vue'
import { useUi } from '@/stores/ui'
import { useData } from '@/stores/data'
import { ROOF } from '@/scene/colors'

const props = defineProps<{ placeholder: string; disabled?: boolean; id: string }>()
const emit = defineEmits<{ send: [text: string, files: ChatUpload[]] }>()
const ui = useUi()
const data = useData()
const text = ref('')
const box = ref<HTMLTextAreaElement>()
const picker = ref<HTMLInputElement>()
const files = ref<(ChatUpload & { key: number; label: string })[]>([])
const dragDepth = ref(0)
let nextKey = 0

// long pastes (code, logs) become an attachment so the message stays readable
const PASTE_LINES = 12
const PASTE_CHARS = 2000

const size = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

function fits(bytes: number): boolean {
  if (files.value.length >= CHAT_UPLOAD_LIMITS.files) {
    ui.toast(`Up to ${CHAT_UPLOAD_LIMITS.files} files per message`, 'bad')
    return false
  }
  if (files.value.reduce((n, f) => n + f.bytes.byteLength, 0) + bytes > CHAT_UPLOAD_LIMITS.bytes) {
    ui.toast(`Attachments are limited to ${size(CHAT_UPLOAD_LIMITS.bytes)} per message`, 'bad')
    return false
  }
  return true
}
async function addFiles(list: FileList | null | undefined): Promise<void> {
  for (const f of Array.from(list ?? [])) {
    if (!fits(f.size)) return
    const name = f.name || `image-${nextKey + 1}.${f.type.split('/')[1] || 'png'}`
    files.value.push({ key: ++nextKey, label: name, name, mime: f.type, kind: 'file', bytes: new Uint8Array(await f.arrayBuffer()) })
  }
  box.value?.focus()
}
function addPaste(t: string): void {
  const bytes = new TextEncoder().encode(t)
  if (!fits(bytes.byteLength)) return
  const n = files.value.filter((f) => f.kind === 'paste').length + 1
  files.value.push({ key: ++nextKey, label: `Pasted text · ${t.split('\n').length} lines`, name: `pasted-${n}.txt`, mime: 'text/plain', kind: 'paste', bytes })
}
function paste(e: ClipboardEvent): void {
  const cd = e.clipboardData
  if (!cd) return
  if (cd.files.length) {
    e.preventDefault()
    void addFiles(cd.files)
    return
  }
  const t = cd.getData('text/plain')
  if (t.split('\n').length < PASTE_LINES && t.length < PASTE_CHARS) return
  e.preventDefault()
  addPaste(t)
}
const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
function dragEnter(e: DragEvent): void {
  if (hasFiles(e)) dragDepth.value++
}
function drop(e: DragEvent): void {
  dragDepth.value = 0
  if (!props.disabled) void addFiles(e.dataTransfer?.files)
}
function pick(): void {
  void addFiles(picker.value?.files)
  if (picker.value) picker.value.value = ''
}

// @-mentions: "@" suggests workspaces and agents; "@workspace" / "@agent" (optionally followed by a
// filter, e.g. "@workspace news") lists just that kind. Picking one writes "@<name> " in place.
type Scope = 'workspace' | 'agent'
interface Mention {
  start: number // index of the "@"
  end: number // caret
  query: string
  scope?: Scope
}
interface MentionOption {
  key: string
  kind: Scope
  name: string
  sub: string
  color: string
}
const menuId = `${props.id}-mentions`
const mention = ref<Mention | null>(null)
const active = ref(0)
let dismissed = -1 // "@" position the user closed the menu for with Escape

const mentionOptions = computed<MentionOption[]>(() => {
  const m = mention.value
  if (!m) return []
  const q = m.query.toLowerCase()
  const ws: MentionOption[] = data.workspaces.map((w) => {
    const n = data.agentsIn(w.id).length
    return { key: `w:${w.id}`, kind: 'workspace', name: w.name, color: ROOF[w.color], sub: `Workspace · ${n} agent${n === 1 ? '' : 's'}` }
  })
  const agents: MentionOption[] = data.agents.map((a) => ({
    key: `a:${a.id}`, kind: 'agent', name: a.name, color: a.look.color, sub: `${a.role} · ${data.workspace(a.workspaceId)?.name ?? 'In pool'}`
  }))
  const pool = m.scope === 'workspace' ? ws : m.scope === 'agent' ? agents : [...ws, ...agents]
  return pool.filter((o) => !q || o.name.toLowerCase().includes(q)).slice(0, 8)
})
const menuOpen = computed(() => !!mention.value && mentionOptions.value.length > 0)

function detectMention(): void {
  const el = box.value
  if (!el || el.selectionStart !== el.selectionEnd) return void (mention.value = null)
  const upto = text.value.slice(0, el.selectionStart)
  const scoped = upto.match(/(?:^|\s)(@(workspace|agent)(?:\s+([^\s@]*))?)$/i)
  const plain = upto.match(/(?:^|\s)(@([^\s@]*))$/)
  const tok = scoped ?? plain
  if (!tok) return void (mention.value = null)
  const start = upto.length - tok[1].length
  if (start === dismissed) return void (mention.value = null)
  const next: Mention = scoped
    ? { start, end: el.selectionStart, scope: scoped[2].toLowerCase() as Scope, query: scoped[3] ?? '' }
    : { start, end: el.selectionStart, query: plain![2] }
  const prev = mention.value
  if (!prev || prev.start !== next.start || prev.query !== next.query || prev.scope !== next.scope) active.value = 0
  mention.value = next
}
function pickMention(o: MentionOption): void {
  const m = mention.value
  if (!m) return
  const before = text.value.slice(0, m.start)
  const after = text.value.slice(m.end)
  const ins = `@${o.name}${after.startsWith(' ') ? '' : ' '}`
  text.value = before + ins + after
  mention.value = null
  const caret = before.length + ins.length
  void nextTick(() => {
    box.value?.focus()
    box.value?.setSelectionRange(caret, caret)
  })
}
function mentionKey(e: KeyboardEvent): boolean {
  if (!menuOpen.value) return false
  const n = mentionOptions.value.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
  else if (e.key === 'Enter' || e.key === 'Tab') pickMention(mentionOptions.value[active.value])
  else if (e.key === 'Escape') {
    dismissed = mention.value!.start
    mention.value = null
    e.stopPropagation()
  } else return false
  e.preventDefault()
  return true
}

function send(): void {
  const t = text.value.trim()
  if ((!t && !files.value.length) || props.disabled) return
  emit('send', t, files.value.map(({ name, mime, kind, bytes }) => ({ name, mime, kind, bytes })))
  text.value = ''
  files.value = []
}
function key(e: KeyboardEvent): void {
  if (mentionKey(e)) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
function insert(s: string): void {
  text.value = (text.value && !text.value.endsWith(' ') ? text.value + ' ' : text.value) + s
  dismissed = -1
  // caret after the chip's text so "@workspace" / "@agent" open their list straight away
  void nextTick(() => {
    const el = box.value
    if (!el) return
    el.focus()
    el.setSelectionRange(text.value.length, text.value.length)
    detectMention()
  })
}
defineExpose({ insert, set: (s: string) => ((text.value = s), box.value?.focus()) })
</script>

<template>
  <form
    class="relative flex flex-col gap-2"
    @submit.prevent="send"
    @dragenter.prevent="dragEnter"
    @dragover.prevent
    @dragleave="dragDepth = Math.max(0, dragDepth - 1)"
    @drop.prevent="drop"
  >
    <ul v-if="files.length" class="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Attachments">
      <li v-for="f in files" :key="f.key" class="chip max-w-full gap-1.5">
        <Icon name="attach" :size="12" />
        <span class="max-w-[220px] truncate" :title="f.name">{{ f.label }}</span>
        <span class="text-ink-faint">{{ size(f.bytes.byteLength) }}</span>
        <button class="-mr-1 cursor-pointer border-0 bg-transparent px-1 text-ink-faint hover:text-ink" type="button" :aria-label="`Remove ${f.label}`" @click="files = files.filter((x) => x.key !== f.key)">×</button>
      </li>
    </ul>
    <div class="flex items-end gap-2">
      <input ref="picker" type="file" multiple class="hidden" tabindex="-1" aria-hidden="true" @change="pick" />
      <button class="btn btn-icon" type="button" aria-label="Attach files" :disabled="disabled" @click="picker?.click()"><Icon name="attach" :size="16" /></button>
      <label :for="id" class="sr-only">Message Jarvis</label>
      <textarea
        :id="id"
        ref="box"
        v-model="text"
        data-jarvis-composer
        class="field flex-1 resize-none"
        rows="2"
        :placeholder="placeholder"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="menuOpen"
        :aria-controls="menuId"
        :aria-activedescendant="menuOpen ? `${menuId}-${active}` : undefined"
        @keydown="key"
        @input="detectMention"
        @click="detectMention"
        @keyup.left.right.home.end="detectMention"
        @blur="mention = null"
        @paste="paste"
      />
      <button class="btn btn-icon btn-pri" type="submit" aria-label="Send" :disabled="disabled || (!text.trim() && !files.length)"><Icon name="send" :size="16" /></button>
    </div>
    <div v-if="menuOpen" class="absolute right-12 bottom-full left-12 z-30 mb-1.5 overflow-hidden rounded-row border border-line-strong bg-hud shadow-tag">
      <div class="lbl border-b border-line-soft px-3 py-1.5">{{ mention?.scope === 'workspace' ? 'Workspaces' : mention?.scope === 'agent' ? 'Agents' : 'Mention a workspace or agent' }}</div>
      <ul :id="menuId" role="listbox" :aria-label="mention?.scope === 'agent' ? 'Agents' : 'Workspaces and agents'" class="m-0 max-h-64 list-none overflow-y-auto p-1">
        <li
          v-for="(o, i) in mentionOptions"
          :id="`${menuId}-${i}`"
          :key="o.key"
          role="option"
          :aria-selected="i === active"
          class="flex cursor-pointer items-center gap-2.5 rounded-row px-2.5 py-1.5"
          :class="i === active ? 'bg-raised' : ''"
          @mousedown.prevent="pickMention(o)"
          @mousemove="active = i"
        >
          <span v-if="o.kind === 'workspace'" class="size-5 flex-none rounded-[5px]" :style="{ background: o.color }" aria-hidden="true" />
          <Avatar v-else :name="o.name" :color="o.color" :size="20" />
          <span class="min-w-0 flex-1 truncate text-[13px] font-medium">{{ o.name }}</span>
          <span class="max-w-[55%] truncate text-[11px] text-ink-faint">{{ o.sub }}</span>
        </li>
      </ul>
      <div class="border-t border-line-soft px-3 py-1 text-[11px] text-ink-faint">↑↓ to move · Enter to pick · Esc to close</div>
    </div>
    <div v-if="dragDepth" class="pointer-events-none absolute -inset-1.5 flex items-center justify-center rounded-row border-2 border-dashed border-accent bg-accent-tint/90 text-small font-medium text-accent-hover">Drop files to attach</div>
  </form>
</template>
