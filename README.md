# Jarvis

Desktop app for running teams of AI agents on your own git repos. It's built from the **Jarvis Agent Orchestrator** design canvas, and the canvas files are copied into [`docs/design/`](docs/design/).

Stack, as picked on the canvas's handoff board: **Electron** · **Vue 3 + TypeScript** (Pinia, Vue Router) · **Three.js** (isometric world) · **Tailwind CSS** · **GLTF/GLB**. Built with electron-vite.

```
Jarvis (global assistant)
└─ Workspace (project folder + git repo; a building in the lobby)
   └─ Orchestrator (plans missions, routes tasks)
      └─ Agents (role, model, skills, integrations; a desk in the office)
         └─ Tasks → Runs → Changes (branch) → QA → Merge (approval)
```

## Requirements

- Node 20+ and pnpm
- git
- [Claude Code](https://claude.com/claude-code) CLI, signed in (`claude --version` works). Jarvis, orchestrators and agents all run through it.

## Run

```bash
pnpm install
pnpm dev          # dev with hot reload
pnpm build        # production build into out/
pnpm typecheck
pnpm dist         # installers into dist/ (AppImage/deb, nsis, dmg)
```

On first launch the app loads the canvas's sample data (Ryscript, News website, Alumni website) so every screen has something in it. The sample workspaces have no project folder, so their agents can't run. To start clean, go to **Settings › Start fresh**, or create a workspace with **New workspace** and point it at a real repo.

### Gotchas

- **`ELECTRON_RUN_AS_NODE`**: if this variable is set (VS Code's extension host sets it), Electron starts as plain Node and fails with `does not provide an export named 'BrowserWindow'`. Run `unset ELECTRON_RUN_AS_NODE` first.
- **WSL / VMs**: the app passes `ignore-gpu-blocklist` so WebGL works with software GL. If WebGL still can't start, every panel keeps working and only the 3D world is hidden.

## What runs for real

| Feature | How |
|---|---|
| Agent runs | `claude -p --output-format stream-json` in a **git worktree per task branch** (in the app's data folder). Your working copy isn't touched until you approve a merge. |
| Tools and guardrails | Agents get file tools only. "Read only" agents get Read/Glob/Grep; "read & write" agents also get Edit/Write. They can't run shell commands. Web search is on only when the agent's Web search integration allows it. Max run time is enforced. |
| Commits, diffs, merge, revert | simple-git. The app commits the agent's changes, shows the numstat and diffs, merges with `--no-ff` after you approve in Inbox, and reverts with `git revert -m 1`. |
| Orchestrator | Plans missions through Claude Code with a JSON schema, respects autonomy (propose only, small plans, autopilot), starts tasks when their dependencies finish (within the parallel limit), adds QA hand-offs, and turns gate steps into approvals. |
| Jarvis chat | Each conversation is one Claude Code session that gets the live app state. Work requests come back as a draft mission card, and nothing runs until you approve it. |
| Approvals | Merge, plan, send, publish, delete and spend all land in Inbox. Agents ask by ending their report with a `REQUEST:` block. |
| Accounts and limits | Token usage per account and window, warn/stop thresholds, and switching agents to another account when one is near its limit. Claude Code's reported 5-hour reset time is used when available. You can give each account its own `CLAUDE_CONFIG_DIR` (one folder per Claude login). |
| Automations | Schedules run with node-cron and plan a mission in the target workspace (or ask Jarvis). The seeded sample automations start **off**. |
| Steer / stop | Steering interrupts the run and resumes the same Claude session with your message. Stop kills the run. |

Not wired up yet: live MCP or HTTP connectors (approved sends and publishes copy the content to your clipboard), event triggers for email, git and webhooks (saved, and they run with **Run now**), the Codex runner for GPT models, and real GLB models (the scene uses placeholder boxes from the layout JSON, as the handoff suggests).

## Layout

```
electron/
  main.ts            window, tray, startup
  preload.ts         window.jarvis.invoke / on (contextIsolation, sandbox)
  ipc.ts             every IpcInvoke channel, with input checks
  services/          db (lowdb), seed, claude (CLI wrapper), runner, orchestrator,
                     jarvis, approvals, changes, git, accounts, automations
src/
  shared/types.ts    verbatim handoff contract
  shared/app-types.ts  app additions (merged into IpcInvoke/IpcEvents)
  shell/             AppShell, HudTopBar, HudDock, DrawerPanel, SearchPalette
  scene/             IsoViewport, camera, LobbyWorld, OfficeWorld, labels (Vue in CSS2D)
  scene/layouts/     lobby-layout.json, office-layout.json (from the handoff)
  screens/           one .vue per canvas board
  stores/            data (mirror of the main DB), ui
tailwind.config.cjs  handoff tokens, loaded via @config
docs/design/         canvas boards + handoff files
```

Data lives in `jarvis-db.json` and `worktrees/` under Electron's `userData` folder (`~/.config/jarvis` on Linux).

Keys: **Esc** closes the drawer, **Ctrl K** opens search, **J** focuses the Jarvis composer. In the world, drag to pan, use the wheel to zoom, and click a building or agent to open it.
