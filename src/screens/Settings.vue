<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ClaudeCheck } from '@shared/app-types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import Toggle from '@/components/Toggle.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'

const data = useData()
const ui = useUi()
const settings = computed(() => data.snap!.settings)
const check = ref<ClaudeCheck | null>(null)
const path = ref(settings.value.claudePath)
const runCheck = async () => (check.value = await invoke('claude:check'))
onMounted(runCheck)
async function savePath(): Promise<void> {
  await ui.act(() => invoke('app:setSettings', { claudePath: path.value.trim() }), 'Saved')
  await runCheck()
}
const setUserSettings = (v: boolean) => ui.act(() => invoke('app:setSettings', { loadUserClaudeSettings: v }))
const qaRetries = ref(settings.value.qaRetries ?? 2)
const saveQaRetries = () => ui.act(() => invoke('app:setSettings', { qaRetries: Math.max(0, Math.min(5, Math.round(qaRetries.value || 0))) }), 'Saved')
const confirmReset = ref<'demo' | 'empty' | null>(null)
async function reset(): Promise<void> {
  if (!confirmReset.value) return
  await ui.act(() => invoke('app:resetData', confirmReset.value!), confirmReset.value === 'demo' ? 'Sample data restored' : 'Started fresh')
  confirmReset.value = null
}
</script>

<template>
  <DrawerPanel label="Settings" close-to="/">
    <template #header><h1 class="m-0 text-title">Settings</h1></template>
    <div class="flex flex-1 flex-col gap-4 overflow-auto px-5 py-4">
      <div class="card flex flex-col gap-3 p-4">
        <div class="font-semibold">Claude Code CLI</div>
        <p class="m-0 text-small text-ink-muted">Jarvis, orchestrators and agents all run through the <span class="mono">claude</span> command in print mode, using your Claude Code sign-in.</p>
        <div class="flex items-center gap-2 text-small">
          <span class="dot" :class="check?.ok ? 'bg-status-working' : check ? 'bg-status-blocked' : 'bg-status-idle'" />
          <span v-if="!check">Checking…</span>
          <span v-else-if="check.ok">Found <span class="mono">{{ check.version }}</span></span>
          <span v-else class="text-status-danger">Not found: {{ check.error }}</span>
        </div>
        <form class="flex gap-2" @submit.prevent="savePath">
          <label for="cp" class="sr-only">Path to claude</label>
          <input id="cp" v-model="path" class="field mono text-small" placeholder="claude (from PATH)" />
          <button class="btn" type="submit">Save &amp; check</button>
        </form>
        <div class="flex items-start gap-2.5 text-[13px]">
          <Toggle :model-value="settings.loadUserClaudeSettings" label="Load my user Claude settings" @update:model-value="setUserSettings" />
          <span>Load my user-level Claude Code settings in agent runs <span class="block text-xs text-ink-faint">Off keeps your personal hooks and plugins out of agent sessions. Project settings in each repo always apply.</span></span>
        </div>
        <div class="flex items-center gap-2.5 text-[13px]">
          <label for="qar" class="flex-1">QA retries before giving up <span class="block text-xs text-ink-faint">When QA fails, the task goes back to its agent with the QA notes, then QA runs again. 0 turns this off.</span></label>
          <input id="qar" v-model.number="qaRetries" type="number" min="0" max="5" class="field w-20" @change="saveQaRetries" />
        </div>
      </div>
      <div class="card flex flex-col gap-3 p-4">
        <div class="font-semibold">Safety</div>
        <ul class="m-0 flex flex-col gap-1 pl-5 text-small text-ink-muted">
          <li>Each task runs in its own git worktree on its own branch; your working copy is only touched when you approve a merge.</li>
          <li>Agents get file tools only (Read, Edit, Write…). Shell commands are not allowed, and “read only” agents cannot edit.</li>
          <li>Sending, publishing, deleting and merging always land in Inbox unless a policy says “allowed”.</li>
        </ul>
      </div>
      <div class="card flex flex-col gap-3 p-4">
        <div class="font-semibold">Data</div>
        <p class="m-0 text-small text-ink-muted">Everything is stored locally in <span class="mono">jarvis-db.json</span> in the app's data folder.</p>
        <div class="flex flex-wrap gap-2">
          <button class="btn" type="button" @click="confirmReset = 'demo'">Restore sample data</button>
          <button class="btn btn-danger" type="button" @click="confirmReset = 'empty'">Start fresh (empty)</button>
        </div>
        <div v-if="confirmReset" role="alertdialog" aria-label="Confirm reset" class="flex flex-wrap items-center gap-2 rounded-row border border-status-blocked/50 p-3 text-small">
          <span class="flex-1">This replaces all workspaces, agents, tasks and chats{{ confirmReset === 'demo' ? ' with the sample data' : '' }}. Running agents are stopped. Your project folders are not touched.</span>
          <button class="btn btn-sm btn-ghost" type="button" @click="confirmReset = null">Cancel</button>
          <button class="btn btn-sm btn-pri" type="button" @click="reset">Replace data</button>
        </div>
      </div>
    </div>
  </DrawerPanel>
</template>
