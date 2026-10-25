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
  'cafe_chair.glb': [0.64, 0.62, 0.92],
  'coffee_machine.glb': [0.35, 0.35, 0.45],
  'microwave.glb': [0.6, 0.4, 0.35],
  'pastry_tray.glb': [0.5, 0.35, 0.1],
  'bar_stool.glb': [0.4, 0.4, 0.75],
  'plant_pot_large.glb': [0.7, 0.7, 1.3]
}

/** What a figure is doing: at the desk, or on a break (idle agents). */
type Activity = 'work' | 'coffee' | 'nap' | 'doze'
type Pose = 'stand' | 'sit' | 'lie'
/** A seat from layout.idleSpots: sitters face `faces`, sleepers lie with their head toward `headTo`. */
interface Spot { pos: number[]; seat: number; faces?: number[]; headTo?: number[]; via?: number[][] }
/** A fading effect (steam puff, Z glyph) with its own material so opacity animates alone. */
interface Fx { obj: THREE.Object3D; m: THREE.MeshStandardMaterial; base: THREE.Vector3; size: number }
/** A coffee run: seat → via → pot and back. Runners share one schedule so they take turns. */
interface Run { path: THREE.Vector2[]; cum: number[]; walk: number; dur: number; start: number; period: number; sitFacing: number; potFacing: number }

interface Figure {
  root: THREE.Group
  torso: THREE.Object3D
  head: THREE.Object3D
  armR: THREE.Object3D
  legs: THREE.Object3D[] // standing legs, pivoted at the hip so they can swing
  lap?: THREE.Object3D // seated thighs + shins (sitters only)
  tags: THREE.Group // label anchor that moves with the figure
  mug?: THREE.Object3D
  mouth?: THREE.Object3D // sleepers only, opens on a yawn
  seat: number
  hipY: number
  status: AgentStatus
  activity: Activity
  run?: Run
  away: boolean // out on a coffee run
  fx: Fx[]
  phase: number
}

const RISE = 0.6 // s standing beside the seat before/after a run
const POUR = 2.5 // s at the pot

function figure(parent: THREE.Object3D, x: number, z: number, y: number, a: OfficeAgent, facing: number, activity: Activity = 'work', pose: Pose = 'stand', seat = 0): Figure {
  const root = new THREE.Group()
  root.position.set(x, y, z)
  if (pose === 'lie') {
    // on its back: head toward `facing`, front up
    root.rotation.order = 'YXZ'
    root.rotation.set(-Math.PI / 2, facing, 0)
  } else root.rotation.y = facing
  const pants = '#2B3240'
  const hipY = pose === 'sit' ? seat : 0.72
  const legs = [-0.1, 0.1].map((lx) => {
    const hip = new THREE.Group()
    hip.position.set(lx, 0.72, 0)
    box(hip, 0, 0, 0.14, 0.18, 0.72, -0.72, pants)
    root.add(hip)
    return hip
  })
  let lap: THREE.Group | undefined
  if (pose === 'sit') {
    // sitters keep the standing legs too (hidden) so they can get up and walk
    lap = new THREE.Group()
    for (const lx of [-0.1, 0.1]) {
      box(lap, lx, 0.15, 0.18, 0.44, 0.16, seat - 0.08, pants)
      box(lap, lx, 0.3, 0.17, 0.17, seat - 0.08, 0, pants)
    }
    root.add(lap)
    legs.forEach((l) => (l.visible = false))
  }
  const tags = new THREE.Group()
  root.add(tags)
  const armRest = pose === 'lie' ? -0.1 : -0.5
  const torso = new THREE.Group()
  torso.position.y = hipY
  capsule(torso, 0, 0.3, 0, 0.21, 0.26, a.look.color)
  capsule(torso, -0.27, 0.22, 0.04, 0.06, 0.3, a.look.color).rotation.x = armRest
  // right arm hangs from a shoulder pivot so it can lift a mug
  const armR = new THREE.Group()
  armR.position.set(0.27, 0.404, -0.06)
  armR.rotation.x = armRest
  capsule(armR, 0, -0.21, 0, 0.06, 0.3, a.look.color)
  torso.add(armR)
  const head = new THREE.Group()
  head.position.y = 0.78
  sphere(head, 0, 0, 0, 0.18, a.look.skin)
  sphere(head, 0, 0.08, -0.02, 0.19, a.look.hair, 0.65)
  if (a.look.glasses) box(head, 0, 0.17, 0.26, 0.02, 0.06, -0.03, '#1E2229')
  let mouth: THREE.Mesh | undefined
  if (activity === 'nap' || activity === 'doze') {
    mouth = sphere(head, 0, -0.08, 0.15, 0.05, '#3A1F1F')
    mouth.visible = false
  }
  torso.add(head)
  root.add(torso)
  parent.add(root)
  return { root, torso, head, armR, legs, lap, tags, mouth, seat, hipY, status: a.status, activity, away: false, fx: [], phase: Math.random() * 6 }
}

/** Swap a sitter between seated and standing legs; labels ride up with the head. */
function standUp(f: Figure, up: boolean): void {
  if (!f.lap) return
  f.lap.visible = !up
  f.legs.forEach((l) => (l.visible = up))
  f.hipY = up ? 0.72 : f.seat
  f.tags.position.y = up ? 0.72 - f.seat : 0
}

function coffeeRun(x: number, z: number, facing: number, via: number[][]): Run {
  const cr = layout.idleSpots.coffeeRun
  const path = [[x, z], ...via, cr.pot].map(([px, pz]) => new THREE.Vector2(px, pz))
  const cum = [0]
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]))
  const walk = cum[cum.length - 1] / cr.speed
  const potFacing = Math.atan2(cr.faces[0] - cr.pot[0], cr.faces[1] - cr.pot[1])
  return { path, cum, walk, dur: RISE + walk + POUR + walk + RISE, start: 0, period: 1, sitFacing: facing, potFacing }
}

/** Point `d` along a run's path and the heading of that segment. */
function along(r: Run, d: number): { x: number; z: number; heading: number } {
  let i = 1
  while (i < r.cum.length - 1 && r.cum[i] < d) i++
  const [a, b] = [r.path[i - 1], r.path[i]]
  const k = THREE.MathUtils.clamp((d - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1] || 1), 0, 1)
  return { x: a.x + (b.x - a.x) * k, z: a.y + (b.y - a.y) * k, heading: Math.atan2(b.x - a.x, b.y - a.y) }
}

/** Pose a runner `s` seconds into its run: stand, walk to the pot, pour, walk back. Returns true once the mug is refilled. */
function runStep(f: Figure, r: Run, s: number, t: number): boolean {
  const speed = layout.idleSpots.coffeeRun.speed
  const pour = RISE + r.walk
  const back = pour + POUR
  let { x, y: z } = r.path[0]
  let heading = r.sitFacing
  let walking = true
  if (s >= RISE && s < pour) ({ x, z, heading } = along(r, (s - RISE) * speed))
  else if (s >= back && s < r.dur - RISE) {
    ;({ x, z, heading } = along(r, r.cum[r.cum.length - 1] - (s - back) * speed))
    heading += Math.PI
  } else {
    walking = false
    if (s >= pour && s < back) {
      ;({ x, y: z } = r.path[r.path.length - 1])
      heading = r.potFacing
    }
  }
  standUp(f, true)
  f.root.position.x = x
  f.root.position.z = z
  f.root.rotation.y = heading
  const swing = walking ? Math.sin(t * 9) * 0.5 : 0
  f.legs[0].rotation.x = swing
  f.legs[1].rotation.x = -swing
  f.torso.position.y = f.hipY + (walking ? Math.abs(Math.cos(t * 9)) * 0.03 : 0)
  // at the pot: hold the mug out under the machine
  const reach = s >= pour && s < back ? smooth((s - pour) / 0.4) * (1 - smooth((s - back + 0.4) / 0.4)) : 0
  f.armR.rotation.x = -0.9 - 0.6 * reach
  f.armR.rotation.z = 0
  f.mug!.rotation.x = -f.armR.rotation.x
  f.head.rotation.x = 0.2 * reach
  return s >= pour + POUR * 0.6
}

function fadeMat(color: string, emissive = '#000000'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.5, roughness: 1, transparent: true, opacity: 0, depthWrite: false })
}

/** Mug in the right hand, with steam puffs above it. */
function mug(f: Figure): void {
  const hand = new THREE.Group()
  hand.position.y = -0.42
  cyl(hand, 0, 0.05, 0.07, 0.14, -0.02, '#F4F1EA')
  for (let i = 0; i < 3; i++) {
    const m = fadeMat('#FFFFFF')
    const puff = sphere(hand, 0, 0.2, 0.05, 0.05, m)
    puff.castShadow = false
    f.fx.push({ obj: puff, m, base: puff.position.clone(), size: puff.scale.x })
  }
  f.armR.add(hand)
  f.mug = hand
}

/** Three "Z" glyphs that drift up from a sleeper's head. */
function zGlyphs(parent: THREE.Object3D, x: number, y: number, z: number, fx: Fx[]): void {
  for (let i = 0; i < 3; i++) {
    const m = fadeMat('#E7ECF5', '#8C9BFF')
    const zg = new THREE.Group()
    zg.position.set(x, y, z)
    zg.rotation.y = Math.PI / 4 // face the iso camera
    box(zg, 0, 0, 0.2, 0.03, 0.035, 0.165, m)
    box(zg, 0, 0, 0.2, 0.03, 0.035, 0, m)
    box(zg, 0, 0, 0.26, 0.03, 0.035, 0.065, m).rotation.z = 0.69
    zg.traverse((o) => (o.castShadow = false))
    parent.add(zg)
    fx.push({ obj: zg, m, base: zg.position.clone(), size: 1 })
  }
}

const hash = (s: string): number => Math.abs([...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0))

/** Seat an idle agent: coffee at the break area / kitchen, a nap on the sofa, or a doze at the desk when all are taken. */
function onBreak(parent: THREE.Object3D, a: OfficeAgent, free: Record<'coffee' | 'nap', Spot[]>, stand: number[]): { fg: Figure; floor: number[]; head: number[] } {
  const order: ('coffee' | 'nap')[] = hash(a.id) % 2 ? ['nap', 'coffee'] : ['coffee', 'nap']
  const act = order.find((k) => free[k].length)
  const s = act && free[act].shift()!
  if (!act || !s) {
    const fg = figure(parent, stand[0], stand[1], 0, a, Math.PI, 'doze')
    zGlyphs(parent, stand[0] + 0.2, 1.85, stand[1], fg.fx)
    return { fg, floor: [stand[0], 0.03, stand[1]], head: [stand[0], 1.77, stand[1]] }
  }
  if (act === 'nap') {
    const dx = s.headTo![0] - s.pos[0]
    const dz = s.headTo![1] - s.pos[1]
    const len = Math.hypot(dx, dz)
    const y = s.seat + 0.12 // sinks a little into the cushion
    const fg = figure(parent, s.pos[0], s.pos[1], y, a, Math.atan2(-dx, -dz), 'nap', 'lie')
    const [hx, hz] = [s.pos[0] + (dx / len) * 1.5, s.pos[1] + (dz / len) * 1.5]
    zGlyphs(parent, hx + 0.15, y + 0.35, hz, fg.fx)
    return { fg, floor: [s.pos[0] + (dx / len) * 0.85, s.seat + 0.02, s.pos[1] + (dz / len) * 0.85], head: [hx, y + 0.3, hz] }
  }
  const f = Math.atan2(s.faces![0] - s.pos[0], s.faces![1] - s.pos[1])
  // sit a little back so the shins clear the table, but not into the backrest
  const [x, z] = [s.pos[0] - Math.sin(f) * 0.05, s.pos[1] - Math.cos(f) * 0.05]
  const fg = figure(parent, x, z, 0, a, f, 'coffee', 'sit', s.seat)
  mug(fg)
  if (s.via) fg.run = coffeeRun(x, z, f, s.via)
  return { fg, floor: [s.pos[0], 0.03, s.pos[1]], head: [x, s.seat + 1.05, z] }
}

const smooth = (v: number): number => {
  const c = THREE.MathUtils.clamp(v, 0, 1)
  return c * c * (3 - 2 * c)
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

/** Upholstered café armchair (break area), turned to face (fx, fz). Seat top at 0.5. */
function cafeChair(parent: THREE.Object3D, x: number, z: number, fx: number, fz: number, color: string): void {
  const c = new THREE.Group()
  c.position.set(x, 0, z)
  c.rotation.y = Math.atan2(fx - x, fz - z)
  for (const [lx, lz] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]]) box(c, lx, lz, 0.05, 0.05, 0.36, 0, '#2B3240')
  box(c, 0, 0, 0.64, 0.62, 0.14, 0.36, color) // cushion
  box(c, 0, -0.27, 0.64, 0.1, 0.52, 0.42, shade(color, 0.85)) // backrest
  for (const ax of [-0.29, 0.29]) box(c, ax, 0.02, 0.06, 0.5, 0.16, 0.5, shade(color, 0.85)) // arms
  parent.add(c)
}

/** Round wooden café table on a single pedestal. */
function roundTable(parent: THREE.Object3D, x: number, z: number, d: number, h: number): void {
  cyl(parent, x, z, 0.32, 0.04, 0, '#2B3240') // foot
  cyl(parent, x, z, 0.06, h - 0.1, 0.04, '#3A414C') // post
  cyl(parent, x, z, d / 2, 0.05, h - 0.07, WOOD[2]) // darker rim
  cyl(parent, x, z, d / 2 - 0.04, 0.03, h - 0.03, WOOD[0]) // top
}

/* ---------- lounge ---------- */

/**
 * Three-seat sofa with its back on the -x side, facing +x: short legs, a darker base,
 * arms at both ends, a backrest and separate seat and back cushions. Seat top at 0.5.
 */
function sofa(parent: THREE.Object3D, x: number, z: number, d: number, len: number, color: string): void {
  const [dark, light] = [shade(color, 0.78), shade(color, 1.1)]
  const [x0, x1, z0, z1] = [x - d / 2, x + d / 2, z - len / 2, z + len / 2]
  const ARM = 0.16
  const BACK = 0.3
  for (const lx of [x0 + 0.1, x1 - 0.1]) for (const lz of [z0 + 0.1, z1 - 0.1]) cyl(parent, lx, lz, 0.035, 0.08, 0, '#1E2229')
  box(parent, x, z, d, len, 0.22, 0.08, dark) // base
  for (const az of [z0 + ARM / 2, z1 - ARM / 2]) box(parent, x, az, d, ARM, 0.52, 0.08, color) // arms
  box(parent, x0 + BACK / 2, z, BACK, len - 2 * ARM, 0.82, 0.08, color) // backrest
  const n = 3
  const cw = (len - 2 * ARM) / n
  for (let i = 0; i < n; i++) {
    const cz = z0 + ARM + cw * (i + 0.5)
    box(parent, (x0 + BACK + x1) / 2, cz, x1 - x0 - BACK - 0.02, cw - 0.03, 0.2, 0.3, light) // seat cushion
    box(parent, x0 + BACK + 0.09, cz, 0.18, cw - 0.03, 0.36, 0.5, light) // back cushion
  }
}

/** Low dark coffee table on four legs, with a mug on it. */
function loungeTable(parent: THREE.Object3D, x: number, z: number, w: number, d: number, h: number): void {
  for (const lx of [-1, 1]) for (const lz of [-1, 1]) box(parent, x + lx * (w / 2 - 0.08), z + lz * (d / 2 - 0.08), 0.05, 0.05, h - 0.05, 0, '#262B33')
  box(parent, x, z, w, d, 0.05, h - 0.05, '#2F3540')
  mugAt(parent, x + 0.15, z - 0.2, h)
}

/* ---------- coffee counter (kitchen zone): modern café bar ---------- */
const RED = '#D8452F'
const STEEL = '#DADDE2'
const BLACK = '#22262E'

/** White counter with a recessed kick plate; the top overhangs the stool side (+z). Top at `h`. */
function counter(parent: THREE.Object3D, x: number, z: number, w: number, d: number, h: number): void {
  box(parent, x, z, w - 0.1, d - 0.2, 0.1, 0, '#3A414C')
  box(parent, x, z, w - 0.04, d - 0.1, h - 0.15, 0.1, '#ECEEF1')
  box(parent, x, z + 0.04, w, d + 0.08, 0.05, h - 0.05, '#F8F9FA')
}

/** White mug with coffee in it, standing at y. */
function mugAt(parent: THREE.Object3D, x: number, z: number, y: number): void {
  cyl(parent, x, z, 0.07, 0.11, y, '#FFFFFF')
  cyl(parent, x, z, 0.058, 0.01, y + 0.105, '#4A2C1C')
}

/** Two-group espresso machine facing the stools (+z), red panel on the camera side. */
function espresso(parent: THREE.Object3D, x: number, z: number, y: number): void {
  box(parent, x, z, 0.8, 0.46, 0.1, y, BLACK) // base
  box(parent, x, z + 0.16, 0.64, 0.12, 0.015, y + 0.1, '#5A616D') // drip grate
  box(parent, x - 0.03, z - 0.04, 0.7, 0.38, 0.42, y + 0.1, STEEL) // body
  box(parent, x + 0.345, z - 0.04, 0.05, 0.38, 0.42, y + 0.1, RED) // side panel
  box(parent, x - 0.03, z - 0.04, 0.72, 0.4, 0.04, y + 0.52, '#C3C8CF') // cup warmer
  for (const gx of [-0.2, 0.14]) {
    box(parent, x + gx, z + 0.16, 0.22, 0.02, 0.2, y + 0.24, '#2A2F38') // group panel
    cyl(parent, x + gx, z + 0.2, 0.05, 0.05, y + 0.2, '#9AA1AB') // portafilter
  }
  cyl(parent, x + 0.27, z + 0.17, 0.012, 0.22, y + 0.12, '#9AA1AB') // steam wand
  mugAt(parent, x - 0.18, z - 0.04, y + 0.56)
}

/** Red grinder with a mug on top. */
function grinder(parent: THREE.Object3D, x: number, z: number, y: number): void {
  box(parent, x, z, 0.3, 0.3, 0.22, y, RED)
  box(parent, x, z, 0.26, 0.26, 0.03, y + 0.22, BLACK)
  mugAt(parent, x, z, y + 0.25)
}

function milkJug(parent: THREE.Object3D, x: number, z: number, y: number): void {
  cyl(parent, x, z, 0.07, 0.16, y, STEEL)
  box(parent, x + 0.08, z, 0.03, 0.02, 0.09, y + 0.04, '#9AA1AB') // handle
}

/** Wooden board of buns. */
function pastries(parent: THREE.Object3D, x: number, z: number, y: number): void {
  box(parent, x, z, 0.56, 0.38, 0.03, y, '#C98A55')
  for (const bx of [-0.17, 0, 0.17]) for (const bz of [-0.08, 0.08]) sphere(parent, x + bx, y + 0.07, z + bz, 0.07, '#E2A74E', 0.7)
}

function cakePlate(parent: THREE.Object3D, x: number, z: number, y: number): void {
  cyl(parent, x, z, 0.17, 0.02, y, '#F4F1EA')
  cyl(parent, x, z, 0.1, 0.08, y + 0.02, '#B5743A')
  cyl(parent, x, z, 0.1, 0.015, y + 0.1, '#F4EDE2')
}

/** Dark cabinet behind the counter for the oven. */
function backCabinet(parent: THREE.Object3D, x: number, z: number, w: number, d: number, h: number): void {
  box(parent, x, z, w, d, h - 0.04, 0, '#4E4A46')
  box(parent, x, z, w + 0.04, d + 0.04, 0.04, h - 0.04, '#6E6862')
  box(parent, x, z + d / 2, 0.02, 0.02, h - 0.2, 0.1, '#3A3633') // door split
}

/** Countertop oven with a warm, lit window. */
function oven(parent: THREE.Object3D, x: number, z: number, y: number): void {
  box(parent, x, z, 0.62, 0.44, 0.4, y, '#262B35')
  box(parent, x - 0.06, z + 0.22, 0.42, 0.02, 0.26, y + 0.07, mat('#3A2414', { emissive: '#F2A33A', emissiveIntensity: 0.55 }))
  box(parent, x + 0.23, z + 0.22, 0.1, 0.02, 0.28, y + 0.06, '#3A414C') // controls
}

function planterBox(parent: THREE.Object3D, x: number, z: number): void {
  box(parent, x, z, 0.56, 0.56, 0.42, 0, '#C98A55')
  box(parent, x, z, 0.6, 0.6, 0.05, 0.42, '#B07444')
  sphere(parent, x, 0.78, z, 0.3, '#2F8F5F')
  sphere(parent, x + 0.14, 1.02, z - 0.06, 0.22, '#45B87A')
  sphere(parent, x - 0.12, 0.96, z + 0.1, 0.2, '#3FA06E')
}

/** Round wooden stool on four legs. Seat top at 0.75. */
function woodStool(parent: THREE.Object3D, x: number, z: number): void {
  for (const [lx, lz] of [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]]) box(parent, x + lx, z + lz, 0.04, 0.04, 0.7, 0, '#4A3426')
  box(parent, x, z, 0.24, 0.03, 0.03, 0.28, '#4A3426') // rungs
  box(parent, x, z, 0.03, 0.24, 0.03, 0.28, '#4A3426')
  cyl(parent, x, z, 0.2, 0.06, 0.69, '#6B4A33')
}

/**
 * Name plaque mounted on a wall (meeting room, break area). The text is drawn into a
 * canvas texture, redrawn once the UI font has loaded; `textures` are disposed with the world.
 */
function sign(parent: THREE.Object3D, text: string, pos: number[], rotY: number, textures: THREE.Texture[]): void {
  const [w, h] = [1.9, 0.44]
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 118
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  textures.push(tex)
  const font = '600 56px "IBM Plex Sans", system-ui, sans-serif'
  const draw = () => {
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#1F2633'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#6A7488'
    ctx.lineWidth = 6
    ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6)
    ctx.fillStyle = '#E7ECF5'
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 3)
    tex.needsUpdate = true
  }
  draw()
  document.fonts?.load(font).then(draw, () => undefined)
  const s = new THREE.Group()
  s.position.set(pos[0], pos[2], pos[1])
  s.rotation.y = THREE.MathUtils.degToRad(rotY)
  box(s, 0, -0.025, w + 0.08, 0.04, h + 0.08, -(h + 0.08) / 2, '#2A3140') // backing frame
  // lit a little so it reads in the dim office
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissive: '#FFFFFF', emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.6 }))
  face.position.z = 0.001
  s.add(face)
  parent.add(s)
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

/** Most desks the open floor holds (4 × 4) between the lounge, meeting room, break area and kitchen. */
export const MAX_DESKS = 16

/**
 * Desk positions for `n` agents: a grid centred on the open floor. Up to 9 it's the
 * 3 × 3 grid of layout.desks (4.5 m apart), using only the rows and columns needed;
 * past that, 4 columns 3 m apart. A short last row is centred. Chair and stand keep
 * their offsets from the desk; mug colour and desk plant come from layout.desks.
 */
function deskGrid(n: number): { desk: number[]; chair: number[]; stand: number[]; mug: string; deskPlant: boolean }[] {
  const count = Math.min(n, MAX_DESKS)
  if (!count) return []
  const cols = count <= 3 ? count : count === 4 ? 2 : count <= 9 ? 3 : 4
  const rows = Math.ceil(count / cols)
  const sx = cols <= 3 ? 4.5 : 3
  const sz = rows <= 3 ? 4.5 : 3
  const [cx, cz] = [12.7, 8.1] // centre of layout.desks
  const ref = layout.desks[0]
  const chair = [ref.chair[0] - ref.desk[0], ref.chair[1] - ref.desk[1]]
  const stand = [ref.stand[0] - ref.desk[0], ref.stand[1] - ref.desk[1]]
  return Array.from({ length: count }, (_, k) => {
    const r = Math.floor(k / cols)
    const inRow = Math.min(cols, count - r * cols)
    const x = cx + (k % cols - (inRow - 1) / 2) * sx
    const z = cz + (r - (rows - 1) / 2) * sz
    const look = layout.desks[k % layout.desks.length]
    return { desk: [x, z], chair: [x + chair[0], z + chair[1]], stand: [x + stand[0], z + stand[1]], mug: look.mug, deskPlant: look.deskPlant }
  })
}

export function buildOffice(input: OfficeInput): World {
  const g = new THREE.Group()
  const labels = new Labels()
  const figures: Figure[] = []
  const spinners: THREE.Object3D[] = []
  const textures: THREE.Texture[] = []
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

  // desks: one per agent, in deskSlot order; agents sit facing the monitors (-z); idle agents go on a break
  const seated = [...input.agents].sort((a, b) => (a.deskSlot ?? Infinity) - (b.deskSlot ?? Infinity) || a.id.localeCompare(b.id))
  const spots: Record<'coffee' | 'nap', Spot[]> = layout.idleSpots
  const free = { coffee: [...spots.coffee], nap: [...spots.nap] }
  const bz = layout.zones.find((z) => z.id === 'break-area')!.bounds
  const peek = new Map<string, { tag: { hidden?: boolean }; fg: Figure; hover: boolean }>()
  const deskSpots = deskGrid(seated.length)
  for (const [k, ds] of deskSpots.entries()) {
    const a = seated[k]
    desk(g, ds.desk[0], ds.desk[1], a?.status === 'working', ds.mug, ds.deskPlant)
    chair(g, ds.chair[0] + 0.95, ds.chair[1])
    if (!a) continue
    const { fg, floor, head } =
      a.status === 'idle'
        ? onBreak(g, a, free, ds.stand)
        : { fg: figure(g, ds.stand[0], ds.stand[1], 0, a, Math.PI), floor: [ds.stand[0], 0.03, ds.stand[1]], head: [ds.stand[0], 1.77, ds.stand[1]] }
    figures.push(fg)
    pickable(fg.root, { kind: 'agent', id: a.id })
    const sel = input.selectedId === a.id
    // coffee runners carry their ring and labels with them
    const [ringHost, tagHost] = fg.run ? [fg.root, fg.tags] : [g, g]
    const fp = fg.run ? [0, 0.03, 0] : floor
    const hp = fg.run ? [0, head[1], 0] : head
    if (sel) {
      const ring = torus(ringHost, fp[0], fp[1], fp[2], 0.62, 0.04, mat('#8C9BFF', { emissive: '#8C9BFF', emissiveIntensity: 1 }))
      spinners.push(ring)
    }
    const [mark, cls]: [string, string] = fg.activity === 'coffee' ? ['☕', BUBBLE.idle[1]] : BUBBLE[a.status]
    labels.add(tagHost, [hp[0], hp[1] - 0.02, hp[2]], { kind: 'bubble', title: mark, bubbleClass: cls })
    // the break area and sofa get crowded: name tags there only show on hover, when selected, or while out for coffee
    const inBreak = floor[0] >= bz[0] && floor[0] <= bz[2] && floor[2] >= bz[1] && floor[2] <= bz[3]
    const tucked = !sel && (inBreak || fg.activity === 'nap')
    const tag = labels.add(tagHost, [hp[0], hp[1] + 0.48, hp[2]], {
      title: a.name,
      sub: a.role,
      dot: DOT[a.status],
      selected: sel,
      hidden: tucked,
      onClick: () => input.selectAgent(a.id)
    } as LabelProps)
    if (tucked) peek.set(a.id, { tag, fg, hover: false })
  }
  // one runner at a time on the path and at the pot
  const runners = figures.filter((f) => f.run)
  const slot = Math.max(0, ...runners.map((f) => f.run!.dur)) + 2
  runners.forEach((f, i) => {
    f.run!.start = 3 + i * slot
    f.run!.period = Math.max(slot * runners.length, 45)
  })

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
    // an idle orchestrator stays on its pad (still clickable) with a coffee
    const fg = figure(g, op.stand[0], op.stand[1], op.stand[2], orch, Math.PI / 4, orch.status === 'idle' ? 'coffee' : 'work')
    if (fg.activity === 'coffee') mug(fg)
    figures.push(fg)
    pickable(fg.root, { kind: 'route', to: `/w/${input.workspaceId}/orchestrator` })
    pickable(pad, { kind: 'route', to: `/w/${input.workspaceId}/orchestrator` })
  }

  // zones
  for (const zn of layout.zones) {
    for (const it of zn.items as { model: string; position?: number[]; positions?: number[][]; faces?: number[]; size?: number[]; rotationY?: number; color?: string; colors?: string[]; onCounter?: boolean; elevation?: number; wall?: string; from?: number; to?: number; y?: number[] }[]) {
      const size = it.size ?? SIZES[it.model] ?? [0.6, 0.6, 0.6]
      const ps = it.positions ?? (it.position ? [it.position] : [])
      for (const p of ps) {
        const y = it.elevation ?? (it.onCounter ? 1.0 : 0)
        if (it.model === 'rug.glb') {
          // optional two-tone checker (lounge); otherwise one colour
          const cs = it.colors ?? [it.color ?? '#D9A441']
          const [tw, td] = [size[0] / 4, size[1] / 4]
          if (cs.length < 2) box(g, p[0], p[1], size[0], size[1], 0.02, 0.002, cs[0])
          else for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) box(g, p[0] - size[0] / 2 + tw * (i + 0.5), p[1] - size[1] / 2 + td * (j + 0.5), tw, td, 0.02, 0.002, cs[(i + j) % cs.length])
        } else if (it.model === 'sofa_3seat.glb') sofa(g, p[0], p[1], size[0], size[1], it.color ?? '#66728A')
        else if (it.model === 'coffee_table.glb') loungeTable(g, p[0], p[1], size[0], size[1], size[2])
        else if (it.model === 'office_chair.glb') chair(g, p[0], p[1], it.rotationY)
        else if (it.model === 'round_table.glb') roundTable(g, p[0], p[1], size[0], size[2])
        else if (it.model === 'cafe_chair.glb') cafeChair(g, p[0], p[1], it.faces?.[0] ?? p[0], it.faces?.[1] ?? p[1] + 1, it.color ?? '#3E8A5A')
        else if (it.model === 'bar_stool.glb') woodStool(g, p[0], p[1])
        else if (it.model === 'plant_pot_large.glb') plant(g, p[0], p[1])
        else if (it.model === 'kitchen_counter.glb') counter(g, p[0], p[1], size[0], size[1], size[2])
        else if (it.model === 'coffee_machine.glb') espresso(g, p[0], p[1], y)
        else if (it.model === 'grinder.glb') grinder(g, p[0], p[1], y)
        else if (it.model === 'milk_jug.glb') milkJug(g, p[0], p[1], y)
        else if (it.model === 'cup.glb') mugAt(g, p[0], p[1], y)
        else if (it.model === 'pastry_tray.glb') pastries(g, p[0], p[1], y)
        else if (it.model === 'cake_plate.glb') cakePlate(g, p[0], p[1], y)
        else if (it.model === 'back_cabinet.glb') backCabinet(g, p[0], p[1], size[0], size[1], size[2])
        else if (it.model === 'microwave.glb') oven(g, p[0], p[1], y)
        else if (it.model === 'planter_box.glb') planterBox(g, p[0], p[1])
        else if (it.model === 'meeting_table.glb') box(g, p[0], p[1], size[0], size[1], size[2], 0, WOOD[0])
        else box(g, p[0], p[1], size[0], size[1], size[2], y, it.color ?? '#D5DAE1')
      }
      if (it.wall && it.from !== undefined && it.to !== undefined && it.y) onWall(g, it.wall, it.from, it.to, it.y[0], it.y[1], mat('#1A1E25', { emissive: '#3B4A60', emissiveIntensity: 0.6 }))
    }
    // name plaque on the zone's camera-facing wall
    const sg = (zn as { sign?: { text: string; position: number[]; rotationY?: number } }).sign
    if (sg) sign(g, sg.text, sg.position, sg.rotationY ?? 0, textures)
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
  labels.add(g, lt.anchor!, { title: 'Task board', sub: `${input.counts.active} active · ${input.counts.todo} todo · ${input.counts.review} review`, onClick: () => input.go(`/w/${input.workspaceId}/tasks`) })
  const lo = layout.labels.find((l) => l.id === 'orchestrator')!
  if (orch)
    labels.add(g, lo.anchor!, {
      title: orch.name,
      sub: `Orchestrator · ${orch.status}`,
      dot: DOT[orch.status],
      accent: true,
      selected: input.highlightOrchestrator,
      onClick: () => input.go(`/w/${input.workspaceId}/orchestrator`)
    })
  else labels.add(g, lo.anchor!, { title: 'No orchestrator', sub: 'Set one up in Settings', dot: 'bg-status-review', onClick: () => input.go(`/w/${input.workspaceId}/settings`) })
  const lf = layout.labels.find((l) => l.id === 'project-files')!
  labels.add(g, lf.anchor!, { title: 'Project files', sub: input.folderPath || 'No folder yet · choose one', onClick: () => input.go(`/w/${input.workspaceId}/settings`) })
  const lc = layout.labels.find((x) => x.id === 'coffee')!
  labels.add(g, lc.anchor!, { title: lc.title, sub: lc.sub, icon: 'coffee' })

  const working = figures.some((f) => f.status === 'working')
  const resting = figures.some((f) => f.activity !== 'work')
  return {
    group: g,
    bounds: { minX: 0, maxX: W, minZ: 0, maxZ: D },
    home: layout.camera.target,
    zoom: layout.camera.zoom,
    animate: (t) => {
      for (const f of figures) {
        const ph = t + f.phase
        if (f.activity === 'coffee') {
          const r = f.run
          const into = r ? (((t - r.start) % r.period) + r.period) % r.period : Infinity
          f.away = into < (r?.dur ?? 0)
          let k = 0
          let hot = true
          if (f.away) hot = runStep(f, r!, into, t)
          else {
            if (r) {
              standUp(f, false)
              f.root.position.set(r.path[0].x, 0, r.path[0].y)
              f.root.rotation.y = r.sitFacing
            }
            // ~5 s loop: lift the mug, sip, lower it, wait
            const s = ph % 5
            k = smooth(s / 0.6) * (1 - smooth((s - 1.6) / 0.6))
            f.armR.rotation.x = -0.9 - 1.3 * k
            f.armR.rotation.z = -0.45 * k
            f.mug!.rotation.x = -f.armR.rotation.x - 0.9 * k
            f.head.rotation.x = -0.25 * k
            f.torso.position.y = f.hipY + Math.sin(ph * 1.5) * 0.008
          }
          f.fx.forEach((fx, i) => {
            const p = (ph * 0.6 + i / 3) % 1
            fx.obj.position.y = fx.base.y + p * 0.3
            fx.obj.scale.setScalar(fx.size * (1 + p * 1.5))
            fx.m.opacity = hot ? 0.5 * Math.sin(p * Math.PI) * (1 - k) : 0
          })
        } else if (f.activity === 'nap' || f.activity === 'doze') {
          const breath = Math.sin(ph * 1.2)
          // every ~14 s a big yawn: head back, mouth open, one arm stretched overhead
          const s = (ph + f.phase * 2) % 14
          const k = smooth(s / 0.7) * (1 - smooth((s - 1.9) / 0.7))
          const armRest = f.activity === 'nap' ? -0.1 : -0.5
          f.armR.rotation.x = armRest + (-2.7 - armRest) * k
          f.mouth!.visible = k > 0.05
          f.mouth!.scale.set(0.08, 0.1 * (0.3 + 1.1 * k), 0.06)
          if (f.activity === 'nap') {
            f.torso.position.z = 0.012 * (breath + 1) // lying: local z is up
            f.head.rotation.z = (0.3 + Math.sin(ph * 0.3) * 0.05) * (1 - k)
            f.head.rotation.x = -0.35 * k
          } else {
            f.torso.position.y = f.hipY + breath * 0.006
            f.head.rotation.x = (0.3 + Math.sin(ph * 0.8) * 0.15) * (1 - k) - 0.35 * k
          }
          f.fx.forEach((fx, i) => {
            const p = (ph * 0.4 + i / 3) % 1
            fx.obj.position.set(fx.base.x + p * 0.12, fx.base.y + p * 0.7, fx.base.z - p * 0.12)
            fx.obj.scale.setScalar(fx.size * (0.6 + p * 0.9))
            fx.m.opacity = 0.9 * Math.sin(p * Math.PI) * (1 - k)
          })
        } else if (f.status === 'working') {
          f.torso.position.y = f.hipY + Math.abs(Math.sin(t * 8 + f.phase)) * 0.025
          f.torso.rotation.x = 0.08
        } else if (f.status === 'blocked') {
          f.torso.rotation.z = Math.sin(t * 2 + f.phase) * 0.06
        } else f.torso.position.y = f.hipY + Math.sin(t * 1.5 + f.phase) * 0.008
      }
      spinners.forEach((s, i) => (s.rotation.z = t * (i === 0 ? 0.8 : 0.5)))
      for (const p of peek.values()) p.tag.hidden = !(p.hover || p.fg.away)
      return working || resting || spinners.length > 1
    },
    hover: (pick) => {
      for (const [id, p] of peek) p.hover = pick?.kind === 'agent' && pick.id === id
    },
    dispose: () => {
      labels.dispose()
      textures.forEach((t) => t.dispose())
      disposeTree(g)
    }
  }
}
