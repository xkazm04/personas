# model-bench — orchestrator runbook

**You are the orchestrator.** You run the benchmark; you do **not** solve any of
its problems. Read [`README.md`](README.md) first (methodology), then follow this
file top to bottom. Every step that produces a fact writes it to `results/`.

Three rules that override anything else you might infer:

1. **Never contribute to a run.** Do not read a child's work while it is in
   flight, do not fix its code, do not answer it, do not resume it.
2. **Never trust a run's own claim.** Every gate you report, you re-ran yourself.
3. **Log deviations rather than smoothing them.** A run that hit a ceiling, got
   stuck, or broke protocol is a *result*. Silently retrying it is data
   fabrication.

---

## Phase 0 — Configure

Write `results/run.config.json`:

```json
{
  "run_id": "<yyyy-mm-dd>",
  "models": { "opus": "<resolved-flagship-id>", "fable": "claude-fable-5" },
  "efforts": ["low", "medium", "high", "xhigh"],
  "effort_mechanism": "<VERIFIED in Phase 1 — do not guess>",
  "ceilings": { "output_tokens": 400000, "wall_clock_min": 180 },
  "waves": [
    { "id": 0, "problem": "P3", "variants": ["O-L", "F-X"], "concurrency": 2, "discard": true },
    { "id": 1, "problem": "P3", "variants": "all", "concurrency": 8 },
    { "id": 2, "problem": "P1", "variants": "all", "concurrency": 8 },
    { "id": "3a", "problem": "P2", "variants": ["O-L","O-M","O-H","O-X"], "concurrency": 4 },
    { "id": "3b", "problem": "P2", "variants": ["F-L","F-M","F-H","F-X"], "concurrency": 4 }
  ],
  "repos": { "P1": "C:/Users/kazda/kiro/pof", "P2": "C:/Users/kazda/kiro/personas", "P3": "C:/Users/kazda/kiro/pumper" },
  "repo_shas": { "P1": "<sha>", "P2": "<sha>", "P3": "<sha>" },
  "judge": { "primary": "fable @ high", "cross_check": "opus @ high", "cross_check_n": 3 }
}
```

> Wave 3a/3b splits by model, not effort, so a cargo-contention effect (if any)
> cannot be mistaken for an effort effect. If you prefer to split by effort
> instead, split each model across both waves — never put all high-effort runs in
> one wave.

---

## Phase 1 — Verify the effort axis (blocking)

This is the one thing that can invalidate the whole benchmark. Do it first.

1. Determine how reasoning effort is pinned for a **headless `claude -p`**
   invocation. Test candidate mechanisms empirically — do not assume one works
   because it appears in documentation.
2. **Acceptance test:** two children, same model, lowest vs highest effort, same
   non-trivial prompt (a small design question with real tradeoffs works well).
   Read the thinking-token counts from their transcripts.
   - **Pass:** counts differ by roughly an order of magnitude.
   - **Fail:** stop. Report to the operator with the evidence and the two options
     in README §4.5 (drop to a 2-variant model comparison, or move to interactive
     runs with the fixed answer sheets). Do not proceed on an unverified axis.
3. Record the verified mechanism verbatim in `run.config.json`.

---

## Phase 2 — Environment hygiene (blocking)

You are a Claude Code session. Your children inherit your environment, and that
breaks them silently.

1. **Strip nesting markers** from every child env: `CLAUDECODE`,
   `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, and every other
   `CLAUDE_CODE_*` variable present in your own env. A child that keeps them runs
   as a nested session and **never persists a transcript** — you would lose the
   token instrumentation and the collection source, with no error message.
2. **Strip `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.** These runs bill the
   subscription. A leaked key changes the auth path and the cost regime silently.
3. **Verify both**, don't assume: spawn one throwaway child, then confirm a
   transcript exists under its own session id in `~/.claude/projects/`. If none
   appears, the strip failed.

---

## Phase 3 — Worktrees and trust

For each of the 24 (problem × variant):

```bash
cd <repo>
git worktree add .claude/worktrees/mb-<problem>-<variant> -b mb-<problem>-<variant>
```

Then, per worktree:

- **Neutralize cross-talk surfaces.** `pof`: `.claude/fleet-memory.md`.
  `personas`: `.claude/active-runs.md`. Remove or replace with an empty
  per-worktree copy so no variant can read another's conclusions.
- **P2 only:** set a per-worktree `CARGO_TARGET_DIR`. Do not share one.
- **Trust the folder.** `--dangerously-skip-permissions` does *not* skip Claude
  Code's first-run "do you trust this folder?" gate, and every worktree is a
  brand-new directory. Resolve it, then **prove it**: run a throwaway one-line
  headless prompt in each worktree and confirm it produces real output rather
  than parking. A worktree that parks here will silently waste its whole slot.
- Record the resulting worktree path in the run's metadata.

**Also prepare, outside every worktree:** the P1 held-out fixture corpus (6
traces — the three historical failures and their good counterparts, per the P1
brief). No variant may see it.

---

## Phase 4 — Spawn a wave

For each variant in the wave, concurrently:

```
cwd    = <worktree>
stdout → results/raw/<problem>-<variant>/stream.jsonl
stderr → results/raw/<problem>-<variant>/stderr.log

claude -p "<brief verbatim>" \
  --model <model-id> \
  --output-format stream-json \
  --dangerously-skip-permissions
  <+ the verified effort mechanism from Phase 1>
```

Before spawning, **diff the 8 brief strings** and confirm they are byte-identical.
This is the single cheapest check that protects the whole comparison.

While the wave runs:

- **Do not write to any child's stdin.** If a child appears to be waiting, it is
  stuck; let the ceiling end it and record `stuck` in its deviations.
- Enforce the ceilings: 400k output tokens, 3h wall-clock. On breach, kill the
  child and mark `hit_token_ceiling` / `hit_wall_ceiling`. Score it as delivered.
- A child that dies on a Claude-side usage limit is **re-run from scratch**, never
  resumed — a resumed run has different context history and is no longer
  comparable. Log the discard and the retry.
- Record start/exit timestamps and the wave concurrency.

---

## Phase 5 — Collect

Per run, into `results/raw/<problem>-<variant>/`:

| Artifact | How |
|---|---|
| `stream.jsonl` | already captured |
| `usage.json` | parse the **`result` event** out of `stream.jsonl` — scan for it, do not assume it is the first parseable line (hook output and other noise can precede real content) |
| `transcript-rollup.json` | fold `~/.claude/projects/<slug>/<session>.jsonl` for input/output/cache tokens, turns, tool counts, files touched. **Cross-check against `usage.json` and report any disagreement** rather than picking one |
| `DIFF.patch` | `git diff` in the worktree, **plus** untracked files (the briefs forbid committing, so the working tree *is* the deliverable) |
| `FILES/` | full contents of every created/modified file |
| `RECAP.md` | the run's closing message |
| `METRICS.json` | conforms to `scorecard.schema.json` → `objective` |

Then **re-run the gates yourself** in each worktree — never copy a run's claim:

- P1 (`pof`): `npm run typecheck`, `npm test`
- P2 (`personas`): `npx tsc --noEmit`, `npm run lint`, `npm run test -- --run`,
  `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`,
  `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- P3 (`pumper`): design-only — assert that `crates/` is **unchanged**; any code
  change is a protocol deviation

And check for protocol deviations: commits, pushes, `git stash`, `git add -A`,
branches other than its own, writes to shared memory dirs (compare mtimes),
reads of the neutralized cross-talk files, code written under P3.

**P1 objective core:** apply each variant's framework to the held-out corpus.
Score = failures correctly detected *with the right mechanism named*, minus false
positives on the good counterparts (0–3). If a framework's entry interface is too
undocumented to feed new data into, that is itself the finding — score 0 and note
it.

---

## Phase 6 — Redact and seal

Run the anti-leak checklist at the bottom of [`judge-prompt.md`](judge-prompt.md).
In particular:

- Strip model/effort from paths, filenames, branch names and file bodies
- Auto-redact case-insensitive: `opus`, `fable`, `sonnet`, `haiku`, `xhigh`,
  `reasoning effort`, `thinking budget`, `ultrathink`
- **Remove all token, turn and wall-clock figures from the judge's `METRICS.json`**
  — cost is joined *after* scoring, never during
- Relabel `A…H` with a per-problem shuffle; write `results/keymap.json` and do not
  open it again until Phase 7 is complete

---

## Phase 7 — Judge

Per problem, using [`judge-prompt.md`](judge-prompt.md):

1. **Pass 1** — Fable at high, all 8 scored independently. One scorecard JSON each.
2. **Pass 2** — Fable at high, forced ranking 1–8 with adjacent-pair separators,
   plus the three closing questions.
3. **Pass 3** — Opus at high re-scores 3 of the 8, chosen to span the pass-1 score
   range. Compute Spearman ρ on ranks and mean absolute delta per dimension.
   **ρ < 0.7 ⇒ mark that problem's quality axis `contested`** in RESULT.md and let
   the objective axis carry its verdict.

---

## Phase 8 — Unseal and report

Open `keymap.json`, join identity to scores, compute `derived` (quality score,
value density, claim violations), and write `results/RESULT.md`:

1. **The decision table** — per problem shape, the cheapest variant reaching ≥90%
   of the best variant's quality. This is the deliverable; put it first.
2. **Effort elasticity curves** — quality vs effort within each model, per problem.
   Call out any *inversion* (higher effort scoring lower) explicitly, with the
   over-reach the judge named.
3. **Model comparison at matched effort** — Opus vs Fable, per problem, with token
   ratios.
4. **Judge agreement** — ρ and deltas; flag contested axes.
5. **Failure signatures** — the qualitative read: what each corner of the matrix
   characteristically does wrong.
6. **Threats to validity that actually bit** — ceilings hit, runs discarded and
   re-run, stuck children, protocol deviations, gate failures, any effort-pinning
   doubt. Be specific; this section is what makes the rest trustworthy.
7. **A null-result statement if that's what happened.** "No axis mattered" is a
   real and useful finding — do not manufacture a signal.

---

## Phase 9 — Clean up

- Unlink any `node_modules` junction **before** removing a worktree — removal
  follows the junction and wipes the target.
- `git worktree remove` each; delete the branches (they were never merged and
  never should be).
- Leave `results/` intact — it is the artifact.
- Report to the operator: the decision table, the threats-to-validity section, and
  anything you had to decide that the runbook didn't cover.
