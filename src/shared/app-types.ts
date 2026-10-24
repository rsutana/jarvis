/**
 * App-level additions to the handoff contract in ./types.ts.
 * types.ts stays a verbatim copy of the design handoff; anything the running
 * app needs beyond it is declared here and merged into IpcInvoke / IpcEvents.
 */
import type {
  AIAccount,
  Agent,
  ApprovalRequest,
  Automation,
  Change,
  Id,
  ISODate,
  Integration,
  IpcEvents,
  IpcInvoke,
  JarvisConfig,
  LimitPolicy,
  Mission,
  Orchestrator,
  Run,
  Task,
  Workspace
} from './types'

export * from './types'

export interface Conversation {
  id: Id
  title: string
  createdAt: ISODate
  updatedAt: ISODate
  sessionId?: string // Claude Code session, resumed on each turn
}

export interface Skill {
  id: Id
  name: string
  description: string
  instructions: string
}

export interface DelegationEntry {
  id: Id
  workspaceId: Id
  t: ISODate
  text: string
  tone: 'info' | 'good' | 'merge' | 'bad' | 'user' | 'orchestrator'
}

export interface UsageSample {
  day: string // YYYY-MM-DD
  scope: Id | 'jarvis' // workspace id or jarvis
  accountId: Id
  tokens: number
}

/** Stored records carry a few fields the handoff types leave implicit. */
export type StoredChange = Change & {
  workspaceId: Id
  createdAt: ISODate
  mergeCommit?: string
  qaNote?: string
}
export type StoredTask = Task & {
  createdAt: ISODate
  createdBy: Id // agent id, 'jarvis', 'user' or automation id
  branch?: string
  qaOf?: string // branch this QA task reviews
  description?: string
  doneAt?: ISODate
}
export type StoredAccount = AIAccount & {
  budgetTokens: number // tokens that count as 100% of one window
  windowStart?: ISODate
  windowTokens: number
}
export type AnyAgent = Agent | Orchestrator

export interface AppSettings {
  claudePath: string // '' = resolve from PATH
  loadUserClaudeSettings: boolean // pass user-level hooks/plugins to spawned CLIs
  worktreeRoot: string // '' = userData/worktrees
}

export interface ClaudeCheck {
  ok: boolean
  version?: string
  path?: string
  error?: string
}

export interface FileDiff {
  path: string
  additions: number
  deletions: number
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  patch: string
}

export interface Snapshot {
  jarvis: JarvisConfig
  conversations: Conversation[]
  workspaces: Workspace[]
  agents: AnyAgent[]
  missions: Mission[]
  tasks: StoredTask[]
  runs: Run[]
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
  paused: Id[] // workspaces whose orchestrator is paused
  awaySince?: ISODate
  movedAgents?: { agentIds: Id[]; from: Id; to: Id; at: ISODate }
}

export type Collection = Exclude<keyof Snapshot, 'awaySince' | 'movedAgents'>

declare module './types' {
  interface IpcInvoke {
    'app:snapshot': () => Snapshot
    'app:resetData': (mode: 'demo' | 'empty') => void
    'app:openPath': (path: string) => void
    'app:setSettings': (s: Partial<AppSettings>) => AppSettings
    'claude:check': () => ClaudeCheck
    'jarvis:setConfig': (c: Partial<JarvisConfig>) => JarvisConfig
    'jarvis:messages': (conversationId: Id) => ChatMessage[]
    'jarvis:newConversation': (title?: string) => Conversation
    'jarvis:setAway': (away: boolean) => void
    'workspace:update': (id: Id, patch: Partial<Workspace>) => Workspace
    'workspace:createFull': (input: NewWorkspaceInput) => Workspace
    'agent:create': (a: Omit<Agent, 'id'>) => Agent
    'agent:assignTask': (agentId: Id, title: string) => Task
    'mission:list': (workspaceId?: Id) => Mission[]
    'mission:plan': (workspaceId: Id, prompt: string, source: Mission['source']) => Mission
    'mission:runOnce': (id: Id) => void
    'orchestrator:message': (workspaceId: Id, text: string) => void
    'orchestrator:setPaused': (workspaceId: Id, paused: boolean) => void
    'orchestrator:save': (o: Orchestrator) => Orchestrator
    'task:update': (id: Id, patch: Partial<StoredTask>) => StoredTask
    'task:start': (id: Id) => void
    'run:list': (taskId: Id) => Run[]
    'change:diff': (workspaceId: Id, branch: string) => FileDiff[]
    'change:requestQa': (workspaceId: Id, branch: string) => void
    'change:requestChanges': (workspaceId: Id, branch: string, note: string) => void
    'account:save': (a: StoredAccount) => StoredAccount
    'account:moveBack': () => void
    'account:pauseAll': () => void
    'integration:save': (i: Integration) => Integration
    'automation:delete': (id: Id) => void
    'approval:update': (id: Id, body: string) => void
    'skill:save': (s: Skill) => Skill
  }
  interface IpcEvents {
    /** Main changed these collections; stores refetch the snapshot slice. */
    'db:changed': { collections: Collection[] }
    'jarvis:typing': { conversationId: Id; typing: boolean }
    'toast': { text: string; tone: 'info' | 'good' | 'bad' }
  }
}

export interface NewWorkspaceInput {
  name: string
  goal: string
  color: Workspace['color']
  folderPath: string
  git: Workspace['git']
  orchestrator: {
    name: string
    accountId: Id
    model: string
    thinking: Agent['thinking']
    autonomy: Orchestrator['autonomy']
  }
  agentIds: Id[]
}

/** Model names shown in the UI → CLI + provider. */
export const MODELS: { name: string; provider: 'anthropic' | 'openai'; cli: string }[] = [
  { name: 'Opus 5.5', provider: 'anthropic', cli: 'opus' },
  { name: 'Sonnet 5.5', provider: 'anthropic', cli: 'sonnet' },
  { name: 'Haiku 5.5', provider: 'anthropic', cli: 'haiku' },
  { name: 'GPT-5.6-Sol', provider: 'openai', cli: 'gpt-5.6-sol' },
  { name: 'GPT-5.6', provider: 'openai', cli: 'gpt-5.6' }
]

/** Shape of window.jarvis exposed by the preload script. */
export interface JarvisApi {
  invoke<K extends keyof IpcInvoke>(channel: K, ...args: Parameters<IpcInvoke[K]>): Promise<Awaited<ReturnType<IpcInvoke[K]>>>
  on<K extends keyof IpcEvents>(event: K, cb: (payload: IpcEvents[K]) => void): () => void
  platform: string
}
