import { safeStorage } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AnyAgent, PlanUsage, StoredAccount } from '@shared/app-types'
import { MODELS, isConnected } from '@shared/app-types'
import { commit, db, now } from './db'
import { emit, toast } from './bus'

/** Encrypt with the OS keychain (DPAPI on Windows) before it touches db.json. */
export function setApiKey(a: StoredAccount, key: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system, so the API key cannot be saved safely.')
  a.keyEnc = safeStorage.encryptString(key).toString('base64')
  a.hasKey = true
  a.keyHint = `${key.slice(0, 7)}…${key.slice(-4)}`
}

export function apiKeyOf(a: StoredAccount): string | undefined {
  return a.keyEnc ? safeStorage.decryptString(Buffer.from(a.keyEnc, 'base64')) : undefined
}

/** The account as the renderer may see it: never the key itself. */
export function publicAccount({ keyEnc: _k, ...a }: StoredAccount): StoredAccount {
  return a
}

/** Ask the provider whether it accepts the key. Only a clear 401/403 counts as rejected. */
export async function verifyKey(provider: StoredAccount['provider'], key: string): Promise<'ok' | 'rejected' | 'unknown'> {
  try {
    const r =
      provider === 'anthropic'
        ? await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(10_000) })
        : await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
    if (r.status === 401 || r.status === 403) return 'rejected'
    return r.ok ? 'ok' : 'unknown'
  } catch {
    return 'unknown'
  }
}

const WINDOW_MS: Record<StoredAccount['window'], number> = {
  '5h': 5 * 3600_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000
}

/** Real plan numbers younger than this win over our own token estimate. */
const PLAN_FRESH_MS = 15 * 60_000
const planFresh = (a: StoredAccount): boolean => !!a.plan && Date.now() - Date.parse(a.plan.at) < PLAN_FRESH_MS

function roll(a: StoredAccount): void {
  const start = a.windowStart ? Date.parse(a.windowStart) : 0
  if (!start || Date.now() - start > WINDOW_MS[a.window]) {
    a.windowStart = now()
    a.windowTokens = 0
    if (planFresh(a)) return
    a.usagePct = 0
    a.resetAt = new Date(Date.now() + WINDOW_MS[a.window]).toISOString()
  }
}

function configDirOf(a: StoredAccount): string {
  const d = a.configDir?.trim() || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return d.replace(/^~(?=$|[\\/])/, homedir())
}

/**
 * The account's real subscription usage: the endpoint Claude Code's /usage and the IDE
 * panel read. Uses the CLI's saved sign-in token but never refreshes it (refreshing
 * rotates the token and would log the CLI out); an expired token just means we wait
 * for the CLI's next run. No credentials file (e.g. macOS keychain) keeps the estimate.
 */
async function fetchPlan(a: StoredAccount): Promise<PlanUsage | null> {
  let token: string | undefined
  try {
    const c = JSON.parse(await readFile(join(configDirOf(a), '.credentials.json'), 'utf8')).claudeAiOauth
    if (typeof c?.expiresAt === 'number' && c.expiresAt < Date.now()) return null
    token = c?.accessToken
  } catch {
    return null
  }
  if (!token) return null
  try {
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!r.ok) return null
    type Win = { utilization?: number | null; resets_at?: string | null } | null | undefined
    const j = (await r.json()) as { five_hour?: Win; seven_day?: Win }
    const win = (w: Win) => (w && typeof w.utilization === 'number' ? { pct: Math.round(w.utilization), resetsAt: w.resets_at ?? undefined } : undefined)
    const plan = { session: win(j.five_hour), weekly: win(j.seven_day), at: now() }
    return plan.session || plan.weekly ? plan : null
  } catch {
    return null
  }
}

/** The tighter of the two windows drives the limit policy (stop at / warn at / switch). */
function applyPlan(a: StoredAccount, plan: PlanUsage): void {
  a.plan = plan
  const tight = [plan.session, plan.weekly].filter((w) => !!w).sort((x, y) => y!.pct - x!.pct)[0]!
  a.usagePct = tight.pct
  if (tight.resetsAt) a.resetAt = tight.resetsAt
  emit('account:usage', { accountId: a.id, usagePct: a.usagePct })
}

let lastRefresh = 0
let soon: ReturnType<typeof setTimeout> | undefined

/** Pull real usage for every Claude Code sign-in. Calls within 20 s of the last one are skipped unless forced. */
export async function refreshPlans(force = false): Promise<void> {
  if (!force && Date.now() - lastRefresh < 20_000) return
  lastRefresh = Date.now()
  const list = db().accounts.filter((a) => a.auth === 'claude_code')
  const plans = await Promise.all(list.map(fetchPlan))
  let changed = false
  plans.forEach((p, i) => {
    if (!p) return
    applyPlan(list[i], p)
    changed = true
  })
  if (changed) commit('accounts')
}

/** After a run spends tokens, re-read the real numbers once things settle. */
function refreshSoon(): void {
  soon ??= setTimeout(() => {
    soon = undefined
    refreshPlans(true).catch(() => undefined)
  }, 15_000)
}

export function account(id: string): StoredAccount | undefined {
  return db().accounts.find((a) => a.id === id)
}

/** Record tokens spent by a run or Jarvis turn. */
export function recordUsage(accountId: string, scope: string, tokens: number): void {
  const a = account(accountId)
  if (!a || tokens <= 0) return
  roll(a)
  a.windowTokens += tokens
  if (a.auth === 'claude_code') refreshSoon()
  // the plan's own numbers include usage outside Jarvis (IDE, CLI, claude.ai); only estimate without them
  if (!planFresh(a)) a.usagePct = Math.min(100, Math.round((a.windowTokens / Math.max(1, a.budgetTokens)) * 100))
  const day = new Date().toISOString().slice(0, 10)
  const s = db().usage.find((u) => u.day === day && u.scope === scope && u.accountId === accountId)
  if (s) s.tokens += tokens
  else db().usage.push({ day, scope, accountId, tokens })
  emit('account:usage', { accountId, usagePct: a.usagePct })
  commit('accounts', 'usage')
}

/** CLI reported its real window state; trust it over our estimate. */
export function recordRateLimit(accountId: string, status: string, resetsAt?: number): void {
  const a = account(accountId)
  if (!a) return
  if (resetsAt) a.resetAt = new Date(resetsAt * 1000).toISOString()
  if (status && status !== 'allowed') a.usagePct = Math.max(a.usagePct, 100)
  commit('accounts')
}

function provider(model: string): 'anthropic' | 'openai' {
  return MODELS.find((m) => m.name === model)?.provider ?? 'anthropic'
}

/**
 * Pick the account an agent should run on right now, applying the limit policy.
 * Returns null when the policy says to pause.
 */
export function accountFor(agent: AnyAgent): { account: StoredAccount; switched: boolean } | { blocked: string } {
  const p = db().limitPolicy
  const a = account(agent.accountId)
  if (!a) return { blocked: `Account ${agent.accountId} not found` }
  if (!isConnected(a)) return { blocked: `${a.name} is not connected${a.auth === 'api_key' ? '. Add its API key in AI Accounts' : ''}.` }
  roll(a)
  if (a.usagePct < p.stopAt) return { account: a, switched: false }
  if (agent.pinnedToAccount || p.whenClose === 'pause') return { blocked: `${a.name} is at ${a.usagePct}% (stop at ${p.stopAt}%)` }
  if (p.whenClose === 'ask') return { blocked: `${a.name} is near its limit. Switch the agent's account or raise the limit.` }
  const alt = db()
    .accounts.filter((x) => x.id !== a.id && isConnected(x) && x.provider === provider(agent.model) && (roll(x), x.usagePct < p.warnAt))
    .sort((x, y) => x.usagePct - y.usagePct)[0]
  if (!alt) return { blocked: `No ${provider(agent.model)} account has room` }
  const from = a.id
  agent.accountId = alt.id
  const mv = db().movedAgents
  if (mv && mv.from === from && mv.to === alt.id) mv.agentIds = [...new Set([...mv.agentIds, agent.id])]
  else db().movedAgents = { agentIds: [agent.id], from, to: alt.id, at: now() }
  emit('jarvis:movedAgents', { from, to: alt.id, count: db().movedAgents!.agentIds.length, at: now() })
  toast(`Jarvis moved ${agent.name} from ${a.name} to ${alt.name}`)
  commit('agents', 'accounts')
  return { account: alt, switched: true }
}

export function moveBack(): void {
  const mv = db().movedAgents
  if (!mv) return
  for (const id of mv.agentIds) {
    const ag = db().agents.find((x) => x.id === id)
    if (ag) ag.accountId = mv.from
  }
  db().movedAgents = undefined
  commit('agents')
}

/** Called on a timer: when switchBack is on, return moved agents once the source window reset. */
export function tickAccounts(): void {
  db().accounts.forEach(roll)
  const mv = db().movedAgents
  if (mv && db().limitPolicy.switchBack) {
    const src = account(mv.from)
    if (src && src.usagePct < db().limitPolicy.warnAt && mv.agentIds.length) moveBack()
  }
  commit('accounts')
}
