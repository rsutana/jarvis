import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles.css'
import App from './App.vue'
import { router } from './router'

// a file dropped outside a drop zone must not navigate the window to it
for (const ev of ['dragover', 'drop']) window.addEventListener(ev, (e) => e.preventDefault())

createApp(App).use(createPinia()).use(router).mount('#app')
