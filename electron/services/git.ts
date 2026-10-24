import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import type { Workspace } from '@shared/types'
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

export function requireRepo(ws: Workspace): string {
  if (!ws.folderPath) throw new Error(`${ws.name} has no project folder yet. Set one in workspace Settings.`)
  if (!existsSync(ws.folderPath)) throw new Error(`Folder not found: ${ws.folderPath}`)
  return ws.folderPath
}

export async function status(folder: string): Promise<{ branch: string; clean: boolean; remote?: string }> {
  const git = g(folder)
  if (!(await git.checkIsRepo())) throw new Error('Not a git repository')
  const s = await git.status()
  const remotes = await git.getRemotes(true)
  const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
  return { branch: s.current ?? 'HEAD', clean: s.isClean(), remote: origin?.refs.fetch }
}

export async function listBranches(folder: string): Promise<string[]> {
  const b = await g(folder).branchLocal()
  return b.all
}

function worktreeRoot(): string {
  const root = db().settings.worktreeRoot || join(app.getPath('userData'), 'worktrees')
  mkdirSync(root, { recursive: true })
  return root
}

/** Isolated checkout for one task branch, so parallel agents never share a working tree. */
export async function ensureWorktree(ws: Workspace, branch: string): Promise<string> {
  const folder = requireRepo(ws)
  const dir = join(worktreeRoot(), ws.id, branch.replace(/[\\/]/g, '__'))
  if (existsSync(join(dir, '.git'))) return dir
  const git = g(folder)
  const branches = await git.branchLocal()
  if (branches.all.includes(branch)) await git.raw(['worktree', 'add', dir, branch])
  else await git.raw(['worktree', 'add', '-b', branch, dir, ws.git.baseBranch])
  return dir
}

export async function commitAll(dir: string, message: string): Promise<string | null> {
  const git = g(dir)
  await git.add(['-A'])
  const s = await git.status()
  if (s.staged.length === 0 && s.files.length === 0) return null
  const r = await git.commit(message, undefined, { '--author': 'Jarvis Agent <agent@jarvis.local>' })
  return r.commit || null
}

export async function branchStats(
  ws: Workspace,
  branch: string
): Promise<{ commits: number; additions: number; deletions: number; files: { path: string; additions: number; deletions: number }[] }> {
  const git = g(requireRepo(ws))
  const range = `${ws.git.baseBranch}...${branch}`
  const count = Number((await git.raw(['rev-list', '--count', `${ws.git.baseBranch}..${branch}`])).trim() || 0)
  const numstat = await git.raw(['diff', '--numstat', range])
  const files = numstat
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, d, path] = l.split('\t')
      return { path, additions: Number(a) || 0, deletions: Number(d) || 0 }
    })
  return {
    commits: count,
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    files
  }
}

export async function diff(ws: Workspace, branch: string): Promise<FileDiff[]> {
  const git = g(requireRepo(ws))
  const range = `${ws.git.baseBranch}...${branch}`
  const stats = await branchStats(ws, branch)
  const nameStatus = await git.raw(['diff', '--name-status', range])
  const kinds = new Map<string, FileDiff['status']>()
  for (const l of nameStatus.split('\n').filter(Boolean)) {
    const [k, ...paths] = l.split('\t')
    const path = paths[paths.length - 1]
    kinds.set(path, k.startsWith('A') ? 'added' : k.startsWith('D') ? 'deleted' : k.startsWith('R') ? 'renamed' : 'modified')
  }
  const out: FileDiff[] = []
  for (const f of stats.files.slice(0, 60)) {
    const patch = await git.raw(['diff', range, '--', f.path])
    out.push({ ...f, status: kinds.get(f.path) ?? 'modified', patch: patch.slice(0, 200_000) })
  }
  return out
}

/** Merge into the base branch in the user's folder. Requires base checked out and clean. */
export async function merge(ws: Workspace, branch: string, message: string): Promise<string> {
  const folder = requireRepo(ws)
  const git = g(folder)
  const s = await git.status()
  if (s.current !== ws.git.baseBranch)
    throw new Error(`Check out ${ws.git.baseBranch} in ${folder} before merging (currently on ${s.current}).`)
  if (!s.isClean()) throw new Error(`${folder} has uncommitted changes. Commit or stash them first.`)
  await git.raw(['merge', '--no-ff', '-m', message, branch])
  return (await git.revparse(['HEAD'])).trim()
}

export async function revert(ws: Workspace, mergeCommit: string): Promise<string> {
  const git = g(requireRepo(ws))
  const s = await git.status()
  if (!s.isClean()) throw new Error('Working tree has uncommitted changes. Commit or stash them first.')
  await git.raw(['revert', '--no-edit', '-m', '1', mergeCommit])
  return (await git.revparse(['HEAD'])).trim()
}

export async function removeWorktree(ws: Workspace, branch: string): Promise<void> {
  const folder = requireRepo(ws)
  const dir = join(worktreeRoot(), ws.id, branch.replace(/[\\/]/g, '__'))
  if (existsSync(dir)) await g(folder).raw(['worktree', 'remove', '--force', dir]).catch(() => undefined)
}
