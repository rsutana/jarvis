<script setup lang="ts">
// Stroke icon set from the Hud board (C3).
const P = {
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z',
  chat: 'M4 5h16v11H9l-5 4z',
  ws: 'M3 21V9l6-4v16M9 21h12V11l-6-3M13 13h2M13 17h2',
  acct: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  agent: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  skill: 'M12 3l2 6 6 3-6 3-2 6-2-6-6-3 6-3z',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4',
  usage: 'M5 20V12M10 20V6M15 20v-9M20 20V4',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  back: 'M15 5l-7 7 7 7',
  home: 'M4 11l8-7 8 7v9H4z',
  orch: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z',
  tasks: 'M8 3h8v3H8zM6 5h12v16H6zM9 13l2 2 4-4',
  branch: 'M6 4v10M18 4a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM6 14a3 3 0 100 6 3 3 0 000-6zM18 9c0 5-12 2-12 5',
  pulse: 'M3 12h4l3-7 4 14 3-7h4',
  folder: 'M3 6h6l2 2h10v11H3z',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  send: 'M12 19V5M5 12l7-7 7 7',
  attach: 'M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 100 6 3 3 0 000-6z',
  stop: 'M6 6h12v12H6z',
  play: 'M7 4l13 8-13 8z'
} as const
export type IconName = keyof typeof P
defineProps<{ name: IconName; size?: number }>()
</script>

<template>
  <svg :width="size ?? 18" :height="size ?? 18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="P[name]" />
  </svg>
</template>
