/** Workspace office (board C2) built from office-layout.json + the agents store. */
import * as THREE from 'three'
import layout from './layouts/office-layout.json'
import { box, capsule, checker, cyl, disposeTree, mat, pickable, shade, sphere, torus } from './build'
import { Labels, type LabelProps } from './labels'
import type { World } from './world'
import type { AgentStatus } from '@shared/types'

export interface OfficeAgent {
  id: string
  name: string
  role: string
  status: AgentStatus
  deskSlot?: number
  look: { color: string; hair: string; skin: string; glasses: boolean }
}
export interface OfficeInput {
  workspaceId: string
  trim: string // workspace colour
  folderPath: string
  agents: OfficeAgent[]
  orchestrator?: OfficeAgent
  selectedId?: string
  highlightOrchestrator?: boolean
  counts: { active: number; todo: number; review: number }
  go: (to: string) => void
  selectAgent: (id: string) => void
}

const WOOD = ['#D2A878', '#B48A5C', '#957049']
const DARK = '#262D3A'
const BUBBLE: Record<AgentStatus, [string, string]> = {
  working: ['•••', 'bg-status-working text-app'],
  review: ['!', 'bg-status-review text-app'],
  blocked: ['!', 'bg-status-blocked text-app'],
  idle: ['z', 'bg-line-strong text-ink']
}
const DOT: Record<AgentStatus, string> = { working: 'bg-status-working', review: 'bg-status-review', blocked: 'bg-status-blocked', idle: 'bg-status-idle' }

/** Default footprints for props the JSON places without a size. */
const SIZES: Record<string, number[]> = {
  'office_chair.glb': [0.64, 0.64, 1.0],
  'cafe_chair.glb': [0.5, 0.5, 0.85],
  'coffee_machine.glb': [0.35, 0.35, 0.45],
  'microwave.glb': [0.6, 0.4, 0.35],
  'pastry_tray.glb': [0.5, 0.35, 0.1],
  'bar_stool.glb': [0.4, 0.4, 0.75],
  'plant_pot_large.glb': [0.7, 0.7, 1.3]
}

interface Figure {
  root: THREE.Group
  torso: THREE.Object3D
  status: AgentStatus
  phase: number
}

function figure(parent: THREE.Object3D, x: number, z: number, y: number, a: OfficeAgent, facing: number): Figure {
  const root = new THREE.Group()
  root.position.set(x, y, z)
  root.rotation.y = facing
  const pants = '#2B3240'
  box(root, -0.1, 0, 0.14, 0.18, 0.72, 0, pants)
  box(root, 0.1, 0, 0.14, 0.18, 0.72, 0, pants)
  const torso = new THREE.Group()
  torso.position.y = 0.72
  capsule(torso, 0, 0.3, 0, 0.21, 0.26, a.look.color)
  capsule(torso, -0.27, 0.22, 0.04, 0.06, 0.3, a.look.color).rotation.x = -0.5
  capsule(torso, 0.27, 0.22, 0.04, 0.06, 0.3, a.look.color).rotation.x = -0.5
  sphere(torso, 0, 0.78, 0, 0.18, a.look.skin)
  sphere(torso, 0, 0.86, -0.02, 0.19, a.look.hair, 0.65)
  if (a.look.glasses) box(torso, 0, 0.78, 0.17, 0.26, 0.02, 0.06, '#1E2229')
  root.add(torso)
  parent.add(root)
  return { root, torso, status: a.status, phase: Math.random() * 6 }
}

function chair(parent: THREE.Object3D, x: number, z: number, rotY = 0): void {
  const c = new THREE.Group()
  c.position.set(x, 0, z)
  c.rotation.y = THREE.MathUtils.degToRad(rotY)
  cyl(c, 0, 0, 0.28, 0.04, 0, '#1A1E25')
  cyl(c, 0, 0, 0.04, 0.4, 0.04, '#3A414C')
  box(c, 0, 0, 0.6, 0.6, 0.1, 0.44, DARK)
  box(c, 0, 0.26, 0.6, 0.1, 0.55, 0.5, DARK)
  parent.add(c)
}

function desk(parent: THREE.Object3D, x: number, z: number, working: boolean, mug: string, plant: boolean): void {
  const [w, d] = [layout.deskModel.size[0], layout.deskModel.size[1]]
  box(parent, x, z, w, d, 0.06, 0.69, WOOD[0])
  box(parent, x - w / 2 + 0.06, z, 0.08, d - 0.1, 0.69, 0, WOOD[2])
  box(parent, x + w / 2 - 0.35, z, 0.6, d - 0.1, 0.69, 0, WOOD[1])
  const screen = working ? mat(layout.deskModel.screenWorking, { emissive: layout.deskModel.screenWorking, emissiveIntensity: 0.9 }) : mat(layout.deskModel.screenIdle)
  for (const mx of [-0.45, 0.45]) {
    box(parent, x + mx, z - 0.35, 0.1, 0.1, 0.12, 0.75, '#3A414C')
    box(parent, x + mx, z - 0.4, 0.8, 0.06, 0.48, 0.85, '#1A1E25')
    box(parent, x + mx, z - 0.366, 0.72, 0.01, 0.4, 0.89, screen)
  }
  box(parent, x, z + 0.15, 0.9, 0.25, 0.03, 0.75, '#AEB5BF')
  cyl(parent, x - 0.95, z + 0.15, 0.06, 0.14, 0.75, mug)
  if (plant) {
    cyl(parent, x + 0.95, z - 0.25, 0.1, 0.16, 0.75, '#C98A55')
    sphere(parent, x + 0.95, 1.05, z - 0.25, 0.16, '#3FA06E')
  }
}

function plant(parent: THREE.Object3D, x: number, z: number): void {
  cyl(parent, x, z, 0.3, 0.55, 0, '#E7E2D8')
  sphere(parent, x, 0.95, z, 0.4, '#2F8F5F')
  sphere(parent, x + 0.12, 1.25, z - 0.08, 0.28, '#45B87A')
}

/** Place a flat panel on one of the two back walls between `from` and `to` along it. */
function onWall(parent: THREE.Object3D, wall: string, from: number, to: number, y0: number, y1: number, color: string | THREE.Material, inset = 0.02): THREE.Mesh {
  const len = to - from
  if (wall === 'wall-back-right') return box(parent, from + len / 2, inset, len, 0.04, y1 - y0, y0, color)
  return box(parent, inset, from + len / 2, 0.04, len, y1 - y0, y0, color)
}

export function buildOffice(input: OfficeInput): World {
  const g = new THREE.Group()
  const labels = new Labels()
  const figures: Figure[] = []
  const spinners: THREE.Object3D[] = []
  const [W, D] = layout.room.size
  const floor = layout.room.floor

  box(g, W / 2, D / 2, W, D, floor.slabThickness, -floor.slabThickness, shade(floor.colors[0], 0.6))
  checker(g, W, D, floor.colors, 0.001)

  for (const w of layout.room.walls) {
    const alongX = w.from[1] === w.to[1]
    const len = alongX ? w.to[0] - w.from[0] : w.to[1] - w.from[1]
    const t = w.thickness
    if (alongX) {
      box(g, len / 2 - t / 2, -t / 2, len + t, t, w.height, 0, w.innerColor)
      box(g, len / 2 - t / 2, -t / 2, len + t, t + 0.02, 0.08, w.height, w.capColor)
    } else {
      box(g, -t / 2, len / 2, t, len, w.height, 0, w.innerColor)
      box(g, -t / 2, len / 2, t + 0.02, len, 0.08, w.height, w.capColor)
    }
    onWall(g, w.id, 0, len, 0, w.trim.height, input.trim, 0.01)
  }
  const glass = mat('#86B4E6', { emissive: '#3F6EA6', emissiveIntensity: 0.35, roughness: 0.2 })
  for (const win of layout.room.windows) {
    onWall(g, win.wall, win.from, win.to, win.y[0], win.y[1], '#232A36', 0.01)
    onWall(g, win.wall, win.from + 0.1, win.to - 0.1, win.y[0] + 0.08, win.y[1] - 0.08, glass, 0.03)
    onWall(g, win.wall, win.from, win.to, win.y[0] - 0.06, win.y[0], '#6A7488', 0.05)
  }

  // desks: one per slot; agents sit at their slot facing the monitors (-z)
  const bySlot = new Map(input.agents.filter((a) => a.deskSlot !== undefined).map((a) => [a.deskSlot!, a]))
  for (const ds of layout.desks) {
    const a = bySlot.get(ds.slot)
    desk(g, ds.desk[0], ds.desk[1], a?.status === 'working', ds.mug, ds.deskPlant)
    chair(g, ds.chair[0] + 0.95, ds.chair[1])
    if (!a) continue
    const fg = figure(g, ds.stand[0], ds.stand[1], 0, a, Math.PI)
    figures.push(fg)
    pickable(fg.root, { kind: 'agent', id: a.id })
    const sel = input.selectedId === a.id
    if (sel) {
      const ring = torus(g, ds.stand[0], 0.03, ds.stand[1], 0.62, 0.04, mat('#8C9BFF', { emissive: '#8C9BFF', emissiveIntensity: 1 }))
      spinners.push(ring)
    }
    labels.add(g, [ds.stand[0], 1.75, ds.stand[1]], { kind: 'bubble', title: BUBBLE[a.status][0], bubbleClass: BUBBLE[a.status][1] })
    labels.add(g, [ds.stand[0], 2.25, ds.stand[1]], {
      title: a.name,
      sub: a.role,
      dot: DOT[a.status],
      selected: sel,
      onClick: () => input.selectAgent(a.id)
    } as LabelProps)
  }

  // orchestrator pad
  const op = layout.orchestrator
  const pad = new THREE.Group()
  cyl(pad, op.pad.position[0], op.pad.position[1], op.pad.size[0] / 2, op.pad.size[2], 0, '#2B3646')
  torus(pad, op.pad.position[0], op.pad.size[2] + 0.01, op.pad.position[1], op.pad.size[0] / 2 - 0.15, 0.05, mat(op.pad.glow, { emissive: op.pad.glow, emissiveIntensity: input.highlightOrchestrator ? 1.4 : 0.8 }))
  const halo = torus(pad, op.stand[0], op.floatingRing.y, op.stand[1], op.floatingRing.radius, 0.04, mat(op.pad.glow, { emissive: op.pad.glow, emissiveIntensity: 1 }))
  spinners.push(halo)
  g.add(pad)
  const orch = input.orchestrator
  if (orch) {
    const fg = figure(g, op.stand[0], op.stand[1], op.stand[2], orch, Math.PI / 4)
    figures.push(fg)
    pickable(fg.root, { kind: 'route', to: `/w/${input.workspaceId}/orchestrator` })
    pickable(pad, { kind: 'route', to: `/w/${input.workspaceId}/orchestrator` })
  }

  // zones
  for (const zn of layout.zones) {
    for (const it of zn.items as { model: string; position?: number[]; positions?: number[][]; size?: number[]; rotationY?: number; color?: string; onCounter?: boolean; wall?: string; from?: number; to?: number; y?: number[] }[]) {
      const size = it.size ?? SIZES[it.model] ?? [0.6, 0.6, 0.6]
      const ps = it.positions ?? (it.position ? [it.position] : [])
      for (const p of ps) {
        const y = it.onCounter ? 1.0 : 0
        if (it.model === 'rug.glb') box(g, p[0], p[1], size[0], size[1], 0.02, 0.002, it.color ?? '#D9A441')
        else if (it.model === 'sofa_3seat.glb') {
          box(g, p[0], p[1], size[0], size[1], 0.45, 0, it.color ?? '#66728A')
          box(g, p[0] - size[0] / 2 + 0.15, p[1], 0.3, size[1], 0.9, 0, shade(it.color ?? '#66728A', 0.85))
        } else if (it.model === 'office_chair.glb') chair(g, p[0], p[1], it.rotationY)
        else if (it.model === 'round_table.glb') {
          cyl(g, p[0], p[1], 0.08, size[2], 0, '#3A414C')
          cyl(g, p[0], p[1], size[0] / 2, 0.06, size[2] - 0.06, WOOD[0])
        } else if (it.model === 'bar_stool.glb' || it.model === 'cafe_chair.glb') {
          cyl(g, p[0], p[1], 0.05, size[2] - 0.08, 0, '#3A414C')
          cyl(g, p[0], p[1], size[0] / 2, 0.08, size[2] - 0.08, it.color ?? DARK)
        } else if (it.model === 'plant_pot_large.glb') plant(g, p[0], p[1])
        else if (it.model === 'coffee_machine.glb') box(g, p[0], p[1], size[0], size[1], size[2], y, '#1A1E25')
        else if (it.model === 'meeting_table.glb' || it.model === 'coffee_table.glb') box(g, p[0], p[1], size[0], size[1], size[2], 0, WOOD[0])
        else box(g, p[0], p[1], size[0], size[1], size[2], y, it.color ?? '#D5DAE1')
      }
      if (it.wall && it.from !== undefined && it.to !== undefined && it.y) onWall(g, it.wall, it.from, it.to, it.y[0], it.y[1], mat('#1A1E25', { emissive: '#3B4A60', emissiveIntensity: 0.6 }))
    }
    // glass walls
    const gw = (zn as { glassWalls?: unknown }).glassWalls
    const glassMat = mat('#9FC3E8', { opacity: 0.18, roughness: 0.1 })
    const segs: { from: number[]; to: number[] }[] =
      Array.isArray(gw) ? gw : gw ? (() => {
        const [x0, z0, x1, z1] = zn.bounds
        return [
          { from: [x0, z0], to: [x1, z0] }, { from: [x1, z0], to: [x1, z1] }, { from: [x0, z1], to: [x1, z1] }, { from: [x0, z0], to: [x0, z1] }
        ]
      })() : []
    for (const s of segs) {
      const alongX = s.from[1] === s.to[1]
      const len = alongX ? s.to[0] - s.from[0] : s.to[1] - s.from[1]
      const cx = alongX ? s.from[0] + len / 2 : s.from[0]
      const cz = alongX ? s.from[1] : s.from[1] + len / 2
      const pane = box(g, cx, cz, alongX ? len : 0.06, alongX ? 0.06 : len, 2.3, 0, glassMat)
      pane.castShadow = false
      box(g, cx, cz, alongX ? len : 0.08, alongX ? 0.08 : len, 0.06, 2.3, '#6A7488')
    }
  }

  // props
  for (const p of layout.props as { id: string; model: string; position?: number[]; size?: number[]; rotationY?: number; wall?: string; from?: number; to?: number; y?: number[]; ledColors?: string[] }[]) {
    if (p.wall && p.y) {
      const board = onWall(g, p.wall, p.from!, p.to!, p.y[0], p.y[1], '#EEF1F4')
      pickable(board, { kind: 'route', to: `/w/${input.workspaceId}/tasks` })
      const notes = ['#F2B544', '#5E9BEA', '#9CC77A', '#F2B544', '#5E9BEA']
      notes.forEach((c, i) => onWall(g, p.wall!, p.from! + 0.4 + i * 1.0, p.from! + 1.1 + i * 1.0, p.y![0] + 0.8 - (i % 2) * 0.4, p.y![0] + 1.2 - (i % 2) * 0.4, c, 0.05))
      continue
    }
    const pos = p.position!
    const size = p.size ?? SIZES[p.model] ?? [0.7, 0.7, 1.2]
    if (p.model === 'plant_pot_large.glb') plant(g, pos[0], pos[1])
    else if (p.model === 'server_rack.glb') {
      const rack = new THREE.Group()
      box(rack, pos[0], pos[1], size[0], size[1], size[2], 0, '#1F2530')
      ;(p.ledColors ?? ['#4FD1B5', '#5E9BEA', '#8C9BFF']).forEach((c, i) =>
        box(rack, pos[0], pos[1] + size[1] / 2 + 0.01, size[0] - 0.2, 0.02, 0.05, 0.3 + i * 0.35, mat(c, { emissive: c, emissiveIntensity: 1.2 }))
      )
      pickable(rack, { kind: 'route', to: `/w/${input.workspaceId}/changes` })
      g.add(rack)
    } else if (p.model === 'bookshelf.glb') {
      box(g, pos[0], pos[1], size[0], size[1], size[2], 0, WOOD[1])
      ;['#E5584A', '#5E9BEA', '#F2B544', '#9B7AE8'].forEach((c, i) => box(g, pos[0] - 0.9 + i * 0.5, pos[1] + 0.22, 0.4, 0.2, 0.35, 0.4 + (i % 2) * 0.6, c))
    } else if (p.model === 'water_cooler.glb') {
      box(g, pos[0], pos[1], size[0], size[1], size[2], 0, '#D5DAE1')
      cyl(g, pos[0], pos[1], 0.18, 0.4, size[2], mat('#7FB2FF', { opacity: 0.7 }))
    } else {
      const r = p.rotationY === 90
      box(g, pos[0], pos[1], r ? size[1] : size[0], r ? size[0] : size[1], size[2], 0, '#3A414C')
    }
  }

  // labels from JSON
  const lt = layout.labels.find((l) => l.id === 'task-board')!
  labels.add(g, lt.anchor, { title: 'Task board', sub: `${input.counts.active} active · ${input.counts.todo} todo · ${input.counts.review} review`, onClick: () => input.go(`/w/${input.workspaceId}/tasks`) })
  const lo = layout.labels.find((l) => l.id === 'orchestrator')!
  if (orch)
    labels.add(g, lo.anchor, {
      title: orch.name,
      sub: `Orchestrator · ${orch.status}`,
      dot: DOT[orch.status],
      accent: true,
      selected: input.highlightOrchestrator,
      onClick: () => input.go(`/w/${input.workspaceId}/orchestrator`)
    })
  else labels.add(g, lo.anchor, { title: 'No orchestrator', sub: 'Set one up in Settings', dot: 'bg-status-review', onClick: () => input.go(`/w/${input.workspaceId}/settings`) })
  const lf = layout.labels.find((l) => l.id === 'project-files')!
  labels.add(g, lf.anchor, { title: 'Project files', sub: input.folderPath || 'No folder yet · choose one', onClick: () => input.go(`/w/${input.workspaceId}/settings`) })
  for (const id of ['coffee', 'meeting-room', 'break-area']) {
    const l = layout.labels.find((x) => x.id === id)!
    labels.add(g, l.anchor, { title: l.title, sub: id === 'meeting-room' ? 'Free' : l.sub })
  }

  const working = figures.some((f) => f.status === 'working')
  return {
    group: g,
    bounds: { minX: 0, maxX: W, minZ: 0, maxZ: D },
    home: layout.camera.target,
    zoom: layout.camera.zoom,
    animate: (t) => {
      for (const f of figures) {
        if (f.status === 'working') {
          f.torso.position.y = 0.72 + Math.abs(Math.sin(t * 8 + f.phase)) * 0.025
          f.torso.rotation.x = 0.08
        } else if (f.status === 'blocked') {
          f.torso.rotation.z = Math.sin(t * 2 + f.phase) * 0.06
        } else f.torso.position.y = 0.72 + Math.sin(t * 1.5 + f.phase) * 0.008
      }
      spinners.forEach((s, i) => (s.rotation.z = t * (i === 0 ? 0.8 : 0.5)))
      return working || spinners.length > 1
    },
    dispose: () => {
      labels.dispose()
      disposeTree(g)
    }
  }
}
