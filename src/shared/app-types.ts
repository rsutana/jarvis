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
  McpConfig,
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
  /** 'shared': an Agent Skills folder (SKILL.md) from the canonical store, read-only here */
  origin?: 'app' | 'shared'
  path?: string // shared: the skill's folder
  location?: string // shared: which store it was found in, e.g. "WSL Ubuntu · ryscript · ~/.agents/skills"
  source?: string // shared: where `npx skills add` got it, e.g. "vercel-labs/agent-skills"
  url?: string // shared: its skills.sh page
}

/** A folder of shared skills. `canonical` stores (~/.agents/skills) are where installs go. */
export interface SkillStore {
  path: string
  label: string
  canonical: boolean
  wsl?: { distro: string; user: string }
  custom?: boolean // added by the user in Skills
  count: number
  error?: string
}

/**
 * An MCP server Claude Code itself is set up with (`claude mcp add`, a project's .mcp.json,
 * a plugin), found in its config on this PC, in WSL homes and in account config dirs.
 * Read-only in Jarvis; header and env values never leave the main process.
 */
export interface LocalMcp {
  id: string
  name: string
  scope: 'local' | 'project' | 'user' | 'plugin'
  transport: McpConfig['transport']
  url?: string // secret-looking query values masked
  command?: string
  args?: string[] // secret-looking values masked
  headerNames: string[]
  envNames: string[]
  project?: string // local / project scope (and project-installed plugins): the folder, as Claude Code wrote it
  plugin?: string // plugin scope, e.g. "github@claude-plugins-official"
  state: 'enabled' | 'disabled' | 'unapproved' // unapproved: a .mcp.json server Claude Code hasn't been allowed to start yet
  home: string // "This PC", "WSL Ubuntu · ryscript" or the account whose config dir it's in
  wsl: boolean
  file: string // where it's defined
  workspaceIds: Id[] // Jarvis workspaces whose folder it applies to
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
  configDir?: string // claude_code: CLAUDE_CONFIG_DIR holding this account's login
  hasKey?: boolean // api_key: a key is saved
  keyHint?: string // api_key: e.g. "sk-ant-…AbCd", safe to show
  keyEnc?: string // api_key: OS-encrypted key; main process only, stripped before it reaches the renderer
  plan?: PlanUsage // claude_code: real subscription limits from Anthropic (what /usage and the IDE show)
}

export interface PlanWindow {
  pct: number
  resetsAt?: ISODate
}
export interface PlanUsage {
  session?: PlanWindow // 5-hour window
  weekly?: PlanWindow // 7-day window
  at: ISODate // when Anthropic was asked
}

/** Usable right now: API-key accounts need a saved key; Codex sign-in has no runner yet. */
export const isConnected = (a: StoredAccount): boolean => (a.auth === 'api_key' ? !!a.hasKey : a.auth === 'claude_code')
export type AnyAgent = Agent | Orchestrator

export interface AppSettings {
  claudePath: string // '' = resolve from PATH
  loadUserClaudeSettings: boolean // pass user-level hooks/plugins to spawned CLIs
  worktreeRoot: string // '' = userData/worktrees
  skillDirs?: string[] // extra shared-skill folders on top of the ones found automatically
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
  localMcps: LocalMcp[] // read from Claude Code's config, not db.json
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
    'account:save': (a: StoredAccount & { apiKey?: string }) => StoredAccount // apiKey is write-only
    'account:delete': (id: Id) => void
    'account:refreshUsage': () => void // re-read real plan usage from Anthropic (throttled)
    'account:moveBack': () => void
    'account:pauseAll': () => void
    'integration:save': (i: Integration) => Integration
    'integration:delete': (id: Id) => void // also unlinks it from agents; refused while an automation triggers on it
    'automation:delete': (id: Id) => void
    'approval:update': (id: Id, body: string) => void
    'skill:save': (s: Skill) => Skill
    'skill:stores': () => SkillStore[]
    'skill:scan': (includeStopped?: boolean) => SkillStore[] // includeStopped also boots stopped WSL distros
    'skill:read': (id: Id) => string // a shared skill's SKILL.md
    'skill:install': (input: string, skill: string | undefined, storePath: string) => string // runs `npx skills add`
    'skill:setDirs': (dirs: string[]) => SkillStore[]
    /** Save a custom MCP's connection settings; secret values replace saved ones only when given. */
    'mcp:configure': (id: Id, cfg: McpConfig, secrets: { headers?: Record<string, string>; clientSecret?: string }) => Integration
    /** Connect (signing in through the browser when OAuth needs it) and discover the server's tools. */
    'mcp:connect': (id: Id) => Integration
    'mcp:signOut': (id: Id) => Integration
    /** Re-read Claude Code's MCP servers; includeStopped also boots stopped WSL distros. */
    'mcp:scanLocal': (includeStopped?: boolean) => LocalMcp[]
    /** Copy one of Claude Code's servers into Jarvis as a custom MCP (headers encrypted), ready to connect. */
    'mcp:importLocal': (id: string) => Integration
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
  repos?: Workspace['repos']
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
/** Where MCP OAuth sign-in comes back to (a loopback listener in the main process). Register this for "bring your own client". */
/**
 * The first port is the one to register; auto-registered clients also list the others as
 * fallbacks, since a port can be taken. Kept below 44000: WSL's mirrored networking reserves
 * the Linux ephemeral range (e.g. 44620–48715) on Windows, and Windows' own starts at 49152.
 */
export const MCP_CALLBACK_PORTS = [38823, 28823, 18823]
export const mcpRedirectUrl = (port: number): string => `http://127.0.0.1:${port}/callback`
export const MCP_REDIRECT_URL = mcpRedirectUrl(MCP_CALLBACK_PORTS[0])

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
