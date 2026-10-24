<script setup lang="ts">
import { useUi } from '@/stores/ui'
const ui = useUi()
</script>

<template>
  <div aria-live="polite" class="pointer-events-none absolute bottom-[100px] left-hud z-40 flex max-w-[420px] flex-col gap-2">
    <div
      v-for="t in ui.toasts"
      :key="t.id"
      class="pointer-events-auto flex items-start gap-2.5 rounded-row border bg-drawer px-3.5 py-2.5 text-small shadow-tag"
      :class="t.tone === 'bad' ? 'border-status-blocked/50' : t.tone === 'good' ? 'border-status-working/50' : 'border-line-strong'"
    >
      <span class="dot mt-1.5" :class="t.tone === 'bad' ? 'bg-status-blocked' : t.tone === 'good' ? 'bg-status-working' : 'bg-accent'" aria-hidden="true" />
      <span class="flex-1">{{ t.text }}</span>
    </div>
  </div>
</template>
