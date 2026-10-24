import { clipboard, Notification } from 'electron'
import type { ApprovalRequest } from '@shared/types'
import { commit, db, findAgent, log, nextApprovalId, now } from './db'
import { emit, toast } from './bus'

type Handler = (a: ApprovalRequest, note?: string) => Promise<void>
const onApprove: Partial<Record<ApprovalRequest['kind'], Handler>> = {}
const onReject: Partial<Record<ApprovalRequest['kind'], Handler>> = {}

/** Services register what approving or rejecting each kind actually does. */
export function handleApproval(kind: ApprovalRequest['kind'], approve: Handler, reject?: Handler): void {
  onApprove[kind] = approve
  if (reject) onReject[kind] = reject
}

export function createApproval(a: Omit<ApprovalRequest, 'id' | 'state' | 'createdAt'>): ApprovalRequest {
  const dup = db().approvals.find((x) => x.state === 'pending' && x.kind === a.kind && x.taskId === a.taskId && x.title === a.title)
  if (dup) return dup
  const req: ApprovalRequest = { ...a, id: nextApprovalId(), state: 'pending', createdAt: now() }
  db().approvals.push(req)
  commit('approvals')
  emit('approval:new', req)
  if (a.workspaceId) log(a.workspaceId, `${who(a.requestedBy)} asked you: ${a.title}. Waiting in Inbox.`, 'info')
  if (Notification.isSupported()) new Notification({ title: 'Jarvis · needs you', body: a.title }).show()
  return req
}

function who(id: string): string {
  return id === 'jarvis' ? 'Jarvis' : (findAgent(id)?.name ?? id)
}

/** Kinds with no live connector yet: approving hands the content to the user. */
async function manualHandoff(a: ApprovalRequest): Promise<void> {
  clipboard.writeText(a.body)
  toast(`Approved. No live ${a.via} connector yet, so the content is on your clipboard.`, 'good')
  completeTask(a.taskId)
}

export function completeTask(taskId?: string): void {
  const t = taskId ? db().tasks.find((x) => x.id === taskId) : undefined
  if (!t) return
  t.status = 'done'
  t.doneAt = now()
  t.note = 'Approved by you'
  const ag = findAgent(t.assigneeId)
  if (ag && ag.currentTaskId === t.id) {
    ag.status = 'idle'
    ag.currentTaskId = undefined
  }
  commit('tasks', 'agents')
}

for (const k of ['send_email', 'publish', 'delete', 'spend', 'folder'] as const) handleApproval(k, manualHandoff)

export async function decide(id: string, decision: 'approve' | 'reject', note?: string, always?: boolean): Promise<void> {
  const a = db().approvals.find((x) => x.id === id)
  if (!a) throw new Error('Approval not found')
  if (a.state !== 'pending') throw new Error('Already decided')
  if (decision === 'approve') {
    await onApprove[a.kind]?.(a, note) // throws leave it pending so the user can retry
    a.state = 'approved'
    if (always) allowAlways(a)
    if (a.workspaceId) log(a.workspaceId, `You approved: ${a.title}.`, 'good')
  } else {
    a.state = 'rejected'
    await onReject[a.kind]?.(a, note)
    const t = a.taskId ? db().tasks.find((x) => x.id === a.taskId) : undefined
    if (t && !onReject[a.kind]) {
      t.status = 'todo'
      t.note = note ? `Sent back: ${note}` : 'Rejected by you'
      if (note) t.description = `${t.description ?? t.title}\n\nFeedback from the user: ${note}`
    }
    if (a.workspaceId) log(a.workspaceId, `You rejected: ${a.title}${note ? ` (“${note}”)` : ''}.`, 'bad')
  }
  commit('approvals', 'tasks')
}

/** "Always allow for <agent>": flip that agent's integration policy to allowed. */
function allowAlways(a: ApprovalRequest): void {
  const ag = findAgent(a.requestedBy)
  if (!ag) return
  const integ = db().integrations.find((i) => i.name === a.via)
  if (!integ) return
  const link = ag.integrations.find((i) => i.integrationId === integ.id)
  if (link) link.policy = 'allowed'
  commit('agents')
}

export function updateBody(id: string, body: string): void {
  const a = db().approvals.find((x) => x.id === id)
  if (!a || a.state !== 'pending') throw new Error('Approval not editable')
  a.body = body
  commit('approvals')
}
