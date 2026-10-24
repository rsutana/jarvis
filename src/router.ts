import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    world: 'lobby' | 'office'
    drawer: number // drawer width in px, drives the camera shift
    dock: 'global' | 'workspace'
    active: string // highlighted dock item
    page: string // breadcrumb leaf
  }
}

const S = {
  LobbyHome: () => import('@/screens/LobbyHome.vue'),
  JarvisChat: () => import('@/screens/JarvisChat.vue'),
  Inbox: () => import('@/screens/Inbox.vue'),
  NewWorkspaceWizard: () => import('@/screens/NewWorkspaceWizard.vue'),
  WorkspaceOffice: () => import('@/screens/WorkspaceOffice.vue'),
  OrchestratorConsole: () => import('@/screens/OrchestratorConsole.vue'),
  TaskBoard: () => import('@/screens/TaskBoard.vue'),
  TaskRun: () => import('@/screens/TaskRun.vue'),
  Changes: () => import('@/screens/Changes.vue'),
  AgentEditor: () => import('@/screens/AgentEditor.vue'),
  AIAccounts: () => import('@/screens/AIAccounts.vue'),
  Integrations: () => import('@/screens/Integrations.vue'),
  Automations: () => import('@/screens/Automations.vue'),
  Skills: () => import('@/screens/Skills.vue'),
  Settings: () => import('@/screens/Settings.vue')
}

const lobby = (path: string, name: string, c: keyof typeof S, drawer: number, active: string, page: string): RouteRecordRaw => ({
  path, name, components: { drawer: S[c] }, meta: { world: 'lobby', drawer, dock: 'global', active, page }
})
const office = (path: string, name: string, c: keyof typeof S, drawer: number, active: string, page: string): RouteRecordRaw => ({
  path: '/w/:id' + path, name, components: { drawer: S[c] }, meta: { world: 'office', drawer, dock: 'workspace', active, page }
})

const routes: RouteRecordRaw[] = [
  lobby('/', 'lobby', 'LobbyHome', 420, 'Chat', 'Lobby'),
  lobby('/jarvis/:conversationId?', 'jarvis', 'JarvisChat', 980, 'Chat', 'Chat'),
  lobby('/inbox/:approvalId?', 'inbox', 'Inbox', 920, 'Inbox', 'Inbox'),
  lobby('/workspaces/new', 'new-workspace', 'NewWorkspaceWizard', 820, 'Workspaces', 'New workspace'),
  lobby('/accounts', 'accounts', 'AIAccounts', 600, 'AI Accounts', 'AI Accounts'),
  lobby('/usage', 'usage', 'AIAccounts', 600, 'Usage', 'Usage'),
  lobby('/agents/:agentId?', 'agents', 'AgentEditor', 620, 'Agents', 'Agents'),
  lobby('/skills/:skillId?', 'skills', 'Skills', 620, 'Skills', 'Skills'),
  lobby('/integrations/:integrationId?', 'integrations', 'Integrations', 880, 'Integrations', 'Integrations'),
  lobby('/automations/:automationId?', 'automations', 'Automations', 880, 'Automations', 'Automations'),
  lobby('/settings', 'settings', 'Settings', 620, 'Settings', 'Settings'),
  office('', 'workspace', 'WorkspaceOffice', 360, 'Overview', 'Office'),
  office('/inbox/:approvalId?', 'ws-inbox', 'Inbox', 920, 'Inbox', 'Inbox'),
  office('/orchestrator', 'orchestrator', 'OrchestratorConsole', 980, 'Orchestrator', 'Orchestrator'),
  office('/tasks', 'tasks', 'TaskBoard', 1020, 'Tasks', 'Tasks'),
  office('/tasks/:taskId', 'task-run', 'TaskRun', 980, 'Tasks', 'Task run'),
  office('/activity', 'activity', 'TaskRun', 980, 'Activity', 'Activity'),
  office('/changes/:branch(.*)?', 'changes', 'Changes', 1020, 'Changes', 'Changes'),
  office('/agents/:agentId', 'ws-agent', 'AgentEditor', 620, 'Agents', 'Agent'),
  office('/agents', 'ws-agents', 'AgentEditor', 620, 'Agents', 'Agents'),
  office('/settings', 'ws-settings', 'NewWorkspaceWizard', 820, 'Settings', 'Settings'),
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

export const router = createRouter({ history: createWebHashHistory(), routes })
