<script setup lang="ts">
import { computed } from 'vue'
import Avatar from '@/components/Avatar.vue'

export type GraphNode = { id: string; title: string; who: string; color?: string; st: string; tone: string; ring: boolean; to?: string; deps: number[] }

const props = defineProps<{ nodes: GraphNode[] }>()

const W = 200
const H = 84
const GX = 56
const GY = 14

/** Column = longest path from a root, so every edge points right. */
const layout = computed(() => {
  const depth: number[] = []
  const depthOf = (i: number, seen = new Set<number>()): number => {
    if (depth[i] !== undefined) return depth[i]
    if (seen.has(i)) return 0 // a stray loop shouldn't hang the view
    seen.add(i)
    const ds = props.nodes[i].deps.filter((d) => d >= 0 && d < props.nodes.length && d !== i)
    return (depth[i] = ds.length ? Math.max(...ds.map((d) => depthOf(d, seen) + 1)) : 0)
  }
  const rows: number[] = []
  const pos = props.nodes.map((_, i) => {
    const col = depthOf(i)
    const row = (rows[col] = (rows[col] ?? -1) + 1)
    return { x: col * (W + GX), y: row * (H + GY) }
  })
  const edges = props.nodes.flatMap((n, i) =>
    n.deps
      .filter((d) => pos[d] && d !== i)
      .map((d) => {
        const a = { x: pos[d].x + W, y: pos[d].y + H / 2 }
        const b = { x: pos[i].x, y: pos[i].y + H / 2 }
        const mid = (a.x + b.x) / 2
        return { key: `${d}-${i}`, path: `M${a.x},${a.y} C${mid},${a.y} ${mid},${b.y} ${b.x - 4},${b.y}`, live: n.ring }
      })
  )
  const cols = rows.length
  return { pos, edges, width: Math.max(W, cols * (W + GX) - GX), height: Math.max(H, Math.max(...rows, 0) * (H + GY) + H) }
})
</script>

<template>
  <div class="relative" :style="{ width: `${layout.width}px`, height: `${layout.height}px` }">
    <svg class="pointer-events-none absolute inset-0 overflow-visible" :width="layout.width" :height="layout.height" aria-hidden="true">
      <defs>
        <marker id="mg-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" class="fill-ink-faint" />
        </marker>
      </defs>
      <path v-for="e in layout.edges" :key="e.key" :d="e.path" fill="none" stroke-width="1.5" marker-end="url(#mg-arrow)" :class="e.live ? 'stroke-status-working' : 'stroke-line-strong'" />
    </svg>
    <component
      :is="n.to ? 'RouterLink' : 'div'"
      v-for="(n, i) in nodes"
      :key="n.id + n.title"
      :to="n.to"
      class="absolute flex flex-col gap-1.5 rounded-row border bg-sidebar p-2.5 text-ink no-underline hover:text-ink"
      :class="n.ring ? 'border-status-working/50' : 'border-line'"
      :style="{ left: `${layout.pos[i].x}px`, top: `${layout.pos[i].y}px`, width: `${W}px`, height: `${H}px` }"
    >
      <span class="flex items-center gap-1.5"><span class="mono text-[11px] text-ink-faint">{{ n.id }}</span><span class="flex-1" /><span class="dot" :class="n.tone.split(' ')[0]" /><span class="text-[11px]" :class="n.tone.split(' ')[1]">{{ n.st }}</span></span>
      <span class="truncate text-[13px] font-medium" :title="n.title">{{ n.title }}</span>
      <span class="flex items-center gap-1.5 text-xs"><Avatar :name="n.who" :color="n.color" :size="20" /><span class="truncate text-ink-faint">{{ n.who }}</span></span>
    </component>
  </div>
</template>
