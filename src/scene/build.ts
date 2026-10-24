/**
 * Placeholder geometry helpers. Until GLB models exist (README §6) every
 * object is built from unit primitives scaled to the layout JSON `size` box,
 * which is the same look as the C1/C2 canvas boards.
 */
import * as THREE from 'three'

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0) // pivot at bottom centre
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24).translate(0, 0.5, 0)
const unitSphere = new THREE.SphereGeometry(0.5, 20, 14)
const unitCapsule = new THREE.CapsuleGeometry(0.5, 1, 6, 14)
const mats = new Map<string, THREE.Material>()

export interface MatOpts {
  emissive?: string
  emissiveIntensity?: number
  opacity?: number
  roughness?: number
}

/** Flat MeshStandardMaterial, cached by colour + options (shared, never disposed). */
export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(o)
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.roughness ?? 0.8,
      metalness: 0,
      emissive: o.emissive ?? '#000000',
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: o.opacity !== undefined,
      opacity: o.opacity ?? 1,
      depthWrite: o.opacity === undefined
    })
    mats.set(key, m)
  }
  return m
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, shadow = true): THREE.Mesh {
  const me = new THREE.Mesh(geo, m)
  me.castShadow = shadow
  me.receiveShadow = true
  return me
}

/** Box by footprint centre (x, z), size w×d×h, bottom at y. */
export function box(parent: THREE.Object3D, x: number, z: number, w: number, d: number, h: number, y: number, color: string | THREE.Material, rotY = 0): THREE.Mesh {
  const me = mesh(unitBox, typeof color === 'string' ? mat(color) : color)
  me.scale.set(w, h, d)
  me.position.set(x, y, z)
  me.rotation.y = THREE.MathUtils.degToRad(rotY)
  parent.add(me)
  return me
}

/** Box by min corner, matching layout JSON `plot` arrays. */
export function plotBox(parent: THREE.Object3D, p: number[], h: number, y: number, color: string | THREE.Material): THREE.Mesh {
  const [x, z, w, d] = p
  return box(parent, x + w / 2, z + d / 2, w, d, h, y, color)
}

export function cyl(parent: THREE.Object3D, x: number, z: number, r: number, h: number, y: number, color: string | THREE.Material): THREE.Mesh {
  const me = mesh(unitCyl, typeof color === 'string' ? mat(color) : color)
  me.scale.set(r * 2, h, r * 2)
  me.position.set(x, y, z)
  parent.add(me)
  return me
}

export function sphere(parent: THREE.Object3D, x: number, y: number, z: number, r: number, color: string | THREE.Material, sy = 1): THREE.Mesh {
  const me = mesh(unitSphere, typeof color === 'string' ? mat(color) : color)
  me.scale.set(r * 2, r * 2 * sy, r * 2)
  me.position.set(x, y, z)
  parent.add(me)
  return me
}

export function capsule(parent: THREE.Object3D, x: number, y: number, z: number, r: number, len: number, color: string | THREE.Material): THREE.Mesh {
  const me = mesh(unitCapsule, typeof color === 'string' ? mat(color) : color)
  me.scale.set(r * 2, (len + 2 * r) / 2, r * 2)
  me.position.set(x, y, z)
  parent.add(me)
  return me
}

export function torus(parent: THREE.Object3D, x: number, y: number, z: number, r: number, tube: number, color: string | THREE.Material): THREE.Mesh {
  const me = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 48), typeof color === 'string' ? mat(color) : color)
  me.rotation.x = Math.PI / 2
  me.position.set(x, y, z)
  parent.add(me)
  return me
}

/** Checkerboard floor as one InstancedMesh. */
export function checker(parent: THREE.Object3D, w: number, d: number, colors: string[], y = 0, x0 = 0, z0 = 0): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), w * d)
  const m = new THREE.Matrix4()
  const c = new THREE.Color()
  let i = 0
  for (let gx = 0; gx < w; gx++)
    for (let gz = 0; gz < d; gz++) {
      m.makeTranslation(x0 + gx + 0.5, y, z0 + gz + 0.5)
      im.setMatrixAt(i, m)
      im.setColorAt(i, c.set(colors[(gx + gz) % colors.length]))
      i++
    }
  im.receiveShadow = true
  parent.add(im)
  return im
}

/** Dispose per-world resources; shared unit geometries and cached materials stay. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const me = o as THREE.Mesh
    if (!me.geometry) return
    if (![unitBox, unitCyl, unitSphere, unitCapsule].includes(me.geometry as THREE.BoxGeometry)) me.geometry.dispose()
    const m = me.material as THREE.Material
    if (m && ![...mats.values()].includes(m)) m.dispose()
  })
}

/** Tag an object so a raycast hit can resolve what was clicked. */
export function pickable<T extends THREE.Object3D>(o: T, pick: Pick): T {
  o.traverse((c) => (c.userData.pick = pick))
  return o
}
export type Pick = { kind: 'agent'; id: string } | { kind: 'route'; to: string } | { kind: 'workspace'; id: string }

/** Shade a hex colour; used for building sides and props without their own palette. */
export function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex)
  c.multiplyScalar(f)
  return '#' + c.getHexString()
}
