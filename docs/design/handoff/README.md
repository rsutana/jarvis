# Jarvis — implementation guide for coding agents

Stack: **Electron** (desktop shell) · **Vue 3 + TypeScript** (UI, state, routing) · **Three.js** (isometric 3D world) · **Tailwind CSS** (dark theme) · **GLTF/GLB** (furniture, buildings, characters).

The Design canvas is the visual spec. Each `*.dc.html` board is one screen; read it for layout, copy and states. This folder holds the machine-readable parts:

| File | Use |
|---|---|
| `tailwind.config.js` | Drop-in Tailwind config. All colours, radii and shadows on the canvas exist as tokens. Never hard-code hex values in components. |
| `types.ts` | Domain types + the Electron IPC contract (`IpcInvoke`, `IpcEvents`). Copy to `src/shared/types.ts`. |
| `office-layout.json` | Every object in the workspace office (walls, desks, chairs, zones, props, labels) in world units for Three.js. |
| `lobby-layout.json` | The campus: ground, roads, workspace building slots, Jarvis portal, props. |

---

## 1. Hierarchy (product model)

```
Jarvis (1 per app, global assistant, chat)
└─ Workspace (project folder + git repo; a building in the lobby)
   └─ Orchestrator (1 per workspace; plans missions, routes tasks)
      └─ Agents (role, model, skills, integrations; a desk in the office)
         └─ Tasks → Runs → Changes (branch) → QA → Merge (approval)
```

Anything that sends, merges, deletes, bills or touches folders creates an `ApprovalRequest` (Inbox) unless that agent/integration policy is `allowed`.

## 2. Architecture

```
electron/
  main.ts            BrowserWindow (min 1100×720, backgroundColor #0B0D10), tray, IPC handlers
  preload.ts         contextBridge.exposeInMainWorld('jarvis', typed invoke/on wrappers) — contextIsolation: true, nodeIntegration: false
  services/          agents runner, git (simple-git), accounts/limits, automations (node-cron), integrations (MCP clients)
src/
  main.ts            createApp + router + pinia
  router.ts          routes in §4
  stores/            pinia: workspaces, agents, tasks, approvals, accounts, ui (drawer, awayMode, selection)
  shell/
    AppShell.vue     <IsoViewport/> + <HudTopBar/> + <RouterView name="drawer"/> + <HudDock/>
    HudTopBar.vue    breadcrumb · search (Ctrl K) · "I'm away" toggle · status pill   (board C3 Hud)
    HudDock.vue      global or workspace dock set, badges                               (board C3 Hud)
    DrawerPanel.vue  props: width ('sm'|'md'|'lg'|'xl'), title, closeTo                 (every drawer screen)
  scene/
    IsoViewport.vue  owns ONE WebGLRenderer + CSS2DRenderer; swaps LobbyWorld/OfficeWorld
    LobbyWorld.ts    builds lobby from lobby-layout.json + workspaces store              (board C1)
    OfficeWorld.ts   builds office from office-layout.json + agents store               (board C2)
    assets.ts        GLTFLoader + DRACOLoader + KTX2Loader, cache by model name
    labels.ts        Vue-rendered world labels via CSS2DObject (clickable, focusable)
    camera.ts        isometric ortho camera, pan/zoom/clamp, drawer shift
  screens/           one .vue per board (see §4)
  components/        Button, Chip, StatusChip, Avatar, Field, Select, Toggle, Card, Tabs, Kanban*, DiffView, Timeline, UsageMeter, MissionCard, ApprovalCard
src/shared/types.ts  (copy of handoff/types.ts)
public/models/*.glb  (see §6)
```

## 3. Shell behaviour (all screens)

- The 3D world fills the window and never unmounts; switching screens only swaps the drawer and, between global and workspace screens, the world (Lobby ↔ Office).
- Floating layers: top bar `top-hud left-hud right-hud` (16px), drawer `top-drawer-top bottom-drawer-bottom right-hud`, dock centred at `bottom-hud`.
- Opening a drawer pans the camera left by the per-screen shift in `office-layout.json › camera.drawerShiftPx` so the scene stays visible.
- Esc closes the drawer (go to the world-level route). Ctrl K opens search. J focuses the Jarvis composer.
- Below 1100px width the drawer becomes full width; the dock scrolls horizontally.

## 4. Routes ↔ canvas boards

| Route | Board | World | Drawer width | Vue screen |
|---|---|---|---|---|
| `/` | 01 Main (Lobby) | Lobby | 420 (Jarvis dock) + left "Today" card | `LobbyHome.vue` |
| `/jarvis/:conversationId?` | 02 JarvisChat | Lobby | 980 | `JarvisChat.vue` |
| `/inbox/:approvalId?` | 03 Inbox | Lobby | 920 | `Inbox.vue` |
| `/workspaces/new` | 04 NewWorkspace | Lobby | 820 | `NewWorkspaceWizard.vue` (4 steps) |
| `/w/:id` | 05 Workspace | Office | 360 (agent quick view) + left summary card | `WorkspaceOffice.vue` |
| `/w/:id/orchestrator` | 06 Orchestrator | Office (orchestrator highlighted) | 980 | `OrchestratorConsole.vue` |
| `/w/:id/tasks` | 07 Tasks | Office | 1020 | `TaskBoard.vue` |
| `/w/:id/tasks/:taskId` | 08 TaskRun | Office (assignee highlighted) | 980 | `TaskRun.vue` |
| `/w/:id/changes/:branch?` | 09 Changes | Office | 1020 | `Changes.vue` |
| `/w/:id/agents/:agentId` | 10 AgentEditor | Office (agent highlighted) | 620 | `AgentEditor.vue` |
| `/accounts` | 11 AIAccounts | Lobby | 600 | `AIAccounts.vue` |
| `/integrations/:id?` | 12 Integrations | Lobby | 880 | `Integrations.vue` |
| `/automations/:id?` | 13 Automations | Lobby | 880 | `Automations.vue` |

## 5. Three.js scene spec

- **Camera**: `OrthographicCamera`, isometric: position = target + (d, d·tan(35.264°)·√2, d) so yaw 45°, pitch −35.264°. Zoom 0.6–1.8 (wheel + buttons), drag to pan, clamp target inside the room/campus bounds, "Recenter" resets.
- **Renderer**: `antialias: true`, `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, clear colour `#0B0D10`. Render on demand (only when camera/state changes or an animation is playing).
- **Lights**: `HemisphereLight(#cfd8ff, #2a3039, 0.9)` + `DirectionalLight(#ffffff, 1.4)` from the upper left (−x, +y, −z) with soft shadows (PCFSoft, 2048 map) on the floor only; office windows add a faint blue `RectAreaLight` (optional).
- **Materials**: flat `MeshStandardMaterial`, roughness 0.8, metalness 0, colours from the layout JSON (they match the canvas). Monitor screens and lit building windows use `emissive`; working status turns emissive on.
- **Floor / ground**: one `InstancedMesh` of tiles (checker colours from JSON). Static props sharing a model → `InstancedMesh`.
- **Characters**: one rigged `character_base.glb`; tint shirt/hair/skin materials per `Agent.look`; animation clips `idle`, `typing`, `idle_worried`; stand at `desks[slot].stand`.
- **Selection**: raycast on pointer up (ignore if the pointer moved > 4px = a pan). Hit agent → `ui.selectAgent(id)` → router to `/w/:id` quick view. Selected agent gets the accent ring (`accent` #8C9BFF, emissive glow); orchestrator pad always has the teal glow.
- **Labels**: `CSS2DObject` hosting a small Vue component (`WorldLabel.vue`: name, sub-line, status dot; `bg-tag border-line-strong rounded-row shadow-tag`). Status bubbles (`•••`, `!`, `z`) sit above heads. Labels are real `<button>`/`<a>` elements — keep them keyboard focusable.
- **Live updates**: subscribe to `agent:status` IPC → swap animation clip, screen emissive, bubble; lobby building `lit` when any agent in it works.

## 6. GLB asset list

Conventions: 1 unit = 1 m, Y-up, model front faces **+Z**, pivot at bottom-centre of the footprint, ≤ 5k triangles per prop (≤ 15k per building, ≤ 8k per character), Draco-compressed, textures KTX2 ≤ 512px or flat vertex colours. Name materials so code can recolour them (`roof`, `trim`, `screen`, `window`, `shirt`, `hair`, `skin`, `upholstery`).

| Model | Size (w×d×h m) | Where |
|---|---|---|
| `desk_dual_monitor.glb` | 2.4×1.2×0.75 (monitors to 1.3) | Office desks ×9 |
| `office_chair.glb` | 0.64×0.64×1.0 | Desks, meeting room |
| `character_base.glb` | ~1.6 tall, rigged | Agents, orchestrator |
| `orchestrator_pad.glb` | 3.6×3.6×0.2 (+ ring) | Office front-left |
| `sofa_3seat.glb` · `coffee_table.glb` · `rug.glb` | see JSON | Lounge, rooms |
| `meeting_table.glb` · `wall_screen.glb` · glass wall panels | see JSON | Meeting room |
| `round_table.glb` · `cafe_chair.glb` | see JSON | Break area |
| `kitchen_counter.glb` · `coffee_machine.glb` · `microwave.glb` · `pastry_tray.glb` · `bar_stool.glb` | see JSON | Kitchen |
| `bookshelf.glb` · `water_cooler.glb` · `server_rack.glb` · `whiteboard_wall.glb` · `low_cabinet.glb` · `plant_pot_large.glb` · `window_double.glb` | see JSON | Office props |
| `office_building_s.glb` / `office_building_m.glb` | footprint 5×4 / 6×5 | Lobby workspaces |
| `jarvis_portal.glb` | r 1.4 | Lobby plaza |
| `tree_round.glb` · `hedge.glb` · `flower_bed.glb` · `street_lamp.glb` · `bench.glb` · `car.glb` | see JSON | Lobby props |

Until real models exist, generate placeholders from the JSON `size` boxes (BoxGeometry with the listed colours) — the canvas boards are exactly that placeholder look.

## 7. Tailwind usage

- `<html class="dark">`, body `bg-app text-ink font-sans text-body`.
- Drawer: `bg-drawer border border-line-strong rounded-drawer shadow-drawer`. HUD pills: `bg-hud border border-line-strong rounded-hud`.
- Buttons: primary `bg-accent text-app`, default `bg-raised border-line-strong`, ghost `bg-transparent`; height `min-h-control` (40px), icon buttons 40×40 with `aria-label`.
- Status always as dot + text (`text-status-working`, etc.), never colour alone.
- Section labels: `text-label uppercase text-ink-label`.

## 8. Build order (milestones)

1. Electron + Vite + Vue + Tailwind scaffold; dark window; preload bridge typed from `types.ts`.
2. AppShell: HudTopBar, HudDock (both sets), DrawerPanel, router per §4 with stub screens.
3. IsoViewport with placeholder boxes from `lobby-layout.json` / `office-layout.json`, camera pan/zoom, CSS2D labels, raycast selection.
4. Screens with mock data (the canvas copy): Lobby/Jarvis chat → Workspace office → Tasks → Task run → Changes → Inbox.
5. Configuration screens: Agent editor, AI accounts, Integrations, Automations, New workspace wizard (folder picker via `workspace:pickFolder`).
6. Wire real services behind IPC; live `agent:status` updates drive the 3D scene.
7. Swap placeholders for GLB models; add animations, emissive states, shadows.

## 9. Acceptance checks per screen

- Matches the board's layout, copy and states (open it in the canvas, press Play to see interactions).
- All controls are real `button`/`a`/`input` with labels; text contrast ≥ 4.5:1 (tokens already pass).
- Drawer closes with Esc and its × link; the world stays interactive beside it.
- No hard-coded colours; only Tailwind tokens.

## Sample data notes

Folder paths shown on the canvas (e.g. `D:\alter-ego-projects\ryscript`) are placeholders. At runtime the office "Project files" label shows `workspace.folderPath`, chosen in the New workspace wizard.
