/** Campus world (board C1) built from lobby-layout.json + the workspaces store. */
import * as THREE from 'three'
import layout from './layouts/lobby-layout.json'
import { box, checker, cyl, disposeTree, mat, pickable, plotBox, shade, sphere, torus, type Pick } from './build'
import { Labels, type LabelProps } from './labels'
import type { World } from './world'

export interface LobbyBuilding {
  id: string
  name: string
  roof: string
  plot: { x: number; z: number; w: number; d: number }
  agents: number
  working: number
  setupNeeded: boolean
}
export interface LobbyInput {
  buildings: LobbyBuilding[]
  jarvisState: string
  jarvisBusy: boolean
  go: (to: string) => void
}

const SLOTS = layout.workspaceSlots.map((s) => s.plot)
const PAINT = layout.markings.paint
const toPlot = ([x, z, w, d]: number[]) => ({ x, z, w, d })

/**
 * Every building gets one of the fixed slots: its saved plot when that is a free slot,
 * otherwise the next free one (older data could sit off-campus). Past the last slot nothing is drawn.
 */
function place(buildings: LobbyBuilding[]): { placed: LobbyBuilding[]; free?: number[] } {
  const taken = new Set<number>()
  const placed: LobbyBuilding[] = []
  const rest: LobbyBuilding[] = []
  for (const b of buildings) {
    const i = SLOTS.findIndex((s, k) => !taken.has(k) && s[0] === b.plot.x && s[1] === b.plot.z)
    if (i < 0) rest.push(b)
    else {
      taken.add(i)
      placed.push({ ...b, plot: toPlot(SLOTS[i]) })
    }
  }
  for (const b of rest) {
    const i = SLOTS.findIndex((_, k) => !taken.has(k))
    if (i < 0) break
    taken.add(i)
    placed.push({ ...b, plot: toPlot(SLOTS[i]) })
  }
  return { placed, free: SLOTS.find((_, k) => !taken.has(k)) }
}

interface Building {
  id: string
  body: THREE.Group
  roof: THREE.MeshStandardMaterial
  glass: THREE.MeshStandardMaterial[]
  beacon: THREE.MeshStandardMaterial
  label: { highlight?: boolean }
  phase: number
}

function building(g: THREE.Group, labels: Labels, b: LobbyBuilding, go: (to: string) => void, phase: number): Building {
  const { x, z, w, d } = b.plot
  const cx = x + w / 2
  const cz = z + d / 2
  // ground floor holds the entrance; one more floor per 3 agents
  const floors = THREE.MathUtils.clamp(1 + Math.floor(b.agents / 3), 1, 4)
  const height = 2.6 + (floors - 1)
  const bw = w - 1
  const bd = d - 1
  const lit = b.working > 0
  const bg = new THREE.Group()
  const body = new THREE.Group()
  // plot paving + lawn edge (stays put when the building lifts on hover)
  box(bg, cx, cz, w, d, 0.05, 0, '#B4B9C0')
  box(body, cx, cz, bw, bd, height, 0.05, '#DCE0E6')
  // one window band per floor on the two camera-facing faces (+z, +x), with a slab line between floors
  const glass: THREE.MeshStandardMaterial[] = []
  for (let f = 0; f < floors; f++) {
    const y = 1.45 + f
    const gm = lit ? new THREE.MeshStandardMaterial({ color: '#FFE7A3', emissive: '#FFD873', emissiveIntensity: 0.9, roughness: 0.8 }) : mat('#3B4A60', { roughness: 0.3 })
    if (lit) glass.push(gm)
    box(body, cx, cz + bd / 2 + 0.02, bw - 0.6, 0.04, 0.5, y, gm)
    box(body, cx + bw / 2 + 0.02, cz, 0.04, bd - 0.6, 0.5, y, gm)
    if (f > 0) box(body, cx, cz, bw + 0.08, bd + 0.08, 0.06, y - 0.27, '#C9CED6')
  }
  // roof slab + parapet in the workspace colour; the slab glows on hover
  const roof = new THREE.MeshStandardMaterial({ color: b.roof, emissive: b.roof, emissiveIntensity: 0, roughness: 0.8 })
  box(body, cx, cz, bw + 0.3, bd + 0.3, 0.3, height + 0.05, roof)
  box(body, cx, cz, bw - 0.4, bd - 0.4, 0.12, height + 0.35, shade(b.roof, 0.8))
  // rooftop: AC units, antenna with a beacon, solar panels while the team works
  const top = height + 0.47
  box(body, cx - bw / 4, cz - bd / 4, 0.6, 0.5, 0.35, top, '#9AA1AB')
  cyl(body, cx - bw / 4, cz - bd / 4, 0.17, 0.04, top + 0.35, '#3A414C')
  if (bw > 4.5) box(body, cx - bw / 4 + 0.8, cz - bd / 4, 0.45, 0.45, 0.3, top, '#9AA1AB')
  cyl(body, cx - bw / 2 + 0.45, cz - bd / 2 + 0.45, 0.03, 1.0, top, '#3A414C')
  const beacon = new THREE.MeshStandardMaterial({ color: '#FF6A5A', emissive: '#FF3B2F', emissiveIntensity: 0.4 })
  sphere(body, cx - bw / 2 + 0.45, top + 1.02, cz - bd / 2 + 0.45, 0.07, beacon)
  if (lit)
    for (let k = 0; k < Math.min(3, Math.floor(bw / 1.3)); k++) {
      const p = box(body, cx + bw / 2 - 0.75 - k * 0.95, cz + bd / 4, 0.8, 0.9, 0.04, top + 0.15, mat('#1F3A66', { roughness: 0.25, emissive: '#2A4F8A', emissiveIntensity: 0.15 }))
      p.rotation.x = -0.35
    }
  // entrance: glass doors + awning, centred on +z
  box(body, cx, cz + bd / 2 + 0.03, 1.2, 0.06, 1.1, 0.05, mat('#9FC3E8', { emissive: '#4A7FE0', emissiveIntensity: 0.25 }))
  box(body, cx, cz + bd / 2 + 0.35, 1.8, 0.7, 0.12, 1.25, b.roof)
  bg.add(body)
  pickable(bg, { kind: 'workspace', id: b.id })
  g.add(bg)
  const label = labels.add(g, [cx, height + 1.7, cz], {
    title: b.name,
    sub: b.setupNeeded ? 'Setup needed · no orchestrator' : `${b.agents} agents · ${b.working} working`,
    dot: b.setupNeeded ? 'bg-status-review' : lit ? 'bg-status-working' : 'bg-status-idle',
    badge: b.setupNeeded ? '!' : undefined,
    color: b.roof,
    meter: b.setupNeeded || !b.agents ? undefined : b.working / b.agents,
    highlight: false,
    onClick: () => go(`/w/${b.id}`)
  } as LabelProps)
  return { id: b.id, body, roof, glass, beacon, label, phase }
}

function tree(g: THREE.Group, x: number, z: number, h: number): void {
  cyl(g, x, z, 0.12, h * 0.4, 0, '#6B4E36')
  sphere(g, x, h * 0.62, z, h * 0.3, '#3FA06E')
  sphere(g, x + 0.15, h * 0.8, z - 0.1, h * 0.2, '#45B87A')
}

/** Flat road paint; never casts a shadow. */
function paint(g: THREE.Group, x: number, z: number, w: number, d: number, y: number): void {
  box(g, x, z, w, d, 0.005, y, PAINT).castShadow = false
}

// ---- traffic -------------------------------------------------------------

type P = [number, number]

/** Closed polyline with arc-length lookup. */
class Track {
  private cum = [0]
  readonly length: number
  constructor(private pts: P[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    this.length = this.cum[this.cum.length - 1]
  }
  at(s: number): P {
    s = ((s % this.length) + this.length) % this.length
    let i = 1
    while (i < this.cum.length - 1 && this.cum[i] < s) i++
    const t = (s - this.cum[i - 1]) / (this.cum[i] - this.cum[i - 1] || 1)
    const [a, b] = [this.pts[i - 1], this.pts[i]]
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  }
}

function arc(pts: P[], c: P, r: number, a0: number, a1: number): void {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.12))
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)])
  }
}

/**
 * One road as a loop, in (along, across) space: out in one lane, around the plaza
 * keeping it on the left, U-turn at the far end, back in the other lane.
 * `turns` are the U-turn radii at each end: the lane offset for a tight turnaround,
 * or larger to circle something (Jarvis's plaza) before heading back.
 */
function roadLoop(end0: number, end1: number, mid: number, plaza: number, ring: number, lane: number, turns: [number, number] = [lane, lane]): P[] {
  const phi = Math.asin(lane / ring)
  const [t0, t1] = turns.map((r) => Math.asin(lane / r))
  const pts: P[] = []
  arc(pts, [plaza, mid], ring, Math.PI - phi, phi)
  arc(pts, [end1, mid], turns[1], Math.PI - t1, -(Math.PI - t1))
  arc(pts, [plaza, mid], ring, -phi, -(Math.PI - phi))
  arc(pts, [end0, mid], turns[0], -t0, -(2 * Math.PI - t0))
  pts.push(pts[0])
  return pts
}

interface Car {
  group: THREE.Group
  wheels: THREE.Mesh[]
}

function car(g: THREE.Group, color: string, wheelGeo: THREE.BufferGeometry): Car {
  const c = new THREE.Group()
  box(c, 0, 0, 0.7, 1.4, 0.32, 0.12, color)
  box(c, 0, -0.08, 0.62, 0.78, 0.26, 0.44, mat('#3B4A60', { roughness: 0.3 }))
  box(c, 0, -0.08, 0.64, 0.8, 0.04, 0.7, shade(color, 0.85))
  // front is +z: headlights there, tail lights at the back
  for (const sx of [-0.22, 0.22]) {
    box(c, sx, 0.7, 0.16, 0.04, 0.08, 0.24, mat('#FFF6D8', { emissive: '#FFF2C0', emissiveIntensity: 1.2 }))
    box(c, sx, -0.7, 0.16, 0.04, 0.08, 0.26, mat('#E5584A', { emissive: '#FF2A1A', emissiveIntensity: 0.9 }))
  }
  const wheels: THREE.Mesh[] = []
  for (const [sx, sz] of [[-0.36, 0.45], [0.36, 0.45], [-0.36, -0.45], [0.36, -0.45]]) {
    const wh = new THREE.Mesh(wheelGeo, mat('#22262C'))
    wh.position.set(sx, 0.14, sz)
    wh.castShadow = true
    c.add(wh)
    wheels.push(wh)
  }
  g.add(c)
  return { group: c, wheels }
}

// ---- world ---------------------------------------------------------------

export function buildLobby(input: LobbyInput): World {
  const g = new THREE.Group()
  const labels = new Labels()
  const animated: ((t: number) => void)[] = []

  const [W, D] = layout.ground.size
  box(g, W / 2, D / 2, W, D, layout.ground.slabThickness, -layout.ground.slabThickness, layout.ground.soil[0])
  checker(g, W, D, layout.ground.grass, 0.001)

  const [px, pz] = layout.plaza.center
  const jp = layout.jarvisPortal
  // Jarvis stands at the south end of road-z: nothing on campus sits between it and the camera
  const [jx, jz] = jp.position
  const turnR = layout.markings.turnaroundRadius
  // turnarounds: both ends of road-x, the north end of road-z (its south end is Jarvis's plaza)
  const ends: P[] = [[turnR + 0.05, pz], [W - turnR - 0.05, pz], [px, turnR + 0.05]]
  for (const r of layout.roads) {
    plotBox(g, r.plot, 0.04, 0.002, r.paving[0])
    // curbs along the long sides
    const p = r.plot
    if (r.id === 'road-x') {
      plotBox(g, [p[0], p[1] - 0.1, p[2], 0.1], 0.08, 0, r.curb)
      plotBox(g, [p[0], p[1] + p[3], p[2], 0.1], 0.08, 0, r.curb)
    } else {
      plotBox(g, [p[0] - 0.1, p[1], 0.1, p[3]], 0.08, 0, r.curb)
      plotBox(g, [p[0] + p[2], p[1], 0.1, p[3]], 0.08, 0, r.curb)
    }
  }
  // turnarounds at the road ends, raised over the curbs
  for (const [x, z] of ends) {
    cyl(g, x, z, turnR, 0.09, 0.002, layout.roads[0].paving[1])
    torus(g, x, 0.09, z, turnR, 0.04, layout.roads[0].curb)
  }
  // centre-line dashes, stopping short of the crosswalks and turnarounds
  const cross = layout.plaza.radius + 0.6
  const dashes = (from: number, to: number, put: (s: number) => void) => {
    for (let s = from; s + 0.5 <= to; s += 1) put(s + 0.25)
  }
  for (const [a, b] of [[2 * turnR + 0.3, px - cross - 0.6], [px + cross + 0.6, W - 2 * turnR - 0.3]]) dashes(a, b, (s) => paint(g, s, pz, 0.5, 0.08, 0.043))
  for (const [a, b] of [[2 * turnR + 0.3, pz - cross - 0.6], [pz + cross + 0.6, jz - jp.plazaRadius - 0.3]]) dashes(a, b, (s) => paint(g, px, s, 0.08, 0.5, 0.043))
  // zebra crosswalks on the four plaza approaches
  const cw = layout.markings.crosswalks
  for (const sgn of [-1, 1])
    for (let k = -2.5; k <= 2.5; k++) {
      paint(g, px + sgn * cross, pz + k * 0.32, cw, 0.16, 0.043)
      paint(g, px + k * 0.32, pz + sgn * cross, 0.16, cw, 0.043)
    }

  // roundabout with a fountain on the island
  cyl(g, px, pz, layout.plaza.radius, 0.06, 0.03, layout.plaza.color)
  torus(g, px, 0.1, pz, layout.plaza.radius, 0.06, layout.plaza.ring)
  cyl(g, px, pz, 1.15, 0.3, 0.06, '#C9CED6')
  const water = new THREE.MeshStandardMaterial({ color: '#4FA3E0', emissive: '#2A6FB0', emissiveIntensity: 0.25, roughness: 0.15 })
  cyl(g, px, pz, 1.0, 0.04, 0.33, water)
  cyl(g, px, pz, 0.16, 0.85, 0.36, '#C9CED6')
  cyl(g, px, pz, 0.45, 0.08, 1.2, '#C9CED6')
  const spray = sphere(g, px, 1.42, pz, 0.2, mat('#BFE3FF', { emissive: '#7FC4FF', emissiveIntensity: 0.4, opacity: 0.75 }))
  spray.castShadow = false
  animated.push((t) => {
    spray.scale.y = 0.4 * (1 + 0.15 * Math.sin(t * 5))
    water.emissiveIntensity = 0.22 + 0.06 * Math.sin(t * 2.4)
  })

  // Jarvis's own plaza + portal
  cyl(g, jx, jz, jp.plazaRadius, 0.06, 0.03, layout.plaza.color)
  torus(g, jx, 0.1, jz, jp.plazaRadius, 0.06, layout.plaza.ring)
  const portal = new THREE.Group()
  cyl(portal, jx, jz, jp.radius * 0.8, jp.pedestalHeight, 0.06, '#2B3646')
  const coreMat = new THREE.MeshStandardMaterial({ color: jp.colors.core, emissive: jp.colors.core, emissiveIntensity: 0.8, roughness: 0.4 })
  sphere(portal, jx, 1.4, jz, 0.45, coreMat)
  const ring = torus(portal, jx, 1.4, jz, jp.radius * 0.7, 0.06, mat(jp.colors.ring, { emissive: jp.colors.ring, emissiveIntensity: 0.9 }))
  const beam = cyl(portal, jx, jz, 0.25, jp.beamHeight, 0.36, mat(jp.colors.core, { emissive: jp.colors.core, emissiveIntensity: 0.6, opacity: 0.25 }))
  beam.castShadow = false
  pickable(portal, { kind: 'route', to: jp.route })
  g.add(portal)
  animated.push((t) => {
    ring.rotation.z = t * (input.jarvisBusy ? 1.6 : 0.4)
    ring.position.y = 1.4 + Math.sin(t * 1.5) * 0.08
    coreMat.emissiveIntensity = input.jarvisBusy ? 0.8 + Math.sin(t * 6) * 0.4 : 0.8
  })
  labels.add(g, jp.label.anchor, { title: jp.label.title, sub: `Main assistant · ${input.jarvisState}`, dot: input.jarvisBusy ? 'bg-status-working' : 'bg-accent', accent: true, onClick: () => input.go(jp.route) })

  // buildings
  const { placed, free: slot } = place(input.buildings)
  const built = placed.map((b, i) => building(g, labels, b, input.go, i * 1.9))
  animated.push((t) => {
    for (const b of built) {
      b.glass.forEach((m, f) => (m.emissiveIntensity = 0.75 + 0.2 * Math.sin(t * 2.3 + b.phase + f * 1.7) - (Math.sin(t * 9 + b.phase * 3 + f) > 0.97 ? 0.45 : 0)))
      b.beacon.emissiveIntensity = Math.sin(t * 3 + b.phase) > 0.6 ? 1.6 : 0.3
    }
  })

  // the first free slot is the "new workspace" lot, while the campus has room
  const free = input.buildings.length < layout.maxWorkspaces ? slot : undefined
  if (free) {
    const lot = new THREE.Group()
    const lotMat = new THREE.MeshStandardMaterial({ color: layout.newWorkspaceLot.ground, emissive: layout.newWorkspaceLot.glow, emissiveIntensity: 0.1, roughness: 0.9 })
    plotBox(lot, free, 0.03, 0.003, lotMat)
    const pts = [
      [free[0], free[1]], [free[0] + free[2], free[1]], [free[0] + free[2], free[1] + free[3]], [free[0], free[1] + free[3]], [free[0], free[1]]
    ].map(([x, z]) => new THREE.Vector3(x, 0.05, z))
    const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#EEF1FF', dashSize: 0.3, gapSize: 0.2 }))
    outline.computeLineDistances()
    lot.add(outline)
    // corner stakes so the plot reads as "ready to build"
    for (const v of pts.slice(0, 4)) cyl(lot, v.x, v.z, 0.05, 0.5, 0, '#E0A33A')
    pickable(lot, { kind: 'route', to: layout.newWorkspaceLot.button.route })
    g.add(lot)
    animated.push((t) => (lotMat.emissiveIntensity = 0.06 + 0.16 * (0.5 + 0.5 * Math.sin(t * 2.2))))
    const left = layout.maxWorkspaces - input.buildings.length
    labels.add(g, [free[0] + free[2] / 2, 0.2, free[1] + free[3] / 2], { kind: 'cta', title: `${layout.newWorkspaceLot.button.label} · ${left} plot${left === 1 ? '' : 's'} left`, onClick: () => input.go(layout.newWorkspaceLot.button.route) }, 'center')
  }

  // props
  const onPlot = (x: number, z: number) =>
    placed.some((b) => x >= b.plot.x && x <= b.plot.x + b.plot.w && z >= b.plot.z && z <= b.plot.z + b.plot.d) ||
    (free && x >= free[0] && x <= free[0] + free[2] && z >= free[1] && z <= free[1] + free[3])
  for (const p of layout.props) {
    const pr = p as typeof p & { plots?: number[][]; positions?: number[][]; height?: number }
    if (p.model === 'hedge.glb') pr.plots!.forEach((pl) => plotBox(g, pl, pr.height ?? 0.45, 0, '#3E8A4A'))
    if (p.model === 'flower_bed.glb')
      pr.plots!.forEach((pl) => {
        plotBox(g, pl, 0.2, 0, '#6B4E36')
        sphere(g, pl[0] + pl[2] / 2, 0.3, pl[1] + pl[3] / 2, pl[2] * 0.35, '#E07AA0', 0.5)
      })
    if (p.model === 'tree_round.glb') pr.positions!.filter(([x, z]) => !onPlot(x, z)).forEach(([x, z]) => tree(g, x, z, pr.height ?? 2.2))
    if (p.model === 'street_lamp.glb')
      pr.positions!.forEach(([x, z]) => {
        cyl(g, x, z, 0.05, pr.height ?? 2.6, 0, '#3A414C')
        sphere(g, x, (pr.height ?? 2.6) + 0.1, z, 0.16, mat('#FFE7A3', { emissive: '#FFE7A3', emissiveIntensity: 1 }))
      })
    if (p.model === 'bench.glb')
      pr.positions!.forEach(([x, z]) => {
        box(g, x, z, 1.4, 0.45, 0.08, 0.4, '#B48A5C')
        box(g, x, z - 0.2, 1.4, 0.06, 0.4, 0.45, '#957049')
        box(g, x - 0.55, z, 0.08, 0.4, 0.4, 0, '#3A414C')
        box(g, x + 0.55, z, 0.08, 0.4, 0.4, 0, '#3A414C')
      })
  }

  // parking strips with painted bays and a parked car or two
  const wheelGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.1, 14).rotateZ(Math.PI / 2)
  for (const pk of layout.parking) {
    const [x, z, w, d] = pk.plot
    plotBox(g, pk.plot, 0.03, 0.002, layout.roads[0].paving[1])
    const bay = w / pk.bays
    for (let i = 0; i <= pk.bays; i++) paint(g, x + i * bay, z + d / 2, 0.06, d * 0.85, 0.033)
    for (const c of pk.parked) car(g, c.color, wheelGeo).group.position.set(x + (c.bay + 0.5) * bay, 0.032, z + d / 2)
  }

  // traffic: loops on both roads, around the roundabout, U-turns at the turnarounds and around Jarvis
  const lane = layout.traffic.lanes.offset
  const rr = layout.traffic.lanes.roundaboutRadius
  const rx = layout.roads.find((r) => r.id === 'road-x')!.plot
  const rz = layout.roads.find((r) => r.id === 'road-z')!.plot
  const tracks = {
    x: new Track(roadLoop(ends[0][0], ends[1][0], rx[1] + rx[3] / 2, px, rr.x, lane)),
    // same loop with axes swapped; reversed so cars still keep right
    z: new Track(roadLoop(ends[2][1], jz, rz[0] + rz[2] / 2, pz, rr.z, lane, [lane, layout.traffic.lanes.jarvisRadius]).map(([a, c]): P => [c, a]).reverse())
  }
  const raised = (x: number, z: number) =>
    Math.hypot(x - px, z - pz) < layout.plaza.radius || Math.hypot(x - jx, z - jz) < jp.plazaRadius || ends.some(([ex, ez]) => Math.hypot(x - ex, z - ez) < turnR)
  const traffic = layout.traffic.cars.map((c) => ({ ...c, track: tracks[c.track as 'x' | 'z'], ...car(g, c.color, wheelGeo) }))
  animated.push((t) => {
    for (const c of traffic) {
      const s = c.offset * c.track.length + t * c.speed
      const [x, z] = c.track.at(s)
      const [ax, az] = c.track.at(s - 0.35)
      const [bx, bz] = c.track.at(s + 0.35)
      c.group.position.set(x, raised(x, z) ? 0.09 : 0.042, z)
      c.group.rotation.y = Math.atan2(bx - ax, bz - az)
      for (const wh of c.wheels) wh.rotation.x = s / 0.14
    }
  })

  return {
    group: g,
    bounds: { minX: 0, maxX: W, minZ: 0, maxZ: D },
    home: layout.camera.target,
    zoom: layout.camera.zoom,
    animate: (t) => {
      animated.forEach((f) => f(t))
      // traffic never parks, so the lobby always renders
      return true
    },
    hover: (pick: Pick | undefined) => {
      for (const b of built) {
        const on = pick?.kind === 'workspace' && pick.id === b.id
        b.roof.emissiveIntensity = on ? 0.35 : 0
        b.body.position.y = on ? 0.06 : 0
        b.label.highlight = on
      }
    },
    dispose: () => {
      labels.dispose()
      disposeTree(g)
    }
  }
}
