# Todo Calendar

Todo Calendar is an open-source desktop calendar and task management app built with **React + Electron + SQLite**.

The project focuses on three core principles:

- Date-first task planning (calendar as the primary view)
- Local-first data ownership (SQLite on your machine)
- AI-assisted planning with explicit user confirmation before database writes

## Why This Project

Many todo apps are list-first and weak on calendar workflows. Many calendar apps are good at display but weak at task operations. Todo Calendar combines both:

- See task density directly in a monthly calendar grid
- Manage tasks quickly from a focused side panel
- Let AI draft changes, then apply them only after user confirmation

## Core Features

### 1) Calendar + Task Management

- 42-cell monthly calendar view
- Task side panel for the selected date
- Drag-and-drop sorting (`@dnd-kit`)
- Priority flag, completion toggle, and task color tagging
- Search by keyword and by tag
- Task type support (`regular / one_day / due_date / future`)

### 2) AI Planning + Preview

- Built-in AI chat panel
- Structured AI action output (`action + actions[]`) instead of direct DB mutation
- Preview-first workflow in React state before persistence
- User controls:
  - `Cancel`: discard current AI preview plan
  - `Confirm`: execute DB writes, refresh UI, clear preview state

### 3) Multi-Model Connection

- Native mode: local WebLLM (WebGPU required)
- API Key mode: OpenAI-compatible endpoint
- OAuth / REST API settings are present as extension-ready options

### 4) Theme + Settings

- Global Light / Dark mode
- Configurable default task type
- Configurable model URL, model version, and auth fields

## Tech Stack

- Frontend: React 18, React Router, MUI
- Desktop runtime: Electron
- Database: better-sqlite3 (SQLite)
- AI: OpenAI SDK, Vercel AI SDK, WebLLM
- Validation: Zod
- Build tooling: Vite, electron-builder

## Project Structure (Key Folders)

```text
src/
  ai/                 # AI pipeline, prompts, action contracts, providers
  components/         # UI components (task panel, chat, dialogs, etc.)
  context/            # Global state (theme, settings, AI preview)
  hooks/              # Business hooks (tasks, AI chat)
  pages/              # App pages (Calendar, Notes, Settings)

electron/
  main.js             # Electron main process entry
  preload.cjs         # Secure bridge (window.db.*)
  db.js               # SQLite init, migration, cleanup
  db-service.js       # Data access + write operations
  ipc-handlers.js     # IPC registration
```

## Quick Start

### Prerequisites

- Node.js LTS (recommended: 18+)
- npm

### Install

```bash
npm install
```

If you are behind a firewall/proxy, configure your local `.npmrc` before installing.

### Development

```bash
npm run dev        # Electron + Vite hot reload
npm run dev:web    # Browser-only mode (no Electron persistence layer)
```

### Lint

```bash
npm run lint
```

### Build & Package

```bash
npm run build      # Production web build -> dist/
npm run pack       # Electron unpacked app -> dist-electron/
npm run dist       # Installers (macOS / Windows / Linux)
```

## Data & Storage

- Desktop mode uses local SQLite storage.
- DB file path: `<userData>/todo-calendar.db`.
- Main tables include `tasks`, `task_day_entries`, `config`, `actions`, `logs`.
- Basic migration logic is included for schema evolution.

## AI Execution Flow (Simplified)

1. User sends a natural-language request.
2. AI pipeline produces a structured action plan.
3. UI renders a preview (no DB write yet).
4. User clicks `Confirm` to execute actions in order.
5. Calendar/task views refresh and preview state is cleared.

This creates a clear safety boundary between AI suggestions and actual persistence.

## Current Limitations

- `Notes` page is currently in-memory (not persisted across restarts).
- Native model mode depends on WebGPU support.
- The repository currently emphasizes lint checks; automated test coverage can be expanded.

## Suggested Roadmap

- Persist notes to local database
- Add import/export support (JSON / CSV / ICS)
- Expand automated tests and CI workflows
- Add more AI providers and observability tooling

## Contributing

Issues and pull requests are welcome.

Recommended contribution flow:

1. Fork the repository and create a feature branch.
2. Implement changes and run `npm run lint`.
3. Document behavior changes and verification steps clearly.
4. Open a pull request.

## License

MIT. See [LICENSE](./LICENSE).
