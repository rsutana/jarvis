/**
 * First-run data. demoData() mirrors the sample content on the design canvas
 * (names, tasks, approvals) so every screen has something to show; emptyData()
 * is a clean install with one Claude Code account.
 */
import type { Agent, Orchestrator } from '@shared/types'
import type { DbSchema } from './db'

const ago = (min: number): string => new Date(Date.now() - min * 60_000).toISOString()
const day = (offset: number): string => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)

const baseJarvis = {
  accountId: 'cc-ls',
  model: 'Opus 5.5',
  thinking: 'medium' as const,
  canStartOnOwn: false,
  limits: { budgetPct: 80, perHour: 12, maxPlanTasks: 8 },
  awayMode: false
}

const settings = { claudePath: '', loadUserClaudeSettings: false, worktreeRoot: '' }

export function emptyData(): DbSchema {
  return {
    version: 1,
    jarvis: { ...baseJarvis },
    conversations: [],
    messages: [],
    workspaces: [],
    agents: [],
    missions: [],
    tasks: [],
    runs: [],
    changes: [],
    approvals: [],
    integrations: [],
    accounts: [
      { id: 'cc-ls', name: 'Claude Code', provider: 'anthropic', auth: 'claude_code', window: '5h', usagePct: 0, budgetTokens: 2_000_000, windowTokens: 0 }
    ],
    limitPolicy: { whenClose: 'switch', warnAt: 85, stopAt: 89, switchBack: true },
    automations: [],
    skills: [],
    delegation: [],
    usage: [],
    settings: { ...settings },
    paused: [],
    counters: { task: 0, mission: 0, approval: 0 }
  }
}

type LookRow = [id: string, name: string, role: string, color: string, hair: string, skin: string, glasses: boolean, model: string]

function agent(r: LookRow, extra: Partial<Agent>): Agent {
  const [id, name, role, color, hair, skin, glasses, model] = r
  return {
    id,
    name,
    role,
    kind: 'agent',
    pronouns: 'they/them',
    look: { color, hair, skin, glasses },
    accountId: model.startsWith('GPT') ? 'codex-ls' : 'cc-ls',
    model,
    thinking: 'default',
    pinnedToAccount: false,
    instructions: `You are ${name}, the ${role}. Work only inside the project folder. Keep changes small and explain what you did in a short report at the end.`,
    skillIds: [],
    integrations: [],
    guardrails: { fileAccess: 'read_write', maxRunMinutes: 30 },
    status: 'idle',
    ...extra
  }
}

export function demoData(): DbSchema {
  const d = emptyData()

  d.accounts = [
    { id: 'cc-ls', name: 'Claude Code LS', provider: 'anthropic', auth: 'claude_code', window: '5h', usagePct: 62, budgetTokens: 2_000_000, windowTokens: 1_240_000, resetAt: ago(-192) },
    { id: 'cc-roy', name: 'Claude Code Roy', provider: 'anthropic', auth: 'claude_code', window: '5h', usagePct: 91, budgetTokens: 2_000_000, windowTokens: 1_820_000, resetAt: ago(-41) },
    { id: 'codex-ls', name: 'Codex Leadstreet', provider: 'openai', auth: 'codex', window: 'weekly', usagePct: 34, budgetTokens: 20_000_000, windowTokens: 6_800_000 },
    { id: 'api-anthropic', name: 'Anthropic API', provider: 'anthropic', auth: 'api_key', window: 'monthly', usagePct: 18, budgetTokens: 50_000_000, windowTokens: 9_000_000 },
    { id: 'api-openai', name: 'OpenAI API', provider: 'openai', auth: 'api_key', window: 'monthly', usagePct: 5, budgetTokens: 50_000_000, windowTokens: 2_500_000 }
  ]

  d.skills = [
    { id: 'sk-module', name: 'HubSpot Module Dev', description: 'Build HubSpot CMS modules (module.html, module.css, fields.json, meta.json).', instructions: 'Follow the folder layout of existing modules. Validate fields.json. Add a README.' },
    { id: 'sk-research', name: 'Module Opportunity Research', description: 'Find module ideas missing from the library.', instructions: 'List candidates with a one-line rationale and expected effort.' },
    { id: 'sk-blog', name: 'Blog Article Writing', description: 'Draft-only blog articles.', instructions: 'Write in plain language, 900–1400 words, with an outline first. Never publish.' },
    { id: 'sk-seo', name: 'SEO Outline', description: 'Headings and keywords for an article.', instructions: 'Return H2/H3 outline and 5 target keywords.' },
    { id: 'sk-email', name: 'Customer Email Drafting', description: 'Friendly, short support replies.', instructions: 'Answer the question, keep under 120 words, sign as the support team.' },
    { id: 'sk-theme', name: 'HubSpot Theme Page Design', description: 'Page templates and sections for themes.', instructions: 'Use theme tokens; keep templates accessible.' },
    { id: 'sk-qa', name: 'QA Checklist', description: 'Review a branch and report PASS or FAIL.', instructions: 'Check the change against the task criteria. End with "QA: PASS" or "QA: FAIL" and reasons.' }
  ]

  const rows: LookRow[] = [
    ['rex', 'Rex', 'HubSpot Module Developer', '#5ED0C0', '#2B2420', '#C98E6A', false, 'Sonnet 5.5'],
    ['kei', 'Kei', 'QA Tester', '#FF8A7A', '#3A2A20', '#F0D2B8', true, 'Sonnet 5.5'],
    ['shake', 'Shake', 'Customer Support', '#B9A2FF', '#E8E2D6', '#F3D9C4', false, 'Haiku 5.5'],
    ['mika', 'Mika', 'Content Writer', '#6FD3E8', '#1F1A17', '#8E5B3E', false, 'Sonnet 5.5'],
    ['ivo', 'Ivo', 'HubSpot Theme Developer', '#F2B544', '#4A2E1E', '#F0D2B8', true, 'Sonnet 5.5'],
    ['nia', 'Nia', 'Market Researcher', '#9FE07A', '#2B1F1A', '#D6A27E', true, 'Sonnet 5.5'],
    ['tomo', 'Tomo', 'HubSpot Theme Build Engineer', '#7FB2FF', '#5A3A24', '#F0D2B8', true, 'Opus 5.5'],
    ['lux', 'Lux', 'HubSpot Theme Designer', '#FFB3D1', '#C9C3BA', '#F3D9C4', true, 'Sonnet 5.5'],
    ['wren', 'Wren', 'Theme Market Researcher', '#E8C99A', '#1F1A17', '#C98E6A', false, 'Sonnet 5.5']
  ]
  const status: Record<string, Agent['status']> = { rex: 'working', kei: 'working', shake: 'review', wren: 'blocked' }
  const skills: Record<string, string[]> = {
    rex: ['sk-module', 'sk-research'], kei: ['sk-qa'], shake: ['sk-email'], mika: ['sk-blog', 'sk-seo'],
    ivo: ['sk-theme'], nia: ['sk-research'], tomo: ['sk-theme'], lux: ['sk-theme'], wren: ['sk-research']
  }
  const ryscriptAgents = rows.map((r, slot) =>
    agent(r, {
      workspaceId: 'ryscript',
      deskSlot: slot,
      status: status[r[0]] ?? 'idle',
      skillIds: skills[r[0]] ?? [],
      currentTaskId: { rex: 'T-076', kei: 'T-077', shake: 'T-022', wren: 'T-081' }[r[0]],
      guardrails: { fileAccess: r[0] === 'kei' ? 'read' : 'read_write', maxRunMinutes: 30 },
      integrations:
        r[0] === 'mika' ? [{ integrationId: 'cyfervoid-com', policy: 'ask' }, { integrationId: 'web-search', policy: 'allowed' }]
        : r[0] === 'shake' ? [{ integrationId: 'cyfervoid-gmail', policy: 'ask' }]
        : r[0] === 'nia' || r[0] === 'wren' ? [{ integrationId: 'web-search', policy: 'allowed' }]
        : []
    })
  )
  ryscriptAgents.find((a) => a.id === 'mika')!.instructions =
    'You are the Content Writer. Research and write draft-only Cyfervoid blog articles about HubSpot, web development and programming for user review. Never publish. Save drafts through the Cyfervoid.Com integration and report the draft ID.'

  const orch = (id: string, name: string, ws: string, color: string, autonomy: Orchestrator['autonomy']): Orchestrator => ({
    ...agent([id, name, 'Orchestrator', color, '#1F1A17', '#D6A27E', false, 'Opus 5.5'], { workspaceId: ws }),
    kind: 'orchestrator',
    thinking: 'high',
    status: 'idle',
    guardrails: { fileAccess: 'read', maxRunMinutes: 10 },
    instructions: 'You plan missions for this workspace and route each step to the best agent.',
    autonomy,
    parallelLimit: 3,
    retriesPerTask: 2,
    routingRules: []
  })
  const cyfervoid = orch('cyfervoid', 'Cyfervoid', 'ryscript', '#4FD1B5', 'run_small_plans')
  cyfervoid.status = 'working'
  cyfervoid.routingRules = [
    { match: 'HubSpot module code', assigneeIds: ['rex'], then: 'QA by Kei' },
    { match: 'Theme build / bug', assigneeIds: ['tomo', 'ivo'], then: 'QA by Kei' },
    { match: 'Blog / copy', assigneeIds: ['mika'], then: 'Ask before publish' },
    { match: 'Customer email', assigneeIds: ['shake'], then: 'Ask before send' }
  ]
  const quill = orch('quill', 'Quill', 'news-website', '#4A7FE0', 'propose_only')

  d.agents = [
    cyfervoid,
    ...ryscriptAgents,
    quill,
    agent(['echo', 'Echo', 'Editor', '#C6A6FF', '#2B2420', '#F0D2B8', false, 'Haiku 5.5'], { workspaceId: 'news-website', deskSlot: 0 }),
    agent(['aria', 'Aria', 'Frontend Developer', '#FFB3D1', '#5A3A24', '#F3D9C4', false, 'Sonnet 5.5'], {}),
    agent(['pax', 'Pax', 'Data Engineer', '#E8C99A', '#1F1A17', '#8E5B3E', true, 'GPT-5.6'], {})
  ]

  d.workspaces = [
    {
      id: 'ryscript', name: 'Ryscript', color: 'teal',
      goal: 'Build and sell HubSpot modules and themes for Cyfervoid, publish a weekly blog and answer support email.',
      folderPath: '', git: { baseBranch: 'main', branchPattern: 'agent/{agent}/{task-id}-{slug}', mergePolicy: 'ask' },
      orchestratorId: 'cyfervoid', agentIds: rows.map((r) => r[0]), lobbyPlot: { x: 13, z: 2, w: 6, d: 5 }
    },
    {
      id: 'news-website', name: 'News website', color: 'blue', goal: 'Keep the news site up to date.',
      folderPath: '', git: { baseBranch: 'main', branchPattern: 'agent/{agent}/{task-id}-{slug}', mergePolicy: 'ask' },
      orchestratorId: 'quill', agentIds: ['echo'], lobbyPlot: { x: 2, z: 2, w: 5, d: 4 }
    },
    {
      id: 'alumni-website', name: 'Alumni website', color: 'clay',
      goal: 'Maintain the alumni association website: fix bugs, publish event pages, and keep the member directory in sync.',
      folderPath: '', git: { baseBranch: 'main', branchPattern: 'agent/{agent}/{task-id}-{slug}', mergePolicy: 'ask' },
      agentIds: [], lobbyPlot: { x: 2, z: 13, w: 5, d: 4 }
    }
  ]

  d.missions = [
    {
      id: 'M-013', title: 'Daily HubSpot module batch', source: 'automation', workspaceId: 'ryscript', status: 'running', estUsagePct: 9,
      steps: [
        { taskId: 'T-072', title: 'Select 5 module ideas', assigneeId: 'nia', model: 'Sonnet 5.5' },
        { taskId: 'T-074', title: 'Breadcrumb, callout, video', assigneeId: 'rex', model: 'Sonnet 5.5', dependsOn: ['T-072'] },
        { taskId: 'T-076', title: 'Pricing table module', assigneeId: 'rex', model: 'Sonnet 5.5', dependsOn: ['T-072'] },
        { taskId: 'T-075', title: 'QA batch 1', assigneeId: 'kei', model: 'Sonnet 5.5', dependsOn: ['T-074'] },
        { taskId: 'T-077', title: 'QA pricing table', assigneeId: 'kei', model: 'Sonnet 5.5', dependsOn: ['T-076'] },
        { title: 'Open merge request', assigneeId: 'cyfervoid', model: 'Opus 5.5', gate: true, dependsOn: ['T-077'] }
      ]
    },
    {
      id: 'M-014', title: 'Weekly Cyfervoid blog article', source: 'jarvis', workspaceId: 'ryscript', status: 'awaiting_approval', estUsagePct: 6,
      steps: [
        { title: 'Pick a topic from HubSpot & dev trends', assigneeId: 'nia', model: 'Sonnet 5.5' },
        { title: 'Research and outline the article', assigneeId: 'mika', model: 'Sonnet 5.5' },
        { title: 'Write full draft (draft only)', assigneeId: 'mika', model: 'Sonnet 5.5' },
        { title: 'Create one thumbnail', assigneeId: 'mika', model: 'Sonnet 5.5' },
        { title: 'Upload as draft to Cyfervoid.com', assigneeId: 'cyfervoid', model: 'Opus 5.5', gate: true }
      ]
    },
    {
      id: 'M-015', title: 'Alumni website setup', source: 'jarvis', workspaceId: 'alumni-website', status: 'awaiting_approval', estUsagePct: 4,
      steps: [
        { title: 'Create orchestrator “Alma” on Sonnet 5.5', assigneeId: 'jarvis', model: 'Opus 5.5' },
        { title: 'Assign an existing agent as Frontend dev', assigneeId: 'jarvis', model: 'Opus 5.5' },
        { title: 'Scan the repo and write context.md', assigneeId: 'aria', model: 'Sonnet 5.5' }
      ]
    }
  ]

  const t = (
    id: string, title: string, assigneeId: string, status: DbSchema['tasks'][number]['status'], priority: 'low' | 'medium' | 'high',
    missionId: string | undefined, note?: string, extra: Partial<DbSchema['tasks'][number]> = {}
  ): DbSchema['tasks'][number] => ({
    id, title, assigneeId, status, priority, missionId, note, workspaceId: 'ryscript', dependsOn: [], criteria: [],
    createdAt: ago(600), createdBy: missionId ? 'cyfervoid' : 'user', ...extra
  })
  d.tasks = [
    t('T-072', 'Select 5 module ideas', 'nia', 'done', 'medium', 'M-013', undefined, { doneAt: ago(150) }),
    t('T-074', 'Breadcrumb, callout, video', 'rex', 'done', 'medium', 'M-013', 'Merged · +9237 −0', { dependsOn: ['T-072'], doneAt: ago(60) }),
    t('T-078', 'Testimonial slider module', 'rex', 'todo', 'medium', 'M-013'),
    t('T-079', 'Weekly blog: pick topic', 'nia', 'todo', 'low', 'M-014', 'Scheduled · Mon 9:00 AM'),
    t('T-080', 'Theme footer a11y fixes', 'tomo', 'todo', 'high', undefined),
    t('T-076', 'Pricing table module', 'rex', 'in_progress', 'high', 'M-013', 'Writing fields.json · 64%', {
      progress: 0.64, dependsOn: ['T-072'], branch: 'agent/rex/t-076-pricing-table',
      description: 'Build a pricing table module. Match the breadcrumb-trail.module structure.',
      criteria: [
        { text: '3 editable tiers', done: true }, { text: 'Monthly / yearly toggle', done: true },
        { text: 'README with usage', done: false }, { text: 'hs-lint with 0 errors', done: false }
      ]
    }),
    t('T-077', 'QA pricing table', 'kei', 'in_progress', 'medium', 'M-013', 'Waiting on T-076', { dependsOn: ['T-076'], progress: 0.3 }),
    t('T-081', 'Scan Marketplace top themes', 'wren', 'blocked', 'medium', undefined, 'Needs HubSpot Marketplace login', { progress: 0.2 }),
    t('T-022', 'Reply to email: Re: Test', 'shake', 'review', 'medium', undefined, 'Draft waiting for your approval', { createdBy: 'automation' }),
    t('T-075', 'Fix code block caption contrast', 'rex', 'done', 'medium', 'M-013', 'Merged · +47 −2', { doneAt: ago(2880) }),
    t('T-024', 'Thumbnail for draft article 34', 'mika', 'done', 'medium', undefined, 'No file changes · answer in report', { doneAt: ago(1500) }),
    t('T-023', 'Draft one Cyfervoid blog article', 'mika', 'done', 'medium', undefined, 'No file changes · answer in report', { doneAt: ago(1600) })
  ]

  d.runs = [
    {
      id: 'run-t076', taskId: 'T-076', agentId: 'rex', branch: 'agent/rex/t-076-pricing-table', startedAt: ago(14), tokens: 212_000,
      events: [
        { t: ago(14), kind: 'received', title: 'Received task from Cyfervoid', text: 'Build a pricing table module. Match the breadcrumb-trail.module structure.' },
        { t: ago(14), kind: 'read', title: 'Read 6 files', code: 'modules/breadcrumb-trail.module/*\ncontext.md' },
        { t: ago(11), kind: 'edit', title: 'Created module skeleton', code: '+ modules/pricing-table.module/meta.json\n+ modules/pricing-table.module/module.html' },
        { t: ago(5), kind: 'command', title: 'Ran hs-lint', text: '2 CSS warnings, no errors. Continuing.', level: 'warn' },
        { t: ago(4), kind: 'commit', title: 'Committed 3f9c2a1', text: 'T-076: pricing table fields' },
        { t: ago(0), kind: 'thinking', title: 'Writing fields.json…', text: 'Adding tier repeater group (name, price, features, CTA).' }
      ],
      report: 'Built pricing-table.module with 3 tiers, a monthly/yearly toggle and a highlighted plan. Fields are editable in the HubSpot page editor.\n\nOpen question for QA: the yearly toggle uses a small inline script. Check it passes the theme’s CSP.',
      filesChanged: [
        { path: 'pricing-table.module/module.html', additions: 188, deletions: 0 },
        { path: 'pricing-table.module/module.css', additions: 242, deletions: 0 },
        { path: 'pricing-table.module/fields.json', additions: 131, deletions: 0 },
        { path: 'pricing-table.module/meta.json', additions: 14, deletions: 0 }
      ]
    }
  ]

  d.changes = [
    { workspaceId: 'ryscript', branch: 'agent/rex/t-076-pricing-table', taskId: 'T-076', agentId: 'rex', commits: 3, additions: 612, deletions: 0, qa: 'passed', state: 'open', createdAt: ago(6), qaNote: '14 checks passed. Rendered at 375 and 1280 px. No console errors.' },
    { workspaceId: 'ryscript', branch: 'agent/tomo/t-080-footer-a11y', taskId: 'T-080', agentId: 'tomo', commits: 1, additions: 31, deletions: 18, qa: 'running', state: 'open', createdAt: ago(22) },
    { workspaceId: 'ryscript', branch: 'rex/auto-sc1792467675858-daily-hubspot-module-creation', agentId: 'rex', commits: 6, additions: 9237, deletions: 0, qa: 'passed', state: 'merged', createdAt: ago(70), mergedAt: ago(1) },
    { workspaceId: 'ryscript', branch: 'rex/t-075-fix-code-block-module-caption', taskId: 'T-075', agentId: 'rex', commits: 1, additions: 47, deletions: 2, qa: 'passed', state: 'merged', createdAt: ago(2900), mergedAt: ago(2880) }
  ]

  d.approvals = [
    {
      id: 'A-001', kind: 'send_email', title: 'Send email reply: “Re: Test”', requestedBy: 'shake', workspaceId: 'ryscript', taskId: 'T-022',
      via: 'Cyfervoid GMail', policy: 'Ask before sending', fields: [{ label: 'To', value: 'client@example.com' }, { label: 'Subject', value: 'Re: Test' }],
      body: 'Hi there,\n\nThanks for reaching out. We received your test message and everything is working on our side. If you have a HubSpot theme or module request, reply here and our team will get back to you within one business day.\n\nBest,\nCyfervoid Support',
      state: 'pending', createdAt: ago(80)
    },
    {
      id: 'A-002', kind: 'merge', title: 'Merge agent/rex/t-076-pricing-table', requestedBy: 'rex', workspaceId: 'ryscript', taskId: 'T-076',
      via: 'Git', policy: 'Merging asks you', fields: [{ label: 'Branch', value: 'agent/rex/t-076-pricing-table → main' }, { label: 'QA', value: 'Passed by Kei · 14 checks' }],
      body: '3 commits · +612 −0\n\nmodules/pricing-table.module/module.html\nmodules/pricing-table.module/module.css\nmodules/pricing-table.module/fields.json\nmodules/pricing-table.module/meta.json\nmodules/pricing-table.module/README.md',
      state: 'pending', createdAt: ago(34)
    },
    {
      id: 'A-003', kind: 'plan', title: 'Approve plan: Alumni website setup', requestedBy: 'jarvis', workspaceId: 'alumni-website', taskId: 'M-015',
      via: 'Jarvis', policy: 'New orchestrators ask you', fields: [{ label: 'Steps', value: '3 tasks · 1 new orchestrator' }, { label: 'Est. use', value: '≈ 4% of Claude Code LS' }],
      body: '1. Create orchestrator “Alma” on Sonnet 5.5\n2. Assign existing agent as Frontend developer\n3. Scan repo and write context.md',
      state: 'pending', createdAt: ago(98)
    },
    {
      id: 'A-004', kind: 'publish', title: 'Publish draft article ID 34', requestedBy: 'mika', workspaceId: 'ryscript', taskId: 'T-024',
      via: 'Cyfervoid.Com', policy: 'Ask before sending', fields: [{ label: 'Post', value: 'HubSpot themes vs modules: when to use each' }, { label: 'Status', value: 'Draft · thumbnail attached' }],
      body: 'Excerpt:\nThemes control the whole look of a HubSpot site. Modules are the reusable building blocks inside it. This post walks through when to build each, with three real Cyfervoid examples…',
      state: 'pending', createdAt: ago(1500)
    }
  ]

  d.integrations = [
    {
      id: 'cyfervoid-gmail', name: 'Cyfervoid GMail', type: 'gmail', agentIds: ['shake'], workspaceScope: ['ryscript'], status: 'connected',
      tools: [
        { name: 'read_inbox', description: 'Read new emails', policy: 'allowed' },
        { name: 'send_email', description: 'Send an email', policy: 'ask' }
      ]
    },
    {
      id: 'cyfervoid-com', name: 'Cyfervoid.Com', type: 'http', agentIds: ['mika'], workspaceScope: ['ryscript'], status: 'connected',
      tools: [
        { name: 'list_posts', description: 'Read posts and drafts', policy: 'allowed' },
        { name: 'get_post', description: 'Read one post', policy: 'allowed' },
        { name: 'create_draft_post', description: 'Create a draft', policy: 'allowed' },
        { name: 'update_draft_post', description: 'Edit a draft', policy: 'allowed' },
        { name: 'upload_media', description: 'Upload images', policy: 'allowed' },
        { name: 'publish_post', description: 'Make a post public', policy: 'ask' },
        { name: 'delete_post', description: 'Delete a post', policy: 'off' }
      ]
    },
    {
      id: 'web-search', name: 'Web search', type: 'mcp', agentIds: ['mika', 'nia', 'wren'], workspaceScope: 'all', status: 'connected',
      tools: [
        { name: 'WebSearch', description: 'Search the web', policy: 'allowed' },
        { name: 'WebFetch', description: 'Read a web page', policy: 'allowed' }
      ]
    }
  ]

  // Seeded schedules start disabled so a fresh install never spends quota on sample data.
  d.automations = [
    { id: 'au-modules', name: 'Daily HubSpot module batch', trigger: { type: 'schedule', cron: '0 9 * * 1-5' }, target: { workspaceId: 'ryscript' },
      prompt: 'Research 5 HubSpot module ideas missing from our library, build them, run QA, and open one merge request.', overLimit: 'ask', enabled: false,
      lastRun: { at: ago(300), result: 'succeeded' } },
    { id: 'au-blog', name: 'Weekly Cyfervoid blog article', trigger: { type: 'schedule', cron: '0 9 * * 1' }, target: { workspaceId: 'ryscript' },
      prompt: 'Have the team research and draft one blog article about HubSpot or web dev. Draft only; I review before publishing.', overLimit: 'ask', enabled: false },
    { id: 'au-support', name: 'Reply to support emails', trigger: { type: 'email', integrationId: 'cyfervoid-gmail' }, target: { workspaceId: 'ryscript' },
      prompt: 'Draft a reply to the new support email. Ask before sending.', overLimit: 'ask', enabled: false,
      lastRun: { at: ago(80), result: 'waiting' } },
    { id: 'au-digest', name: 'Nightly news digest', trigger: { type: 'schedule', cron: '0 23 * * *' }, target: { workspaceId: 'news-website' },
      prompt: 'Write a digest of today’s top stories as a draft page.', overLimit: 'skip', enabled: false,
      lastRun: { at: ago(17000), result: 'failed' } }
  ]

  d.delegation = [
    ['09:00', 'Mission M-013 received from automation “Daily module batch”.', 'info'],
    ['09:01', 'Split into 6 tasks. Assigned T-072 → Nia.', 'info'],
    ['10:12', 'T-072 done. Assigned T-074, T-076 → Rex.', 'info'],
    ['12:41', 'Kei: QA passed on T-074 (14 checks).', 'good'],
    ['12:44', 'Merged auto-sc1792467675858 → main (+9,237).', 'merge'],
    ['12:50', 'Wren blocked: needs Marketplace login. Asked you in Inbox.', 'bad']
  ].map(([hm, text, tone], i) => {
    const [h, m] = hm.split(':').map(Number)
    const at = new Date()
    at.setHours(h, m, 0, 0)
    return { id: 'd' + i, workspaceId: 'ryscript', t: at.toISOString(), text, tone: tone as 'info' }
  })

  d.conversations = [
    { id: 'c-status', title: 'Status of all workspaces', createdAt: ago(30), updatedAt: ago(29) },
    { id: 'c-blog', title: 'Weekly Cyfervoid blog', createdAt: ago(200), updatedAt: ago(190) }
  ]
  d.messages = [
    { id: 'm1', conversationId: 'c-status', role: 'user', text: 'Status of all workspaces?', createdAt: ago(30) },
    { id: 'm2', conversationId: 'c-status', role: 'jarvis', text: '**Ryscript** is busy: Rex just merged 5 new modules and Kei passed QA. **News website** is idle. **Alumni website** still needs an orchestrator. Want me to set one up?', createdAt: ago(29), missionId: 'M-015' },
    { id: 'm3', conversationId: 'c-blog', role: 'user', text: 'Every Monday, have the Cyfervoid team research and draft one blog article about HubSpot or web dev. I want to review it before anything is published.', createdAt: ago(200) },
    { id: 'm4', conversationId: 'c-blog', role: 'jarvis', text: 'Ryscript already has the right people: **Nia** (Market Researcher) and **Mika** (Content Writer). I’ll hand the plan to the **Cyfervoid** orchestrator and add a review gate before publishing. Nothing runs until you approve it.', createdAt: ago(199), missionId: 'M-014',
      toolSteps: [{ label: 'Looked at agents and accounts', ok: true }, { label: 'Read Cyfervoid context.md', ok: true }, { label: 'Checked Cyfervoid.Com tools', ok: true }] },
    { id: 'm5', conversationId: 'c-blog', role: 'user', text: 'Add a thumbnail too. Use Sonnet for drafting to save quota.', createdAt: ago(195) },
    { id: 'm6', conversationId: 'c-blog', role: 'jarvis', text: 'Done. I added step 4 (thumbnail, Mika) and kept Mika on `Sonnet 5.5`. Estimated use is about 6% of Claude Code LS each week. The plan on the right is updated.', createdAt: ago(190) }
  ]

  const days: [number, number, number][] = [[48, 8, 6], [22, 4, 5], [15, 0, 4], [55, 12, 8], [61, 10, 7], [58, 6, 9], [72, 9, 10]]
  d.usage = days.flatMap(([c, n, j], i) => [
    { day: day(6 - i), scope: 'ryscript', accountId: 'cc-ls', tokens: c * 10_000 },
    { day: day(6 - i), scope: 'news-website', accountId: 'cc-ls', tokens: n * 10_000 },
    { day: day(6 - i), scope: 'jarvis', accountId: 'cc-ls', tokens: j * 10_000 }
  ])

  d.movedAgents = { agentIds: [], from: 'cc-roy', to: 'cc-ls', at: ago(120) }
  d.counters = { task: 81, mission: 15, approval: 4 }
  return d
}
