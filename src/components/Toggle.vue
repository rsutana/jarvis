<script setup lang="ts">
defineProps<{ label: string }>()
const model = defineModel<boolean>({ default: false })
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    :aria-label="label"
    class="relative h-5 w-9 flex-none cursor-pointer rounded-full border-0"
    :class="model ? 'bg-status-working' : 'bg-line-strong'"
    @click="model = !model"
  >
    <span class="absolute top-0.5 size-4 rounded-full transition-all" :class="model ? 'left-[18px] bg-app' : 'left-0.5 bg-ink-muted'" />
  </button>
</template>
