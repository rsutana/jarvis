<script setup lang="ts">
import type { AgentStatus, TaskStatus } from '@shared/types'
import { statusBg, statusLabel, taskLabel } from './status'
defineProps<{ status: AgentStatus | TaskStatus; label?: string }>()
</script>

<template>
  <span class="chip">
    <span class="dot" :class="statusBg[status]" aria-hidden="true" />
    {{ label ?? (status in statusLabel ? statusLabel[status as AgentStatus] : taskLabel[status as TaskStatus]) }}
  </span>
</template>
