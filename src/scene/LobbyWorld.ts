/** Campus world (board C1) built from lobby-layout.json + the workspaces store. */
import * as THREE from 'three'
import layout from './layouts/lobby-layout.json'
import { box, checker, cyl, disposeTree, mat, pickable, plotBox, shade, sphere, torus } from './build'
import { Labels } from './labels'
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

const BASE_SLOTS = layout.workspaceSlots.map((s) => s.plot)

function building(g: THREE.Group, labels: Labels, b: LobbyBuilding, go: (to: string) => void): void {
  const { x, z, w, d } = b.plot
  const cx = x + w / 2
  const cz = z + d / 2
  // single-storey office: entrance + one window band, whatever the team size
  const height = 2.6
  const bw = w - 1
  const bd = d - 1
  const lit = b.working > 0
  const bg = new THREE.Group()
  // plot paving + lawn edge
  box(bg, cx, cz, w, d, 0.05, 0, '#B4B9C0')
  box(bg, cx, cz, bw, bd, height, 0.05, '#DCE0E6')
  // window band on the two camera-facing faces (+z, +x), above the entrance awning
  const glass = lit ? mat('#FFE7A3', { emissive: '#FFD873', emissiveIntensity: 0.9 }) : mat('#3B4A60', { roughness: 0.3 })
  box(bg, cx, cz + bd / 2 + 0.02, bw - 0.6, 0.04, 0.5, 1.45, glass)
  box(bg, cx + bw / 2 + 0.02, cz, 0.04, bd - 0.6, 0.5, 1.45, glass)
  // roof slab + parapet in the workspace colour
  box(bg, cx, cz, bw + 0.3, bd + 0.3, 0.3, height + 0.05, b.roof)
  box(bg, cx, cz, bw - 0.4, bd - 0.4, 0.12, height + 0.35, shade(b.roof, 0.8))
  // entrance: glass doors + awning, centred on +z
  box(bg, cx, cz + bd / 2 + 0.03, 1.2, 0.06, 1.1, 0.05, mat('#9FC3E8', { emissive: '#4A7FE0', emissiveIntensity: 0.25 }))
  box(bg, cx, cz + bd / 2 + 0.35, 1.8, 0.7, 0.12, 1.25, b.roof)
  pickable(bg, { kind: 'workspace', id: b.id })
  g.add(bg)
  labels.add(g, [cx, height + 1.2, cz], {
    title: b.name,
    sub: b.setupNeeded ? 'Setup needed · no orchestrator' : `${b.agents} agents · ${b.working} working`,
    dot: b.setupNeeded ? 'bg-status-review' : lit ? 'bg-status-working' : 'bg-status-idle',
    badge: b.setupNeeded ? '!' : undefined,
    onClick: () => go(`/w/${b.id}`)
  })
}

function tree(g: THREE.Group, x: number, z: number, h: number): void {
  cyl(g, x, z, 0.12, h * 0.4, 0, '#6B4E36')
  sphere(g, x, h * 0.62, z, h * 0.3, '#3FA06E')
  sphere(g, x + 0.15, h * 0.8, z - 0.1, h * 0.2, '#45B87A')
}

export function buildLobby(input: LobbyInput): World {
  const g = new THREE.Group()
  const labels = new Labels()
  const animated: ((t: number) => void)[] = []

  // campus grows in 20-tile blocks along +x as workspaces fill the slots
  const maxX = Math.max(20, ...input.buildings.map((b) => b.plot.x + b.plot.w))
  const blocks = Math.ceil(maxX / 20)
  const W = blocks * 20
  const D = layout.ground.size[1]
  box(g, W / 2, D / 2, W, D, layout.ground.slabThickness, -layout.ground.slabThickness, layout.ground.soil[0])
  checker(g, W, D, layout.ground.grass, 0.001)

  for (let k = 0; k < blocks; k++) {
    for (const r of layout.roads) {
      const [x, z, w, d] = r.plot
      const p = r.id === 'road-x' ? [0, z, W, d] : [x + k * 20, z, w, d]
      if (r.id === 'road-x' && k > 0) continue
      plotBox(g, p, 0.04, 0.002, r.paving[0])
      // curbs along the long sides
      if (r.id === 'road-x') {
        plotBox(g, [p[0], p[1] - 0.1, p[2], 0.1], 0.08, 0, r.curb)
        plotBox(g, [p[0], p[1] + p[3], p[2], 0.1], 0.08, 0, r.curb)
      } else {
        plotBox(g, [p[0] - 0.1, p[1], 0.1, p[3]], 0.08, 0, r.curb)
        plotBox(g, [p[0] + p[2], p[1], 0.1, p[3]], 0.08, 0, r.curb)
      }
    }
  }

  // plaza + Jarvis portal
  const [px, pz] = layout.plaza.center
  cyl(g, px, pz, layout.plaza.radius, 0.06, 0.03, layout.plaza.color)
  torus(g, px, 0.1, pz, layout.plaza.radius, 0.06, layout.plaza.ring)
  const portal = new THREE.Group()
  const jp = layout.jarvisPortal
  cyl(portal, px, pz, jp.radius * 0.8, jp.pedestalHeight, 0.06, '#2B3646')
  const coreMat = new THREE.MeshStandardMaterial({ color: jp.colors.core, emissive: jp.colors.core, emissiveIntensity: 0.8, roughness: 0.4 })
  sphere(portal, px, 1.4, pz, 0.45, coreMat)
  const ring = torus(portal, px, 1.4, pz, jp.radius * 0.7, 0.06, mat(jp.colors.ring, { emissive: jp.colors.ring, emissiveIntensity: 0.9 }))
  const beam = cyl(portal, px, pz, 0.25, jp.beamHeight, 0.36, mat(jp.colors.core, { emissive: jp.colors.core, emissiveIntensity: 0.6, opacity: 0.25 }))
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
  for (const b of input.buildings) building(g, labels, b, input.go)

  // first free slot becomes the "new workspace" lot
  const used = new Set(input.buildings.map((b) => `${b.plot.x},${b.plot.z}`))
  let free: number[] | undefined
  for (let k = 0; k <= blocks && !free; k++) free = BASE_SLOTS.map((s) => [s[0] + k * 20, s[1], s[2], s[3]]).find((s) => !used.has(`${s[0]},${s[1]}`))
  if (free && free[0] + free[2] <= W) {
    const lot = new THREE.Group()
    plotBox(lot, free, 0.03, 0.003, layout.newWorkspaceLot.ground)
    const pts = [
      [free[0], free[1]], [free[0] + free[2], free[1]], [free[0] + free[2], free[1] + free[3]], [free[0], free[1] + free[3]], [free[0], free[1]]
    ].map(([x, z]) => new THREE.Vector3(x, 0.05, z))
    const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#EEF1FF', dashSize: 0.3, gapSize: 0.2 }))
    outline.computeLineDistances()
    lot.add(outline)
    pickable(lot, { kind: 'route', to: '/workspaces/new' })
    g.add(lot)
    labels.add(g, [free[0] + free[2] / 2, 0.2, free[1] + free[3] / 2], { kind: 'cta', title: 'New workspace', onClick: () => input.go('/workspaces/new') }, 'center')
  }

  // props (first block only, as drawn on the board)
  const freeSlot = free ? `${free[0]},${free[1]}` : ''
  const onPlot = (x: number, z: number) =>
    input.buildings.some((b) => x >= b.plot.x && x <= b.plot.x + b.plot.w && z >= b.plot.z && z <= b.plot.z + b.plot.d) ||
    (freeSlot && free && x >= free[0] && x <= free[0] + free[2] && z >= free[1] && z <= free[1] + free[3])
  for (const p of layout.props) {
    const pr = p as typeof p & { plots?: number[][]; positions?: number[][]; instances?: { position: number[]; rotationY: number; color: string }[]; height?: number }
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
    if (p.model === 'car.glb')
      pr.instances!.forEach((c) => {
        const car = new THREE.Group()
        box(car, 0, 0, 0.9, 1.8, 0.45, 0.15, c.color)
        box(car, 0, -0.05, 0.8, 1.0, 0.35, 0.6, mat('#3B4A60', { roughness: 0.3 }))
        car.position.set(c.position[0], 0, c.position[1])
        car.rotation.y = THREE.MathUtils.degToRad(c.rotationY)
        g.add(car)
      })
  }

  const b = { minX: 0, maxX: W, minZ: 0, maxZ: D }
  return {
    group: g,
    bounds: b,
    home: layout.camera.target,
    zoom: layout.camera.zoom,
    animate: (t) => {
      animated.forEach((f) => f(t))
      return input.jarvisBusy
    },
    dispose: () => {
      labels.dispose()
      disposeTree(g)
    }
  }
}
