import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import type { RepoChange, RepoStatus, Workspace } from '@shared/types'
import type { FileDiff } from '@shared/app-types'
import { db } from './db'

const g = (dir: string): SimpleGit => simpleGit({ baseDir: dir, maxConcurrentProcesses: 4 })

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'
}

export function branchName(ws: Workspace, agentName: string, taskId: string, title: string): string {
  return ws.git.branchPattern
    .replace('{agent}', slug(agentName))
    .replace('{task-id}', taskId.toLowerCase())
    .replace('{slug}', slug(title))
}

/** One repo an agent works in: `dir` is the user's checkout, `sub` its folder inside a task worktree ('' = the worktree itself). */
export interface RepoRef {
  name: string
  dir: string
  sub: string
  base: string
}

export function requireFolder(ws: Workspace): string {
  if (!ws.folderPath) throw new Error(`${ws.name} has no project folder yet. Set one in workspace Settings.`)
  if (!existsSync(ws.folderPath)) throw new Error(`Folder not found: ${ws.folderPath}`)
  return ws.folderPath
}

/** The repos of a workspace. Without `ws.repos` the project folder itself is the one repo. */
export function reposOf(ws: Workspace): RepoRef[] {
  const root = requireFolder(ws)
  if (!ws.repos?.length) return [{ name: basename(root), dir: root, sub: '', base: ws.git.baseBranch }]
  return ws.repos.map((r) => {
    const dir = join(root, r.path)
    if (!existsSync(dir)) throw new Error(`Repo ${r.name} not found at ${dir}. Update the repos in workspace Settings.`)
    return { name: r.name, dir, sub: r.path, base: r.baseBranch || ws.git.baseBranch }
  })
}

export const isMultiRepo = (ws: Workspace): boolean => !!ws.repos?.length

/** Windows git refuses repos owned by another user, which is every repo under \\wsl.localhost. */
function explain(e: unknown, dir: string): Error {
  const msg = (e as Error).message ?? String(e)
  if (/dubious ownership/i.test(msg))
    return new Error(`Git does not trust ${dir} (owned by another user, e.g. inside WSL). Run: git config --global --add safe.directory "${dir.replace(/\\/g, '/')}"`)
  return e instanceof Error ? e : new Error(msg)
}

async function repoStatus(dir: string, path: string, defaultBase: string): Promise<RepoStatus> {
  const git = g(dir)
  try {
    if (!(await git.checkIsRepo())) throw new Error('Not a git repository')
    const s = await git.status()
    const remotes = await git.getRemotes(true)
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
    const branches = (await git.branchLocal()).all
    const current = s.current ?? 'HEAD'
    const baseBranch = [defaultBase, 'main', 'master', 'develop'].find((b) => branches.includes(b)) ?? current
    return { name: path ? basename(path) : basename(dir), path, branch: current, clean: s.isClean(), remote: origin?.refs.fetch, branches, baseBranch }
  } catch (e) {
    throw explain(e, dir)
  }
}

const SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'Pods'])

/** Git repos at `folder`, or (when it is not one) up to two levels below it. */
function findRepos(folder: string, rel = '', depth = 0): string[] {
  if (existsSync(join(folder, rel, '.git'))) return [rel]
  if (depth >= 2) return []
  let entries: string[] = []
  try {
    entries = readdirSync(join(folder, rel), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name))
      .map((d) => d.name)
  } catch {
    return []
  }
  return entries.flatMap((n) => findRepos(folder, rel ? `${rel}/${n}` : n, depth + 1))
}

export async function scanRepos(folder: string, defaultBase: string): Promise<RepoStatus[]> {
  if (!existsSync(folder)) throw new Error(`Folder not found: ${folder}`)
  const paths = findRepos(folder)
  if (!paths.length) throw new Error('No git repository in this folder or the two levels below it')
  return Promise.all(paths.map((p) => repoStatus(p ? join(folder, p) : folder, p, defaultBase)))
}

/** Live status of every repo in a workspace, with its saved base branch. */
export async function statuses(ws: Workspace): Promise<RepoStatus[]> {
  return Promise.all(
    reposOf(ws).map(async (r) => ({ ...(await repoStatus(r.dir, r.sub, r.base)), name: r.name, baseBranch: r.base }))
  )
}

function worktreeRoot(): string {
  const root = db().settings.worktreeRoot || join(app.getPath('userData'), 'worktrees')
  mkdirSync(root, { recursive: true })
  return root
}

/** Folder for one task branch; in a multi-repo workspace it mirrors the project (web/, api/, …). */
const taskDir = (ws: Workspace, branch: string): string => join(worktreeRoot(), ws.id, branch.replace(/[\\/]/g, '__'))
const wtOf = (dir: string, r: RepoRef): string => (r.sub ? join(dir, r.sub) : dir)

/** Isolated checkout of every repo on the task branch, so parallel agents never share a working tree. */
export async function ensureWorktree(ws: Workspace, branch: string): Promise<string> {
  const dir = taskDir(ws, branch)
  for (const r of reposOf(ws)) {
    const wt = wtOf(dir, r)
    if (existsSync(join(wt, '.git'))) continue
    const git = g(r.dir)
    try {
      await git.raw(['worktree', 'prune']) // forget worktrees whose folder was deleted
      mkdirSync(dirname(wt), { recursive: true })
      if ((await git.branchLocal()).all.includes(branch)) await git.raw(['worktree', 'add', wt, branch])
      else await git.raw(['worktree', 'add', '-b', branch, wt, r.base])
    } catch (e) {
      throw explain(e, r.dir)
    }
  }
  return dir
}

/** Commit whatever the agent changed, repo by repo. */
export async function commitAll(ws: Workspace, branch: string, message: string): Promise<{ repo: string; sha: string }[]> {
  const dir = taskDir(ws, branch)
  const out: { repo: string; sha: string }[] = []
  for (const r of reposOf(ws)) {
    const wt = wtOf(dir, r)
    if (!existsSync(join(wt, '.git'))) continue
    const git = g(wt)
    await git.add(['-A'])
    const s = await git.status()
    if (s.staged.length === 0 && s.files.length === 0) continue
    const c = await git.commit(message, undefined, { '--author': 'Jarvis Agent <agent@jarvis.local>' })
    if (c.commit) out.push({ repo: r.name, sha: c.commit })
  }
  return out
}

type FileStat = { path: string; additions: number; deletions: number }

/** Commits ahead of base; 0 when the branch does not exist in this repo. */
async function ahead(r: RepoRef, branch: string): Promise<number> {
  return Number((await g(r.dir).raw(['rev-list', '--count', `${r.base}..${branch}`]).catch(() => '0')).trim() || 0)
}

async function repoStats(r: RepoRef, branch: string): Promise<RepoChange & { files: FileStat[] }> {
  const commits = await ahead(r, branch)
  if (!commits) return { name: r.name, commits: 0, additions: 0, deletions: 0, files: [] }
  const numstat = await g(r.dir).raw(['diff', '--numstat', `${r.base}...${branch}`])
  const prefix = r.sub ? r.sub.replace(/\\/g, '/') + '/' : ''
  const files = numstat
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, d, path] = l.split('\t')
      return { path: prefix + path, additions: Number(a) || 0, deletions: Number(d) || 0 }
    })
  const sum = (k: 'additions' | 'deletions') => files.reduce((s, f) => s + f[k], 0)
  return { name: r.name, commits, additions: sum('additions'), deletions: sum('deletions'), files }
}

export async function branchStats(
  ws: Workspace,
  branch: string
): Promise<{ commits: number; additions: number; deletions: number; files: FileStat[]; repos: RepoChange[] }> {
  const per = await Promise.all(reposOf(ws).map((r) => repoStats(r, branch)))
  const touched = per.filter((p) => p.commits > 0)
  return {
    commits: touched.reduce((s, p) => s + p.commits, 0),
    additions: touched.reduce((s, p) => s + p.additions, 0),
    deletions: touched.reduce((s, p) => s + p.deletions, 0),
    files: touched.flatMap((p) => p.files),
    repos: touched.map(({ files: _f, ...rest }) => rest)
  }
}

export async function diff(ws: Workspace, branch: string): Promise<FileDiff[]> {
  const out: FileDiff[] = []
  for (const r of reposOf(ws)) {
    const stats = await repoStats(r, branch)
    if (!stats.commits) continue
    const git = g(r.dir)
    const range = `${r.base}...${branch}`
    const prefix = r.sub ? r.sub.replace(/\\/g, '/') + '/' : ''
    const kinds = new Map<string, FileDiff['status']>()
    for (const l of (await git.raw(['diff', '--name-status', range])).split('\n').filter(Boolean)) {
      const [k, ...paths] = l.split('\t')
      kinds.set(prefix + paths[paths.length - 1], k.startsWith('A') ? 'added' : k.startsWith('D') ? 'deleted' : k.startsWith('R') ? 'renamed' : 'modified')
    }
    for (const f of stats.files) {
      if (out.length >= 60) return out
      const patch = await git.raw(['diff', range, '--', f.path.slice(prefix.length)])
      out.push({ ...f, status: kinds.get(f.path) ?? 'modified', patch: patch.slice(0, 200_000) })
    }
  }
  return out
}

/**
 * Merge the branch into each touched repo's base, in the user's folders. Every repo
 * is checked first (base checked out, clean) so one dirty repo doesn't leave it half merged.
 */
export async function merge(ws: Workspace, branch: string, message: string): Promise<{ repo: string; sha: string }[]> {
  const targets: RepoRef[] = []
  for (const r of reposOf(ws)) if ((await ahead(r, branch)) > 0) targets.push(r)
  if (!targets.length) throw new Error(`${branch} has no commits to merge`)
  for (const r of targets) {
    const s = await g(r.dir).status()
    if (s.current !== r.base) throw new Error(`Check out ${r.base} in ${r.dir} before merging (currently on ${s.current}).`)
    if (!s.isClean()) throw new Error(`${r.dir} has uncommitted changes. Commit or stash them first.`)
  }
  const out: { repo: string; sha: string }[] = []
  for (const r of targets) {
    const git = g(r.dir)
    await git.raw(['merge', '--no-ff', '-m', message, branch])
    out.push({ repo: r.name, sha: (await git.revparse(['HEAD'])).trim() })
  }
  return out
}

/** Revert merge commits made by `merge`; a single-repo workspace may pass repo ''. */
export async function revert(ws: Workspace, commits: { repo: string; sha: string }[]): Promise<void> {
  const all = reposOf(ws)
  const targets = commits.map((c) => {
    const r = all.find((x) => x.name === c.repo) ?? (all.length === 1 ? all[0] : undefined)
    if (!r) throw new Error(`Repo ${c.repo} is no longer part of this workspace`)
    return { r, sha: c.sha }
  })
  for (const { r } of targets) if (!(await g(r.dir).status()).isClean()) throw new Error(`${r.dir} has uncommitted changes. Commit or stash them first.`)
  for (const { r, sha } of targets) await g(r.dir).raw(['revert', '--no-edit', '-m', '1', sha])
}

/** Drop a repo's worktree (and, when `dropBranch`, its branch). */
async function dropRepo(r: RepoRef, wt: string, branch: string, dropBranch: boolean): Promise<void> {
  const git = g(r.dir)
  if (existsSync(wt)) await git.raw(['worktree', 'remove', '--force', wt]).catch(() => undefined)
  if (dropBranch) await git.raw(['branch', '-D', branch]).catch(() => undefined)
}

export async function removeWorktree(ws: Workspace, branch: string): Promise<void> {
  const dir = taskDir(ws, branch)
  for (const r of reposOf(ws)) await dropRepo(r, wtOf(dir, r), branch, false)
  if (isMultiRepo(ws)) rmSync(dir, { recursive: true, force: true })
}

/** Multi-repo: remove the branch and worktree from repos the task never committed to. */
export async function pruneUntouched(ws: Workspace, branch: string): Promise<void> {
  if (!isMultiRepo(ws)) return
  const dir = taskDir(ws, branch)
  for (const r of reposOf(ws)) {
    const wt = wtOf(dir, r)
    if (!existsSync(join(wt, '.git')) || (await ahead(r, branch)) > 0) continue
    if (!(await g(wt).status()).isClean()) continue // the agent left work here; keep it
    await dropRepo(r, wt, branch, true)
  }
}
