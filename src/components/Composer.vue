<script setup lang="ts">
import { ref } from 'vue'
import { CHAT_UPLOAD_LIMITS, type ChatUpload } from '@shared/app-types'
import Icon from './Icon.vue'
import { useUi } from '@/stores/ui'

const props = defineProps<{ placeholder: string; disabled?: boolean; id: string }>()
const emit = defineEmits<{ send: [text: string, files: ChatUpload[]] }>()
const ui = useUi()
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

function send(): void {
  const t = text.value.trim()
  if ((!t && !files.value.length) || props.disabled) return
  emit('send', t, files.value.map(({ name, mime, kind, bytes }) => ({ name, mime, kind, bytes })))
  text.value = ''
  files.value = []
}
function key(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
function insert(s: string): void {
  text.value = (text.value ? text.value + ' ' : '') + s
  box.value?.focus()
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
      <textarea :id="id" ref="box" v-model="text" data-jarvis-composer class="field flex-1 resize-none" rows="2" :placeholder="placeholder" @keydown="key" @paste="paste" />
      <button class="btn btn-icon btn-pri" type="submit" aria-label="Send" :disabled="disabled || (!text.trim() && !files.length)"><Icon name="send" :size="16" /></button>
    </div>
    <div v-if="dragDepth" class="pointer-events-none absolute -inset-1.5 flex items-center justify-center rounded-row border-2 border-dashed border-accent bg-accent-tint/90 text-small font-medium text-accent-hover">Drop files to attach</div>
  </form>
</template>
