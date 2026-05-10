# CLI Coordination via Active-Runs Ledger

> **Status:** Architecture pattern — shipped 2026-05-09 (v1 + v2 priority-five adoption); long-tail adoption shipped same day in commit `605cf0bc6`. Moved from `docs/concepts/cli-coordination-active-runs.md` to `docs/architecture/` on 2026-05-10.
> **Related:** [`.claude/active-runs.md`](../../.claude/active-runs.md) (the ledger), [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) → "Concurrent CLI sessions" (project-wide pointer), `.claude/skills/research/skill.md` (first adopter).

---

## What this is

A small, low-ceremony coordination surface for multiple CLIs (Claude Code agents, manual sessions, skill invocations) operating concurrently on the same git checkout, on the same branch, without branching for isolation.

A single git-tracked file at `.claude/active-runs.md` serves as a shared ledger:

- **Phase 0** of each session reads it, scans for in-progress entries whose declared paths overlap with the new session's planned scope, and surfaces conflicts to the user.
- **Phase 11/13** of each session moves its entry to "completed" and records the commit SHA.

That's it. No locks, no daemon, no queue, no branching.

---

## Why this exists

### What was actually observed

On 2026-05-09 four `/research` runs happened on the same checkout, on `master`, within ~12 hours:

1. Morning — Bright Data hackathon
2. Afternoon — Matt Wolfe second-brain video
3. Late afternoon / evening — "Printing Press" walkthrough by Nate Herk (no Lessons entry written; produced uncommitted `engine/skills_sidecar/` directory)
4. Evening — Matt Loui CapCut tutorial (this design doc's parent run, produced `docs/concepts/per-persona-claude-code-skills.md` + `…image-attachments.md`)

Run #4's F1 finding was **about to propose** building exactly the infrastructure run #3 had already drafted. The collision was caught reactively: a second-pass `grep` against `\.claude/skills` happened to turn up the in-flight `DESIGN.md` + `mod.rs`. Without that grep, run #4 would have shipped a duplicate concept doc.

Run #3 also left a stray `.research-cache/YDqqRqqlnJU.en.vtt` cache file behind — its Phase 2a cleanup never ran, presumably because the run didn't reach Phase 11.

Both failures are coordination failures: not "broken code", but "two agents working on the same branch, same checkout, with no view of each other's in-flight intent".

### The chronic version of this problem

As more skills run concurrently and more tasks are delegated to the CLI in parallel, the cost of these collisions grows. Two skills writing the same file. Two skills proposing the same finding. Two skills committing in close succession with messages that read as if either was working solo.

The user's framing was apt: *"many CLIs are working in parallel on one machine in one branch in separate commits — please propose how to make order in the chaos, without branching."*

---

## Approaches considered

Five shapes were on the table. Ranked from most invasive to least:

### 1. Branching (rejected by premise)

Each CLI works on its own branch; merges back via PR. **Rejected:** the user explicitly said "without branching". Branching also defeats the "multiple CLIs share a working tree" model that makes parallel work cheap in this codebase.

### 2. Queue / dispatcher daemon

A background process accepts session requests, queues them, runs them serially or with explicit concurrency limits. **Rejected:** defeats parallelism entirely; significant infrastructure to build and maintain; introduces a single point of failure.

### 3. Lock files per domain

`.locks/<domain>.lock` files (engine, prompt, db migrations, …). Each CLI acquires advisory locks before touching that domain. **Rejected:** domain granularity is impossible to get right. "Engine" is too broad, per-file is too narrow. Stale locks need a lifecycle. The mental model is heavier than what the actual problem warrants.

### 4. Git-only coordination (rebase-on-merge)

Each CLI commits more granularly; pulls and rebases before its own commit lands; conflicts surface at merge time. **Partially rejected:** git already does some of this. But conflicts only surface AFTER both runs have written code — too late. The most expensive failure mode (duplicate proposed concept docs) doesn't even produce a git conflict because the files are at different paths.

### 5. Active-runs ledger (chosen)

A single file documenting in-progress sessions. CLIs declare scope at start; check overlap; mark complete at end. **Chosen.** Reasons:

- **Cheap:** one file, ~10 lines of skill-spec changes per adopter.
- **Catches intent before code:** the conflict check fires at Phase 0, before either session has written anything.
- **Human-readable:** plain markdown, browseable, grep-able, version-controlled.
- **Discipline-dependent but bounded:** if a session forgets to register, the worst outcome is duplicate work — same shape as the failure that motivated this concept. No new failure modes introduced.
- **Self-discoverable via CLAUDE.md:** the project's CLAUDE.md references the ledger, so any agent loading project context sees it without each skill having to spec it.

---

## Implementation v1

### The file: `.claude/active-runs.md`

Three sections:

```
# Active Runs Ledger

[brief explanation of the contract]

## Conventions

- timestamps, path declaration, edit-conflict resolution rules

## Active

[in-progress entries, format below]

## Recently completed (last 14 days)

[completed entries, oldest at bottom]
```

Each entry shape:

```markdown
- **[YYYY-MM-DD HH:MM] /<skill-name> — <slug>**
  - **Source:** <where the run came from — URL, conversation, etc.>
  - **Paths:** `path1/`, `path2/`, `glob/**`
  - **Status:** started | completed (commit: <sha>) | aborted (<reason>)
```

### Self-discoverability via `CLAUDE.md`

The project's `CLAUDE.md` carries a section under "Important Conventions" (Concurrent CLI sessions) pointing at `.claude/active-runs.md` and describing the contract. CLAUDE.md is auto-loaded into every Claude Code conversation in this repo, so any session sees the convention without having to be told.

### Conflict detection rule

A planned-path-vs-active-path overlap exists when EITHER:

- A planned path is a prefix of an active path (broader to narrower).
- An active path is a prefix of a planned path (narrower to broader).
- The two paths are equal.

When overlap exists AND the active entry is `started`-status AND the entry's `started` timestamp is less than 2 hours old, surface the conflict to the user. The user can:

- **Abort:** the new session stops, no entry written.
- **Coordinate:** the new session writes a different scope (e.g. picks a different finding, narrower paths) and the user manually de-conflicts with the other session.
- **Proceed-with-awareness:** the new session continues with the conflict noted in its run record.

When the active entry is `started`-status AND older than 2 hours, the new session presumes the other session is abandoned. It should NOT silently rewrite the other session's entry — it can mention the stale entry to the user, but the cleanup is a manual or out-of-band concern.

---

## v2 — cross-skill adoption

### Priority five (shipped 2026-05-09)

The five highest-collision-risk skills now carry a "Coordination — Active-Runs Ledger" section near their top, listing the skill's declared paths and the register/deregister contract. Each section is ~15 lines and cross-links the design doc and CLAUDE.md.

| Skill | Why it adopted | Declared paths summary |
|---|---|---|
| `/architect` | Material multi-file design work; Phase 7 commits | Obsidian `Architect/`, varies by area mode (`src-tauri/src/<area>/`, `src/features/<area>/`) |
| `/refresh-context` | Single-writer for `.claude/codebase-context.md` and `.claude/codebase-catalogs.md` | The two context files (regenerated wholesale) |
| `/add-template` | Writes JSON + regenerates checksum manifests (frontend + backend) | `scripts/templates/<category>/`, both checksum files |
| `/add-credential` | Writes connector JSON + SVG icon + Rust seed + frontend imports + OAuth registry | `scripts/connectors/builtin/`, `public/icons/connectors/`, Rust seed, frontend imports |
| `/codebase-init` | First-touch on fresh repos — concurrent init clobbers `CLAUDE.md`, `codebase-stack.md`, `Design.md` | The three foundational `.claude/` docs |

### Long-tail adoption (shipped 2026-05-09 in commit `605cf0bc6`)

The eight skills below were the original long-tail target. Six were updated; two are plugin-provided and have no local skill.md to edit.

| Skill | Reason to adopt | Status |
|---|---|---|
| `/sentry` | Applies code fixes for issues | ✅ adopted (per-issue paths, batch worktree, atomic-commit-per-issue) |
| `/triage-backlog` | Autonomously applies multi-fix waves | ✅ adopted (autonomous-execution registration, atomic-commit-per-idea) |
| `/simplify` | Applies quality fixes | ⏸ skipped (plugin-provided — no local skill.md) |
| `/frontend-design` | Generates frontend code | ⏸ skipped (plugin-provided — no local skill.md) |
| `/prototype` | Generates UI variant code | ✅ adopted (variant-files-as-multi-file by definition, per-round commits) |
| `/code-review` | Mostly read-only but writes review reports | ✅ adopted (read-only-by-default, optional fix-up worktree) |
| `/cli-quality-check` | Mostly read-only but writes fix-up commits | ✅ adopted (fix-up batch worktree, per-feature-area commits) |
| `/guide-sync` | Modifies the marketing repo (separate checkout, but same machine) | ✅ adopted (cross-repo, per-topic commits in personas-web) |

Each adopter declares paths, an end-of-session deregister phase, and the parallel-safety primitives (no stash; worktree for multi-file scope; atomic commits per logical unit; verify staged index before commit; worktree cleanup after merge).

Skills explicitly **not** adopting (read-only or non-tree-modifying): `/explorer`, `/prime`, `/reflect` (Obsidian-only, no checkout collision), `/loop`, `/schedule`, `/init` (one-time per repo, redundant with `/codebase-init`), `/update-config`, `/fewer-permission-prompts`, `/keybindings-help`, `/claude-api`, `/review`, `/security-review`, `/record-demo` (generates artifacts that don't get committed).

---

## Parallel-safety primitives (v3 — added after the 2026-05-09 stash incident)

The ledger coordinates **intent**. These primitives protect the **working tree** even when intent coordination fails. All are mandatory across every CLI session per `CLAUDE.md` → "Concurrent CLI sessions → Parallel-safety primitives".

### Motivating incidents

**Stash sweep (2026-05-09).** A browser-harness `/research` run was in flight when a parallel cli-coordination session ran `git stash` to clean its tree before commit. The stash swept five of the research run's files (one untracked) into `stash@{0}`. The cli-coordination session committed cleanly (`27b6d5a3b`); the research session, on returning to its commit step, saw an empty `git status` and had to recover via `git show stash@{0}:<path>` for the four tracked files and rewrite the untracked `skill_scratchpad.rs` from conversation context. Recovery worked, but only by luck — the untracked file's content happened to still be in the active conversation. The ledger DID list both sessions as `## Active`. The stashing session DID see the research entry. What was missing was a project-wide rule that **`git stash` is a sweep, not a save**, and another session's in-flight work is right in the way of the broom.

**Index pollution (same day, follow-up).** The very commit that codified these primitives (`5e3f9055a`) tripped a second failure mode: 18 files of a concurrent clear-wins/creative session were already pre-staged in the index when this codification ran `git add` on its own 6 files. `git commit` then swept up everything in the index — 24 files in total — under a misleading parallel-safety commit message. No work was lost (both bodies of work landed in `git log master`), but the attribution was wrong. The follow-up commit added a guard to rule #5: after `git add` and before `git commit`, run `git diff --cached --stat` and verify the staged-file count matches the count you explicitly added. Anything extra → `git restore --staged <path>` per unrelated file before committing.

### The five primitives

1. **Never `git stash` work that isn't yours.** Not even with `--keep-index`. Stash captures the entire working tree (and untracked files with `-u`) into a hidden state most agents never look for. If a commit step needs a clean stage, use `git add <path>` per file — explicit, scoped, leaves everything else untouched.

2. **Use `git worktree` for all multi-file work.** Single-file fixes can stay on the main checkout. Anything bigger gets its own worktree:

    ```bash
    git worktree add .claude/worktrees/<short-slug> -b worktree-<short-slug>
    cd .claude/worktrees/<short-slug>
    # work, commit atomically per task
    ```

    Worktrees give physical isolation; the ledger gives logical coordination. Together they make the never-lose-work guarantee real. Worktrees-on-the-same-checkout are NOT the rejected "branching" approach from v1 — those were full-fork branches with PR review overhead. Worktrees are local, lightweight, and merge into local `master` as a single squash commit.

3. **Atomic commits per task.** Never accumulate more than ~30 minutes of uncommitted work. Each finding, each refactor step, each PR-step in a rollout plan = one commit. If validation fails, fix inline and commit; never stack failing work. The 2026-04-11 merge-loss incident and the 2026-05-09 stash incident both reduce to "too much uncommitted work in flight at once" — atomic commits are the structural fix.

4. **Worktree cleanup (Phase 13 ritual).** After the worktree's branch is merged (or squash-merged) into `master` AND you've confirmed the work is in `git log master`, remove both:

    ```bash
    cd /c/Users/<user>/path/to/personas       # back to main checkout
    git worktree remove .claude/worktrees/<short-slug>
    git branch -D worktree-<short-slug>    # only if branch is merged
    ```

    Stale worktrees are not free — they hold a working copy of the repo (gigabytes), confuse `git worktree list`, and a future session may accidentally `cd` into one. Treat worktree cleanup as part of the same Phase 13 ritual that records the commit SHA in the ledger.

5. **`git status` shows everyone's work — and so does the staged index.** Before any commit, scan `git status --porcelain` and classify each entry: yours / pre-existing drift / another session's in-flight work. Stage only yours.

    **AND THEN** — after `git add` but BEFORE `git commit` — run `git diff --cached --stat` and check the staged file count. If it is greater than the number of files you explicitly `git add`-ed, the index already had pre-staged files from another session sitting in it; your `git add` simply layered on top. Run `git restore --staged <path>` per unrelated file before committing.

### How this changes v1

The v1 design explicitly rejected branching and assumed "one machine, one checkout, multiple sessions sharing the same working tree". That assumption was correct for *small* sessions — the ledger alone is enough overhead. For *multi-file* sessions, "sharing the same working tree" turned out to be the failure mode. v3 keeps the ledger for intent coordination AND adds worktrees as the physical-isolation primitive for sessions where the cost of accidental sweep is high.

This is not a contradiction of v1 — it's the resolution of v1's "discipline-dependent" tradeoff. The discipline that v1 left to "common sense" (don't stash, commit often) is now codified as a project-wide rule.

---

## Tradeoffs explicitly accepted

- **Discipline-dependent.** A session that forgets to register is invisible to others. Mitigated by: CLAUDE.md self-discoverability, skill-spec enforcement at the Phase 0 / Phase 11 ritual moments. Not a new failure mode — it's the same shape as the cache-cleanup contract that already exists.
- **Single-machine assumption.** Multi-machine = future work, not v1.
- **Edit-conflict retries.** When two sessions race on the file at the same instant, one Edit succeeds and the other must re-read and retry. Acceptable; the skill spec includes a retry rule.
- **Manual SHA recording.** Auto-baseliner-aware SHA capture is a v2 concern.

---

## Reconsideration triggers

- **Multiple machines / worktrees become routine.** Single-machine assumption breaks; ledger needs to be daemonized or moved off the working tree.
- **Session-density grows past ~5/day per project.** v1 ledger format works fine at today's 3-runs/day cadence. At 10+/day the manual scrolling and stale-entry cleanup may need automation.
- **A non-`/research` skill duplicates work without registering.** Concrete signal that a v2 cross-skill adoption gap is overdue.
- **The auto-baseliner produces SHA confusion in Phase 13.** Codify SHA-detection.
- **The ledger file itself becomes a git-conflict hotspot.** If two sessions consistently race on appending entries and the retries pile up, the format may need a more conflict-resistant shape (one entry per file under `.claude/active-runs/<id>.md`, or YAML frontmatter with per-entry IDs).

---

## Out of scope

- **Authentication of who's running.** v1 trusts entries; no signing, no agent-identity column. The "agent X claims to be working on Y" is taken at face value.
- **Real-time conflict prevention.** v1 is best-effort; nothing prevents two sessions from writing the same file in parallel if both somehow miss the ledger.
- **Audit trail beyond 14 days.** Older entries are trimmed. The git history of `.claude/active-runs.md` is the long-term record.
- **Notifications.** No "your session conflicts" Slack ping or desktop notification. The Phase 0 conflict-check is the human-visible event.

---

## Cross-references

- [`.claude/active-runs.md`](../../.claude/active-runs.md) — the ledger this design implements.
- [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) → "Concurrent CLI sessions" — project-wide pointer.
- `.claude/skills/research/skill.md` — first adopter; Phase 0 + Phase 11 rituals.
