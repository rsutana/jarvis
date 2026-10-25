import type { AgentStatus, TaskStatus } from '@shared/types'

// Full class strings so Tailwind can see them.
export const statusText: Record<AgentStatus | TaskStatus | 'done' | 'danger', string> = {
  working: 'text-status-working',
  in_progress: 'text-status-working',
  review: 'text-status-review',
  blocked: 'text-status-blocked',
  idle: 'text-status-idle',
  todo: 'text-ink-faint',
  done: 'text-status-done',
  danger: 'text-status-danger'
}
export const statusBg: Record<AgentStatus | TaskStatus | 'done' | 'danger', string> = {
  working: 'bg-status-working',
  in_progress: 'bg-status-working',
  review: 'bg-status-review',
  blocked: 'bg-status-blocked',
  idle: 'bg-status-idle',
  todo: 'bg-status-idle',
  done: 'bg-status-done',
  danger: 'bg-status-danger'
}
export const statusLabel: Record<AgentStatus, string> = {
  working: 'Working',
  review: 'Waiting for your review',
  blocked: 'Blocked',
  idle: 'Idle'
}
export const taskLabel: Record<TaskStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done'
}

export function timeShort(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  const y = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function ago(iso?: string): string {
  if (!iso) return ''
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  const d = Math.round(s / 86400)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

export function duration(from?: string, to?: string): string {
  if (!from) return ''
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
}

export function until(iso?: string): string {
  if (!iso) return ''
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000)
  if (s <= 0) return 'resetting'
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (h >= 48) return `resets in ${Math.round(h / 24)}d` // weekly windows
  return h ? `resets in ${h}h ${m}m` : `resets in ${m}m`
}

/** Tiny, safe markdown: **bold**, `code`, paragraphs and list lines. */
export function md(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n')
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
        const ordered = /^\s*\d+\./.test(lines[0])
        const items = lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')
        return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`
      }
      return `<p>${lines.map(inline).join('<br>')}</p>`
    })
    .join('')
}
function inline(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
}
