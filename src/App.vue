<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppShell from '@/shell/AppShell.vue'
import { useData } from '@/stores/data'

const data = useData()
const error = ref('')
onMounted(async () => {
  data.subscribe()
  try {
    await data.load()
  } catch (e) {
    error.value = (e as Error).message
  }
})
</script>

<template>
  <AppShell v-if="data.snap" />
  <div v-else class="flex h-full items-center justify-center text-ink-muted">{{ error || 'Starting Jarvis…' }}</div>
</template>
