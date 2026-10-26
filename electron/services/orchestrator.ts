/**
 * One orchestrator per workspace: plans missions with its model, turns steps
 * into tasks, and starts tasks as their dependencies finish.
 */
import type { Mission, Orchestrator } from '@shared/types'
import type { AnyAgent, StoredTask } from '@shared/app-types'
import { commit, db, findAgent, findWorkspace, log, nextMissionId, nextTaskId, now } from './db'
import { toast } from './bus'
import { askJson } from './claude'
import { accountFor, recordUsage } from './accounts'
import { createApproval, handleApproval, completeTask } from './approvals'
import { isRunning, runningCount, setOnTaskFinished, startTask } from './runner'
import { cleanStepDeps } from './graph'
import { mkdirSync } from 'node:fs'
import { app } from 'electron'
import { join } from 'node:path'

export type StoredMission = Mission & { schedule?: string; prompt?: string }

const isQa = (a?: AnyAgent): boolean => !!a && /\b(qa|test|review)/i.test(a.role)

function orchestratorOf(workspaceId: string): Orchestrator | undefined {
  const ws = findWorkspace(workspaceId)
  return ws?.orchestratorId ? (findAgent(ws.orchestratorId) as Orchestrator) : undefined
}

function team(workspaceId: string): AnyAgent[] {
  return db().agents.filter((a) => a.workspaceId === workspaceId && a.kind === 'agent')
}

const planSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          assignee: { type: 'string', description: 'agent name from the team list' },
          details: { type: 'string' },
          criteria: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'integer' }, description: '0-based indexes of earlier steps' },
          gate: { type: 'boolean', description: 'true when this step sends, publishes or merges and must wait for the user' }
        },
        required: ['title', 'assignee']
      }
    }
  },
  required: ['title', 'steps']
}

interface PlanOut {
  title: string
  steps: { title: string; assignee: string; details?: string; criteria?: string[]; dependsOn?: number[]; gate?: boolean }[]
}

function scratchDir(): string {
  const d = join(app.getPath('userData'), 'scratch')
  mkdirSync(d, { recursive: true })
  return d
}

export async function planMission(workspaceId: string, prompt: string, source: Mission['source']): Promise<StoredMission> {
  const ws = findWorkspace(workspaceId)
  if (!ws) throw new Error('Workspace not found')
  const orch = orchestratorOf(workspaceId)
  if (!orch) throw new Error(`${ws.name} has no orchestrator yet`)
  const members = team(workspaceId)
  if (!members.length) throw new Error(`${ws.name} has no agents`)
  const pick = accountFor(orch)
  if ('blocked' in pick) throw new Error(pick.blocked)

  log(workspaceId, `Planning mission: “${prompt.slice(0, 120)}”`, 'orchestrator')
  orch.status = 'working'
  commit('agents')
  const rules = orch.routingRules
    .map((r) => `- "${r.match}" → ${r.assigneeIds.map((i) => findAgent(i)?.name).join(', ')}${r.then ? ` (then: ${r.then})` : ''}`)
    .join('\n')
  try {
    const { value, tokens } = await askJson<PlanOut>({
      cwd: scratchDir(),
      model: orch.model,
      account: pick.account,
      thinking: orch.thinking,
      systemPrompt: `You are ${orch.name}, the orchestrator of workspace "${ws.name}". ${orch.instructions}`,
      prompt: [
        `Workspace goal: ${ws.goal}`,
        `Team:\n${members.map((a) => `- ${a.name}: ${a.role} (${a.model})`).join('\n')}`,
        rules ? `Routing rules:\n${rules}` : '',
        `Break this mission into ${db().jarvis.limits.maxPlanTasks} or fewer concrete steps, each for one agent. Add a QA step after code changes when a QA agent exists. Mark steps that send, publish or merge as gate.`,
        `Mission: ${prompt}`
      ]
        .filter(Boolean)
        .join('\n\n'),
      schema: planSchema,
      timeoutMs: 5 * 60_000
    })
    recordUsage(pick.account.id, workspaceId, tokens)
    const m = buildMission(workspaceId, value, source, prompt)
    log(workspaceId, `Mission ${m.id} planned: ${m.steps.length} steps.`, 'orchestrator')
    autoStart(m, orch)
    return m
  } finally {
    orch.status = runningCount(workspaceId) ? 'working' : 'idle'
    commit('agents')
  }
}

export function buildMission(workspaceId: string, plan: PlanOut, source: Mission['source'], prompt?: string): StoredMission {
  const members = db().agents.filter((a) => a.workspaceId === workspaceId)
  const orch = orchestratorOf(workspaceId)
  const byName = (n: string): AnyAgent | undefined =>
    members.find((a) => a.name.toLowerCase() === n.trim().toLowerCase()) ?? members.find((a) => n.toLowerCase().includes(a.name.toLowerCase()))
  const { steps, problems } = cleanStepDeps(plan.steps)
  for (const p of problems) log(workspaceId, `Plan “${plan.title}”: ${p}.`, 'bad')
  const m: StoredMission = {
    id: nextMissionId(),
    title: plan.title,
    source,
    workspaceId,
    prompt,
    status: 'draft',
    steps: steps.map((s) => {
      const a = byName(s.assignee) ?? orch ?? members[0]
      return {
        title: s.title,
        assigneeId: a?.id ?? 'jarvis',
        model: a?.model ?? 'Sonnet 5.5',
        gate: !!s.gate,
        dependsOn: (s.dependsOn ?? []).map(String),
        // keep details for task creation
        ...({ details: s.details, criteria: s.criteria } as object)
      }
    }),
    estUsagePct: Math.max(1, Math.round(steps.length * 1.2))
  }
  db().missions.push(m)
  commit('missions')
  return m
}

function autoStart(m: StoredMission, orch: Orchestrator): void {
  const small = m.steps.length <= db().jarvis.limits.maxPlanTasks
  const go = !db().paused.includes(m.workspaceId) && (orch.autonomy === 'autopilot' || (orch.autonomy === 'run_small_plans' && small))
  if (go) approveMission(m.id)
  else requestPlanApproval(m)
}

export function requestPlanApproval(m: StoredMission): void {
  m.status = 'awaiting_approval'
  const ws = findWorkspace(m.workspaceId)
  createApproval({
    kind: 'plan',
    title: `Approve plan: ${m.title}`,
    requestedBy: m.source === 'jarvis' ? 'jarvis' : (ws?.orchestratorId ?? 'jarvis'),
    workspaceId: m.workspaceId,
    taskId: m.id,
    via: m.source === 'jarvis' ? 'Jarvis' : 'Orchestrator',
    policy: 'Plans ask you',
    fields: [
      { label: 'Steps', value: `${m.steps.length} tasks` },
      { label: 'Est. use', value: `≈ ${m.estUsagePct ?? 1}% of account` }
    ],
    body: m.steps.map((s, i) => `${i + 1}. ${s.title} — ${findAgent(s.assigneeId)?.name ?? s.assigneeId}${s.gate ? ' (approval)' : ''}`).join('\n')
  })
  commit('missions')
}

/** Approve a mission: create its tasks and start what can start. */
export function approveMission(id: string): void {
  const m = db().missions.find((x) => x.id === id) as StoredMission | undefined
  if (!m) throw new Error('Mission not found')
  if (m.status === 'running') return
  const ids: string[] = []
  m.steps.forEach((s, i) => {
    if (s.taskId && db().tasks.some((t) => t.id === s.taskId)) {
      ids[i] = s.taskId
      return
    }
    const extra = s as typeof s & { details?: string; criteria?: string[] }
    const task: StoredTask = {
      id: nextTaskId(),
      missionId: m.id,
      workspaceId: m.workspaceId,
      title: s.title,
      assigneeId: s.assigneeId,
      status: 'todo',
      priority: 'medium',
      dependsOn: [],
      criteria: (extra.criteria ?? []).map((text) => ({ text, done: false })),
      description: extra.details,
      createdAt: now(),
      createdBy: findWorkspace(m.workspaceId)?.orchestratorId ?? 'jarvis'
    }
    ids[i] = task.id
    s.taskId = task.id
    db().tasks.push(task)
  })
  // dependsOn arrives as step indexes from plans, or task ids from seeded missions
  m.steps.forEach((s, i) => {
    const t = db().tasks.find((x) => x.id === ids[i])!
    t.dependsOn = (s.dependsOn ?? [])
      .map((d) => (/^\d+$/.test(d) ? ids[Number(d)] : d))
      .filter((d) => d && d !== t.id && db().tasks.some((x) => x.id === d))
    s.dependsOn = t.dependsOn
  })
  m.status = 'running'
  log(m.workspaceId, `Mission ${m.id} started: ${m.steps.length} tasks.`, 'orchestrator')
  commit('missions', 'tasks')
  schedule()
}

handleApproval(
  'plan',
  async (a) => {
    if (a.taskId) approveMission(a.taskId)
  },
  async (a) => {
    const m = db().missions.find((x) => x.id === a.taskId)
    if (m) m.status = 'failed'
    commit('missions')
  }
)

const depDone = (id: string): boolean => {
  const t = db().tasks.find((x) => x.id === id)
  return !t || t.status === 'done' || t.status === 'review'
}

/** Start every mission task whose dependencies are satisfied, within limits. */
export function schedule(): void {
  for (const ws of db().workspaces) {
    if (db().paused.includes(ws.id)) continue
    const orch = orchestratorOf(ws.id)
    const limit = orch?.parallelLimit ?? 2
    const ready = db().tasks.filter(
      (t) => t.workspaceId === ws.id && t.missionId && t.status === 'todo' && !isRunning(t.id) && t.dependsOn.every(depDone)
    )
    for (const t of ready) {
      const m = db().missions.find((x) => x.id === t.missionId)
      if (!m || m.status !== 'running') continue
      const step = m.steps.find((s) => s.taskId === t.id)
      if (step?.gate) {
        openGate(t, m)
        continue
      }
      if (runningCount(ws.id) >= limit) break
      const agent = findAgent(t.assigneeId)
      if (!agent || agent.status === 'working') continue
      if (isQa(agent) && !t.qaOf) {
        const dep = t.dependsOn.map((d) => db().tasks.find((x) => x.id === d)).find((d) => d?.branch)
        if (dep?.branch) t.qaOf = dep.branch
      }
      log(ws.id, `Assigned ${t.id} → ${agent.name}.`)
      startTask(t.id).catch((e) => toast(`${t.id}: ${(e as Error).message}`, 'bad'))
    }
  }
}

/** A gate step waits for the user: merge open branches of the mission, or approve its result. */
function openGate(t: StoredTask, m: Mission): void {
  t.status = 'review'
  t.note = 'Waiting for your approval'
  const branches = db()
    .tasks.filter((x) => x.missionId === m.id && x.branch && !x.qaOf)
    .map((x) => db().changes.find((c) => c.branch === x.branch && c.state === 'open'))
    .filter(Boolean)
  if (branches.length && /merge/i.test(t.title)) {
    for (const c of branches) {
      createApproval({
        kind: 'merge',
        title: `Merge ${c!.branch}`,
        requestedBy: t.assigneeId,
        workspaceId: m.workspaceId,
        taskId: c!.taskId,
        via: 'Git',
        policy: 'Merging asks you',
        fields: [
          { label: 'Branch', value: `${c!.branch} → ${findWorkspace(m.workspaceId)?.git.baseBranch}` },
          { label: 'QA', value: c!.qa }
        ],
        body: `${c!.commits} commit(s) · +${c!.additions} −${c!.deletions}\n\nMission ${m.id} · ${m.title}`
      })
    }
    completeTask(t.id)
  } else {
    const reports = db()
      .tasks.filter((x) => x.missionId === m.id && x.id !== t.id)
      .map((x) => [...db().runs].reverse().find((r) => r.taskId === x.id)?.report)
      .filter(Boolean)
    createApproval({
      kind: 'publish',
      title: t.title,
      requestedBy: t.assigneeId,
      workspaceId: m.workspaceId,
      taskId: t.id,
      via: 'Orchestrator',
      policy: 'Gate steps ask you',
      fields: [{ label: 'Mission', value: `${m.id} · ${m.title}` }],
      body: (reports.at(-1) ?? 'No report yet.').slice(0, 4000)
    })
  }
  commit('tasks')
}

function closeMissions(): void {
  for (const m of db().missions) {
    if (m.status !== 'running') continue
    const ts = db().tasks.filter((t) => t.missionId === m.id)
    if (ts.length && ts.every((t) => t.status === 'done')) {
      m.status = 'done'
      log(m.workspaceId, `Mission ${m.id} done.`, 'good')
    }
  }
  commit('missions')
}

setOnTaskFinished(() => {
  closeMissions()
  schedule()
})

const steerSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    removeTaskIds: { type: 'array', items: { type: 'string' } },
    newMission: { type: 'string', description: 'set when the user asks for new work; a one-line mission prompt' }
  },
  required: ['reply']
}

/** Chat with the orchestrator from the console: it can drop tasks or start a mission. */
export async function message(workspaceId: string, text: string): Promise<void> {
  const orch = orchestratorOf(workspaceId)
  if (!orch) throw new Error('No orchestrator')
  log(workspaceId, text, 'user')
  const pick = accountFor(orch)
  if ('blocked' in pick) throw new Error(pick.blocked)
  const open = db().tasks.filter((t) => t.workspaceId === workspaceId && t.status !== 'done')
  const { value, tokens } = await askJson<{ reply: string; removeTaskIds?: string[]; newMission?: string }>({
    cwd: scratchDir(),
    model: orch.model,
    account: pick.account,
    systemPrompt: `You are ${orch.name}, orchestrator of ${findWorkspace(workspaceId)?.name}. Answer briefly.`,
    prompt: `Open tasks:\n${open.map((t) => `${t.id} [${t.status}] ${t.title} — ${findAgent(t.assigneeId)?.name}`).join('\n') || '(none)'}\n\nUser: ${text}`,
    schema: steerSchema,
    timeoutMs: 3 * 60_000
  })
  recordUsage(pick.account.id, workspaceId, tokens)
  for (const id of value.removeTaskIds ?? []) {
    const t = db().tasks.find((x) => x.id === id && x.workspaceId === workspaceId)
    if (t && !isRunning(t.id) && t.status !== 'done') {
      db().tasks.splice(db().tasks.indexOf(t), 1)
      db().tasks.forEach((x) => (x.dependsOn = x.dependsOn.filter((d) => d !== id)))
    }
  }
  log(workspaceId, value.reply, 'orchestrator')
  commit('tasks')
  if (value.newMission) await planMission(workspaceId, value.newMission, 'user')
  else schedule()
}

export function setPaused(workspaceId: string, paused: boolean): void {
  const p = new Set(db().paused)
  if (paused) p.add(workspaceId)
  else p.delete(workspaceId)
  db().paused = [...p]
  log(workspaceId, paused ? 'Orchestrator paused by you.' : 'Orchestrator resumed.', paused ? 'bad' : 'good')
  commit('workspaces')
  if (!paused) schedule()
}

export function isPaused(workspaceId: string): boolean {
  return db().paused.includes(workspaceId)
}
