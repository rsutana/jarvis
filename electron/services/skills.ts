/**
 * Shared Agent Skills: the SKILL.md folders every AI tool reads from the canonical
 * store (~/.agents/skills, which `npx skills add` from skills.sh fills and links into
 * ~/.claude/skills etc.). Found on this PC and in each WSL distro's home, shown in the
 * app next to its own skills, and given to agents at run time.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { Skill, SkillStore } from '@shared/app-types'
import { commit, db } from './db'

type StoreDir = Omit<SkillStore, 'count' | 'error'>

let cache: { skills: Skill[]; stores: SkillStore[] } = { skills: [], stores: [] }
export const sharedSkills = (): Skill[] => cache.skills
export const skillStores = (): SkillStore[] => cache.stores
export const allSkills = (): Skill[] => [...db().skills, ...cache.skills]

/** WSL distros (`wsl -l -q` prints UTF-16). Only running ones unless asked, since touching \\wsl.localhost boots a distro. */
function wslDistros(includeStopped: boolean): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  const args = includeStopped ? ['-l', '-q'] : ['-l', '-q', '--running']
  return new Promise((resolve) =>
    execFile('wsl.exe', args, { encoding: 'buffer', timeout: 8000, windowsHide: true }, (err, out) => {
      if (err) return resolve([])
      const names = out.toString('utf16le').replace(/\0/g, '').split(/\r?\n/).map((s) => s.trim())
      resolve(names.filter((n) => n && !n.startsWith('docker-desktop')))
    })
  )
}

/** Windows paths compare case-insensitively and with either slash; trailing separators and \\wsl$ vs \\wsl.localhost don't matter. */
export const normPath = (p: string): string => {
  const s = resolve(p.trim().replace(/^[\\/]{2}wsl\$[\\/]/i, '\\\\wsl.localhost\\')).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? s.replace(/\//g, '\\').toLowerCase() : s
}
export const samePath = (a: string, b: string): boolean => normPath(a) === normPath(b)

export interface Home {
  path: string
  label: string // "This PC" or "WSL Ubuntu · ryscript"
  wsl?: { distro: string; user: string }
}

/** This PC's home and every user home in the (running, unless asked) WSL distros. */
export async function homes(includeStopped: boolean): Promise<Home[]> {
  const out: Home[] = [{ path: homedir(), label: 'This PC' }]
  for (const distro of await wslDistros(includeStopped)) {
    const root = `\\\\wsl.localhost\\${distro}\\home`
    let users: string[] = []
    try {
      users = readdirSync(root)
    } catch {
      continue
    }
    for (const user of users) out.push({ path: join(root, user), label: `WSL ${distro} · ${user}`, wsl: { distro, user } })
  }
  return out
}

/** The folders found without any setup (this PC + running WSL homes), for telling a custom folder apart. */
export function isKnownStore(p: string): boolean {
  return cache.stores.some((s) => !s.custom && samePath(s.path, p))
}

/** Canonical store first in each home, so a skill linked into ~/.claude/skills resolves to its real folder. */
async function storeDirs(includeStopped: boolean): Promise<StoreDir[]> {
  const out: StoreDir[] = []
  for (const h of await homes(includeStopped)) {
    out.push({ path: join(h.path, '.agents', 'skills'), label: `${h.label} · ~/.agents/skills`, canonical: true, ...(h.wsl && { wsl: h.wsl }) })
    out.push({ path: join(h.path, '.claude', 'skills'), label: `${h.label} · ~/.claude/skills`, canonical: false, ...(h.wsl && { wsl: h.wsl }) })
  }
  for (const p of db().settings.skillDirs ?? []) if (!out.some((d) => samePath(d.path, p))) out.push({ path: p, label: p, canonical: false, custom: true })
  // a canonical store is a valid install target before its first skill: `npx skills add -g` creates it
  return out.filter((d) => d.custom || d.canonical || existsSync(d.path))
}

/** Frontmatter `name` / `description` (plain or folded `>` / `|` YAML) and the body. */
export function parseSkillMd(md: string): { name?: string; description?: string; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { body: md }
  const lines = m[1].split(/\r?\n/)
  const get = (key: string): string | undefined => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`))
    if (i < 0) return undefined
    const v = lines[i].slice(key.length + 1).trim()
    // an empty value continues on indented lines (plain multi-line scalar), like `>`
    if (v && !/^[>|][-+]?$/.test(v)) return v.replace(/^(["'])(.*)\1$/, '$2')
    const more: string[] = []
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) more.push(lines[j].trim())
    return more.join(v.startsWith('|') ? '\n' : ' ')
  }
  return { name: get('name'), description: get('description'), body: m[2] }
}

/** `npx skills add` records where each skill came from next to the canonical store. */
function readLock(store: string): Record<string, { source?: string; sourceType?: string }> {
  try {
    return JSON.parse(readFileSync(join(dirname(store), '.skill-lock.json'), 'utf8')).skills ?? {}
  } catch {
    return {}
  }
}

export async function scanSkills(includeStopped = false): Promise<void> {
  const seen = new Map<string, Skill>()
  const stores: SkillStore[] = []
  for (const d of await storeDirs(includeStopped)) {
    let entries: string[]
    try {
      entries = readdirSync(d.path)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      // a not-yet-created canonical store is empty, not broken
      stores.push(d.canonical && code === 'ENOENT' ? { ...d, count: 0 } : { ...d, count: 0, error: code ?? 'unreadable' })
      continue
    }
    const lock = basename(d.path) === 'skills' ? readLock(d.path) : {}
    let count = 0
    for (const folder of entries) {
      if (folder.startsWith('.')) continue
      let md: string
      try {
        // WSL symlinks (~/.claude/skills → ~/.agents/skills) can't be followed from Windows; the canonical copy covers them
        md = readFileSync(join(d.path, folder, 'SKILL.md'), 'utf8')
      } catch {
        continue
      }
      const p = parseSkillMd(md)
      const name = p.name || folder
      const id = `shared:${name}`
      if (seen.has(id)) continue
      count++
      const l = lock[folder]
      seen.set(id, {
        id,
        name,
        description: p.description ?? '',
        instructions: '', // read from SKILL.md when a run needs it
        origin: 'shared',
        path: join(d.path, folder),
        location: d.label,
        source: l?.source,
        url: l?.source && l.sourceType === 'github' ? `https://skills.sh/${l.source}/${folder}` : undefined
      })
    }
    stores.push({ ...d, count })
  }
  cache = { skills: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)), stores }
  commit('skills')
}

export function readSkillMd(id: string): string {
  const s = cache.skills.find((x) => x.id === id)
  if (!s?.path) throw new Error('Skill not found')
  return readFileSync(join(s.path, 'SKILL.md'), 'utf8')
}

const MAX_BODY = 12_000

/** How a skill appears in an agent's prompt. Shared skills bring their SKILL.md and point at their folder. */
export function skillPrompt(s: Skill): string {
  if (s.origin !== 'shared' || !s.path) return `- ${s.name}: ${s.instructions}`
  let body: string
  try {
    body = parseSkillMd(readFileSync(join(s.path, 'SKILL.md'), 'utf8')).body.trim()
  } catch {
    body = '(SKILL.md could not be read)'
  }
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY)}\n…(truncated; read the rest in ${join(s.path, 'SKILL.md')})`
  return `### Skill: ${s.name}\n${s.description}\nFolder: ${s.path} (read files under references/, assets/ or scripts/ there when these instructions point to them)\n\n${body}`
}

/* ---------- install from skills.sh ---------- */

const SAFE = /^[\w.-]+$/
const SOURCE = /^(?:[\w.-]+\/[\w.-]+|https:\/\/(?:github\.com|gitlab\.com)\/[\w./-]+)$/

/** Accepts owner/repo, owner/repo/skill, a skills.sh link, a GitHub/GitLab URL, or a pasted `npx skills add …` command. */
export function parseSource(input: string, skill?: string): { source: string; skill?: string } {
  let s = input.trim().replace(/^npx\s+(-y\s+)?skills(@\S+)?\s+add\s+/, '')
  const flag = s.match(/\s(?:--skill|-s)\s+([\w.-]+)/)
  s = s.replace(/\s.*$/, '') // drop other pasted flags
  let pick = skill?.trim() || flag?.[1]
  const sh = s.match(/^https?:\/\/(?:www\.)?skills\.sh\/([\w.-]+)\/([\w.-]+)(?:\/([\w.-]+))?\/?$/)
  const tri = s.match(/^([\w.-]+)\/([\w.-]+)\/([\w.-]+)$/)
  if (sh || tri) {
    const m = (sh ?? tri)!
    s = `${m[1]}/${m[2]}`
    pick ||= m[3]
  }
  if (!SOURCE.test(s)) throw new Error('Use owner/repo, a skills.sh link, or a GitHub/GitLab URL')
  if (pick && !SAFE.test(pick)) throw new Error('Skill names use letters, numbers, dots, dashes and underscores')
  return { source: s, skill: pick || undefined }
}

/**
 * Run `npx skills add <source> -g -y` in the environment that owns `storePath`, so the
 * skill lands in that home's canonical ~/.agents/skills and is linked to every agent
 * there. Inputs are validated above, so they're safe inside the WSL bash command line.
 */
export async function installSkill(input: string, skill: string | undefined, storePath: string): Promise<string> {
  const { source, skill: pick } = parseSource(input, skill)
  const store = cache.stores.find((s) => s.path === storePath && s.canonical)
  if (!store) throw new Error('Pick a shared skills folder (~/.agents/skills) to install into')
  const args = ['-y', 'skills', 'add', source, '-g', '-y', ...(pick ? ['--skill', pick] : [])]
  const [cmd, argv, shell] = store.wsl
    ? (['wsl.exe', ['-d', store.wsl.distro, '-u', store.wsl.user, '--', 'bash', '-lic', `cd ~ && npx ${args.join(' ')}`], false] as const)
    : process.platform === 'win32'
      ? (['npx.cmd', args, true] as const) // .cmd needs a shell; args are validated
      : (['npx', args, false] as const)
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, [...argv], { shell, windowsHide: true })
    let log = ''
    const add = (b: Buffer) => (log = (log + b.toString()).slice(-8000))
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const timer = setTimeout(() => child.kill(), 180_000)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Could not start npx: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      // eslint-disable-next-line no-control-regex
      const clean = log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()
      if (code === 0) resolve(clean)
      else reject(new Error(clean.split('\n').slice(-6).join('\n') || `npx skills add exited with ${code}`))
    })
  })
  await scanSkills(true)
  return out.split('\n').slice(-8).join('\n')
}
