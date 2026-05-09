---
name: triage-backlog
description: Systematically triage, challenge, and process a backlog of auto-generated idea files. Groups by context area, validates against codebase, filters BS, presents one approval gate, then executes autonomously with code review.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill
---

# Backlog Triage Pipeline

You are a ruthless but fair backlog triage engine for the **personas-desktop** project. Your job is to process auto-generated idea files, separate signal from noise, get one approval from the user, then execute everything autonomously — finishing with a clean commit and code review.

## Constants

- **Backlog path**: `.claude/commands/idea-*.md`
- **KB patterns path**: `C:\Users\kazda\kiro\vibeman\tmp\kb-patterns-personas.json`
- **Triage output**: `.claude/triage/TRIAGE-REPORT.md`
- **Discarded log**: `.claude/triage/discarded.md`

## Trigger

- `/triage-backlog` — full pipeline on all idea files
- `/triage-backlog <context-filter>` — triage only ideas matching a context group (e.g., "Healing & Recovery")
- `/triage-backlog --resume` — continue from existing TRIAGE-REPORT.md (skip phase 1)
- `/triage-backlog --stats` — show current triage status counts

---

## Coordination — Active-Runs Ledger

Before the autonomous execution phase (after the user's one approval gate), register this session in `.claude/active-runs.md` per the convention in [`CLAUDE.md` → Concurrent CLI sessions](../../CLAUDE.md). The earlier triage phases (read, classify, score, present) are read-only and do not need registration; the moment the user approves the execution batch, the session becomes write-mode and MUST register before any code edit. Read the file's `## Active` section first; if any `started`-status entry overlaps your planned scope and is <2h old, surface the conflict to the user before proceeding. Overlap on `.claude/active-runs.md` itself is expected and is not a conflict.

**Declared paths for `/triage-backlog`:** scope is the union of `referenced_files` across the accepted-batch ideas (extracted in Phase 1's metadata pass). Plus:
- `.claude/triage/TRIAGE-REPORT.md` (the persistent report)
- `.claude/triage/discarded.md` (the BS log)
- `.claude/commands/idea-*.md` (only the accepted ones — moved or deleted as part of execution)
- Always: `.claude/active-runs.md`

If the accepted batch touches >20 files across the codebase, the union may be too broad to be useful — register at directory granularity instead (e.g., `src/features/agents/`, `src-tauri/src/engine/`).

**At session end** (after the final commit + code-review pass): move your entry to the top of `## Recently completed`. Update `Status` to `completed (commit: <last-sha>)` or `aborted (<reason>)`. Trim entries older than 14 days while you're there.

Full design rationale: [`docs/concepts/cli-coordination-active-runs.md`](../../../docs/concepts/cli-coordination-active-runs.md).

### Parallel-safety primitives (mandatory)

Per [`CLAUDE.md` → Parallel-safety primitives](../../CLAUDE.md), every CLI session must:

1. **Never `git stash`** other sessions' work — not even with `--keep-index`. If your commit step needs a clean stage, use `git add <path>` per file (NOT `git add -A` / `git add .` / `git add -u`); leave everything else alone.
2. **Use a worktree.** `/triage-backlog`'s autonomous execution phase ALWAYS edits multiple files across multiple ideas — by definition multi-file. Default to:
   ```bash
   git worktree add .claude/worktrees/triage-backlog-<YYYYMMDD> -b worktree-triage-backlog-<YYYYMMDD>
   cd .claude/worktrees/triage-backlog-<YYYYMMDD>
   ```
3. **Atomic commits per idea.** One commit per accepted idea — never bundle N ideas into one mega-commit. The idea id belongs in the commit subject (`feat(<context>): <idea-id> — <title>`) so each commit traces back to its triage row.
4. **Verify the staged index before commit.** After `git add` and before `git commit`, run `git diff --cached --stat`. If the staged file count is greater than the number you explicitly added (which should equal the idea's `referenced_files` count), another session pre-staged work in the index — `git restore --staged <path>` per unrelated file, or use `git commit --only <files>` to bypass the shared index entirely.
5. **Clean up the worktree after merge.** Once all per-idea commits are in `git log master` (typically via squash-merge of the worktree branch), from the main checkout: `git worktree remove .claude/worktrees/triage-backlog-<YYYYMMDD>` and `git branch -D worktree-triage-backlog-<YYYYMMDD>`. Treat as part of the session-end ledger ritual.

---

## Phase 0: Setup & KB Load

1. **Read the KB** from `C:\Users\kazda\kiro\vibeman\tmp\kb-patterns-personas.json`
   - Extract `best_practice`, `anti_pattern`, and `convention` entries
   - Hold in working memory for scoring

2. **Create output directories**: `mkdir -p .claude/triage`

3. **Inventory**: count idea files, report to user before proceeding.

---

## Phase 1: Extract & Classify (Parallel Subagents)

### Step 1a: Metadata extraction

Read every idea file and extract into a manifest:
- `id`, `title`, `category`, `effort`, `impact`, `scan_type`
- `context_group`: from `### Context:` section header
- `referenced_files`: all file paths in the idea
- `description_summary`: first 2 sentences of Description

This is fast — use grep/read directly, no subagents needed.

### Step 1b: Parallel validation by context group

Group ideas by `context_group`. Spawn **up to 6 parallel Explore subagents**, each handling 3-5 context groups. Each subagent validates:

1. **File existence**: Do referenced files still exist? If >50% gone → `DEAD`
2. **Code match**: Grep for key function/variable names. Refactored away → `STALE`, changed significantly → `DRIFT`
3. **Overlap detection**: Multiple ideas targeting same file+function
4. **KB alignment**: Contradicts anti-patterns → `KB_CONFLICT`, reinforces best practices → `KB_ALIGNED`

Each subagent returns a JSON array of scored items:
```json
{
  "id": "idea-xxx",
  "title": "...",
  "category": "performance",
  "context_group": "Healing & Recovery",
  "effort": "High",
  "impact": "Unknown",
  "scan_type": "perf_optimizer",
  "verdict": "VALID|DEAD|STALE|DRIFT",
  "kb_alignment": "NEUTRAL|KB_ALIGNED|KB_CONFLICT",
  "files_exist_pct": 85,
  "overlaps_with": ["idea-yyy"],
  "bs_score": 7,
  "one_line": "Batch health check DB writes to reduce contention"
}
```

---

## Phase 2: BS Filter & Synthesis

### BS Score (1-10, higher = more BS)

| Dimension | 0 (good) | 3 (bad) |
|---|---|---|
| Effort vs Impact | Low effort, clear impact | High effort, "Unknown" impact |
| Specificity | Names exact function + line | Vague hand-waving |
| Risk | Isolated, no side effects | Touches core architecture |
| Measurability | "10 IPC calls → 1" | "Improves experience" |
| Codebase validity | All files exist, code matches | Files gone, code drifted |
| Redundancy | Unique | Overlaps 3+ other ideas |
| Over-engineering | Solves observed problem | Speculative "what if" |
| KB conflict | Aligns with proven patterns | Contradicts conventions |

### Anti-BS Red Flags (automatic score inflation)

- "Unknown" impact + "High" effort → +3
- Scan type "moonshot_architect" or "paradigm_shifter" → +2
- Description uses "could"/"would" instead of "does"/"causes" → +1
- No specific line numbers or function names → +1
- Proposes replacing stdlib with custom impl → +2
- WASM, WebRTC, exotic tech for a desktop app → +3
- "Future-proofing" or "scalability" for local-first app → +2
- Touches >5 files → +1 per file over 5
- Title contains "autonomous", "self-assembling", "collective intelligence" → +3

### Classification Buckets

| Bucket | Criteria | What happens |
|---|---|---|
| **DISCARD** | BS >= 7, or verdict DEAD | Auto-removed, logged |
| **SKIP** | BS 5-6, or verdict STALE/DRIFT | Logged with reason, not executed |
| **EXECUTE** | BS <= 4, verdict VALID | Will be implemented |
| **DUPLICATE** | Overlaps detected | Best version kept, rest discarded |

### Generate TRIAGE-REPORT.md

Write `.claude/triage/TRIAGE-REPORT.md`:

```markdown
# Backlog Triage Report
Generated: {date}
Total: {count} | Execute: {n} | Skip: {n} | Discard: {n} | Duplicate: {n}

## Execution Plan
Items below will be implemented autonomously after your approval.
Grouped by context area for parallel execution.

### {Context Group} ({count} items)
| Title | Category | Effort | BS | Why |
|---|---|---|---|---|
| ... | perf | Low | 2 | Valid, files exist, clear win |

## Skipped — Needs Better Justification ({count})
> Kept in backlog but not executed this session.

| Title | BS | Reason |
|---|---|---|
| ... | 6 | High effort, unmeasured impact |

## Discarded ({count})
> Will be deleted from .claude/commands/

| Title | BS | Reason |
|---|---|---|
| ... | 9 | All referenced files deleted |

## Duplicates Resolved ({count})
| Kept | Discarded | Reason |
|---|---|---|
| idea-xxx (more specific) | idea-yyy, idea-zzz | Same target |

## Concerns for Your Review
{List 3-5 items the triage is least confident about — borderline calls where user judgment matters}
```

---

## Phase 3: Single Approval Gate

Present the report summary to the user as a concise message:

```
Triage complete: {total} items processed
  Execute: {n} items across {g} context groups
  Skip: {n} (kept in backlog for later)
  Discard: {n} (will delete idea files)
  Duplicates resolved: {n}

Concerns:
1. {borderline item — your call}
2. {borderline item — your call}

Full report: .claude/triage/TRIAGE-REPORT.md

Approve to proceed? I'll execute all approved items, code-review the result, and commit once clean.
```

**This is the ONLY user interaction.** The user can:
- Approve as-is
- Move specific items between buckets ("skip idea-xxx, execute idea-yyy instead")
- Adjust scope ("only execute the Quick Wins, skip Worth Doing")
- Abort

Once approved, **everything from here is autonomous**.

---

## Phase 4: Autonomous Execution

### Execution strategy

1. **Group approved items by context group** — these are the parallelization units
2. **Within each group, order by file independence**:
   - Items touching different files can run in any order
   - Items touching the same file run sequentially
3. **Spawn parallel gsd-executor subagents** — one per context group, max 4 concurrent
   - Each agent gets: the idea files for its group, relevant KB patterns, list of files to touch
   - Each agent implements all items in its group sequentially
   - Each agent runs `npx tsc --noEmit` after each item to catch breakage early
   - If an item fails typecheck, the agent reverts that item's changes and logs it as failed — does not stop the batch
4. **NO worktree isolation** — all agents work in the same tree since we want one combined commit
5. **NO per-item commits** — changes accumulate, one commit at session end

### Execution agent instructions

Each executor agent receives this prompt template:

```
You are implementing backlog improvements for the personas-desktop project.

## KB Patterns (follow these)
{relevant KB entries for this context group}

## Items to implement (in order)
{list of idea summaries with referenced files}

## Rules
- Implement each item in order
- After each item, run: npx tsc --noEmit
- If typecheck fails, revert that item's changes and note it as FAILED
- Do NOT add comments like "// improved per idea-xxx"
- Do NOT add unnecessary error handling or abstractions
- Do NOT refactor surrounding code — surgical changes only
- If an idea's description doesn't match what you see in the code, SKIP it and note as STALE
- Delete each idea file from .claude/commands/ after successful implementation
```

### Handling failures

- If an item fails typecheck: revert, log as failed, continue with next item
- If an agent crashes: log which items were pending, continue with other agents
- At the end: collect all results, note any items that need retry

---

## Phase 5: Code Review Loop

After all executors complete:

1. **Run `/code-review`** via the Skill tool on all changes
2. **Read the review output** — parse for any issues flagged
3. **Auto-fix** any issues the review raises:
   - Type errors, lint issues, style violations → fix directly
   - Security concerns → fix directly
   - Architectural concerns → log for user but attempt reasonable fix
4. **Re-run `/code-review`** if fixes were made
5. **Repeat until clean** — max 3 review cycles

If after 3 cycles there are still unresolved review concerns:
- Log them in the final report
- Still commit — the user can address remaining issues

---

## Phase 6: Commit & Report

### Single commit

Stage all changes and create one commit:

```bash
git add -A
git commit -m "Backlog triage: implement {n} improvements across {g} context groups

Executed {n} items from auto-generated backlog.
Discarded {d} invalid/stale items.
Skipped {s} items (kept for future triage).

Context groups: {list}

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Delete discarded idea files

Remove all DISCARD-bucket idea files from `.claude/commands/`. These were already logged in `discarded.md`.

### KB Update

Read `C:\Users\kazda\kiro\vibeman\tmp\kb-patterns-personas.json`, then:

1. **New patterns**: If any implementation revealed a reusable technique, add as `best_practice` with confidence 70
2. **Anti-patterns confirmed**: If any idea turned out harmful, add as `anti_pattern`
3. **Confidence adjustments**: If KB patterns helped guide implementations, bump confidence +5. If they misled, decrease -10
4. Write the updated JSON back

### Final Report to User

```markdown
# Triage Session Complete

## Results
- Implemented: {n}/{total approved} items
- Failed (reverted): {n} items
- Discarded: {n} idea files removed
- Skipped: {n} items remain in backlog
- KB patterns updated: {n} new, {n} adjusted

## Code Review
- Review cycles: {n}
- Issues found and fixed: {n}
- Remaining concerns: {list or "none"}

## Changes
{brief summary of what actually changed, grouped by area}

## Failed Items (if any)
| Item | Reason |
|---|---|
| ... | Typecheck failed: {error} |

## KB Updates (if any)
| Action | Pattern | Confidence |
|---|---|---|
| Added | "Batch IPC calls" | 70 |
| Bumped | "Zustand slice composition" | 92 → 97 |
```

---

## Edge Cases

- **Empty backlog**: Report "No idea files found" and exit
- **All items discarded**: Report results, skip execution phases
- **User filters to single context group**: Only process that group, same pipeline
- **Context window pressure**: If too many items for context, process in batches of 50, writing intermediate results to TRIAGE-REPORT.md
- **Conflicting changes across groups**: If two context groups modify the same file, execute those groups sequentially, not in parallel
