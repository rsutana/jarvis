import type { AnyAgent, StoredAccount } from '@shared/app-types'
import { MODELS } from '@shared/app-types'
import { commit, db, now } from './db'
import { emit, toast } from './bus'

const WINDOW_MS: Record<StoredAccount['window'], number> = {
  '5h': 5 * 3600_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000
}

function roll(a: StoredAccount): void {
  const start = a.windowStart ? Date.parse(a.windowStart) : 0
  if (!start || Date.now() - start > WINDOW_MS[a.window]) {
    a.windowStart = now()
    a.windowTokens = 0
    a.usagePct = 0
    a.resetAt = new Date(Date.now() + WINDOW_MS[a.window]).toISOString()
  }
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
  a.usagePct = Math.min(100, Math.round((a.windowTokens / Math.max(1, a.budgetTokens)) * 100))
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
  roll(a)
  if (a.usagePct < p.stopAt) return { account: a, switched: false }
  if (agent.pinnedToAccount || p.whenClose === 'pause') return { blocked: `${a.name} is at ${a.usagePct}% (stop at ${p.stopAt}%)` }
  if (p.whenClose === 'ask') return { blocked: `${a.name} is near its limit. Switch the agent's account or raise the limit.` }
  const alt = db()
    .accounts.filter((x) => x.id !== a.id && x.provider === provider(agent.model) && (roll(x), x.usagePct < p.warnAt))
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
