# Active Runs Ledger

Coordination surface for CLIs (Claude Code agents, manual sessions, skill
invocations) operating concurrently on this checkout. Each session that
materially edits the working tree should touch this file twice:

1. **At session start (Phase 0):** read this file, scan `## Active` for
   running entries. If any entry's declared paths overlap with this
   session's planned scope AND the entry is less than 2 hours old AND its
   status is `started`, surface the conflict to the user before proceeding
   (options: abort, coordinate, or proceed-with-awareness). Then append
   your own entry under `## Active`.
2. **At session end (Phase 11/13):** move your `## Active` entry to the
   top of `## Recently completed`, update its status to `completed (commit:
   <sha>)` or `aborted (<reason>)`. Trim entries older than 14 days from
   `## Recently completed`.

If your session crashes, your entry stays under `## Active` with a stale
timestamp — the next session can recognize it as abandoned.

## Conventions

- Timestamps are local time, format `YYYY-MM-DD HH:MM`.
- `Paths` declares the directories or globs the session expects to read or
  write. Be specific enough that overlap is meaningful (`src/features/agents/sub_chat/`
  is good; `src/` is too broad to be useful).
- The `## Active` section is the source of truth; `## Recently completed`
  is a rolling history window.
- Concurrent edits to this file: re-read on Edit failure, repeat the
  conflict check, retry. The Edit tool's unique-old-string rule prevents
  silent clobbers.

## Active

- **[2026-05-09 ~21:00] /research — browser-harness (browser-use)**
  - **Source:** [Browser Harness walkthrough](https://www.youtube.com/watch?v=YDqqRqqlnJU) (browser-use folks)
  - **Paths:** `scripts/connectors/builtin/desktop-browser.json`, `src-tauri/src/db/builtin_connectors.rs`, `src-tauri/src/engine/skill_scratchpad.rs` (new), `src-tauri/src/engine/mod.rs`, `src-tauri/src/engine/prompt/mod.rs`, `.claude/active-runs.md`, `Obsidian/personas/Research/`, `Obsidian/personas/Lessons/`
  - **Status:** started

- **[2026-05-09 ~21:15] /research — cli-coordination-active-runs (design + execute)**
  - **Source:** in-session conversation following Claude+CapCut run; user request to design and execute the active-runs ledger right away
  - **Paths:** `.claude/active-runs.md`, `.claude/CLAUDE.md`, `.claude/skills/research/skill.md`, `docs/concepts/cli-coordination-active-runs.md`, `docs/concepts/README.md`
  - **Status:** started — overlaps with browser-harness only on `.claude/active-runs.md` (by design — that file is the coordination surface itself)

- **[2026-05-09 ~21:30] manual — clear-wins/creative backlog execution**
  - **Source:** user request to walk through `.claude/commands/clear-wins/creative/` task by task, working on top of current code state
  - **Paths:** `src/features/shared/`, `src/features/agents/`, `src/features/vault/`, `src/features/overview/`, `src/features/recipes/`, `src/features/onboarding/`, `src/styles/`, `src/i18n/locales/en.json`, `tailwind.config.*`
  - **Status:** started — no overlap with active /research sessions (they touch backend/connector/engine paths)

## Recently completed (last 14 days)

- **[2026-05-09 13:10] /research — claude-blender (defer-all-reopenable)**
  - **Source:** [Claude + Blender Is Insane Now](https://www.youtube.com/watch?v=wSY1kHXSap0); also extended `/research` skill with Phase 2.5 web augmentation + on-demand `docs/features/` lookup (skill edits already landed in commit `27b6d5a3b` via baseliner; ledger entry registered retroactively)
  - **Paths:** `.claude/skills/research/skill.md`, `.claude/active-runs.md`, `Obsidian/personas/Research/2026-05-09-claude-blender-mcp.md` (new), `Obsidian/personas/Lessons/2026-05-09-research.md` (appended), `Obsidian/personas/Patterns/descoped-reopenable.md` (new meta-entry)
  - **Status:** completed (commit `9ac5148ca`) — 0 accepted, 7 descoped-reopenable folded into one `descoped-reopenable.md` meta-entry (3D-readiness wave); ledger-only commit at the repo level (skill edits already landed in `27b6d5a3b`; Obsidian writes are out-of-repo)

- **[2026-05-09 ~21:50] cross-skill — active-runs adoption v2 (priority five)**
  - **Source:** in-session continuation of the active-runs ledger v1 commit; user request to do cross-skill adoption now
  - **Paths:** `.claude/skills/architect/skill.md`, `.claude/skills/add-template/skill.md`, `.claude/skills/add-credential/skill.md`, `.claude/skills/refresh-context/skill.md`, `.claude/skills/codebase-init/skill.md`, `docs/concepts/cli-coordination-active-runs.md`, `docs/concepts/README.md`
  - **Status:** completed (commit `a88d7f190`)

- **[2026-05-09 19:10] /research — claude-capcut-motion-graphics**
  - **Source:** [Matt Loui — Claude + CapCut tutorial](https://www.youtube.com/watch?v=8oIFBQ9BhVU)
  - **Paths:** `docs/concepts/`, `Obsidian/personas/Lessons/`, `Obsidian/personas/Research/`
  - **Status:** completed (commit `16bf3b431`)

- **[2026-05-09 ~19:30] /research — cli-coordination-active-runs (this entry's own author)**
  - **Source:** in-session design + execute (no external source)
  - **Paths:** `.claude/active-runs.md`, `.claude/CLAUDE.md`, `.claude/skills/research/skill.md`, `docs/concepts/cli-coordination-active-runs.md`
  - **Status:** completed (commit pending — this run is creating the ledger itself)
