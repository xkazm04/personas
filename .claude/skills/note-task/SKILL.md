---
name: note-task
description: "Execute ONE Notepad note end to end in the repo it belongs to: read the note the operator wrote, treat it as the requirement, analyse it against this repo's own conventions, plan, implement atomically, verify with the repo's own gates, and report back through the app's one gated door (notepad_ingest_runs, which the fleet ticker also sweeps automatically) by writing report.md + result.json into the note's run directory. Never writes the Personas database. Invoke with `/note-task <note-id>`."
argument-hint: "<note-id>"
category: Development
contexts: tracked
memory: project
---
# Note Task 🗒️

You execute **one note** — a scratch requirement the operator wrote on the
Personas Notepad and handed to you — and then report back through the app's one
gated door.

> **Why the door is not optional.** The operator chose a CLI session over an
> in-app op knowing the trade: a session is invisible to the app's progress
> surface and writes no audit ledger. `result.json` is the entire compensating
> control. **You never write `personas.db`** — not through SQL, not through the
> management API's write endpoints. Everything you did reaches the app through
> `started.json` and `result.json`, which the app's sweeper
> (`notepad_ingest_runs`, and the fleet ticker every 30 s) reads and applies.
> A run that does good work and writes no result executed the note
> **invisibly**, which is the exact risk the choice took on. Phase 2 is the
> deliverable; the code you write is how you earn it.

The note id is your argument. Everything you need is on disk under
`.personas/notepad/` in the current repo — you are already standing in the
project the note belongs to.

---

## Phase 0 — Claim the note (do this FIRST, before any analysis)

1. **Read the note.**

   ```bash
   cat .personas/notepad/<note-id>/note.md
   ```

   The file carries frontmatter (`note_id`, `title`, `project_id`) and then the
   body the operator typed. **If it is missing, STOP and say so loudly** — do
   not guess at the requirement from the id, do not go looking for something
   that resembles it, and do not write a `result.json`. A missing `note.md`
   means the app has not published this note into this repo; the operator needs
   to know that, not to receive work aimed at a requirement you invented.

2. **Write `started.json` immediately**, before you analyse anything:

   ```bash
   mkdir -p .personas/notepad/runs/<note-id>
   cat > .personas/notepad/runs/<note-id>/started.json <<'JSON'
   { "schema_version": 1, "note_id": "<note-id>", "started_at": "<ISO-8601 UTC>" }
   JSON
   ```

   This is what flips the note to **in progress** on the pad. Writing it first
   is deliberate: the operator should see the note is claimed while you are
   still reading, not after you finish. A run that dies mid-way then leaves a
   note honestly marked in-progress rather than one that looks untouched.

3. **Register in the active-runs ledger** if this repo keeps one
   (`.claude/active-runs.md`), and check for a conflicting live entry before you
   start. If your scope is more than a single file — it usually is — work in a
   worktree. Never `git stash`; never `git add -A`.

## Phase 1 — Treat the note as the requirement

The note is a requirement, not a task list. It was written quickly, in a pad,
by someone who had the whole product in their head and did not write most of it
down. Your job is to turn it into the change they meant.

1. **Ground it in this repo.** Read the repo's `CLAUDE.md` (and any
   `.claude/rules/*.md` it points at) BEFORE deciding on an approach. The
   conventions there are the ones the change will be judged against — the
   golden paths, the gates, the primitives it expects you to reach for instead
   of writing new ones.

2. **Locate the real surface.** Find the files the note actually touches. If
   the repo has a context map, scope to the relevant context. Read the
   neighbours before you write anything: the strongest signal of what "right"
   looks like here is the code next to the code you are about to change.

3. **Challenge the note where it is wrong.** If the requirement rests on a
   premise the code contradicts — a function that does not exist, a behaviour
   that already ships, a design the repo deliberately rejected — say so in the
   summary and do the *right* thing rather than the literal thing. A note is the
   operator thinking out loud; it is allowed to be wrong, and you are the one
   holding the code.

4. **Plan, then implement atomically.** One coherent change per commit, each
   commit passing the repo's gates. Do not accumulate a large uncommitted tree.

5. **Verify with the repo's OWN gates** — the typecheck / lint / test / build
   commands the repo declares, in the order it declares them. Do not invent a
   verification of your own and do not claim green on a gate you did not run.
   If a gate is red for reasons that predate you, say so explicitly in the
   summary rather than quietly passing it off as yours or as fine.

## Phase 2 — Report back

Write BOTH files into `.personas/notepad/runs/<note-id>/`.

**`report.md`** — free-form, for a human. What you did, what you decided and
why, what you deliberately did not do, what you would do next. Not ingested;
this is the place for the reasoning that does not fit in a summary.

**`result.json`** — the ingested artifact. Exactly this shape:

```json
{
  "schema_version": 1,
  "note_id": "<note-id>",
  "status": "completed",
  "summary": "What changed and what it means for the operator.",
  "artifacts": [
    { "path": "a1b2c3d", "kind": "commit" },
    { "path": "src/features/x/Thing.tsx", "kind": "file" },
    { "path": "docs/concepts/thing.md", "kind": "doc" }
  ],
  "finished_at": "<ISO-8601 UTC>"
}
```

Rules the door enforces — get any of them wrong and your run is skipped with a
warning nobody reads:

- `schema_version` **must** be `1`. Absent is refused, not defaulted.
- `note_id` **must** equal the directory's note id. A result in the wrong
  directory is refused rather than applied to someone else's note.
- `status` is `"completed"` or `"failed"`. **Use `"failed"` honestly** — a
  failed run is a *report*, not a completion: the note stays in progress, keeps
  your result, and the operator can read the why and re-dispatch. A run that
  reports `"completed"` after leaving the gates red has lied to the one surface
  the operator trusts.
- `summary` is at most **2000 characters**. Write it for someone who has not
  seen the code: what changed, what it means, what is still owed.
- `artifacts` lists what you produced — commit SHAs (`"kind": "commit"`),
  touched files (`"file"`), and any documentation you wrote (`"doc"`). Keep it
  to what matters; this is a manifest, not a `git diff --stat`.
- The whole file must be under **1 MiB**. It is a report, not a log.

Do **not** write `ingested.json` — that marker is the app's, and writing it
yourself makes the app skip your result entirely.

## Phase 3 — Close out

Move your active-runs entry to `## Recently completed` with the commit SHA, and
tell the operator in one paragraph what landed and where. If you worked in a
worktree, say whether the branch is merged or still owed.
