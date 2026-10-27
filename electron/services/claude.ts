/**
 * Thin wrapper over the Claude Code CLI in print mode.
 * Every agent run, Jarvis turn and orchestrator plan goes through spawnClaude().
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeCheck, StoredAccount } from '@shared/app-types'
import { MODELS } from '@shared/app-types'
import { db } from './db'
import { apiKeyOf } from './accounts'

export interface ClaudeOptions {
  prompt: string
  cwd: string
  model: string // UI model name, e.g. "Sonnet 5.5"
  account?: StoredAccount
  systemPrompt?: string
  tools: string[] // built-in tools to expose; [] = none
  allowEdits?: boolean
  addDirs?: string[] // extra folders the agent may read (e.g. shared skill folders)
  resume?: string
  jsonSchema?: object
  timeoutMs?: number
  maxTurns?: number // cap on the CLI's own tool loop; stops with reason 'error_max_turns'
  thinking?: 'default' | 'medium' | 'high'
}

/** Normalised stream events, independent of the CLI's JSON shapes. */
export type ClaudeEvent =
  | { type: 'init'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; text: string; isError: boolean }
  | { type: 'usage'; tokens: number }
  | { type: 'rate_limit'; status: string; resetsAt?: number; window?: string }
  | { type: 'result'; ok: boolean; text: string; sessionId?: string; tokens: number; structured?: unknown; costUsd?: number; reason?: string }
  | { type: 'stderr'; text: string }

export interface ClaudeHandle {
  child: ChildProcess
  done: Promise<Extract<ClaudeEvent, { type: 'result' }>>
  kill: () => void
}

export function claudeBin(): string {
  const p = db().settings.claudePath
  // libuv resolves claude.exe on Windows without a shell, which keeps prompt args unmangled
  return p || 'claude'
}

function envFor(account?: StoredAccount): NodeJS.ProcessEnv {
  const env = { ...process.env }
  // common install location that GUI-launched apps often miss on PATH
  const local = join(homedir(), '.local', 'bin')
  if (!env.PATH?.includes(local)) env.PATH = `${local}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}`
  if (account?.auth === 'api_key') {
    const key = apiKeyOf(account)
    if (!key) throw new Error(`${account.name} has no API key yet. Add it in AI Accounts.`)
    env.ANTHROPIC_API_KEY = key
  } else if (account) {
    // a sign-in account must use its login, not a key that happens to be in the app's environment
    delete env.ANTHROPIC_API_KEY
    if (account.configDir) env.CLAUDE_CONFIG_DIR = account.configDir
  }
  return env
}

export function cliModel(name: string): string {
  return MODELS.find((m) => m.name === name)?.cli ?? name
}

export function isAnthropicModel(name: string): boolean {
  return (MODELS.find((m) => m.name === name)?.provider ?? 'anthropic') === 'anthropic'
}

function tokensOf(usage: Record<string, number> | undefined): number {
  if (!usage) return 0
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
}

export function spawnClaude(opts: ClaudeOptions, onEvent: (e: ClaudeEvent) => void): ClaudeHandle {
  const args = ['-p', opts.prompt, '--output-format', 'stream-json', '--verbose', '--model', cliModel(opts.model)]
  args.push('--permission-mode', opts.allowEdits ? 'acceptEdits' : 'dontAsk')
  args.push('--tools', opts.tools.length ? opts.tools.join(',') : '')
  if (opts.tools.length) args.push('--allowedTools', opts.tools.join(','))
  if (!db().settings.loadUserClaudeSettings) args.push('--setting-sources', 'project,local')
  if (opts.systemPrompt) args.push('--append-system-prompt', opts.systemPrompt)
  if (opts.resume) args.push('--resume', opts.resume)
  if (opts.jsonSchema) args.push('--json-schema', JSON.stringify(opts.jsonSchema))
  if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns))
  for (const d of opts.addDirs ?? []) args.push('--add-dir', d)

  const env = envFor(opts.account)
  if (opts.thinking === 'high') env.MAX_THINKING_TOKENS = '24000'
  else if (opts.thinking === 'medium') env.MAX_THINKING_TOKENS = '8000'

  const child = spawn(claudeBin(), args, { cwd: opts.cwd, env, windowsHide: true })
  child.stdin?.end()
  let buf = ''
  let tokens = 0
  let sessionId: string | undefined
  let result: Extract<ClaudeEvent, { type: 'result' }> | undefined
  let stderr = ''

  const handle = (line: string): void => {
    let m: Record<string, any>
    try {
      m = JSON.parse(line)
    } catch {
      return
    }
    if (m.type === 'system' && m.subtype === 'init') {
      sessionId = m.session_id
      onEvent({ type: 'init', sessionId: m.session_id })
    } else if (m.type === 'assistant') {
      for (const c of m.message?.content ?? []) {
        if (c.type === 'text' && c.text) onEvent({ type: 'text', text: c.text })
        else if (c.type === 'thinking' && c.thinking) onEvent({ type: 'thinking', text: c.thinking })
        else if (c.type === 'tool_use') onEvent({ type: 'tool', id: c.id, name: c.name, input: c.input ?? {} })
      }
      const t = tokensOf(m.message?.usage)
      if (t) {
        tokens += t
        onEvent({ type: 'usage', tokens: t })
      }
    } else if (m.type === 'user') {
      for (const c of m.message?.content ?? []) {
        if (c.type === 'tool_result') {
          const text = Array.isArray(c.content) ? c.content.map((x: { text?: string }) => x.text ?? '').join('\n') : String(c.content ?? '')
          onEvent({ type: 'tool_result', id: c.tool_use_id, text, isError: !!c.is_error })
        }
      }
    } else if (m.type === 'rate_limit_event') {
      const i = m.rate_limit_info ?? {}
      onEvent({ type: 'rate_limit', status: i.status, resetsAt: i.resetsAt, window: i.rateLimitType })
    } else if (m.type === 'result') {
      const total = tokensOf(m.usage) || tokens
      result = {
        type: 'result',
        ok: m.subtype === 'success' && !m.is_error,
        text: m.result ?? (m.errors ? String(m.errors) : m.subtype),
        sessionId: m.session_id ?? sessionId,
        tokens: total,
        structured: m.structured_output,
        costUsd: m.total_cost_usd,
        reason: m.subtype
      }
      onEvent(result)
    }
  }

  child.stdout?.on('data', (d: Buffer) => {
    buf += d.toString()
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) handle(line)
    }
  })
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
    onEvent({ type: 'stderr', text: d.toString() })
  })

  let timer: NodeJS.Timeout | undefined
  if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs)

  const done = new Promise<Extract<ClaudeEvent, { type: 'result' }>>((resolve) => {
    const finish = (code: number | null, err?: Error): void => {
      if (timer) clearTimeout(timer)
      if (buf.trim()) handle(buf.trim())
      if (result) return resolve(result)
      const msg = err
        ? err.message.includes('ENOENT')
          ? `Claude Code CLI not found (${claudeBin()}). Install it or set its path in Settings.`
          : err.message
        : stderr.trim() || `claude exited with code ${code}`
      resolve({ type: 'result', ok: false, text: msg, sessionId, tokens, reason: err ? 'spawn_error' : 'exit' })
    }
    child.on('error', (e) => finish(null, e))
    child.on('close', (code) => finish(code))
  })

  return { child, done, kill: () => child.kill('SIGTERM') }
}

export function checkClaude(): Promise<ClaudeCheck> {
  return new Promise((resolve) => {
    execFile(claudeBin(), ['--version'], { env: envFor(), timeout: 15_000 }, (err, out) => {
      if (err) resolve({ ok: false, path: claudeBin(), error: err.message })
      else resolve({ ok: true, path: claudeBin(), version: out.trim() })
    })
  })
}

/** One-shot call that returns structured JSON (plans, routing). */
export async function askJson<T>(opts: Omit<ClaudeOptions, 'jsonSchema' | 'tools'> & { schema: object }): Promise<{ value: T; tokens: number }> {
  const h = spawnClaude({ ...opts, tools: [], jsonSchema: opts.schema }, () => undefined)
  const r = await h.done
  if (!r.ok) throw new Error(r.text)
  if (r.structured) return { value: r.structured as T, tokens: r.tokens }
  const m = r.text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Model did not return JSON')
  return { value: JSON.parse(m[0]) as T, tokens: r.tokens }
}
