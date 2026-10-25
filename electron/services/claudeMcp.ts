/**
 * MCP servers Claude Code itself is set up with: `claude mcp add` (local and user scope in
 * ~/.claude.json), project .mcp.json files and installed plugins. Read from this PC, every
 * WSL home and each account's CLAUDE_CONFIG_DIR, and listed read-only in Integrations.
 * Header and env values stay in this process; one can be copied into Jarvis as a custom MCP.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { Integration } from '@shared/types'
import type { LocalMcp } from '@shared/app-types'
import { commit, db, uid } from './db'
import { configureMcp } from './mcp'
import { homes, normPath, samePath } from './skills'

/** One server entry as Claude Code writes it. */
interface Raw {
  type?: string
  url?: string
  command?: string
  args?: string[]
  headers?: Record<string, string>
  env?: Record<string, string>
}

/** A Claude Code config home: ~/.claude.json next to ~/.claude, or both inside CLAUDE_CONFIG_DIR. */
interface Source {
  home: string
  json: string
  dir: string
  label: string
  wsl?: { distro: string; user: string }
}

let cache: { list: LocalMcp[]; raw: Map<string, Raw> } = { list: [], raw: new Map() }
export const localMcps = (): LocalMcp[] => cache.list

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}
const entries = (o: unknown): [string, any][] => (o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o) : [])
const names = (o: unknown): string[] => entries(o).map(([k]) => k)

/** A path as Claude Code wrote it, made readable from Windows (WSL's /home/… becomes \\wsl.localhost\<distro>\home\…). */
const reach = (src: Source, p: string): string => (src.wsl && p.startsWith('/') ? `\\\\wsl.localhost\\${src.wsl.distro}${p.replace(/\//g, '\\')}` : p)

const inside = (child: string, parent: string): boolean => {
  const c = normPath(child)
  const p = normPath(parent)
  return c === p || c.startsWith(p + sep)
}

/** Workspaces whose project folder holds this folder or sits inside it (one repo of a multi-repo workspace). */
const workspacesFor = (folder: string): string[] =>
  db().workspaces.filter((w) => w.folderPath && (inside(folder, w.folderPath) || inside(w.folderPath, folder))).map((w) => w.id)

const SECRETISH = /key|token|secret|pass|auth|cred/i
const MASK = '•••'

function maskArgs(args: string[]): string[] {
  return args.map((a, k) => {
    const eq = a.match(/^(--?[\w-]+)=/)
    if (eq && SECRETISH.test(eq[1])) return `${eq[1]}=${MASK}`
    const prev = args[k - 1]
    return prev && /^--?[\w-]+$/.test(prev) && SECRETISH.test(prev) && !a.startsWith('-') ? MASK : a
  })
}

function maskUrl(u: string): string {
  try {
    const x = new URL(u)
    const keys = [...x.searchParams.keys()].filter((k) => SECRETISH.test(k))
    if (!keys.length && !x.password) return u
    for (const k of keys) x.searchParams.set(k, MASK)
    if (x.password) x.password = MASK
    return decodeURIComponent(x.toString())
  } catch {
    return u
  }
}

/** Servers a plugin ships: .mcp.json at its root, or `mcpServers` in its plugin.json (inline or a path). */
function pluginServers(root: string): { file: string; servers: [string, Raw][] }[] {
  const out: { file: string; servers: [string, Raw][] }[] = []
  const add = (file: string, j: unknown) => {
    const s = entries((j as any)?.mcpServers ?? j)
    if (s.length) out.push({ file, servers: s })
  }
  const dotMcp = join(root, '.mcp.json')
  add(dotMcp, readJson(dotMcp))
  const manifest = join(root, '.claude-plugin', 'plugin.json')
  const m = readJson(manifest)?.mcpServers
  if (typeof m === 'string') add(join(root, m), readJson(join(root, m)))
  else if (m) add(manifest, { mcpServers: m })
  return out
}

/** Whether Claude Code may start a project's .mcp.json server: allowed lists live in ~/.claude.json and the project's .claude settings. */
function projectState(name: string, folder: string, proj: any): LocalMcp['state'] {
  const sets = [proj, readJson(join(folder, '.claude', 'settings.local.json')), readJson(join(folder, '.claude', 'settings.json'))].filter(Boolean)
  if (sets.some((s) => s.disabledMcpjsonServers?.includes?.(name))) return 'disabled'
  if (sets.some((s) => s.enableAllProjectMcpServers === true || s.enabledMcpjsonServers?.includes?.(name))) return 'enabled'
  return 'unapproved'
}

export async function scanLocalMcps(includeStopped = false): Promise<LocalMcp[]> {
  const sources: Source[] = (await homes(includeStopped)).map((h) => ({ home: h.path, json: join(h.path, '.claude.json'), dir: join(h.path, '.claude'), label: h.label, wsl: h.wsl }))
  for (const a of db().accounts) {
    if (a.configDir && !sources.some((s) => samePath(s.dir, a.configDir!))) sources.push({ home: a.configDir, json: join(a.configDir, '.claude.json'), dir: a.configDir, label: a.name })
  }

  const list: LocalMcp[] = []
  const raw = new Map<string, Raw>()
  const add = (src: Source, file: string, scope: LocalMcp['scope'], name: string, r: Raw, extra: Partial<LocalMcp> = {}) => {
    if (!r || typeof r !== 'object' || (!r.url && !r.command)) return
    const id = 'cc-' + createHash('sha1').update([file, scope, extra.project ?? '', extra.plugin ?? '', name].join('|')).digest('hex').slice(0, 12)
    if (raw.has(id)) return
    raw.set(id, r)
    list.push({
      id,
      name,
      scope,
      transport: r.type === 'sse' ? 'sse' : r.command && r.type !== 'http' ? 'stdio' : 'http',
      url: r.url ? maskUrl(r.url) : undefined,
      command: r.command,
      args: Array.isArray(r.args) ? maskArgs(r.args.map(String)) : undefined,
      headerNames: names(r.headers),
      envNames: names(r.env),
      home: src.label,
      wsl: !!src.wsl,
      file,
      state: 'enabled',
      workspaceIds: [],
      ...extra
    })
  }

  // project folders to look for a .mcp.json in: every Jarvis workspace (and its repos) and every project Claude Code has opened
  const folders = new Map<string, { folder: string; project: string; src?: Source; proj?: unknown }>()
  const addFolder = (folder: string, project: string, src?: Source, proj?: unknown) => {
    const k = normPath(folder)
    const had = folders.get(k)
    if (!had || (!had.proj && proj)) folders.set(k, { folder, project, src, proj })
  }

  for (const src of sources) {
    const cj = readJson(src.json)
    if (cj) {
      for (const [n, r] of entries(cj.mcpServers)) add(src, src.json, 'user', n, r)
      for (const [p, proj] of entries(cj.projects)) {
        const folder = reach(src, p)
        const off: unknown = proj?.disabledMcpServers
        for (const [n, r] of entries(proj?.mcpServers)) {
          add(src, src.json, 'local', n, r, { project: p, state: Array.isArray(off) && off.includes(n) ? 'disabled' : 'enabled', workspaceIds: workspacesFor(folder) })
        }
        addFolder(folder, p, src, proj)
      }
    }
    const enabled = readJson(join(src.dir, 'settings.json'))?.enabledPlugins ?? {}
    for (const [key, installs] of entries(readJson(join(src.dir, 'plugins', 'installed_plugins.json'))?.plugins)) {
      for (const inst of Array.isArray(installs) ? installs : [installs]) {
        if (typeof inst?.installPath !== 'string') continue
        const project = typeof inst.projectPath === 'string' ? inst.projectPath : undefined
        for (const { file, servers } of pluginServers(reach(src, inst.installPath))) {
          for (const [n, r] of servers) {
            add(src, file, 'plugin', n, r, { plugin: key, project, state: enabled[key] === false ? 'disabled' : 'enabled', workspaceIds: project ? workspacesFor(reach(src, project)) : [] })
          }
        }
      }
    }
  }
  for (const w of db().workspaces) {
    if (!w.folderPath) continue
    addFolder(w.folderPath, w.folderPath)
    for (const r of w.repos ?? []) addFolder(join(w.folderPath, r.path), join(w.folderPath, r.path))
  }

  for (const { folder, project, src, proj } of folders.values()) {
    const file = join(folder, '.mcp.json')
    const j = readJson(file)
    if (!j) continue
    // a workspace folder in WSL belongs to that home's ~/.claude.json
    const owner = src ?? sources.find((s) => s.wsl && inside(folder, s.home)) ?? sources[0]
    for (const [n, r] of entries(j.mcpServers)) {
      add(owner, file, 'project', n, r, { project, state: projectState(n, folder, proj), workspaceIds: workspacesFor(folder) })
    }
  }

  const ORDER = { local: 0, project: 1, user: 2, plugin: 3 }
  list.sort((a, b) => a.name.localeCompare(b.name) || ORDER[a.scope] - ORDER[b.scope])
  cache = { list, raw }
  commit('localMcps')
  return list
}

const HEADER = /^[A-Za-z0-9-]+$/

/**
 * Add one of Claude Code's servers to Jarvis as a custom MCP, so it can be connected, its tools
 * listed and given policies. Header values are copied into Jarvis's encrypted store, except
 * ${VAR} placeholders, which Claude Code fills from its own environment.
 */
export function importLocalMcp(id: string): Integration {
  const l = cache.list.find((x) => x.id === id)
  const r = cache.raw.get(id)
  if (!l || !r) throw new Error("That server isn't in Claude Code's config any more. Refresh the list.")
  if (l.transport === 'stdio' && l.wsl) throw new Error(`${l.name} is a command that runs inside WSL, and Jarvis starts local servers on Windows. Add it as a Custom MCP with a Windows command instead.`)
  if (l.transport === 'stdio' && l.envNames.length) throw new Error(`${l.name} needs environment variables (${l.envNames.join(', ')}), which Jarvis can't pass to a local command yet.`)
  const twin = db().integrations.find((i) => i.mcp && (l.transport === 'stdio' ? i.mcp.command === r.command && (i.mcp.args ?? []).join('\0') === (r.args ?? []).join('\0') : i.mcp.url === r.url))
  if (twin) throw new Error(`Already in Jarvis as ${twin.name}.`)

  const headers = entries(r.headers).filter(([n, v]) => HEADER.test(n) && typeof v === 'string')
  const rec: Integration = { id: uid('in-'), name: l.name, type: 'mcp', tools: [], agentIds: [], workspaceScope: l.workspaceIds.length ? l.workspaceIds : 'all', status: 'disconnected', mcp: { transport: l.transport, oauth: 'none', headers: [] } }
  db().integrations.push(rec)
  try {
    return configureMcp(
      rec.id,
      { transport: l.transport, url: r.url, command: r.command, args: (r.args ?? []).map(String), oauth: headers.length ? 'none' : 'dcr', headers: headers.map(([n]) => ({ name: n, set: false })) },
      { headers: Object.fromEntries(headers.filter(([, v]) => !String(v).includes('${'))) }
    )
  } catch (e) {
    db().integrations = db().integrations.filter((i) => i.id !== rec.id)
    throw e
  }
}
