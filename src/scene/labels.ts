import { createApp, h, reactive, type App } from 'vue'
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import WorldLabel from './WorldLabel.vue'

export type LabelProps = InstanceType<typeof WorldLabel>['$props']

/** Owns the Vue apps mounted into CSS2DObjects for one world. */
export class Labels {
  private apps: App[] = []
  private els: HTMLElement[] = []

  add(parent: THREE.Object3D, pos: number[], props: LabelProps, anchor: 'bottom' | 'center' = 'bottom'): LabelProps {
    const el = document.createElement('div')
    el.style.pointerEvents = 'none'
    const state = reactive({ ...props }) as LabelProps
    const app = createApp({ render: () => h(WorldLabel, state) })
    app.mount(el)
    this.apps.push(app)
    this.els.push(el)
    const obj = new CSS2DObject(el)
    obj.position.set(pos[0], pos[1], pos[2])
    // anchor the label's bottom edge on the point, like a pin
    obj.center.set(0.5, anchor === 'bottom' ? 1 : 0.5)
    parent.add(obj)
    return state
  }

  dispose(): void {
    this.apps.forEach((a) => a.unmount())
    // removing a parent group does not fire 'removed' on child CSS2DObjects
    this.els.forEach((e) => e.remove())
    this.apps = []
    this.els = []
  }
}
