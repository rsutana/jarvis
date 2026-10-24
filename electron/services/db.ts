import { app } from 'electron'
import { join } from 'node:path'
import { JSONFilePreset } from 'lowdb/node'
import type { Low } from 'lowdb'
import type {
  ApprovalRequest,
  Automation,
  ChatMessage,
  Integration,
  JarvisConfig,
  LimitPolicy,
  Mission,
  Run,
  Workspace
} from '@shared/types'
import type {
  AnyAgent,
  AppSettings,
  Collection,
  Conversation,
  DelegationEntry,
  Skill,
  Snapshot,
  StoredAccount,
  StoredChange,
  StoredTask,
  UsageSample
} from '@shared/app-types'
import { demoData, emptyData } from './seed'
import { emit } from './bus'

export type StoredRun = Run & { live?: boolean; sessionId?: string; accountId?: string }

export interface DbSchema {
  version: 1
  jarvis: JarvisConfig
  conversations: Conversation[]
  messages: ChatMessage[]
  workspaces: Workspace[]
  agents: AnyAgent[]
  missions: Mission[]
  tasks: StoredTask[]
  runs: StoredRun[]
  changes: StoredChange[]
  approvals: ApprovalRequest[]
  integrations: Integration[]
  accounts: StoredAccount[]
  limitPolicy: LimitPolicy
  automations: Automation[]
  skills: Skill[]
  delegation: DelegationEntry[]
  usage: UsageSample[]
  settings: AppSettings
  awaySince?: string
  paused: string[] // workspace ids whose orchestrator is paused
  movedAgents?: { agentIds: string[]; from: string; to: string; at: string }
  counters: { task: number; mission: number; approval: number }
}

let low: Low<DbSchema>

export async function openDb(): Promise<void> {
  const file = join(app.getPath('userData'), 'jarvis-db.json')
  low = await JSONFilePreset<DbSchema>(file, demoData())
  // fill keys added after the file was first written
  const base = emptyData()
  for (const k of Object.keys(base) as (keyof DbSchema)[]) {
    if (low.data[k] === undefined) (low.data as unknown as Record<string, unknown>)[k] = base[k]
  }
  await low.write()
}

export function db(): DbSchema {
  return low.data
}

let pending = new Set<Collection>()
let timer: NodeJS.Timeout | null = null

/** Persist and tell renderers which collections changed (batched per tick). */
export function commit(...collections: Collection[]): void {
  collections.forEach((c) => pending.add(c))
  if (timer) return
  timer = setTimeout(async () => {
    timer = null
    const changed = [...pending]
    pending = new Set()
    await low.write()
    emit('db:changed', { collections: changed })
  }, 16)
}

export async function resetDb(mode: 'demo' | 'empty'): Promise<void> {
  const settings = low.data.settings
  low.data = mode === 'demo' ? demoData() : emptyData()
  low.data.settings = settings
  await low.write()
}

export function snapshot(): Snapshot {
  const d = low.data
  return {
    jarvis: d.jarvis,
    conversations: d.conversations,
    workspaces: d.workspaces,
    agents: d.agents,
    missions: d.missions,
    tasks: d.tasks,
    runs: d.runs.map(({ events, ...r }) => ({ ...r, events: events.slice(-200) })),
    changes: d.changes,
    approvals: d.approvals,
    integrations: d.integrations,
    accounts: d.accounts,
    limitPolicy: d.limitPolicy,
    automations: d.automations,
    skills: d.skills,
    delegation: d.delegation.slice(-400),
    usage: d.usage,
    settings: d.settings,
    paused: d.paused,
    awaySince: d.awaySince,
    movedAgents: d.movedAgents
  }
}

export const now = (): string => new Date().toISOString()
export const uid = (p = ''): string => p + Math.random().toString(36).slice(2, 10)

export function nextTaskId(): string {
  low.data.counters.task += 1
  return 'T-' + String(low.data.counters.task).padStart(3, '0')
}
export function nextMissionId(): string {
  low.data.counters.mission += 1
  return 'M-' + String(low.data.counters.mission).padStart(3, '0')
}
export function nextApprovalId(): string {
  low.data.counters.approval += 1
  return 'A-' + String(low.data.counters.approval).padStart(3, '0')
}

export function findAgent(id: string): AnyAgent | undefined {
  return low.data.agents.find((a) => a.id === id)
}
export function findWorkspace(id: string): Workspace | undefined {
  return low.data.workspaces.find((w) => w.id === id)
}
export function findTask(id: string): StoredTask | undefined {
  return low.data.tasks.find((t) => t.id === id)
}

export function log(workspaceId: string, text: string, tone: DelegationEntry['tone'] = 'info'): void {
  low.data.delegation.push({ id: uid('d'), workspaceId, t: now(), text, tone })
  if (low.data.delegation.length > 2000) low.data.delegation.splice(0, 500)
  commit('delegation')
}
