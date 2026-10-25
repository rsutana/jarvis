import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import type { Agent, IpcInvoke, Orchestrator, Workspace } from '@shared/types'
import type { AnyAgent, NewWorkspaceInput, StoredAccount } from '@shared/app-types'
import { commit, db, findAgent, findTask, findWorkspace, nextTaskId, now, resetDb, snapshot, uid } from './services/db'
import * as git from './services/git'
import * as runner from './services/runner'
import * as approvals from './services/approvals'
import * as changes from './services/changes'
import * as orchestrator from './services/orchestrator'
import * as jarvis from './services/jarvis'
import * as automations from './services/automations'
import * as skills from './services/skills'
import { moveBack, publicAccount, refreshPlans, setApiKey, verifyKey } from './services/accounts'
import { toast } from './services/bus'
import { checkClaude } from './services/claude'

type Handlers = { [K in keyof IpcInvoke]: (...args: Parameters<IpcInvoke[K]>) => ReturnType<IpcInvoke[K]> | Promise<ReturnType<IpcInvoke[K]>> }

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new Error(`${name} must be a non-empty string`)
  return v
}
const obj = <T>(v: unknown, name: string): T => {
  if (!v || typeof v !== 'object') throw new Error(`${name} must be an object`)
  return v as T
}

/** Free lobby plot for a new building (lobby-layout.json › workspaceSlots, then extend along +x). */
function freePlot(): Workspace['lobbyPlot'] {
  const slots = [
    { x: 13, z: 2, w: 6, d: 5 },
    { x: 2, z: 2, w: 5, d: 4 },
    { x: 2, z: 13, w: 5, d: 4 },
    { x: 13, z: 13, w: 5, d: 4 }
  ]
  const used = db().workspaces.map((w) => `${w.lobbyPlot.x},${w.lobbyPlot.z}`)
  for (let ring = 0; ring < 20; ring++) {
    for (const s of slots) {
      const p = { ...s, x: s.x + ring * 20 }
      if (!used.includes(`${p.x},${p.z}`)) return p
    }
  }
  return slots[0]
}

function upsertAgent(a: AnyAgent): AnyAgent {
  const list = db().agents
  const i = list.findIndex((x) => x.id === a.id)
  if (i < 0) throw new Error('Agent not found')
  const prev = list[i]
  list[i] = { ...prev, ...a }
  // keep workspace.agentIds in step with agent.workspaceId
  if (prev.workspaceId !== a.workspaceId) {
    for (const w of db().workspaces) w.agentIds = w.agentIds.filter((id) => id !== a.id)
    const w = a.workspaceId ? findWorkspace(a.workspaceId) : undefined
    if (w && a.kind === 'agent') w.agentIds.push(a.id)
    if (!a.workspaceId) list[i].deskSlot = undefined
    else if (list[i].deskSlot === undefined && a.kind === 'agent') list[i].deskSlot = freeDesk(a.workspaceId)
  }
  commit('agents', 'workspaces')
  return list[i]
}

function freeDesk(workspaceId: string): number | undefined {
  const used = new Set(db().agents.filter((x) => x.workspaceId === workspaceId && x.deskSlot !== undefined).map((x) => x.deskSlot))
  for (let i = 0; i < 9; i++) if (!used.has(i)) return i
  return undefined
}

const handlers: Handlers = {
  'app:snapshot': () => {
    const s = snapshot()
    return { ...s, skills: [...s.skills, ...skills.sharedSkills()] } // shared skills live on disk, not in db.json
  },
  'app:resetData': async (mode) => {
    runner.stopAll()
    await resetDb(mode === 'empty' ? 'empty' : 'demo')
    automations.scheduleAll()
    commit('workspaces', 'agents', 'tasks', 'missions', 'approvals', 'changes', 'runs', 'conversations', 'accounts', 'automations', 'integrations', 'skills', 'delegation', 'usage', 'jarvis')
  },
  'app:openPath': async (p) => {
    if (!existsSync(str(p, 'path'))) throw new Error('Path not found')
    await shell.openPath(p)
  },
  'app:setSettings': (s) => {
    Object.assign(db().settings, obj(s, 'settings'))
    commit('settings')
    return db().settings
  },
  'claude:check': () => checkClaude(),

  'jarvis:send': (id, text) => {
    // reply streams on 'jarvis:message'; don't hold the invoke open
    jarvis.send(str(id, 'conversationId'), str(text, 'text')).catch((e) => console.error(e))
  },
  'jarvis:setConfig': (c) => {
    Object.assign(db().jarvis, obj(c, 'config'))
    commit('jarvis')
    return db().jarvis
  },
  'jarvis:messages': (id) => jarvis.messages(str(id, 'conversationId')),
  'jarvis:newConversation': (title) => jarvis.newConversation(title),
  'jarvis:setAway': (away) => {
    db().jarvis.awayMode = !!away
    db().awaySince = away ? now() : undefined
    commit('jarvis')
  },

  'workspace:list': () => db().workspaces,
  'workspace:create': (w) => {
    const ws: Workspace = { ...obj<Omit<Workspace, 'id'>>(w, 'workspace'), id: uid('ws-'), lobbyPlot: freePlot() }
    db().workspaces.push(ws)
    commit('workspaces')
    return ws
  },
  'workspace:createFull': (input: NewWorkspaceInput) => {
    obj(input, 'input')
    const id = uid('ws-')
    const orchId = uid('or-')
    const o: Orchestrator = {
      id: orchId,
      name: str(input.orchestrator.name, 'orchestrator name'),
      role: 'Orchestrator',
      kind: 'orchestrator',
      pronouns: 'they/them',
      look: { color: '#4FD1B5', hair: '#1F1A17', skin: '#D6A27E', glasses: false },
      accountId: input.orchestrator.accountId,
      model: input.orchestrator.model,
      thinking: input.orchestrator.thinking,
      pinnedToAccount: false,
      instructions: 'You plan missions for this workspace and route each step to the best agent.',
      skillIds: [],
      integrations: [],
      guardrails: { fileAccess: 'read', maxRunMinutes: 10 },
      workspaceId: id,
      status: 'idle',
      autonomy: input.orchestrator.autonomy,
      parallelLimit: 3,
      retriesPerTask: 2,
      routingRules: []
    }
    const ws: Workspace = {
      id,
      name: str(input.name, 'name'),
      goal: input.goal ?? '',
      color: input.color,
      folderPath: input.folderPath,
      repos: input.repos ?? [],
      git: input.git,
      orchestratorId: orchId,
      agentIds: [],
      lobbyPlot: freePlot()
    }
    db().workspaces.push(ws)
    db().agents.push(o)
    for (const aid of input.agentIds ?? []) {
      const a = findAgent(aid)
      if (a) upsertAgent({ ...a, workspaceId: id, deskSlot: undefined })
    }
    commit('workspaces', 'agents')
    return ws
  },
  'workspace:update': (id, patch) => {
    const ws = findWorkspace(str(id, 'id'))
    if (!ws) throw new Error('Workspace not found')
    Object.assign(ws, obj(patch, 'patch'), { id: ws.id })
    commit('workspaces')
    return ws
  },
  'workspace:pickFolder': async () => {
    const win = BrowserWindow.getFocusedWindow()
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  },
  'workspace:gitStatus': async (id) => {
    const ws = findWorkspace(str(id, 'id'))
    if (!ws) throw new Error('Workspace not found')
    return git.statuses(ws)
  },
  'workspace:scanRepos': (folder, defaultBase) => git.scanRepos(str(folder, 'folder'), typeof defaultBase === 'string' && defaultBase ? defaultBase : 'main'),

  'agent:list': (workspaceId) => (workspaceId ? db().agents.filter((a) => a.workspaceId === workspaceId) : db().agents),
  'agent:save': (a) => upsertAgent(obj<Agent>(a, 'agent')) as Agent,
  'agent:create': (a) => {
    const rec = { ...obj<Omit<Agent, 'id'>>(a, 'agent'), id: uid('ag-') } as Agent
    db().agents.push({ ...rec, workspaceId: undefined })
    return upsertAgent(rec) as Agent
  },
  'agent:assignTask': (agentId, title) => {
    const a = findAgent(str(agentId, 'agentId'))
    if (!a?.workspaceId) throw new Error('Agent is not in a workspace')
    const t = {
      id: nextTaskId(), workspaceId: a.workspaceId, title: str(title, 'title'), assigneeId: a.id, status: 'todo' as const,
      priority: 'medium' as const, dependsOn: [], criteria: [], createdAt: now(), createdBy: 'user'
    }
    db().tasks.push(t)
    commit('tasks')
    runner.startTask(t.id).catch((e) => console.error(e))
    return t
  },

  'mission:approve': (id) => {
    const m = db().missions.find((x) => x.id === str(id, 'id')) as orchestrator.StoredMission | undefined
    if (!m) throw new Error('Mission not found')
    const pending = db().approvals.find((a) => a.kind === 'plan' && a.taskId === m.id && a.state === 'pending')
    if (pending) pending.state = 'approved'
    if (m.schedule && automations.validCron(m.schedule)) {
      automations.save({
        id: '', name: m.title, trigger: { type: 'schedule', cron: m.schedule }, target: { workspaceId: m.workspaceId },
        prompt: m.prompt ?? m.title, overLimit: 'ask', enabled: true
      })
      m.status = 'done' // the schedule owns future runs
      commit('missions', 'approvals')
      return
    }
    orchestrator.approveMission(m.id)
    commit('approvals')
  },
  'mission:runOnce': (id) => {
    const m = db().missions.find((x) => x.id === str(id, 'id'))
    if (!m) throw new Error('Mission not found')
    orchestrator.approveMission(m.id)
  },
  'mission:list': (workspaceId) => (workspaceId ? db().missions.filter((m) => m.workspaceId === workspaceId) : db().missions),
  'mission:plan': (workspaceId, prompt, source) => orchestrator.planMission(str(workspaceId, 'workspaceId'), str(prompt, 'prompt'), source ?? 'user'),
  'orchestrator:message': (workspaceId, text) => orchestrator.message(str(workspaceId, 'workspaceId'), str(text, 'text')),
  'orchestrator:setPaused': (workspaceId, paused) => orchestrator.setPaused(str(workspaceId, 'workspaceId'), !!paused),
  'orchestrator:save': (o) => upsertAgent(obj<Orchestrator>(o, 'orchestrator')) as Orchestrator,

  'task:list': (workspaceId) => db().tasks.filter((t) => t.workspaceId === workspaceId),
  'task:create': (t) => {
    const rec = { ...obj<object>(t, 'task'), id: nextTaskId(), createdAt: now(), createdBy: 'user' } as ReturnType<IpcInvoke['task:create']> & { createdAt: string; createdBy: string }
    db().tasks.push(rec)
    commit('tasks')
    return rec
  },
  'task:update': (id, patch) => {
    const t = findTask(str(id, 'id'))
    if (!t) throw new Error('Task not found')
    Object.assign(t, obj(patch, 'patch'), { id: t.id })
    commit('tasks')
    return t
  },
  'task:start': (id) => {
    runner.startTask(str(id, 'id')).catch((e) => console.error(e))
  },
  'run:get': (taskId) => {
    const r = [...db().runs].reverse().find((x) => x.taskId === taskId)
    if (!r) throw new Error('No run yet')
    return r
  },
  'run:list': (taskId) => db().runs.filter((r) => r.taskId === taskId),
  'run:steer': (runId, text) => runner.steer(str(runId, 'runId'), str(text, 'text')),
  'run:stop': (runId) => runner.stop(str(runId, 'runId')),

  'change:list': (workspaceId) => db().changes.filter((c) => c.workspaceId === workspaceId),
  'change:merge': (branch) => changes.requestMerge(str(branch, 'branch')),
  'change:revert': (branch) => changes.revertBranch(str(branch, 'branch')),
  'change:diff': (workspaceId, branch) => {
    const ws = findWorkspace(str(workspaceId, 'workspaceId'))
    if (!ws) throw new Error('Workspace not found')
    return git.diff(ws, str(branch, 'branch'))
  },
  'change:requestQa': (workspaceId, branch) => {
    const c = db().changes.find((x) => x.workspaceId === workspaceId && x.branch === branch)
    if (!c) throw new Error('Change not found')
    const qa = db().agents.find((a) => a.workspaceId === workspaceId && /\b(qa|test)/i.test(a.role)) ?? db().agents.find((a) => a.id === findWorkspace(workspaceId)?.orchestratorId)
    if (!qa) throw new Error('No QA agent in this workspace')
    const src = c.taskId ? findTask(c.taskId) : undefined
    const t = {
      id: nextTaskId(), workspaceId, title: `QA ${src?.title ?? branch}`, assigneeId: qa.id, status: 'todo' as const, priority: 'medium' as const,
      dependsOn: c.taskId ? [c.taskId] : [], criteria: src?.criteria ?? [], createdAt: now(), createdBy: 'user', qaOf: branch, description: src?.description
    }
    db().tasks.push(t)
    c.qa = 'running'
    commit('tasks', 'changes')
    runner.startTask(t.id).catch((e) => console.error(e))
  },
  'change:requestChanges': (workspaceId, branch, note) => {
    const c = db().changes.find((x) => x.workspaceId === workspaceId && x.branch === branch)
    const t = c?.taskId ? findTask(c.taskId) : undefined
    if (!t) throw new Error('No task for this branch')
    t.description = `${t.description ?? t.title}\n\nRequested changes: ${str(note, 'note')}`
    t.status = 'todo'
    commit('tasks')
    runner.startTask(t.id).catch((e) => console.error(e))
  },

  'approval:list': () => db().approvals,
  'approval:decide': (id, decision, note, always) => approvals.decide(str(id, 'id'), decision === 'reject' ? 'reject' : 'approve', note, always),
  'approval:update': (id, body) => approvals.updateBody(str(id, 'id'), String(body ?? '')),

  'integration:list': () => db().integrations,
  'integration:setPolicy': (id, tool, policy) => {
    const i = db().integrations.find((x) => x.id === id)
    const t = i?.tools.find((x) => x.name === tool)
    if (!t) throw new Error('Tool not found')
    t.policy = policy
    commit('integrations')
  },
  'integration:save': (i) => {
    const list = db().integrations
    const k = list.findIndex((x) => x.id === i.id)
    const rec = { ...i, id: i.id || uid('in-') }
    if (k >= 0) list[k] = rec
    else list.push(rec)
    commit('integrations')
    return rec
  },

  'account:list': () => db().accounts.map(publicAccount),
  'account:setLimitPolicy': (p) => {
    db().limitPolicy = { ...db().limitPolicy, ...obj(p, 'policy') }
    commit('limitPolicy')
  },
  'account:save': async (input) => {
    const { apiKey, keyEnc: _ignored, hasKey: _h, keyHint: _kh, ...a } = obj<StoredAccount & { apiKey?: string }>(input, 'account')
    const list = db().accounts
    const k = list.findIndex((x) => x.id === a.id)
    const prev = k >= 0 ? list[k] : undefined
    const rec: StoredAccount = { ...a, windowTokens: a.windowTokens ?? 0, budgetTokens: a.budgetTokens || 2_000_000, id: a.id || uid('acct-') }
    // the renderer never has the key, so carry the saved one over
    if (rec.auth === 'api_key' && prev?.keyEnc) Object.assign(rec, { keyEnc: prev.keyEnc, hasKey: prev.hasKey, keyHint: prev.keyHint })
    const key = typeof apiKey === 'string' ? apiKey.trim() : ''
    if (rec.auth === 'api_key' && key) {
      const check = await verifyKey(rec.provider, key)
      if (check === 'rejected') throw new Error(`${rec.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} rejected this API key. Check it and try again.`)
      setApiKey(rec, key)
      if (check === 'unknown') toast(`Saved ${rec.name}, but could not reach ${rec.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} to check the key.`)
    }
    if (k >= 0) list[k] = rec
    else list.push(rec)
    commit('accounts')
    return publicAccount(rec)
  },
  'account:delete': (id) => {
    const a = db().accounts.find((x) => x.id === str(id, 'id'))
    if (!a) return
    const users = [db().jarvis.accountId === a.id ? 'Jarvis' : '', ...db().agents.filter((x) => x.accountId === a.id).map((x) => x.name)].filter(Boolean)
    if (users.length) throw new Error(`${a.name} is used by ${users.join(', ')}. Move them to another account first.`)
    db().accounts = db().accounts.filter((x) => x.id !== a.id)
    commit('accounts')
  },
  'account:moveBack': () => moveBack(),
  'account:refreshUsage': () => refreshPlans(),
  'account:pauseAll': () => {
    runner.stopAll()
    for (const w of db().workspaces) orchestrator.setPaused(w.id, true)
  },

  'automation:list': () => db().automations,
  'automation:save': (a) => automations.save(obj(a, 'automation')),
  'automation:runNow': (id) => {
    automations.runNow(str(id, 'id')).catch((e) => console.error(e))
  },
  'automation:delete': (id) => automations.remove(str(id, 'id')),
  'skill:save': (s) => {
    if (s.origin === 'shared' || s.id?.startsWith('shared:')) throw new Error('Shared skills live in their folder; edit SKILL.md there.')
    const list = db().skills
    const k = list.findIndex((x) => x.id === s.id)
    const rec = { ...s, id: s.id || uid('sk-'), origin: 'app' as const }
    if (k >= 0) list[k] = rec
    else list.push(rec)
    commit('skills')
    return rec
  },
  'skill:stores': () => skills.skillStores(),
  'skill:scan': async (includeStopped) => {
    await skills.scanSkills(!!includeStopped)
    return skills.skillStores()
  },
  'skill:read': (id) => skills.readSkillMd(str(id, 'id')),
  'skill:install': (input, skill, storePath) => skills.installSkill(str(input, 'source'), typeof skill === 'string' ? skill : undefined, str(storePath, 'storePath')),
  'skill:setDirs': async (dirs) => {
    if (!Array.isArray(dirs) || dirs.some((d) => typeof d !== 'string')) throw new Error('dirs must be a list of folders')
    const list = dirs.map((d) => d.trim()).filter(Boolean)
    const known = list.find((d) => skills.isKnownStore(d))
    if (known) throw new Error(`${known} is already scanned automatically; it's in the list above.`)
    db().settings.skillDirs = list.filter((d, i) => list.findIndex((x) => skills.samePath(x, d)) === i)
    commit('settings')
    await skills.scanSkills(true)
    return skills.skillStores()
  }
}

export function registerIpc(): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_e, ...args: unknown[]) => {
      try {
        return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(...args) }
      } catch (err) {
        return { ok: false, error: (err as Error).message ?? String(err) }
      }
    })
  }
}
