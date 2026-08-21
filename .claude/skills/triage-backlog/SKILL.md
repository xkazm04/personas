---
name: triage-backlog
description: Systematically triage, challenge, and process a backlog of auto-generated idea files. Groups by context area, validates against codebase, filters BS, presents one approval gate, then executes autonomously with code review.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill
---

# Backlog Triage Pipeline

You are a ruthless but fair backlog triage engine for the **personas-desktop** project. Your job is to process auto-generated idea files, separate signal from noise, get one approval from the user, then execute everything autonomously — finishing with clean atomic commits and code review.

**Calibration from real runs:** ~50% of an auto-generated backlog being stale is NORMAL, not a red flag. Design the pipeline so stale detection is cheap — verify each idea's *premise* against current code before spending any planning effort on it. A finding whose premise moved is closed as STALE, never fixed.

## Constants

- **Backlog path**: `.claude/commands/idea-*.md`
- **KB patterns path** (optional): `C:\Users\kazda\kiro\vibeman\tmp\kb-patterns-personas.json` — if absent, skip KB scoring dimensions and the Phase 6 KB update; do not fail.
- **Triage output**: `.claude/triage/TRIAGE-REPORT.md`
- **Discarded log**: `.claude/triage/discarded.md`

## Trigger

- `/triage-backlog` — full pipeline on all idea files
- `/triage-backlog <filter>` — triage only ideas matching a category or context group
- `/triage-backlog --resume` — continue from existing TRIAGE-REPORT.md (skip phase 1)
- `/triage-backlog --stats` — show current triage status counts

---

## Coordination — Active-Runs Ledger

Before the autonomous execution phase (after the user's one approval gate), register this session in `.claude/active-runs.md` per [`CLAUDE.md` → Concurrent CLI sessions](../../CLAUDE.md). The earlier triage phases (read, classify, score, present) are read-only and do not need registration; the moment the user approves the execution batch, the session becomes write-mode and MUST register before any code edit. Read the file's `## Active` section first; if any `started`-status entry overlaps your planned scope and is <2h old, surface the conflict to the user before proceeding. Overlap on `.claude/active-runs.md` itself is expected and is not a conflict.

**Declared paths for `/triage-backlog`:** the union of `referenced_files` across accepted ideas, plus `.claude/triage/` and the accepted `.claude/commands/idea-*.md` files (deleted on completion). If the union exceeds ~20 files, declare at directory granularity instead (e.g., `src/features/agents/`, `src-tauri/src/engine/`).

**At session end** (after final commits + code-review pass): move your entry to the top of `## Recently completed` with `completed (commit: <last-sha>)` or `aborted (<reason>)`. Trim entries older than 14 days while you're there.

Full design rationale: [`docs/architecture/cli-coordination.md`](../../../docs/architecture/cli-coordination.md).

### Parallel-safety primitives (mandatory)

Per [`CLAUDE.md` → Parallel-safety primitives](../../CLAUDE.md):

1. **Never `git stash`** — not even with `--keep-index`. Other sessions' in-flight work may be in the tree. If your commit step needs a clean stage, stage your own files explicitly; leave everything else alone.
2. **Use a worktree.** Execution ALWAYS edits multiple files — by definition multi-file. Before any edit:
   ```bash
   git worktree add .claude/worktrees/triage-backlog-<YYYYMMDD> -b worktree-triage-backlog-<YYYYMMDD>
   cd .claude/worktrees/triage-backlog-<YYYYMMDD>
   ```
3. **Atomic commit per accepted group** (see Phase 4) — never one mega-commit at session end, never >30 min of uncommitted work.
4. **Scoped `git add` in ONE invocation, then verify the index.** Stage explicit paths in a single command — `git reset -q && git add <path1> <path2> ...` — never `git add -A`/`.`/`-u`. Then, before `git commit`, run `git diff --cached --stat`: if the staged file count exceeds what you just added, another session pre-staged work — `git restore --staged <path>` per unrelated file. Even worktrees have been found with foreign pre-staged content; always verify.
5. **Clean up the worktree after merge.** Once commits are in `git log master`, from the main checkout: `git worktree remove .claude/worktrees/triage-backlog-<YYYYMMDD>` and `git branch -D worktree-triage-backlog-<YYYYMMDD>`. Part of the session-end ledger ritual.

---

## Phase 0: Setup & KB Load

1. **Read the KB** (if present) — extract `best_practice`, `anti_pattern`, `convention` entries; hold for scoring.
2. **Create output directory**: `mkdir -p .claude/triage`
3. **Inventory**: count idea files, report to user before proceeding.

---

## Phase 1: Extract & Validate (Parallel Subagents)

### Step 1a: Metadata extraction

Read every idea file and extract into a manifest:
- `id`, `title`, `category`, `effort`, `impact`, `scan_type`
- `context_group`: from `### Context:` section header (kept for reporting/conflict detection, not batching)
- `referenced_files`: all file paths in the idea
- `premise`: the ONE claim the idea depends on (e.g., "health checks write to DB per-check", "component X hand-rolls a spinner")
- `description_summary`: first 2 sentences

Fast — grep/read directly, no subagents.

### Step 1b: Parallel validation — sweep by CATEGORY, not context

**Category sweep beats context batching** (validated in real runs): batch by finding-category (`performance`, `tech_debt`, `error_handling`, `security`, …) across the whole backlog. One agent validating 8 similar findings shares one mental model and one detection recipe; a context-batched agent re-derives a new lens per item. Context groups return in Phase 4 only to detect same-file conflicts.

Spawn **general-purpose agents** (not Explore — they need to grep, read, and judge), one per category, max 6 concurrent; fold tiny categories together. Each agent validates its items **premise-first, cheapest check first**:

1. **Premise check (do this FIRST, before any other analysis)**: grep the current code for the exact condition the idea claims. Already fixed, refactored away, or never true → verdict `STALE`, stop — zero further effort on that item. Expect roughly half your items to die here.
2. **File existence**: >50% of referenced files gone → `DEAD`
3. **Code drift**: premise holds but surrounding code changed significantly → `DRIFT` (needs re-planning, not blind execution)
4. **Overlap detection**: multiple ideas targeting same file+function
5. **KB alignment** (if KB loaded): contradicts anti-patterns → `KB_CONFLICT`; reinforces → `KB_ALIGNED`

Each agent returns a JSON array of scored items:
```json
{
  "id": "idea-xxx",
  "title": "...",
  "category": "performance",
  "context_group": "Healing & Recovery",
  "effort": "Low|Medium|High",
  "verdict": "VALID|STALE|DEAD|DRIFT",
  "evidence": "healing/mod.rs:214 still writes per-check; batch fn absent",
  "kb_alignment": "NEUTRAL|KB_ALIGNED|KB_CONFLICT",
  "overlaps_with": ["idea-yyy"],
  "bs_score": 7,
  "one_line": "Batch health check DB writes to reduce contention"
}
```

`evidence` is mandatory: one line citing file:line (or the grep that came up empty) proving the verdict. It feeds the approval gate directly.

---

## Phase 2: BS Filter & Synthesis

### BS Score (1-10, higher = more BS)

| Dimension | 0 (good) | 3 (bad) |
|---|---|---|
| Effort vs Impact | Low effort, clear impact | High effort, "Unknown" impact |
| Specificity | Names exact function + line | Vague hand-waving |
| Risk | Isolated, no side effects | Touches core architecture |
| Measurability | "10 IPC calls → 1" | "Improves experience" |
| Codebase validity | Premise verified in current code | Premise moved or unverifiable |
| Redundancy | Unique | Overlaps 3+ other ideas |
| Over-engineering | Solves observed problem | Speculative "what if" |
| KB conflict | Aligns with proven patterns | Contradicts conventions |

### Anti-BS Red Flags (automatic score inflation)

- "Unknown" impact + "High" effort → +3
- Scan type "moonshot_architect" or "paradigm_shifter" → +2
- "could"/"would" instead of "does"/"causes" → +1
- No specific line numbers or function names → +1
- Proposes replacing stdlib with custom impl → +2
- WASM, WebRTC, exotic tech for a desktop app → +3
- "Future-proofing" / "scalability" for local-first app → +2
- Touches >5 files → +1 per file over 5
- Title contains "autonomous", "self-assembling", "collective intelligence" → +3

### Classification Buckets

| Bucket | Criteria | What happens |
|---|---|---|
| **STALE** | Premise no longer holds (or DEAD) | Closed + idea file deleted — this is a *successful* outcome, not a failure; log one-line evidence |
| **DISCARD** | BS >= 7 | Removed, logged with reason |
| **SKIP** | BS 5-6, or DRIFT | Kept in backlog, not executed this session |
| **EXECUTE** | BS <= 4, verdict VALID | Implemented after approval |
| **DUPLICATE** | Overlaps detected | Best version kept, rest discarded |

### Generate TRIAGE-REPORT.md

Write `.claude/triage/TRIAGE-REPORT.md`: header counts (total / execute / stale / skip / discard / duplicate), then per-bucket tables using the same columns as the approval gate below, then **Concerns for Your Review** — the 3-5 borderline calls where user judgment matters. Group the Execute table by category, noting context group per row.

---

## Phase 3: Single Approval Gate

Present ONE scannable message — the user should be able to judge 30 items in a minute. **Every item gets one row: verdict + one-line evidence + size.** No prose per item.

```
Triage: {total} items — Execute {n} · Stale {n} (normal: ~50%) · Skip {n} · Discard {n} · Dup {n}

EXECUTE ({n}):
| # | Item | Size | Evidence |
|---|---|---|---|
| 1 | Batch health-check DB writes | S | healing/mod.rs:214 still per-check |
| 2 | ... | M | ... |

STALE — closing ({n}):
| Item | Evidence |
|---|---|
| Debounce vault search | vault/Search.tsx:88 already debounced (300ms) |

SKIP ({n}): {item — reason, one line each}
DISCARD ({n}): {item — reason, one line each}

Concerns (borderline — your call):
1. {item + why unsure}

Full report: .claude/triage/TRIAGE-REPORT.md
Approve to proceed? I'll execute, code-review, and commit atomically per group.
```

Size: S (<1h, ≤2 files) / M (few files) / L (cross-cutting). **This is the ONLY user interaction.** The user can approve as-is, move items between buckets, narrow scope, or abort. Once approved, everything is autonomous.

---

## Phase 4: Autonomous Execution

1. **Register in the active-runs ledger and create the worktree** (see Coordination section). All execution happens in the worktree.
2. **Group approved items into commit groups by category**; split a group where two items touch the same file as an item in another concurrently-running group — same-file work runs sequentially.
3. **Spawn general-purpose agents** — one per commit group, max 4 concurrent, all working in the worktree. Each gets: its idea files, relevant KB patterns, files to touch.

### Execution agent instructions (prompt template)

```
You are implementing backlog improvements for the personas-desktop project,
working in the worktree at {worktree-path}. Read CLAUDE.md conventions first.

## KB Patterns (follow these)
{relevant KB entries}

## Items to implement (in order)
{idea summaries with referenced files and evidence lines}

## Rules
- Re-verify each item's premise before editing; if the code no longer matches
  the idea's description, SKIP it and report STALE — do not force the fix.
- After each item, run: npm run check (ten gates incl. census:check — NOT a bare
  tsc, which skips the eight gates ahead of it; and cargo check if Rust touched).
  On failure: revert that item's changes, report FAILED, continue.
- Surgical changes only — no drive-by refactors, no "// per idea-xxx" comments,
  no speculative abstractions. New UI strings go through i18n (t.section.key).
- Do NOT run any git commands — the orchestrator commits.
- Report per item: DONE | STALE | FAILED (+ files touched).
```

### Committing (orchestrator, after each group's agent finishes)

One **atomic commit per accepted group**, immediately when its agent reports — do not accumulate groups:

```bash
git reset -q && git add <file1> <file2> ...   # explicit paths, ONE invocation
git diff --cached --stat                       # verify count matches; restore-staged any strays
git commit -m "chore(triage): <category> — <n> items

<idea-ids and one-liners>

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Delete each successfully implemented idea file from `.claude/commands/` and include the deletion in that group's commit. Agent crash: log pending items, continue with other groups.

---

## Phase 5: Code Review Loop

After all groups complete:

1. **Run `/code-review`** via the Skill tool on all changes
2. **Auto-fix** flagged issues: type/lint/style and security → fix directly; architectural concerns → attempt reasonable fix, log for user
3. Commit fixes (same scoped-add discipline), **re-run `/code-review`**, repeat until clean — max 3 cycles
4. Still unresolved after 3 cycles → log in the final report; the commits stand and the user can address the rest

---

## Phase 6: Finalize & Report

1. **Delete STALE/DISCARD idea files** from `.claude/commands/` (already logged in `discarded.md` with evidence) and commit that cleanup as its own commit.
2. **Merge the worktree branch to master** (or leave the branch and tell the user, if master moved significantly), then remove the worktree per the Coordination section, and close the active-runs ledger entry.
3. **KB update** (if KB file exists): add newly proven techniques as `best_practice` (confidence 70), confirmed-harmful ideas as `anti_pattern`, adjust confidence ±5/-10 for patterns that helped/misled. Write the JSON back.

### Final Report to User

```markdown
# Triage Session Complete
- Implemented: {n}/{approved} · Failed (reverted): {n} · Closed stale: {n} · Discarded: {n} · Skipped: {n}
- Commits: {list of sha — subject}
- Code review: {cycles} cycles, {fixed} fixed, remaining: {list or "none"}
- Changes: {brief summary by category}
- Failed items: {item — reason, or "none"}
- KB updates: {or "n/a — KB file absent"}
```

---

## Edge Cases

- **Empty backlog**: report "No idea files found" and exit.
- **Everything stale/discarded**: a valid, useful outcome — clean up idea files, report, skip execution phases.
- **Filter argument**: process only matching ideas, same pipeline.
- **Context pressure**: process in batches of 50, writing intermediate results to TRIAGE-REPORT.md.
- **KB file missing**: proceed without KB dimensions; note in report.
