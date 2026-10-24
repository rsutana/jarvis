<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ name: string; color?: string; size?: number; square?: boolean }>()
const initials = computed(() => (props.name.length > 1 && /^[A-Z][a-z]/.test(props.name) && props.size && props.size >= 28 && props.square ? props.name.slice(0, 2) : props.name.slice(0, 1)).toUpperCase())
</script>

<template>
  <span
    class="inline-flex flex-none items-center justify-center font-semibold text-app"
    :class="square ? 'rounded-[9px]' : 'rounded-full'"
    :style="{ width: (size ?? 32) + 'px', height: (size ?? 32) + 'px', fontSize: Math.round((size ?? 32) * 0.4) + 'px', background: color ?? 'var(--color-accent)' }"
    aria-hidden="true"
    >{{ name === 'Jarvis' ? 'J' : initials }}</span
  >
</template>
