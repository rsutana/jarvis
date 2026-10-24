/**
 * Runs one task with its agent through the Claude Code CLI inside an isolated
 * git worktree, streams RunEvents to the UI, and turns the result into a Change.
 */
import { mkdirSync } from 'node:fs'
import type { RunEvent } from '@shared/types'
import type { AnyAgent, StoredTask } from '@shared/app-types'
import { commit, db, findAgent, findWorkspace, log, now, uid, type StoredRun } from './db'
import { emit, toast } from './bus'
import { spawnClaude, isAnthropicModel, type ClaudeEvent, type ClaudeHandle } from './claude'
import { accountFor, recordRateLimit, recordUsage } from './accounts'
import * as git from './git'
import { createApproval } from './approvals'

interface Live {
  run: StoredRun
  handle: ClaudeHandle
  cwd: string
  steer?: string
  stopped?: boolean
}
const live = new Map<string, Live>()
let onFinished: (task: StoredTask) => void = () => undefined

export function setOnTaskFinished(fn: (task: StoredTask) => void): void {
  onFinished = fn
}

export function isRunning(taskId: string): boolean {
  return [...live.values()].some((l) => l.run.taskId === taskId)
}
export function runningCount(workspaceId: string): number {
  return [...live.values()].filter((l) => db().tasks.find((t) => t.id === l.run.taskId)?.workspaceId === workspaceId).length
}

function setAgent(agent: AnyAgent, status: AnyAgent['status'], taskId?: string, progress?: number): void {
  agent.status = status
  agent.currentTaskId = taskId
  emit('agent:status', { agentId: agent.id, status, taskId, progress })
  commit('agents')
}

function push(run: StoredRun, ev: RunEvent): void {
  run.events.push(ev)
  if (run.events.length > 1500) run.events.splice(0, 300)
  emit('run:event', { runId: run.id, event: ev })
  commit('runs')
}

const READ_TOOLS = ['Read', 'Glob', 'Grep', 'LS']
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

function toolsFor(agent: AnyAgent, qa: boolean): { tools: string[]; edits: boolean } {
  const tools = [...READ_TOOLS, 'TodoWrite']
  const edits = !qa && agent.guardrails.fileAccess === 'read_write'
  if (edits) tools.push(...EDIT_TOOLS)
  const web = agent.integrations.some((i) => i.integrationId === 'web-search' && i.policy !== 'off')
  if (web) tools.push('WebSearch', 'WebFetch')
  return { tools, edits }
}

function short(p: unknown): string {
  const s = String(p ?? '')
  return s.length > 90 ? '…' + s.slice(-88) : s
}

function mapEvent(e: ClaudeEvent): RunEvent | null {
  const t = now()
  switch (e.type) {
    case 'text':
      return { t, kind: 'message', title: 'Message', text: e.text }
    case 'thinking':
      return { t, kind: 'thinking', title: 'Thinking…', text: e.text.slice(0, 600) }
    case 'tool': {
      const i = e.input as Record<string, string>
      if (e.name === 'Read') return { t, kind: 'read', title: `Read ${short(i.file_path)}`, code: i.file_path }
      if (e.name === 'Glob' || e.name === 'Grep') return { t, kind: 'read', title: `Searched ${short(i.pattern)}`, code: i.path ?? i.pattern }
      if (e.name === 'Write') return { t, kind: 'edit', title: `Wrote ${short(i.file_path)}`, code: '+ ' + i.file_path }
      if (EDIT_TOOLS.includes(e.name)) return { t, kind: 'edit', title: `Edited ${short(i.file_path ?? i.notebook_path)}`, code: '~ ' + (i.file_path ?? i.notebook_path) }
      if (e.name === 'Bash') return { t, kind: 'command', title: 'Ran command', code: '$ ' + i.command }
      if (e.name === 'WebSearch') return { t, kind: 'read', title: `Searched the web: ${short(i.query)}` }
      if (e.name === 'WebFetch') return { t, kind: 'read', title: `Read ${short(i.url)}` }
      if (e.name === 'TodoWrite') return null
      return { t, kind: 'command', title: `Used ${e.name}` }
    }
    case 'tool_result':
      return e.isError ? { t, kind: 'message', title: 'Tool error', text: e.text.slice(0, 800), level: 'warn' } : null
    default:
      return null
  }
}

function contextFor(task: StoredTask): string {
  const parts: string[] = []
  for (const dep of task.dependsOn) {
    const r = [...db().runs].reverse().find((x) => x.taskId === dep && x.report)
    if (r?.report) parts.push(`Report from ${dep}:\n${r.report.slice(0, 3000)}`)
  }
  return parts.join('\n\n')
}

function promptFor(task: StoredTask, agent: AnyAgent, branch: string, qaDiff?: string): string {
  const ws = findWorkspace(task.workspaceId)!
  const skills = db().skills.filter((s) => agent.skillIds.includes(s.id))
  const lines = [
    `Workspace: ${ws.name}. Goal: ${ws.goal}`,
    `Task ${task.id}: ${task.title}`,
    task.description ? `Details: ${task.description}` : '',
    task.criteria.length ? 'Acceptance criteria:\n' + task.criteria.map((c) => `- ${c.text}`).join('\n') : '',
    contextFor(task),
    qaDiff ? `You are reviewing branch ${branch}. Changed files:\n${qaDiff}\nReview the change against the task. End your reply with exactly "QA: PASS" or "QA: FAIL" on its own line, followed by the reasons.` : '',
    `You work in a git worktree on branch ${branch}. Stay inside this folder. Do not run git; the app commits your changes when you finish.`,
    'Never send, publish, delete or spend on external services yourself. If the task needs that, finish everything else and add a final block:',
    'REQUEST: <send_email|publish|delete|spend> | <short title>',
    '<the exact content to send or publish>',
    'Finish with a short report: what you changed, anything left open.'
  ]
  if (skills.length) lines.splice(1, 0, 'Skills:\n' + skills.map((s) => `- ${s.name}: ${s.instructions}`).join('\n'))
  return lines.filter(Boolean).join('\n\n')
}

function parseRequest(report: string): { kind: string; title: string; body: string } | null {
  const m = report.match(/REQUEST:\s*(send_email|publish|delete|spend)\s*\|\s*(.+)\n([\s\S]*)$/i)
  return m ? { kind: m[1].toLowerCase(), title: m[2].trim(), body: m[3].trim() } : null
}

function fail(task: StoredTask, agent: AnyAgent | undefined, note: string, workspaceId: string): void {
  task.status = 'blocked'
  task.note = note
  if (agent) setAgent(agent, 'blocked', task.id)
  log(workspaceId, `${task.id} blocked: ${note}`, 'bad')
  commit('tasks')
  toast(`${task.id}: ${note}`, 'bad')
}

export async function startTask(taskId: string, resumeRun?: StoredRun, steerText?: string): Promise<void> {
  const task = db().tasks.find((t) => t.id === taskId)
  if (!task) throw new Error('Task not found')
  if (!resumeRun && isRunning(taskId)) throw new Error(`${taskId} is already running`)
  const ws = findWorkspace(task.workspaceId)
  const agent = findAgent(task.assigneeId)
  if (!ws) throw new Error('Workspace not found')
  if (!agent) return fail(task, undefined, 'No agent assigned', task.workspaceId)
  if (!isAnthropicModel(agent.model)) return fail(task, agent, `${agent.model} needs the Codex runner, which is not available yet. Pick a Claude model.`, ws.id)

  const pick = accountFor(agent)
  if ('blocked' in pick) return fail(task, agent, pick.blocked, ws.id)

  const qa = !!task.qaOf
  const branch = task.qaOf ?? task.branch ?? git.branchName(ws, agent.name, task.id, task.title)
  let cwd: string
  try {
    cwd = await git.ensureWorktree(ws, branch)
  } catch (e) {
    return fail(task, agent, (e as Error).message, ws.id)
  }
  mkdirSync(cwd, { recursive: true })
  task.branch = qa ? task.branch : branch

  let qaDiff: string | undefined
  if (qa) {
    const s = await git.branchStats(ws, branch).catch(() => null)
    qaDiff = s?.files.map((f) => `${f.path} (+${f.additions} −${f.deletions})`).join('\n') || '(no file changes)'
  }

  const run: StoredRun =
    resumeRun ??
    ({ id: uid('run-'), taskId, agentId: agent.id, branch, startedAt: now(), tokens: 0, events: [], filesChanged: [], live: true, accountId: pick.account.id } as StoredRun)
  if (!resumeRun) {
    db().runs.push(run)
    const by = task.createdBy === 'user' ? 'you' : (findAgent(task.createdBy)?.name ?? task.createdBy)
    push(run, { t: now(), kind: 'received', title: `Received task from ${by}`, text: task.description ?? task.title })
  } else if (steerText) {
    push(run, { t: now(), kind: 'message', title: 'You steered the run', text: steerText })
  }
  run.live = true
  task.status = 'in_progress'
  task.note = 'Starting…'
  setAgent(agent, 'working', task.id, task.progress)
  commit('tasks', 'runs')

  const { tools, edits } = toolsFor(agent, qa)
  let toolCalls = 0
  const handle = spawnClaude(
    {
      prompt: resumeRun && steerText ? `The user steers you: ${steerText}\nContinue the task with this in mind.` : promptFor(task, agent, branch, qaDiff),
      cwd,
      model: agent.model,
      account: pick.account,
      thinking: agent.thinking,
      systemPrompt: `You are ${agent.name}, ${agent.role}. ${agent.instructions}`,
      tools,
      allowEdits: edits,
      resume: resumeRun?.sessionId,
      timeoutMs: agent.guardrails.maxRunMinutes * 60_000
    },
    (e) => {
      if (e.type === 'init') run.sessionId = e.sessionId
      if (e.type === 'usage') {
        run.tokens += e.tokens
        recordUsage(pick.account.id, ws.id, e.tokens)
      }
      if (e.type === 'rate_limit') recordRateLimit(pick.account.id, e.status, e.resetsAt)
      if (e.type === 'tool') toolCalls++
      const ev = mapEvent(e)
      if (ev) {
        push(run, ev)
        task.note = ev.title
        task.progress = Math.min(0.95, toolCalls / (toolCalls + 12))
        emit('agent:status', { agentId: agent.id, status: 'working', taskId: task.id, progress: task.progress })
        commit('tasks')
      }
    }
  )
  const entry: Live = { run, handle, cwd }
  live.set(run.id, entry)
  const res = await handle.done
  live.delete(run.id)

  if (entry.steer) return startTask(taskId, run, entry.steer)
  run.live = false
  run.endedAt = now()
  if (entry.stopped) {
    push(run, { t: now(), kind: 'message', title: 'Run stopped by you', level: 'warn' })
    task.status = 'todo'
    task.note = 'Stopped by you'
    setAgent(agent, 'idle')
    commit('tasks', 'runs')
    return
  }
  if (!res.ok) {
    push(run, { t: now(), kind: 'message', title: 'Run failed', text: res.text, level: 'error' })
    return fail(task, agent, res.text.split('\n')[0].slice(0, 160), ws.id)
  }
  run.report = res.text
  await finish(task, agent, run, cwd)
}

async function finish(task: StoredTask, agent: AnyAgent, run: StoredRun, cwd: string): Promise<void> {
  const ws = findWorkspace(task.workspaceId)!
  const report = run.report ?? ''
  task.progress = 1

  if (task.qaOf) {
    const change = db().changes.find((c) => c.workspaceId === ws.id && c.branch === task.qaOf)
    const pass = /QA:\s*PASS/i.test(report)
    if (change) {
      change.qa = pass ? 'passed' : 'failed'
      change.qaNote = report.replace(/[\s\S]*QA:\s*(PASS|FAIL)\s*/i, '').trim().slice(0, 600) || report.slice(-600)
    }
    log(ws.id, `${agent.name}: QA ${pass ? 'passed' : 'failed'} on ${task.qaOf}.`, pass ? 'good' : 'bad')
    task.status = 'done'
    task.doneAt = now()
    task.note = pass ? 'QA passed' : 'QA failed'
    setAgent(agent, 'idle')
    commit('tasks', 'changes', 'runs')
    if (pass && change && ws.git.mergePolicy === 'auto_with_revert') {
      const { mergeBranch } = await import('./changes')
      await mergeBranch(ws.id, change.branch).catch((e) => toast(String(e.message ?? e), 'bad'))
    }
    onFinished(task)
    return
  }

  let sha: string | null = null
  try {
    sha = await git.commitAll(cwd, `${task.id}: ${task.title}`)
  } catch (e) {
    push(run, { t: now(), kind: 'message', title: 'Commit failed', text: (e as Error).message, level: 'error' })
  }
  if (sha) push(run, { t: now(), kind: 'commit', title: `Committed ${sha.slice(0, 7)}`, text: `${task.id}: ${task.title}` })

  const stats = await git.branchStats(ws, run.branch).catch(() => null)
  run.filesChanged = stats?.files ?? []
  const request = parseRequest(report)

  if (stats && stats.commits > 0) {
    let change = db().changes.find((c) => c.workspaceId === ws.id && c.branch === run.branch)
    if (!change) {
      change = { workspaceId: ws.id, branch: run.branch, taskId: task.id, agentId: agent.id, commits: 0, additions: 0, deletions: 0, qa: 'pending', state: 'open', createdAt: now() }
      db().changes.push(change)
    }
    Object.assign(change, { commits: stats.commits, additions: stats.additions, deletions: stats.deletions, qa: 'pending' })
    task.status = 'review'
    task.note = `Branch ready · +${stats.additions} −${stats.deletions}`
    log(ws.id, `${agent.name} finished ${task.id}: ${stats.commits} commit(s) on ${run.branch}.`, 'good')
  } else {
    task.status = request ? 'review' : 'done'
    task.note = request ? 'Waiting for your approval' : 'No file changes · answer in report'
    if (!request) task.doneAt = now()
    log(ws.id, `${agent.name} finished ${task.id}${request ? ' and asked you to approve an action' : ''}.`, 'good')
  }

  if (request) {
    createApproval({
      kind: request.kind as 'publish',
      title: request.title,
      requestedBy: agent.id,
      workspaceId: ws.id,
      taskId: task.id,
      via: agent.integrations.length ? (db().integrations.find((i) => i.id === agent.integrations[0].integrationId)?.name ?? 'Agent') : 'Agent',
      policy: 'Ask before sending',
      fields: [{ label: 'Task', value: `${task.id} · ${task.title}` }],
      body: request.body
    })
  }
  setAgent(agent, task.status === 'review' ? 'review' : 'idle')
  commit('tasks', 'changes', 'runs')
  onFinished(task)
}

export function steer(runId: string, text: string): void {
  const l = live.get(runId)
  if (!l) throw new Error('Run is not active')
  if (!l.run.sessionId) throw new Error('Run has not started yet')
  l.steer = text
  l.handle.kill()
}

export function stop(runId: string): void {
  const l = live.get(runId)
  if (!l) throw new Error('Run is not active')
  l.stopped = true
  l.handle.kill()
}

export function stopAll(): void {
  for (const l of live.values()) {
    l.stopped = true
    l.handle.kill()
  }
}

/** After a restart, runs that were live can no longer report back. */
export function recoverInterrupted(): void {
  for (const r of db().runs) {
    if (!r.live) continue
    r.live = false
    r.endedAt = now()
    r.events.push({ t: now(), kind: 'message', title: 'Run interrupted (app closed)', level: 'warn' })
    const t = db().tasks.find((x) => x.id === r.taskId)
    if (t && t.status === 'in_progress') {
      t.status = 'todo'
      t.note = 'Interrupted · start again'
    }
    const a = findAgent(r.agentId)
    if (a && a.currentTaskId === r.taskId) {
      a.status = 'idle'
      a.currentTaskId = undefined
    }
  }
  commit('runs', 'tasks', 'agents')
}
