<script setup lang="ts">
// World-space label over the 3D scene (CSS2DObject host). Real buttons so they stay focusable.
defineProps<{
  title: string
  sub?: string
  dot?: string // status colour class, e.g. bg-status-working
  accent?: boolean
  selected?: boolean
  badge?: string
  kind?: 'tag' | 'bubble' | 'cta'
  bubbleClass?: string
  onClick?: () => void
}>()
</script>

<template>
  <span v-if="kind === 'bubble'" class="pointer-events-none flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-bold shadow-tag" :class="bubbleClass">{{ title }}</span>
  <button
    v-else-if="kind === 'cta'"
    type="button"
    class="pointer-events-auto flex min-h-touch cursor-pointer items-center gap-2 rounded-row border border-dashed border-accent bg-tag px-3.5 font-semibold whitespace-nowrap text-accent-link shadow-tag hover:text-accent-hover"
    @click.stop="onClick?.()"
  >
    + {{ title }}
  </button>
  <component
    :is="onClick ? 'button' : 'span'"
    v-else
    :type="onClick ? 'button' : undefined"
    :aria-pressed="onClick && selected !== undefined ? selected : undefined"
    class="flex max-w-[240px] flex-col items-start rounded-row border bg-tag px-2.5 py-1 text-left whitespace-nowrap shadow-tag"
    :class="[
      onClick ? 'pointer-events-auto cursor-pointer hover:border-accent' : 'pointer-events-none',
      selected ? 'border-accent' : accent ? 'border-status-working/60' : 'border-line-strong'
    ]"
    @click.stop="onClick?.()"
    @pointerdown.stop
  >
    <span class="flex items-center gap-1.5 text-small font-semibold text-ink">
      <span v-if="dot" class="dot" :class="dot" aria-hidden="true" />{{ title }}
      <span v-if="badge" class="rounded bg-status-review px-1 text-[10px] font-bold text-app">{{ badge }}</span>
    </span>
    <span v-if="sub" class="max-w-[220px] truncate font-sans text-[11px] text-ink-faint">{{ sub }}</span>
  </component>
</template>
