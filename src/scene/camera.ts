import * as THREE from 'three'

/**
 * Isometric orthographic camera (README §5): yaw 45°, pitch −35.264°,
 * position = target + (d, d·tan(35.264°)·√2, d) = target + (d, d, d).
 */
export class IsoCamera {
  readonly camera: THREE.OrthographicCamera
  readonly target = new THREE.Vector3()
  private home = new THREE.Vector3()
  zoom = 1
  min = 0.6
  max = 1.8
  /** pixels per world unit at zoom 1; frames the whole campus or office beside a drawer */
  ppu = 36
  bounds = { minX: 0, maxX: 20, minZ: 0, maxZ: 20 }
  private w = 1
  private h = 1
  private shift = 0
  private shiftTarget = 0

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400)
  }

  setHome(target: number[], zoom = 1, min = 0.6, max = 1.8): void {
    this.home.set(target[0], target[1], target[2])
    this.min = min
    this.max = max
    this.zoom = zoom
    this.target.copy(this.home)
    this.apply()
  }

  recenter(): void {
    this.target.copy(this.home)
    this.zoom = 1
    this.apply()
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w)
    this.h = Math.max(1, h)
    this.apply()
  }

  /** Drawer shift in px: the scene slides left so it stays visible beside the drawer. */
  setShift(px: number, immediate = false): void {
    this.shiftTarget = px
    if (immediate) this.shift = px
    this.apply()
  }

  /** Returns true while the shift is still animating. */
  step(): boolean {
    if (Math.abs(this.shift - this.shiftTarget) < 0.5) {
      if (this.shift !== this.shiftTarget) {
        this.shift = this.shiftTarget
        this.apply()
      }
      return false
    }
    this.shift += (this.shiftTarget - this.shift) * 0.18
    this.apply()
    return true
  }

  zoomBy(f: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * f, this.min, this.max)
    this.apply()
  }

  /** Pan by a screen-space drag in px. */
  pan(dx: number, dy: number): void {
    const s = 1 / (this.ppu * this.zoom)
    const right = new THREE.Vector3(1, 0, -1).normalize()
    const down = new THREE.Vector3(1, 0, 1).normalize()
    // one screen px vertically covers 1/sin(pitch) ground units
    const k = 1 / Math.sin(THREE.MathUtils.degToRad(35.264))
    this.target.addScaledVector(right, -dx * s)
    this.target.addScaledVector(down, -dy * s * k)
    this.clamp()
    this.apply()
  }

  private clamp(): void {
    const b = this.bounds
    this.target.x = THREE.MathUtils.clamp(this.target.x, b.minX, b.maxX)
    this.target.z = THREE.MathUtils.clamp(this.target.z, b.minZ, b.maxZ)
  }

  private apply(): void {
    const c = this.camera
    const half = (v: number) => v / 2 / this.ppu
    c.left = -half(this.w)
    c.right = half(this.w)
    c.top = half(this.h)
    c.bottom = -half(this.h)
    c.zoom = this.zoom
    const d = 60
    c.position.set(this.target.x + d, this.target.y + d, this.target.z + d)
    c.lookAt(this.target)
    c.setViewOffset(this.w, this.h, this.shift, 0, this.w, this.h)
    c.updateProjectionMatrix()
  }
}
