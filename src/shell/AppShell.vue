<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import IsoViewport from '@/scene/IsoViewport.vue'
import HudTopBar from './HudTopBar.vue'
import HudDock from './HudDock.vue'
import SearchPalette from './SearchPalette.vue'
import Toasts from './Toasts.vue'
import { useUi } from '@/stores/ui'

const route = useRoute()
const router = useRouter()
const ui = useUi()

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

function onKey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    ui.searchOpen = !ui.searchOpen
    return
  }
  if (e.key === 'Escape' && !ui.searchOpen) {
    if (typing(e.target)) return (e.target as HTMLElement).blur()
    // Esc closes the drawer: go to the world-level route
    if (route.meta.world === 'office') {
      if (route.name === 'workspace') ui.selectAgent(undefined)
      else router.push(`/w/${route.params.id}`)
    } else if (route.name !== 'lobby') router.push('/')
    return
  }
  if (e.key.toLowerCase() === 'j' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) {
    const box = document.querySelector<HTMLTextAreaElement>('[data-jarvis-composer]')
    e.preventDefault()
    if (box) box.focus()
    else router.push('/')
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="relative h-full min-h-[720px] overflow-hidden bg-app text-body text-ink">
    <IsoViewport />
    <div class="pointer-events-none absolute inset-0">
      <RouterView v-slot="{ Component, route: r }" name="drawer">
        <component :is="Component" :key="String(r.name) + (r.params.id ?? '')" />
      </RouterView>
    </div>
    <HudTopBar />
    <HudDock />
    <Toasts />
    <SearchPalette />
  </div>
</template>
