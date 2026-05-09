# Guide Sync — Keep marketing guides in sync with desktop app changes

Detect what changed in the personas desktop codebase since the last sync, map changes to guide topics, flag stale content, and optionally update the personas-web guide content.

## When to use

Run after any significant feature work on the personas desktop app — new features, renamed UI sections, removed functionality, or changed workflows. The skill bridges the gap between desktop app development and marketing site documentation.

## Prerequisites

- Both repos must be accessible:
  - Desktop app: `C:\Users\kazda\kiro\personas`
  - Marketing site: `C:\Users\kazda\kiro\personas-web`
- The desktop app should have committed changes (the skill reads git history)

---

## Coordination — Active-Runs Ledger

`/guide-sync` is **cross-repo** — it reads from the personas desktop checkout and writes to the personas-web marketing repo. The active-runs ledger lives in the personas desktop repo (`.claude/active-runs.md`); register there since that's the side that has the convention. Per [`CLAUDE.md` → Concurrent CLI sessions](../../CLAUDE.md): read the file's `## Active` section first; if any `started`-status entry overlaps the desktop files you're about to read for change-detection AND is <2h old, surface the conflict to the user (the diff you compute may be incomplete if a sibling session is mid-commit on the same area). Overlap on `.claude/active-runs.md` itself is expected and is not a conflict.

**Declared paths for `/guide-sync`:** scope spans both repos.
- Read-only in personas: changed files since last sync (resolved in Phase 1 from the marker)
- Write in personas: `.claude/guide-sync-marker.json` (the marker update at session end)
- Write in personas-web: `personas-web/src/data/guide/content/*.ts` (the guide content updates), `personas-web/src/data/guide/desktop-modules.ts` (if the mapping needs an update)
- Always: `.claude/active-runs.md`

Cross-repo note: register at the personas-side ledger, but the actual writes happen in BOTH repos. Treat the personas-web commit as a separate atomic commit from any personas-side marker update — they're two different git histories.

**At session end** (after both commits land — desktop marker update + personas-web content update): move your entry to the top of `## Recently completed`. Update `Status` to `completed (commit: <desktop-sha> + personas-web:<web-sha>)` or `aborted (<reason>)`. Trim entries older than 14 days while you're there.

Full design rationale: [`docs/concepts/cli-coordination-active-runs.md`](../../../docs/concepts/cli-coordination-active-runs.md).

### Parallel-safety primitives (mandatory)

Per [`CLAUDE.md` → Parallel-safety primitives](../../CLAUDE.md), every CLI session must:

1. **Never `git stash`** other sessions' work — in EITHER repo, not even with `--keep-index`. If your commit step needs a clean stage, use `git add <path>` per file (NOT `git add -A` / `git add .` / `git add -u`); leave everything else alone.
2. **Use a worktree in personas-web for multi-topic guide updates.** Single-topic edits to one guide file can stay on the personas-web main checkout. Multi-topic syncs (typical for any non-trivial sync) get:
   ```bash
   cd C:/Users/kazda/kiro/personas-web
   git worktree add .claude/worktrees/guide-sync-<YYYYMMDD> -b worktree-guide-sync-<YYYYMMDD>
   cd .claude/worktrees/guide-sync-<YYYYMMDD>
   ```
   The personas-side marker update is a single-file commit that can stay on the main checkout (the marker file is gitignored or tracked depending on the repo setup — check before assuming).
3. **Atomic commits per topic** in personas-web. One commit per guide topic updated (e.g. `docs(guide): update agents/persona-editor for renamed tabs`). The marker update on the desktop side is one separate commit (`chore(guide-sync): bump marker to <new-sha>`).
4. **Verify the staged index before commit** in BOTH repos. After `git add` and before `git commit`, run `git diff --cached --stat`. If the staged file count is greater than the number you explicitly added, another session pre-staged work in the index — `git restore --staged <path>` per unrelated file, or use `git commit --only <files>` to bypass the shared index entirely.
5. **Clean up the personas-web worktree after merge.** Once the personas-web commits are in `git log master`, from the personas-web main checkout: `git worktree remove .claude/worktrees/guide-sync-<YYYYMMDD>` and `git branch -D worktree-guide-sync-<YYYYMMDD>`. Treat as part of the session-end ledger ritual.

---

## Phase 1: Detect changes since last sync

1. Check for the sync marker file at `C:\Users\kazda\kiro\personas\.claude\guide-sync-marker.json`:
   ```json
   { "lastSyncCommit": "abc1234", "lastSyncDate": "2026-04-11", "topicsFlagged": [] }
   ```
   If missing, create it with the current HEAD as the starting point and report "First sync — scanning full codebase."

2. Get the diff since last sync:
   ```bash
   cd C:/Users/kazda/kiro/personas && git diff --name-only LAST_SYNC_COMMIT..HEAD
   ```

3. Also get commit messages for context:
   ```bash
   git log --oneline LAST_SYNC_COMMIT..HEAD
   ```

## Phase 2: Map changes to guide topics

1. Read the desktop module mapping from:
   ```
   C:\Users\kazda\kiro\personas-web\src\data\guide\desktop-modules.ts
   ```
   This maps topic IDs to desktop app modules and file paths.

2. Read the topic definitions:
   ```
   C:\Users\kazda\kiro\personas-web\src\data\guide\topics.ts
   ```

3. For each changed file in the diff, determine which desktop module it belongs to:
   - `src/features/agents/` → `agents` module
   - `src/features/vault/` → `connections` module
   - `src/features/settings/` → `settings` module
   - `src/features/execution/` → `agents` module (execution is part of agent workflow)
   - `src/features/pipeline/` → `pipeline` module
   - `src/features/triggers/` → `events` module
   - `src/features/onboarding/` → `home` module
   - `src/features/templates/` → `templates` module
   - `src/features/plugins/` → `plugins` module
   - `src/features/overview/` → `overview` module
   - `src/features/deployment/` → `deployment` module
   - `src/stores/` → multiple modules (check slice name)
   - `src-tauri/src/commands/` → backend for corresponding module
   - `src-tauri/src/engine/` → core engine (affects execution, monitoring guides)

4. Map each affected module to guide topics via `desktop-modules.ts`. A topic is **stale** if:
   - Its mapped module had files changed
   - The commit messages mention related functionality
   - The change was structural (new files, deleted files, renamed exports)

5. Score staleness:
   - **HIGH**: Topic's exact mapped file was changed (direct hit)
   - **MEDIUM**: Topic's mapped module had changes (same directory tree)
   - **LOW**: Topic's category had tangential changes (related module)

## Phase 3: Read current guide content

For each stale topic (HIGH or MEDIUM), read the current guide content:
```
C:\Users\kazda\kiro\personas-web\src\data\guide\content\{categoryId}.ts
```

Extract the specific topic's markdown content and compare against the changes.

## Phase 4: Present findings

Show a table of stale topics:

```markdown
## Guide Sync Report — {date}

Changes since: {lastSyncCommit} ({commitCount} commits)

| # | Topic | Category | Staleness | Changed files | What changed |
|---|-------|----------|-----------|---------------|-------------|
| 1 | Creating your first agent | Getting Started | HIGH | EditorTabBar.tsx, ... | Tabs hidden in Simple mode |
| 2 | Understanding triggers | Triggers | MEDIUM | TriggerPopover.tsx | Simple mode filter added |
```

For each HIGH-staleness topic, show:
- Current guide excerpt (first 3 lines)
- What changed in the code
- Suggested content update (1-2 sentences describing what to add/change)

## Phase 5: Update content (with approval)

Ask the user which topics to update. For approved topics:

1. Read the full content file for the category
2. Locate the topic's content block
3. Update the markdown to reflect the changes
4. Preserve the existing structure and style (headings, steps blocks, callouts)

## Phase 6: Update sync marker

After the sync is complete:

```json
{
  "lastSyncCommit": "NEW_HEAD",
  "lastSyncDate": "YYYY-MM-DD",
  "topicsFlagged": ["topic-id-1", "topic-id-2"],
  "topicsUpdated": ["topic-id-3"]
}
```

## Phase 7: Check mode tags

As a final pass, verify that the `mode` tags in `topics.ts` and `categories.ts` still make sense given the latest changes. If a feature was moved between Simple/Power modes, flag the topic for mode tag update.

Check that:
- Topics tagged `simple` are actually accessible in Simple mode sidebar sections
- Topics tagged `power` reference features hidden in Simple mode
- New features have appropriate mode tags

---

## Anti-patterns

- Do NOT regenerate guide content from scratch — always edit the existing content
- Do NOT change content structure (heading levels, step ordering) without explicit approval
- Do NOT update content for LOW-staleness topics unless explicitly asked
- Do NOT modify `desktop-modules.ts` — that's a manual mapping maintained by the developer
- Do NOT run this skill without committed changes in the desktop app — it reads git history

## Integration with /research skill

If the `/research` skill discovers a finding that affects user-facing documentation, it should note "guide-sync needed" in its Phase 9 research note. The guide-sync skill can then be run separately to update the affected topics.

The two skills share the same desktop module mapping but operate on different axes:
- `/research`: external ideas → codebase changes → release notes
- `/guide-sync`: codebase changes → guide content → marketing site
