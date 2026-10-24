import type * as THREE from 'three'

/** One buildable world (Lobby or Office) mounted into the shared viewport. */
export interface World {
  group: THREE.Group
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  home: number[]
  zoom: { default: number; min: number; max: number }
  /** advance animations; return true while something keeps moving */
  animate: (t: number) => boolean
  dispose: () => void
}
