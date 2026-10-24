<script setup lang="ts">
import { ref } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{ placeholder: string; disabled?: boolean; id: string }>()
const emit = defineEmits<{ send: [text: string] }>()
const text = ref('')
const box = ref<HTMLTextAreaElement>()

function send(): void {
  const t = text.value.trim()
  if (!t || props.disabled) return
  emit('send', t)
  text.value = ''
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
  <form class="flex items-end gap-2" @submit.prevent="send">
    <label :for="id" class="sr-only">Message Jarvis</label>
    <textarea :id="id" ref="box" v-model="text" data-jarvis-composer class="field flex-1 resize-none" rows="2" :placeholder="placeholder" @keydown="key" />
    <button class="btn btn-icon btn-pri" type="submit" aria-label="Send" :disabled="disabled || !text.trim()"><Icon name="send" :size="16" /></button>
  </form>
</template>
