/**
 * Jarvis: the global assistant. Each turn is a Claude Code CLI call that
 * resumes the conversation's session and may read workspace folders first.
 * When the user asks for work, Jarvis answers with a ```mission block that
 * becomes a draft Mission card; a block that fails the checks goes back to
 * Jarvis to fix, a couple of times at most.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ChatMessage } from '@shared/types'
import type { ChatAttachment, ChatUpload, Conversation } from '@shared/app-types'
import { commit, db, findAgent, now, uid } from './db'
import { emit } from './bus'
import { spawnClaude, isAnthropicModel, type ClaudeEvent } from './claude'
import { account, recordRateLimit, recordUsage } from './accounts'
import { buildMission, type StoredMission } from './orchestrator'
import { cleanStepDeps } from './graph'

const busy = new Set<string>()
const READ_TOOLS = ['Read', 'Glob', 'Grep']
const MAX_FIXES = 2
const MAX_TURNS = 8 // steps (file reads, replies) one Jarvis call may take
const INLINE_MAX = 60_000 // text attachments up to this size go straight into the prompt

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

/** Drop chats with their messages and uploaded files; a chat Jarvis is still answering stays. Returns how many went. */
export function deleteConversations(ids: string[]): number {
  const want = new Set(ids)
  if ([...want].every((id) => busy.has(id))) throw new Error('Jarvis is still answering in that chat')
  const gone = new Set(db().conversations.filter((c) => want.has(c.id) && !busy.has(c.id)).map((c) => c.id))
  if (!gone.size) return 0
  db().conversations = db().conversations.filter((c) => !gone.has(c.id))
  db().messages = db().messages.filter((m) => !gone.has(m.conversationId))
  for (const id of gone) rmSync(join(cwd(), 'attachments', id), { recursive: true, force: true })
  commit('conversations')
  return gone.size
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

/** Keep uploads next to the conversation, inside Jarvis's folder so its Read tool can open them. */
function saveUploads(conversationId: string, uploads: ChatUpload[]): ChatAttachment[] {
  const dir = join(cwd(), 'attachments', conversationId)
  mkdirSync(dir, { recursive: true })
  return uploads.map((u) => {
    const safe = basename(u.name).replace(/[^\w.\- ]+/g, '_').slice(-80) || 'file'
    const path = join(dir, `${uid('a-')}-${safe}`)
    writeFileSync(path, u.bytes)
    return { name: u.name, size: u.bytes.byteLength, kind: u.kind, path }
  })
}

function attachmentBlock(list: ChatAttachment[]): string {
  const items = list.map((a) => {
    const head = `<attachment name="${a.name.replace(/"/g, "'")}" path="${a.path}" size="${a.size}">`
    const buf = a.size <= INLINE_MAX ? readFileSync(a.path) : undefined
    const text = buf && !buf.subarray(0, 8000).includes(0) ? buf.toString('utf8') : undefined
    return text === undefined ? `${head}Open it with Read.</attachment>` : `${head}\n${text}\n</attachment>`
  })
  return `<attachments>\n${items.join('\n')}\n</attachments>`
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

/**
 * Workspaces and agents the user @-mentioned (the composer inserts `@<name>`), resolved
 * longest name first so "@News website" doesn't also count as an agent called "News".
 */
function mentions(text: string): string {
  const d = db()
  const named = [
    ...d.workspaces.map((w) => ({ name: w.name, what: `workspace **${w.name}** (folder: ${w.folderPath || 'not set'})` })),
    ...d.agents.map((a) => {
      const ws = d.workspaces.find((w) => w.id === a.workspaceId)
      return { name: a.name, what: `${a.kind === 'orchestrator' ? 'orchestrator' : 'agent'} **${a.name}**, ${a.role}, ${ws ? `in workspace **${ws.name}**` : 'in the unassigned pool'}` }
    })
  ].sort((a, b) => b.name.length - a.name.length)
  let rest = text.toLowerCase()
  const out: string[] = []
  // a mention starts the text or follows whitespace ("me@news.com" is not one) and is a whole
  // name ("@Echo" must not match inside "@Echoes")
  const at = (tag: string, i: number) => (i === 0 || /\s/.test(rest[i - 1])) && !/[\p{L}\p{N}_-]/u.test(rest[i + tag.length] ?? '')
  for (const n of named) {
    const tag = `@${n.name.toLowerCase()}`
    let found = false
    for (let i = rest.indexOf(tag); i >= 0; i = rest.indexOf(tag, i + 1)) {
      if (!at(tag, i)) continue
      found = true
      rest = rest.slice(0, i) + ' '.repeat(tag.length) + rest.slice(i + tag.length)
    }
    if (found) out.push(`- @${n.name} → ${n.what}`)
  }
  return out.join('\n')
}

const SYSTEM = `You are Jarvis, the user's main assistant in a desktop app that runs teams of AI agents.
Each workspace is a project folder with one orchestrator and several agents. You never do the work yourself; you plan it and hand it to a workspace.
You can read workspace folders with Read, Glob and Grep to check facts before you plan. Never change files.
Files the user attaches are listed in <attachments>; open the ones not shown inline (images, PDFs, large files) with Read.
Workspaces and agents the user @-mentions are resolved in <mentions>; those are exactly the ones they mean.
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

function extractMission(text: string): { clean: string; block?: MissionBlock; error?: string } {
  const m = text.match(/```mission\s*([\s\S]*?)```/)
  if (!m) return { clean: text }
  try {
    return { clean: text.replace(m[0], '').trim(), block: JSON.parse(m[1]) }
  } catch (e) {
    return { clean: text, error: `The mission block is not valid JSON (${(e as Error).message}).` }
  }
}

/** What is wrong with a mission block, in words Jarvis can act on. */
function validateMission(block: MissionBlock): string[] {
  const d = db()
  const ws = d.workspaces.find((w) => w.name.toLowerCase() === block.workspace?.toLowerCase())
  if (!ws) return [`Unknown workspace "${block.workspace}". Workspaces: ${d.workspaces.map((w) => w.name).join(', ') || 'none'}.`]
  if (!Array.isArray(block.steps) || !block.steps.length) return ['The mission has no steps.']
  const names = d.agents.filter((a) => a.workspaceId === ws.id).map((a) => a.name)
  const problems = block.steps.flatMap((s, i) => {
    const n = String(s.assignee ?? '').trim().toLowerCase()
    return n && names.some((a) => n === a.toLowerCase() || n.includes(a.toLowerCase()))
      ? []
      : [`Step ${i + 1}: "${s.assignee}" is not in ${ws.name}. Agents there: ${names.join(', ') || 'none'}.`]
  })
  return [...problems, ...cleanStepDeps(block.steps).problems.map((p) => `${p[0].toUpperCase()}${p.slice(1)}.`)]
}

function toolLabel(e: Extract<ClaudeEvent, { type: 'tool' }>): string {
  const i = e.input as { file_path?: string; pattern?: string }
  if (e.name === 'Read' && i.file_path) return `Read ${basename(i.file_path)}`
  if (e.name === 'Grep' && i.pattern) return `Searched for “${i.pattern}”`
  if (e.name === 'Glob' && i.pattern) return `Listed ${i.pattern}`
  return `Used ${e.name}`
}

export async function send(conversationId: string, text: string, uploads: ChatUpload[] = []): Promise<void> {
  const conv = db().conversations.find((c) => c.id === conversationId)
  if (!conv) throw new Error('Conversation not found')
  if (busy.has(conversationId)) throw new Error('Jarvis is still answering')
  const attachments = uploads.length ? saveUploads(conversationId, uploads) : undefined
  addMessage({ conversationId, role: 'user', text, attachments })
  if (conv.title === 'New chat') conv.title = (text || attachments?.[0].name || conv.title).slice(0, 48)

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
    const dirs = [...new Set(db().workspaces.map((w) => w.folderPath).filter((p) => p && existsSync(p)))]
    const ask = async (prompt: string) => {
      const h = spawnClaude(
        {
          prompt,
          cwd: cwd(),
          model: cfg.model,
          account: acct,
          thinking: cfg.thinking,
          systemPrompt: SYSTEM,
          tools: READ_TOOLS,
          addDirs: dirs,
          resume: conv.sessionId,
          timeoutMs: 5 * 60_000,
          maxTurns: MAX_TURNS
        },
        (e) => {
          if (e.type === 'init') conv.sessionId = e.sessionId
          if (e.type === 'rate_limit' && acct) recordRateLimit(acct.id, e.status, e.resetsAt)
          if (e.type === 'tool') steps.push({ label: toolLabel(e), ok: true })
        }
      )
      const r = await h.done
      if (acct) recordUsage(acct.id, 'jarvis', r.tokens)
      return r
    }
    const files = attachments ? `\n\n${attachmentBlock(attachments)}` : ''
    const tagged = mentions(text)
    const picked = tagged ? `\n\n<mentions>\n${tagged}\n</mentions>` : ''
    const r = await ask(`${text || 'Have a look at the attached files.'}${files}${picked}\n\n<app_state>\n${stateSummary()}\n</app_state>`)
    if (!r.ok && r.reason === 'error_max_turns') {
      // the session is fine, it just ran out of steps; keep it so the next message carries on
      steps.push({ label: `Stopped after ${MAX_TURNS} steps`, ok: false })
      addMessage({ conversationId, role: 'jarvis', text: 'I read a lot without reaching an answer. Point me at a file or narrow the question.', toolSteps: steps })
      return
    }
    if (!r.ok) {
      // a stale session id is the usual cause; drop it so the next turn starts fresh
      conv.sessionId = undefined
      addMessage({ conversationId, role: 'jarvis', text: `Something went wrong: ${r.text}`, toolSteps: [{ label: 'Claude Code call failed', ok: false }] })
      return
    }
    let parsed = extractMission(r.text)
    for (let i = 0; i < MAX_FIXES; i++) {
      const problems = parsed.error ? [parsed.error] : parsed.block ? validateMission(parsed.block) : []
      if (!problems.length) break
      const again = await ask(`Your mission block had these problems:\n${problems.map((p) => `- ${p}`).join('\n')}\nReply again with the short explanation and one corrected mission block.`)
      if (!again.ok) break
      parsed = extractMission(again.text)
      steps.push({ label: `Fixed plan: ${problems.join(' ')}`, ok: true })
    }
    const { clean, block, error } = parsed
    if (error) steps.push({ label: error, ok: false })
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
