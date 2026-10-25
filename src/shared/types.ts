/**
 * Jarvis — shared domain types + Electron IPC contract.
 * Place in src/shared/types.ts; import from main, preload and renderer.
 * Screens that use each entity are noted as board numbers from the Design canvas.
 */

export type Id = string;
export type ISODate = string;

/* ---------- Status vocabulary (maps 1:1 to Tailwind `status.*` tokens) ---------- */
export type AgentStatus = 'working' | 'review' | 'blocked' | 'idle';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'review' | 'done';
export type Policy = 'allowed' | 'ask' | 'off';
export type Autonomy = 'propose_only' | 'run_small_plans' | 'autopilot';

/* ---------- Jarvis (01, 02, 11) ---------- */
export interface JarvisConfig {
  accountId: Id;
  model: string;            // e.g. "GPT-5.6-Sol"
  thinking: 'default' | 'medium' | 'high';
  canStartOnOwn: boolean;   // "Let Jarvis start tasks and plans on his own"
  limits: { budgetPct: number; perHour: number; maxPlanTasks: number };
  awayMode: boolean;        // HUD "I'm away" toggle
}

export interface ChatMessage {
  id: Id;
  conversationId: Id;
  role: 'user' | 'jarvis' | 'orchestrator';
  text: string;
  toolSteps?: { label: string; ok: boolean }[]; // chips like "Looked at agents and accounts"
  missionId?: Id;           // renders a MissionCard inline
  createdAt: ISODate;
}

/* ---------- Workspace (01, 04, 05) ---------- */
/** One git repo inside a multi-repo project folder (e.g. web/, mobile/, api/). */
export interface Repo {
  name: string;             // shown in Changes, e.g. "api"
  path: string;             // relative to Workspace.folderPath, e.g. "api" or "apps/web"
  baseBranch: string;       // task branches start from and merge back into this
}

export interface Workspace {
  id: Id;
  name: string;             // e.g. "Ryscript"
  color: 'teal' | 'blue' | 'clay' | 'purple' | 'amber'; // roof colour in LobbyScene
  goal: string;
  folderPath: string;       // chosen in the New workspace wizard; shown on the Project files label
  repos?: Repo[];           // empty/undefined: folderPath itself is the one repo (git.baseBranch)
  git: { baseBranch: string; branchPattern: string; mergePolicy: 'ask' | 'auto_with_revert' };
  orchestratorId?: Id;      // undefined → "Setup incomplete" in the lobby
  agentIds: Id[];
  lobbyPlot: { x: number; z: number; w: number; d: number }; // tile footprint on the campus
}

/* ---------- Orchestrator + Agents (05, 06, 10) ---------- */
export interface Agent {
  id: Id;
  name: string;             // nickname shown in the office, e.g. "Rex"
  role: string;             // e.g. "HubSpot Module Developer"
  kind: 'agent' | 'orchestrator';
  pronouns: 'he/him' | 'she/her' | 'they/them';
  look: { color: string; hair: string; skin: string; glasses: boolean; model?: string }; // GLB character variant
  accountId: Id;
  model: string;
  thinking: 'default' | 'medium' | 'high';
  pinnedToAccount: boolean;
  instructions: string;
  skillIds: Id[];
  integrations: { integrationId: Id; policy: Policy }[];
  guardrails: { fileAccess: 'read' | 'read_write'; maxRunMinutes: number; weeklyCapPct?: number };
  workspaceId?: Id;         // undefined = in the agent pool
  deskSlot?: number;        // index into office-layout.json › desks
  status: AgentStatus;
  currentTaskId?: Id;
}

export interface Orchestrator extends Agent {
  kind: 'orchestrator';
  autonomy: Autonomy;
  parallelLimit: number;
  retriesPerTask: number;
  routingRules: { match: string; assigneeIds: Id[]; then?: string }[];
}

/* ---------- Missions, tasks, runs, changes (02, 06, 07, 08, 09) ---------- */
export interface Mission {
  id: Id;                   // "M-014"
  title: string;
  source: 'jarvis' | 'automation' | 'user';
  workspaceId: Id;
  steps: { taskId?: Id; title: string; assigneeId: Id; model: string; gate?: boolean; dependsOn?: Id[] }[];
  status: 'draft' | 'awaiting_approval' | 'running' | 'done' | 'failed';
  estUsagePct?: number;
}

export interface Task {
  id: Id;                   // "T-076"
  missionId?: Id;
  workspaceId: Id;
  title: string;
  assigneeId: Id;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  dependsOn: Id[];
  criteria: { text: string; done: boolean }[];
  note?: string;            // card sub-line, e.g. "Writing fields.json · 64%"
  progress?: number;        // 0–1
}

export interface RunEvent {
  t: ISODate;
  kind: 'received' | 'read' | 'edit' | 'command' | 'commit' | 'message' | 'thinking';
  title: string;
  text?: string;
  code?: string;
  level?: 'info' | 'warn' | 'error';
}

export interface Run {
  id: Id;
  taskId: Id;
  agentId: Id;
  branch: string;
  startedAt: ISODate;
  endedAt?: ISODate;
  tokens: number;
  events: RunEvent[];
  report?: string;
  filesChanged: { path: string; additions: number; deletions: number }[];
}

export interface Change {
  branch: string;
  taskId?: Id;
  agentId: Id;
  commits: number;
  additions: number;
  deletions: number;
  qa: 'pending' | 'running' | 'passed' | 'failed';
  state: 'open' | 'merged' | 'closed';
  mergedAt?: ISODate;
  repos?: RepoChange[];     // multi-repo workspaces: the repos this branch touched
}

export interface RepoChange {
  name: string;
  commits: number;
  additions: number;
  deletions: number;
  mergeCommit?: string;
}

/* ---------- Approvals / Inbox (03) ---------- */
export interface ApprovalRequest {
  id: Id;
  kind: 'send_email' | 'merge' | 'plan' | 'publish' | 'spend' | 'delete' | 'folder';
  title: string;
  requestedBy: Id;          // agent or 'jarvis'
  workspaceId?: Id;
  taskId?: Id;
  via: string;              // integration or "Git"
  policy: string;           // human sentence shown in the drawer
  fields: { label: string; value: string }[];
  body: string;
  state: 'pending' | 'approved' | 'rejected';
  createdAt: ISODate;
}

/* ---------- Integrations, accounts, automations (11, 12, 13) ---------- */
export interface Integration {
  id: Id;
  name: string;             // "Cyfervoid.Com"
  type: 'mcp' | 'http' | 'gmail' | 'slack' | 'github' | 'hubspot';
  tools: { name: string; description: string; policy: Policy }[]; // custom MCP: discovered on connect
  agentIds: Id[];
  workspaceScope: Id[] | 'all';
  status: 'connected' | 'error' | 'disconnected';
  mcp?: McpConfig;          // a third-party MCP server you connect yourself
  mcpSecret?: string;       // main process only: OS-encrypted header values, client secret and OAuth tokens
}

/** How to reach a third-party MCP server. Secret values never leave the main process. */
export interface McpConfig {
  transport: 'http' | 'sse' | 'stdio'; // Streamable HTTP, SSE (legacy), local command
  url?: string;             // http / sse
  command?: string;         // stdio
  args?: string[];
  headers?: { name: string; set: boolean }[]; // values are write-only
  oauth: 'none' | 'dcr' | 'client'; // none · auto-register (dynamic client registration) · bring your own client
  clientId?: string;        // oauth 'client'
  hasClientSecret?: boolean;
  signedIn?: boolean;       // OAuth tokens saved
  server?: { name: string; version?: string }; // reported on the last successful connect
  testedAt?: ISODate;
  error?: string;           // last connect failure
}

export interface AIAccount {
  id: Id;
  name: string;             // "Claude Code LS"
  provider: 'anthropic' | 'openai';
  auth: 'claude_code' | 'codex' | 'api_key';
  window: '5h' | 'weekly' | 'monthly';
  usagePct: number;
  resetAt?: ISODate;
}

export interface LimitPolicy { whenClose: 'switch' | 'ask' | 'pause'; warnAt: number; stopAt: number; switchBack: boolean }

export interface Automation {
  id: Id;
  name: string;
  trigger: { type: 'schedule'; cron: string } | { type: 'email'; integrationId: Id } | { type: 'git'; event: 'push' | 'merge' | 'tag' } | { type: 'webhook'; path: string };
  target: { workspaceId: Id } | 'jarvis';
  prompt: string;
  overLimit: 'ask' | 'run' | 'skip';
  enabled: boolean;
  lastRun?: { at: ISODate; result: 'succeeded' | 'failed' | 'waiting' };
}

export interface RepoStatus {
  name: string;
  path: string;             // relative to the scanned folder; '' = the folder itself
  branch: string;           // checked out now
  clean: boolean;
  remote?: string;
  branches: string[];       // local branches, for the base-branch picker
  baseBranch: string;       // best guess (or saved choice) for the base
}

/* ---------- Electron IPC contract (preload exposes window.jarvis) ---------- */
export interface IpcInvoke {
  'workspace:list': () => Workspace[];
  'workspace:create': (w: Omit<Workspace, 'id'>) => Workspace;
  'workspace:pickFolder': () => string | null;          // dialog.showOpenDialog
  'workspace:gitStatus': (id: Id) => RepoStatus[];       // one per repo
  'workspace:scanRepos': (folder: string, defaultBase: string) => RepoStatus[]; // the folder itself, or the repos under it
  'agent:list': (workspaceId?: Id) => Agent[];
  'agent:save': (a: Agent) => Agent;
  'jarvis:send': (conversationId: Id, text: string) => void; // reply streams on 'jarvis:message'
  'mission:approve': (id: Id) => void;
  'task:list': (workspaceId: Id) => Task[];
  'task:create': (t: Omit<Task, 'id'>) => Task;
  'run:get': (taskId: Id) => Run;
  'run:steer': (runId: Id, text: string) => void;
  'run:stop': (runId: Id) => void;
  'change:list': (workspaceId: Id) => Change[];
  'change:merge': (branch: string) => void;              // always goes through an ApprovalRequest first
  'change:revert': (branch: string) => void;
  'approval:list': () => ApprovalRequest[];
  'approval:decide': (id: Id, decision: 'approve' | 'reject', note?: string, always?: boolean) => void;
  'integration:list': () => Integration[];
  'integration:setPolicy': (id: Id, tool: string, policy: Policy) => void;
  'account:list': () => AIAccount[];
  'account:setLimitPolicy': (p: LimitPolicy) => void;
  'automation:list': () => Automation[];
  'automation:save': (a: Automation) => Automation;
  'automation:runNow': (id: Id) => void;
}

/** Main → renderer push events (webContents.send) */
export interface IpcEvents {
  'jarvis:message': ChatMessage;
  'agent:status': { agentId: Id; status: AgentStatus; taskId?: Id; progress?: number };
  'run:event': { runId: Id; event: RunEvent };
  'approval:new': ApprovalRequest;
  'account:usage': { accountId: Id; usagePct: number };
  'jarvis:movedAgents': { from: Id; to: Id; count: number; at: ISODate };
}
