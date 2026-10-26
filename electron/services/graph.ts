/**
 * Checks for the task dependency graph. Plan steps may only depend on earlier
 * steps, which keeps every mission acyclic; edited tasks are checked for cycles.
 */
import type { StoredTask } from '@shared/app-types'

/** Keep only deps that point at an earlier step; report the edges that were dropped. */
export function cleanStepDeps<S extends { dependsOn?: number[] }>(steps: S[]): { steps: S[]; problems: string[] } {
  const problems: string[] = []
  const clean = steps.map((s, i) => {
    const deps: number[] = []
    for (const d of s.dependsOn ?? []) {
      if (!Number.isInteger(d) || d < 0 || d >= i) problems.push(`step index ${i} depends on ${JSON.stringify(d)}, which is not an earlier step index (dropped)`)
      else if (!deps.includes(d)) deps.push(d)
    }
    return { ...s, dependsOn: deps }
  })
  return { steps: clean, problems }
}

/** True when giving `taskId` these deps would close a loop. */
export function wouldCycle(tasks: StoredTask[], taskId: string, deps: string[]): boolean {
  const edges = new Map(tasks.map((t) => [t.id, t.id === taskId ? deps : t.dependsOn]))
  const seen = new Set<string>()
  const stack = [...deps]
  while (stack.length) {
    const id = stack.pop()!
    if (id === taskId) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(edges.get(id) ?? []))
  }
  return false
}
