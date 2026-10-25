import type * as THREE from 'three'
import type { Pick } from './build'

/** One buildable world (Lobby or Office) mounted into the shared viewport. */
export interface World {
  group: THREE.Group
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  home: number[]
  zoom: { default: number; min: number; max: number }
  /** advance animations; return true while something keeps moving */
  animate: (t: number) => boolean
  /** pointer is over `pick` (undefined: over nothing / left the canvas) */
  hover?: (pick: Pick | undefined) => void
  dispose: () => void
}
