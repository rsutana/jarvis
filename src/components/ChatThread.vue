<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { ChatMessage } from '@shared/types'
import MissionCard from './MissionCard.vue'
import Avatar from './Avatar.vue'
import { md } from './status'

const props = defineProps<{ messages: ChatMessage[]; typing?: boolean; roomy?: boolean }>()
const box = ref<HTMLDivElement>()
watch(
  () => [props.messages.length, props.typing],
  async () => {
    await nextTick()
    box.value?.scrollTo({ top: box.value.scrollHeight, behavior: 'smooth' })
  },
  { immediate: true }
)
</script>

<template>
  <div ref="box" class="flex flex-1 flex-col overflow-auto" :class="roomy ? 'gap-4 px-6 py-5' : 'gap-3 p-4 text-[13px]'" aria-live="polite">
    <template v-for="m in messages" :key="m.id">
      <div v-if="m.role === 'user'" class="max-w-[85%] self-end rounded-[14px_14px_2px_14px] bg-accent-active px-3 py-2.5 whitespace-pre-wrap">{{ m.text }}</div>
      <div v-else class="flex gap-3">
        <Avatar v-if="roomy" name="Jarvis" square :size="28" />
        <div class="flex min-w-0 flex-1 flex-col gap-2.5">
          <div v-if="m.toolSteps?.length" class="flex flex-wrap gap-1.5">
            <span v-for="s in m.toolSteps" :key="s.label" class="chip">
              <span class="dot" :class="s.ok ? 'bg-status-working' : 'bg-status-blocked'" aria-hidden="true" />{{ s.label }}
            </span>
          </div>
          <div class="md max-w-[94%]" :class="roomy ? 'text-ink' : 'rounded-[12px_12px_12px_2px] border border-line bg-card px-3 py-2.5'" v-html="md(m.text)" />
          <MissionCard v-if="m.missionId" :mission-id="m.missionId" :compact="!roomy" />
        </div>
      </div>
    </template>
    <div v-if="typing" class="flex items-center gap-2 text-small text-ink-faint">
      <span class="dot animate-pulse bg-accent" aria-hidden="true" /> Jarvis is thinking…
    </div>
    <div v-if="!messages.length && !typing" class="m-auto max-w-[320px] text-center text-ink-faint">Ask Jarvis about your workspaces, or describe work for your agents.</div>
  </div>
</template>
