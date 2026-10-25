/**
 * Jarvis: the global assistant. Each turn is one Claude Code CLI call that
 * resumes the conversation's session. When the user asks for work, Jarvis
 * answers with a ```mission block that becomes a draft Mission card.
 */
import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage } from '@shared/types'
import type { Conversation } from '@shared/app-types'
import { commit, db, findAgent, now, uid } from './db'
import { emit } from './bus'
import { spawnClaude, isAnthropicModel } from './claude'
import { account, recordRateLimit, recordUsage } from './accounts'
import { buildMission, type StoredMission } from './orchestrator'

const busy = new Set<string>()

function cwd(): string {
  const d = join(app.getPath('userData'), 'jarvis')
  mkdirSync(d, { recursive: true })
  return d
}

export function newConversation(title = 'New chat'): Conversation {
  const c: Conversation = { id: uid('c-'), title, createdAt: now(), updatedAt: now() }
  db().conversations.unshift(c)
  commit('conversations')
  return c
}

function addMessage(m: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
  const msg: ChatMessage = { ...m, id: uid('m-'), createdAt: now() }
  db().messages.push(msg)
  const c = db().conversations.find((x) => x.id === m.conversationId)
  if (c) c.updatedAt = msg.createdAt
  emit('jarvis:message', msg)
  commit('conversations')
  return msg
}

/** What Jarvis knows about the app each turn. */
function stateSummary(): string {
  const d = db()
  const ws = d.workspaces
    .map((w) => {
      const agents = d.agents.filter((a) => a.workspaceId === w.id)
      const orch = agents.find((a) => a.kind === 'orchestrator')
      const team = agents
        .filter((a) => a.kind === 'agent')
        .map((a) => `${a.name} (${a.role}, ${a.model}, ${a.status})`)
        .join('; ')
      const open = d.tasks.filter((t) => t.workspaceId === w.id && t.status !== 'done')
      return `- ${w.name}: goal "${w.goal}". Orchestrator: ${orch?.name ?? 'none (setup incomplete)'}. Folder: ${w.folderPath || 'not set'}${w.repos?.length ? ` (repos: ${w.repos.map((r) => r.path).join(', ')})` : ''}. Team: ${team || 'none'}. Open tasks: ${open.map((t) => `${t.id} ${t.title} [${t.status}]`).join(', ') || 'none'}.`
    })
    .join('\n')
  const pool = d.agents.filter((a) => !a.workspaceId).map((a) => `${a.name} (${a.role})`).join(', ')
  const pending = d.approvals.filter((a) => a.state === 'pending').map((a) => a.title).join('; ')
  const accts = d.accounts.map((a) => `${a.name} ${a.usagePct}%`).join(', ')
  return [
    `Today is ${new Date().toDateString()}.`,
    `Workspaces:\n${ws || '(none yet)'}`,
    `Agent pool (unassigned): ${pool || 'none'}`,
    `Waiting for the user's approval: ${pending || 'nothing'}`,
    `AI accounts usage: ${accts}`
  ].join('\n\n')
}

const SYSTEM = `You are Jarvis, the user's main assistant in a desktop app that runs teams of AI agents.
Each workspace is a project folder with one orchestrator and several agents. You never do the work yourself; you plan it and hand it to a workspace.
Be brief and concrete. Use **bold** for names. Plain markdown only.
When the user asks for work to be done, reply with a short explanation and then exactly one fenced block:
\`\`\`mission
{"workspace":"<workspace name>","title":"<short title>","steps":[{"title":"...","assignee":"<agent name>","gate":false,"dependsOn":[]}],"schedule":"<optional 5-field cron if the user asked for a recurring job>"}
\`\`\`
Use only agents that are in that workspace. dependsOn holds 0-based indexes of earlier steps. Set gate true for steps that send, publish or merge. Nothing runs until the user approves the card.`

interface MissionBlock {
  workspace: string
  title: string
  steps: { title: string; assignee: string; gate?: boolean; dependsOn?: number[] }[]
  schedule?: string
}

function extractMission(text: string): { clean: string; block?: MissionBlock } {
  const m = text.match(/```mission\s*([\s\S]*?)```/)
  if (!m) return { clean: text }
  try {
    return { clean: text.replace(m[0], '').trim(), block: JSON.parse(m[1]) }
  } catch {
    return { clean: text }
  }
}

export async function send(conversationId: string, text: string): Promise<void> {
  const conv = db().conversations.find((c) => c.id === conversationId)
  if (!conv) throw new Error('Conversation not found')
  if (busy.has(conversationId)) throw new Error('Jarvis is still answering')
  addMessage({ conversationId, role: 'user', text })
  if (conv.title === 'New chat') conv.title = text.slice(0, 48)

  const cfg = db().jarvis
  if (!isAnthropicModel(cfg.model)) {
    addMessage({ conversationId, role: 'jarvis', text: `I'm set to **${cfg.model}**, which needs the Codex runner. Switch my brain to a Claude model in AI Accounts.` })
    return
  }
  busy.add(conversationId)
  emit('jarvis:typing', { conversationId, typing: true })
  const steps: { label: string; ok: boolean }[] = [{ label: 'Looked at workspaces, agents and accounts', ok: true }]
  try {
    const acct = account(cfg.accountId)
    const h = spawnClaude(
      {
        prompt: `${text}\n\n<app_state>\n${stateSummary()}\n</app_state>`,
        cwd: cwd(),
        model: cfg.model,
        account: acct,
        thinking: cfg.thinking,
        systemPrompt: SYSTEM,
        tools: [],
        resume: conv.sessionId,
        timeoutMs: 5 * 60_000
      },
      (e) => {
        if (e.type === 'init') conv.sessionId = e.sessionId
        if (e.type === 'rate_limit' && acct) recordRateLimit(acct.id, e.status, e.resetsAt)
      }
    )
    const r = await h.done
    if (acct) recordUsage(acct.id, 'jarvis', r.tokens)
    if (!r.ok) {
      // a stale session id is the usual cause; drop it so the next turn starts fresh
      conv.sessionId = undefined
      addMessage({ conversationId, role: 'jarvis', text: `Something went wrong: ${r.text}`, toolSteps: [{ label: 'Claude Code call failed', ok: false }] })
      return
    }
    const { clean, block } = extractMission(r.text)
    let missionId: string | undefined
    if (block) {
      const ws = db().workspaces.find((w) => w.name.toLowerCase() === block.workspace?.toLowerCase())
      if (ws) {
        const m: StoredMission = buildMission(
          ws.id,
          { title: block.title, steps: block.steps.map((s) => ({ ...s, dependsOn: s.dependsOn ?? [] })) },
          'jarvis',
          text
        )
        m.status = 'awaiting_approval'
        m.schedule = block.schedule
        missionId = m.id
        steps.push({ label: `Drafted mission ${m.id} for ${ws.name}`, ok: true })
        commit('missions')
      } else steps.push({ label: `Unknown workspace “${block.workspace}”`, ok: false })
    }
    addMessage({ conversationId, role: 'jarvis', text: clean || 'Here is the plan.', missionId, toolSteps: steps })
  } finally {
    busy.delete(conversationId)
    emit('jarvis:typing', { conversationId, typing: false })
    commit('conversations')
  }
}

export function messages(conversationId: string): ChatMessage[] {
  return db().messages.filter((m) => m.conversationId === conversationId)
}

export function agentName(id: string): string {
  return id === 'jarvis' ? 'Jarvis' : (findAgent(id)?.name ?? id)
}
