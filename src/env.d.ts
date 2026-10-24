/// <reference types="vite/client" />
import type { JarvisApi } from '@shared/app-types'

declare global {
  interface Window {
    jarvis: JarvisApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

export {}
