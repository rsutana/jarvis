<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
const props = defineProps<{ label: string; closeTo?: string; width?: number; bare?: boolean }>()
const route = useRoute()
const w = computed(() => props.width ?? route.meta.drawer)
</script>

<template>
  <aside
    :aria-label="label"
    class="pointer-events-auto absolute top-drawer-top right-hud bottom-drawer-bottom z-20 flex max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-drawer border border-line-strong bg-drawer shadow-drawer max-[1100px]:left-hud max-[1100px]:!w-auto"
    :style="{ width: w + 'px' }"
  >
    <header v-if="!bare" class="flex min-h-[60px] flex-wrap items-center gap-3 border-b border-line py-3 pr-4 pl-5">
      <slot name="header" />
      <RouterLink v-if="closeTo" :to="closeTo" class="x-close ml-auto" aria-label="Close">×</RouterLink>
    </header>
    <slot />
  </aside>
</template>
