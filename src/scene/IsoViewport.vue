<script setup lang="ts">
/**
 * The one persistent 3D viewport: owns a WebGLRenderer + CSS2DRenderer and
 * swaps LobbyWorld / OfficeWorld as the route changes. Renders on demand.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as THREE from 'three'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { IsoCamera } from './camera'
import { buildLobby } from './LobbyWorld'
import { buildOffice } from './OfficeWorld'
import type { World } from './world'
import type { Pick } from './build'
import Icon from '@/components/Icon.vue'
import { useData } from '@/stores/data'
import { useUi } from '@/stores/ui'

const host = ref<HTMLDivElement>()
const glError = ref('')
const route = useRoute()
const router = useRouter()
const data = useData()
const ui = useUi()

let renderer: THREE.WebGLRenderer
let labelRenderer: CSS2DRenderer
const scene = new THREE.Scene()
const iso = new IsoCamera()
let world: World | null = null
let dirty = true
let raf = 0
let ro: ResizeObserver | null = null
const timer = new THREE.Timer()

const wsId = computed(() => (route.meta.world === 'office' ? (route.params.id as string) : undefined))

/** Agent highlighted by the current screen (agent editor, task run assignee, quick view). */
const highlight = computed(() => {
  if (route.params.agentId) return route.params.agentId as string
  if (route.params.taskId) return data.task(route.params.taskId as string)?.assigneeId
  if (route.name === 'workspace') return ui.selectedAgentId
  return undefined
})

/** Only the fields that change what the world looks like; a new value rebuilds it. */
const signature = computed(() => {
  if (!data.snap) return ''
  if (wsId.value) {
    const ws = data.workspace(wsId.value)
    if (!ws) return 'missing'
    const ts = data.tasksIn(ws.id)
    return JSON.stringify([
      'office', ws.id, ws.color, ws.folderPath, highlight.value, route.name === 'orchestrator',
      data.agents.filter((a) => a.workspaceId === ws.id).map((a) => [a.id, a.name, a.role, a.status, a.deskSlot, a.look]),
      ts.filter((t) => t.status === 'in_progress').length, ts.filter((t) => t.status === 'todo').length, ts.filter((t) => t.status === 'review').length
    ])
  }
  const busy = Object.values(data.typing).some(Boolean)
  return JSON.stringify([
    'lobby', busy, data.pendingApprovals.length,
    data.workspaces.map((w) => [w.id, w.name, w.color, w.lobbyPlot, w.orchestratorId, data.agentsIn(w.id).length, data.countByStatus(w.id, 'working')])
  ])
})

const ROOF: Record<string, string> = { teal: '#34B394', blue: '#4A7FE0', clay: '#D7655A', purple: '#8A6FE0', amber: '#E0A33A' }
const go = (to: string) => router.push(to)

function build(): void {
  const prevKind = world ? (world.group.userData.kind as string) : ''
  const prevWs = world?.group.userData.ws as string | undefined
  if (world) {
    scene.remove(world.group)
    world.dispose()
    world = null
  }
  if (!data.snap) return
  const id = wsId.value
  if (id) {
    const ws = data.workspace(id)
    if (!ws) return
    const all = data.agents.filter((a) => a.workspaceId === id)
    const ts = data.tasksIn(id)
    const orch = all.find((a) => a.kind === 'orchestrator')
    world = buildOffice({
      workspaceId: id,
      trim: ROOF[ws.color] ?? '#2FA58A',
      folderPath: ws.folderPath,
      agents: all.filter((a) => a.kind === 'agent'),
      orchestrator: orch,
      selectedId: highlight.value,
      highlightOrchestrator: route.name === 'orchestrator',
      counts: { active: ts.filter((t) => t.status === 'in_progress').length, todo: ts.filter((t) => t.status === 'todo').length, review: ts.filter((t) => t.status === 'review').length },
      go,
      selectAgent: (aid) => {
        ui.selectAgent(aid)
        if (route.name !== 'workspace') router.push(`/w/${id}`)
      }
    })
    world.group.userData = { kind: 'office', ws: id }
  } else {
    const busy = Object.values(data.typing).some(Boolean)
    world = buildLobby({
      buildings: data.workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        roof: ROOF[w.color] ?? '#34B394',
        plot: w.lobbyPlot,
        agents: data.agentsIn(w.id).length,
        working: data.countByStatus(w.id, 'working'),
        setupNeeded: !w.orchestratorId
      })),
      jarvisBusy: busy,
      jarvisState: busy ? 'thinking…' : data.pendingApprovals.length ? `${data.pendingApprovals.length} need you` : 'ready',
      go
    })
    world.group.userData = { kind: 'lobby' }
  }
  scene.add(world.group)
  iso.bounds = world.bounds
  // keep the camera where the user left it unless the world itself changed
  if (prevKind !== world.group.userData.kind || prevWs !== world.group.userData.ws) iso.setHome(world.home, world.zoom.default, world.zoom.min, world.zoom.max)
  dirty = true
}

function shiftFor(): number {
  const w = route.meta.drawer ?? 0
  const lobbyHome = route.name === 'lobby'
  if (route.name === 'workspace' && !ui.selectedAgentId) return 0
  return Math.round(w * (lobbyHome ? 0.48 : 0.41))
}

function loop(): void {
  raf = requestAnimationFrame(loop)
  const moving = iso.step()
  timer.update()
  const animating = world?.animate(timer.getElapsed()) ?? false
  if (dirty || moving || animating) {
    renderer.render(scene, iso.camera)
    labelRenderer.render(scene, iso.camera)
    dirty = false
  }
}

// pointer: drag to pan, click (< 4px movement) to pick
let down: { x: number; y: number; moved: boolean } | null = null
const raycaster = new THREE.Raycaster()
function pickAt(e: PointerEvent): Pick | undefined {
  const r = renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ndc, iso.camera)
  const hit = world ? raycaster.intersectObject(world.group, true).find((h) => h.object.userData.pick) : undefined
  return hit?.object.userData.pick as Pick | undefined
}
function onDown(e: PointerEvent): void {
  if (e.button !== 0) return
  down = { x: e.clientX, y: e.clientY, moved: false }
  renderer.domElement.setPointerCapture(e.pointerId)
}
function onMove(e: PointerEvent): void {
  if (down) {
    const dx = e.clientX - down.x
    const dy = e.clientY - down.y
    if (!down.moved && Math.hypot(dx, dy) > 4) down.moved = true
    if (down.moved) {
      iso.pan(e.movementX, e.movementY)
      dirty = true
    }
    return
  }
  renderer.domElement.style.cursor = pickAt(e) ? 'pointer' : 'grab'
}
function onUp(e: PointerEvent): void {
  const d = down
  down = null
  if (!d || d.moved) return
  const p = pickAt(e)
  if (!p) return
  if (p.kind === 'workspace') router.push(`/w/${p.id}`)
  else if (p.kind === 'route') router.push(p.to)
  else if (p.kind === 'agent') {
    ui.selectAgent(p.id)
    if (route.name !== 'workspace') router.push(`/w/${wsId.value}`)
  }
}
function onWheel(e: WheelEvent): void {
  e.preventDefault()
  iso.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
  dirty = true
}
const zoom = (f: number) => {
  iso.zoomBy(f)
  dirty = true
}
const recenter = () => {
  iso.recenter()
  dirty = true
}

onMounted(() => {
  const el = host.value!
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch (e) {
    // no WebGL: keep every panel usable, just without the world behind them
    glError.value = (e as Error).message
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.setClearColor('#0B0D10')
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  el.appendChild(renderer.domElement)
  labelRenderer = new CSS2DRenderer()
  labelRenderer.domElement.className = 'pointer-events-none absolute inset-0 z-10'
  el.appendChild(labelRenderer.domElement)

  scene.add(new THREE.HemisphereLight('#cfd8ff', '#2a3039', 0.9))
  const sun = new THREE.DirectionalLight('#ffffff', 1.4)
  sun.position.set(-20, 40, -10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const sc = sun.shadow.camera
  sc.left = -30
  sc.right = 30
  sc.top = 30
  sc.bottom = -30
  sc.far = 120
  sun.shadow.bias = -0.0005
  scene.add(sun, sun.target)

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = el
    renderer.setSize(w, h)
    labelRenderer.setSize(w, h)
    iso.resize(w, h)
    dirty = true
  }
  ro = new ResizeObserver(resize)
  ro.observe(el)
  resize()

  const c = renderer.domElement
  c.addEventListener('pointerdown', onDown)
  c.addEventListener('pointermove', onMove)
  c.addEventListener('pointerup', onUp)
  c.addEventListener('wheel', onWheel, { passive: false })
  c.style.cursor = 'grab'
  c.setAttribute('aria-hidden', 'true')

  watch(signature, () => {
    build()
    // centre the shadow frustum on the current world
    const b = iso.bounds
    sun.target.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2)
    sun.position.set(sun.target.position.x - 20, 40, sun.target.position.z - 10)
  }, { immediate: true })
  watch([() => route.fullPath, () => ui.selectedAgentId], () => iso.setShift(shiftFor()), { immediate: true })
  loop()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  world?.dispose()
  renderer?.dispose()
  timer.dispose()
})
</script>

<template>
  <div ref="host" class="absolute inset-0 overflow-hidden" role="application" aria-label="Isometric world">
    <p v-if="glError" class="absolute top-1/2 left-hud max-w-[420px] -translate-y-1/2 text-small text-ink-faint">
      The 3D world needs WebGL, which this machine could not start ({{ glError }}). Everything else works.
    </p>
    <div v-if="!glError" class="pointer-events-auto absolute bottom-hud left-hud z-20 flex gap-1 rounded-hud border border-line-strong bg-hud p-1">
      <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Zoom in" @click="zoom(1.15)"><Icon name="plus" :size="16" /></button>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Zoom out" @click="zoom(1 / 1.15)"><Icon name="minus" :size="16" /></button>
      <button type="button" class="btn btn-ghost btn-sm" @click="recenter">Recenter</button>
    </div>
  </div>
</template>
