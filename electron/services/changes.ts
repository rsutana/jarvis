import { commit, db, findAgent, findWorkspace, log, now } from './db'
import { toast } from './bus'
import * as git from './git'
import { createApproval, handleApproval, completeTask } from './approvals'

function findChange(branch: string, workspaceId?: string) {
  const c = db().changes.find((x) => x.branch === branch && (!workspaceId || x.workspaceId === workspaceId))
  if (!c) throw new Error(`No change for ${branch}`)
  return c
}

/** IPC `change:merge`: always goes through an ApprovalRequest first. */
export function requestMerge(branch: string): void {
  const c = findChange(branch)
  const ws = findWorkspace(c.workspaceId)!
  const agent = findAgent(c.agentId)
  createApproval({
    kind: 'merge',
    title: `Merge ${branch}`,
    requestedBy: c.agentId,
    workspaceId: c.workspaceId,
    taskId: c.taskId,
    via: 'Git',
    policy: 'Merging asks you',
    fields: [
      { label: 'Branch', value: `${branch} → ${ws.repos?.length ? 'each repo’s base' : ws.git.baseBranch}` },
      ...(c.repos?.length ? [{ label: 'Repos', value: c.repos.map((r) => `${r.name} +${r.additions} −${r.deletions}`).join(' · ') }] : []),
      { label: 'QA', value: c.qa === 'passed' ? `Passed${c.qaNote ? ' · ' + c.qaNote.slice(0, 80) : ''}` : c.qa }
    ],
    body: `${c.commits} commit(s) · +${c.additions} −${c.deletions}\n\nRequested by ${agent?.name ?? c.agentId}.`
  })
  toast('Merge request sent to Inbox')
}

export async function mergeBranch(workspaceId: string, branch: string): Promise<void> {
  const c = findChange(branch, workspaceId)
  const ws = findWorkspace(workspaceId)!
  const merged = await git.merge(ws, branch, `Merge ${branch}${c.taskId ? ` (${c.taskId})` : ''}`)
  c.state = 'merged'
  c.mergedAt = now()
  if (git.isMultiRepo(ws)) {
    c.repos = (c.repos ?? merged.map((m) => ({ name: m.repo, commits: 0, additions: 0, deletions: 0 }))).map((r) => ({ ...r, mergeCommit: merged.find((m) => m.repo === r.name)?.sha }))
  } else c.mergeCommit = merged[0].sha
  await git.removeWorktree(ws, branch)
  const into = git.isMultiRepo(ws) ? merged.map((m) => m.repo).join(', ') : ws.git.baseBranch
  log(workspaceId, `Merged ${branch} → ${into} (+${c.additions.toLocaleString()}).`, 'merge')
  completeTask(c.taskId)
  const t = c.taskId ? db().tasks.find((x) => x.id === c.taskId) : undefined
  if (t) t.note = `Merged · +${c.additions} −${c.deletions}`
  commit('changes', 'tasks')
  toast(`Merged ${branch}`, 'good')
}

export async function revertBranch(branch: string): Promise<void> {
  const c = findChange(branch)
  const ws = findWorkspace(c.workspaceId)!
  const commits = c.repos?.length
    ? c.repos.filter((r) => r.mergeCommit).map((r) => ({ repo: r.name, sha: r.mergeCommit! }))
    : c.mergeCommit ? [{ repo: '', sha: c.mergeCommit }] : []
  if (!commits.length) throw new Error('This merge was not made by Jarvis, so there is no commit to revert.')
  await git.revert(ws, commits)
  c.state = 'closed'
  log(ws.id, `Reverted merge of ${branch}.`, 'bad')
  commit('changes')
  toast(`Reverted ${branch}`)
}

handleApproval('merge', async (a) => {
  const branch = a.fields.find((f) => f.label === 'Branch')?.value.split(' → ')[0] ?? a.title.replace(/^Merge /, '')
  await mergeBranch(a.workspaceId!, branch)
})
