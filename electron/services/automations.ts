import cron, { type ScheduledTask } from 'node-cron'
import type { Automation } from '@shared/types'
import { commit, db, now, uid } from './db'
import { toast } from './bus'
import { approveMission, planMission, requestPlanApproval, type StoredMission } from './orchestrator'
import { newConversation, send } from './jarvis'

const jobs = new Map<string, ScheduledTask>()

export function validCron(expr: string): boolean {
  return cron.validate(expr)
}

export function scheduleAll(): void {
  for (const j of jobs.values()) j.stop()
  jobs.clear()
  for (const a of db().automations) {
    if (!a.enabled || a.trigger.type !== 'schedule' || !cron.validate(a.trigger.cron)) continue
    jobs.set(a.id, cron.schedule(a.trigger.cron, () => void runNow(a.id)))
  }
}

export function save(a: Automation): Automation {
  if (a.trigger.type === 'schedule' && !cron.validate(a.trigger.cron)) throw new Error(`Invalid schedule: ${a.trigger.cron}`)
  const list = db().automations
  const i = list.findIndex((x) => x.id === a.id)
  const rec = { ...a, id: a.id || uid('au-') }
  if (i >= 0) list[i] = rec
  else list.push(rec)
  commit('automations')
  scheduleAll()
  return rec
}

export function remove(id: string): void {
  db().automations = db().automations.filter((a) => a.id !== id)
  commit('automations')
  scheduleAll()
}

export async function runNow(id: string): Promise<void> {
  const a = db().automations.find((x) => x.id === id)
  if (!a) throw new Error('Automation not found')
  a.lastRun = { at: now(), result: 'waiting' }
  commit('automations')
  try {
    if (a.target === 'jarvis') {
      const c = db().conversations.find((x) => x.title === `Automation · ${a.name}`) ?? newConversation(`Automation · ${a.name}`)
      await send(c.id, a.prompt)
      a.lastRun = { at: now(), result: 'succeeded' }
    } else {
      const m = (await planMission(a.target.workspaceId, a.prompt, 'automation')) as StoredMission
      const tooBig = m.steps.length > db().jarvis.limits.maxPlanTasks
      if (tooBig && a.overLimit === 'skip') m.status = 'failed'
      else if (tooBig && a.overLimit === 'run' && m.status !== 'running') approveMission(m.id)
      else if (tooBig && m.status !== 'awaiting_approval' && m.status !== 'running') requestPlanApproval(m)
      a.lastRun = { at: now(), result: m.status === 'running' ? 'succeeded' : 'waiting' }
    }
  } catch (e) {
    a.lastRun = { at: now(), result: 'failed' }
    toast(`${a.name}: ${(e as Error).message}`, 'bad')
  }
  commit('automations', 'missions')
}

/** Next fire time for display. */
export function nextRun(a: Automation): string | null {
  const j = jobs.get(a.id)
  const d = j?.getNextRun?.()
  return d ? d.toISOString() : null
}
