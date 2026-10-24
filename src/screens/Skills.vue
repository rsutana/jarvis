<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Skill } from '@shared/app-types'
import DrawerPanel from '@/shell/DrawerPanel.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'
import { invoke } from '@/lib/ipc'

const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()
const skills = computed(() => data.snap?.skills ?? [])
const draft = ref<Skill | null>(null)
watch(() => route.params.skillId, (id) => {
  const s = skills.value.find((x) => x.id === id)
  draft.value = id === 'new' ? { id: '', name: '', description: '', instructions: '' } : s ? { ...s } : null
}, { immediate: true })
const usedBy = (id: string) => data.agents.filter((a) => a.skillIds.includes(id)).map((a) => a.name)
async function save(): Promise<void> {
  if (!draft.value?.name.trim()) return
  const s = await ui.act(() => invoke('skill:save', draft.value!), 'Skill saved')
  if (s) router.replace(`/skills/${s.id}`)
}
</script>

<template>
  <DrawerPanel label="Skills" close-to="/">
    <template #header>
      <h1 class="m-0 text-title">Skills <span class="text-[13px] font-normal text-ink-faint">Reusable instructions you give agents</span></h1>
      <div class="flex-1" />
      <RouterLink class="btn btn-sm btn-pri" to="/skills/new">+ New skill</RouterLink>
    </template>
    <form v-if="draft" class="flex flex-1 flex-col gap-3.5 overflow-auto px-5 py-4" @submit.prevent="save">
      <RouterLink to="/skills" class="text-[13px]">‹ All skills</RouterLink>
      <div><label class="field-label" for="sn">Name</label><input id="sn" v-model="draft.name" class="field" /></div>
      <div><label class="field-label" for="sd">Short description</label><input id="sd" v-model="draft.description" class="field" /></div>
      <div><label class="field-label" for="si">Instructions (added to the agent's prompt)</label><textarea id="si" v-model="draft.instructions" class="field resize-y" rows="8" /></div>
      <div class="flex gap-2"><div class="flex-1" /><button class="btn btn-pri" type="submit">Save skill</button></div>
    </form>
    <div v-else class="flex-1 overflow-auto p-3">
      <RouterLink v-for="s in skills" :key="s.id" :to="`/skills/${s.id}`" class="flex flex-col gap-0.5 rounded-row px-3 py-2.5 text-ink no-underline hover:bg-raised hover:text-ink">
        <span class="font-medium">{{ s.name }}</span>
        <span class="text-small text-ink-faint">{{ s.description }}<template v-if="usedBy(s.id).length"> · used by {{ usedBy(s.id).join(', ') }}</template></span>
      </RouterLink>
      <p v-if="!skills.length" class="p-6 text-center text-ink-faint">No skills yet.</p>
    </div>
  </DrawerPanel>
</template>
