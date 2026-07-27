# model-bench — model × reasoning-effort benchmark on real, unsolved work

**Question this answers:** *when is Opus worth it over Fable, and when is more
reasoning effort worth it over less?* — measured not on synthetic puzzles but on
**three genuinely hard, currently-unsolved problems** in three of the operator's
own repositories, run by **8 identical-brief variants in parallel isolated
worktrees**, scored by a blind judge on quality **and** by hard instrumentation
on token spend.

The output is a **decision table** the operator can act on: for each *kind* of
work (perception-framework engineering · architecture review + ship · greenfield
design), which (model, effort) point sits on the value/cost frontier, and where
the curve goes flat.

> Sibling harnesses: [build-bench](../build-bench/README.md) (one-shot build
> speed/structure), [clarify-bench](../clarify-bench/README.md) (interactive
> question quality), [autonomy-eval](../autonomy-eval/) (fleet autonomy). This one
> is different in kind: the *subject under test is the model*, not the product.

**To run it:** the orchestrator session reads
[`ORCHESTRATOR.md`](ORCHESTRATOR.md) — the step-by-step runbook. This file is the
methodology and the reasoning behind it.

---

## 1. The matrix

| | low | medium | high | xhigh |
|---|---|---|---|---|
| **Opus** (current flagship) | O-L | O-M | O-H | O-X |
| **Fable** | F-L | F-M | F-H | F-X |

8 variants × 3 problems = **24 runs**.

> **Model-id note.** Fill the exact ids at run time into `results/run.config.json`
> — the operator refers to the flagship as "Opus 5"; this harness is written
> against whatever the current Opus flagship id resolves to (`claude-opus-*`) and
> `claude-fable-5`. Do **not** hardcode ids into the problem briefs; the briefs
> must be byte-identical across variants (§4.2).

**Judge:** Fable at **high** — cheap enough to run 24 bundles × multiple passes,
strong enough for structured rubric work.

**Judge-bias controls** (Fable judging Fable is the obvious objection):
1. **Blind.** Variant identity is stripped; each problem's 8 bundles are relabeled
   `A…H` with a *per-problem* shuffle. The judge never sees model or effort, and
   never sees two problems' labelings together.
2. **Cross-judge sample.** 3 of the 8 bundles per problem (chosen to span the
   score range after pass 1) are re-judged by **Opus at high**. Report
   judge-agreement (Spearman ρ on ranks + mean absolute score delta). If ρ < 0.7,
   the quality axis is reported as *contested* and the objective axis carries the
   verdict.
3. **Objective floor.** Half the scorecard needs no judge at all (§5.1). A
   variant cannot win on judge charm alone.
4. **Style-blind rubric.** The rubric scores *claims verified*, *failure modes
   named*, *tradeoffs priced* — not prose quality. The judge is explicitly told to
   penalize confident unverified assertions (see [judge-prompt.md](judge-prompt.md)).

---

## 2. Why these three problems

The three are deliberately different **shapes of hard**, because the interesting
result is almost certainly *shape-dependent* ("more thinking helps design, not
mechanics" is a hypothesis worth falsifying).

| # | Repo | Shape | What it discriminates |
|---|---|---|---|
| **P1** | `C:\Users\kazda\kiro\pof` | **Invent a framework for a problem that has resisted solution.** Make UE runtime output machine-readable so an LLM stops composing animations/mechanics blind. Has a hard objective core: it must catch 3 *historically real* failures. | Insight under ambiguity + engineering. Objectively gradeable (does it catch the 3?), so judge inflation is bounded. |
| **P2** | `C:\Users\kazda\kiro\personas` | **Review a mature, live system and ship the highest-leverage improvement.** The fleet autonomy machine. | Judgment (what to build) × coding excellence (build it well) under a live regression risk. Punishes both timidity and recklessness. |
| **P3** | `C:\Users\kazda\kiro\pumper` | **Design a large new subsystem from scratch, no code.** Extraction that survives the web changing. | Pure design/planning. The cleanest test of "does thinking effort buy better plans, or just longer ones?" |

Full briefs: [`problems/P1-ue-observation.md`](problems/P1-ue-observation.md) ·
[`problems/P2-fleet-architecture.md`](problems/P2-fleet-architecture.md) ·
[`problems/P3-pumper-resilient-extraction.md`](problems/P3-pumper-resilient-extraction.md).

### Why pumper and not kp for P3

Both were surveyed. **kp** (`C:\Users\kazda\kiro\kp`, automated hiring) is *too
well documented* to be a design benchmark: `docs/V2_PLAN.md`,
`ENTERPRISE_READINESS.md`, `GDPR_AND_HIRING_EXTENSIONS.md`, `POSTGRES_BACKEND.md`
and ~25 more already contain worked designs for its obvious frontiers (fairness,
tenancy, self-host, taxonomy). A design task there would largely measure
*retrieval and paraphrase*, which is exactly the confound this benchmark must
avoid.

**pumper** is the opposite: a sharp, small Rust spine (engines · datasets with
revisions + SimHash · declarative `RuleSet` extraction with per-field
`matched/empty/error` quality reports · WASM sandbox · tiered fetch with learned
host memory) whose roadmap has *no* answer to its most obvious existential
problem — **extraction silently rots when sites change, and there is no ground
truth to detect it against.** Nothing in `docs/` or `crates/` addresses drift,
repair, canaries, or trust. It is genuinely open, it is richly constrained by
existing primitives (so the design must *integrate*, not fantasize), and it has
crisp failure modes to reason about. That's the ideal design-skill probe.

> **kp fallback.** If P3 must be re-sited, the strongest kp equivalent is *"a
> decision-integrity layer for a high-risk AI hiring system"* — counterfactual
> fairness probes, adverse-impact monitoring over nondeterministic LLM judgments,
> per-decision reproducibility, and human-override capture — which
> `ENTERPRISE_READINESS.md` gestures at but does not design. Use it only if
> pumper becomes unavailable.

---

## 3. Orchestration — one CLI orchestrator, 24 headless children

**Fleet is not used.** The harness is a plain Claude Code CLI session (the
orchestrator, Opus at high) that spawns each run as a **headless `claude -p`
child process** in its own git worktree. This is a deliberate simplification and
it removes two whole classes of confound at once (§4.1, §4.3).

### 3.1 Topology

```
orchestrator CLI  (Opus, high)  ── reads ORCHESTRATOR.md, never does the work itself
   │
   ├─ P3 wave: 8 × `claude -p` children, one per variant, one worktree each
   ├─ P1 wave: 8 × …
   ├─ P2 wave: 4 + 4 (cargo contention, §3.5)
   └─ judging: sequential `claude -p` calls over redacted bundles
```

The orchestrator's job is **spawn · monitor · collect · re-verify · redact ·
judge · report**. It must not contribute to any run's solution, must not read a
run's work while it is in flight, and must not answer questions (there are none —
§4.1).

### 3.2 The spawn shape

```
claude -p "<brief>" \
  --model <model-id> \
  --output-format stream-json \
  --dangerously-skip-permissions
# cwd = the variant's worktree
# stdout → results/raw/<problem>-<variant>/stream.jsonl
```

**Environment hygiene — the orchestrator is itself a Claude Code session, so this
is not optional.** Every child inherits the parent's session markers unless they
are stripped, and a child that sees them silently runs as a *nested* session:
it never registers, and it **never persists a transcript** — which would destroy
the token instrumentation and leave nothing to collect. Strip, per child:

- `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, and every
  other `CLAUDE_CODE_*` marker present in the parent environment
- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` — these runs must bill the
  **subscription**, not the metered API. A leaked key silently changes the cost
  regime and the auth path.

**Folder trust.** `--dangerously-skip-permissions` skips *tool* permissions but
**not** Claude Code's first-run "do you trust this folder?" gate, and every
worktree is a brand-new directory. An untrusted cwd parks the child before it
does any work. Resolve this in pre-flight (§8) — either by pre-registering the
worktree paths as trusted, or by opening each once — and **verify** with a
throwaway one-line run per worktree before the real spawn.

### 3.3 Instrumentation

Two independent sources; the orchestrator records both and reports the
disagreement if any:

1. **The `result` line of the stream-json stdout** — the authoritative per-run
   usage figures. Note that hook output and other noise can precede real content,
   so the collector must **scan for the `result` event**, never assume it is the
   first or only parseable line.
2. **The persisted transcript** at `~/.claude/projects/<cwd-slug>/<session>.jsonl`
   — the fallback and the cross-check. Same fold as Fleet's rollup: input/output/
   cache tokens, turns, tool counts, files touched.

Optionally also enable OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) if a
collector is available — every span carries the session id, which makes
aggregate cost/latency free. Not required; the two sources above are sufficient.

**Completion** is process exit. There is no marker protocol to interpret and no
orchestration lane to run — headless `-p` ends when the turn ends. The briefs
still ask for a closing `RUN:DONE — <summary>` line, but purely as a *self-report
artifact for the judge*, not as a control signal.

### 3.4 Isolation

**One git worktree per (problem × variant).** Non-negotiable — this is the
protocol's whole validity.

```bash
git worktree add .claude/worktrees/mb-<problem>-<variant> -b mb-<problem>-<variant>
```

Known hazards, already paid for once each — respect them:

- **Cargo target dirs (P2).** Do *not* share one `CARGO_TARGET_DIR` across
  concurrent worktrees: cargo's target lock serializes them and the wall-clock
  measurement becomes a measurement of queueing. Per-worktree target dirs, and
  halve the wave (§3.5).
- **Worktree removal follows `node_modules` junctions and wipes them.** Unlink the
  junction *before* `git worktree remove`.
- **`git stash` is banned** for the whole run, orchestrator included. Other
  sessions' work lives in these trees.

### 3.5 Waves

| Wave | Content | Concurrency | Notes |
|---|---|---|---|
| 0 | **Pilot**: P3 × {O-L, F-X} | 2 | Shakes out effort plumbing, trust gates, env stripping, token capture, brief clarity. **Discard results.** |
| 1 | P3 × 8 | 8 | Doc-only — cheapest, no build contention. |
| 2 | P1 × 8 | 8 | App-repo + fixtures only; no live UE (§ P1 brief). |
| 3a / 3b | P2 × 4, then P2 × 4 | 4 | Cargo contention forces halving (operator-confirmed). |
| 4 | Judging | 1 | Serial, cheap. |

Record the wave and its concurrency in every run's metadata — wall-clock is
uninterpretable without it (§4.5).

---

## 4. Experimental controls

The threats to validity here are larger than the effect being measured. These are
the controls, in descending order of how badly they'd corrupt the result.

### 4.1 No interactive answering — closed by construction

A run must not receive help, and help must not vary between variants. Headless
`claude -p` **has no interactive question surface**: there is no one to ask, so
each variant resolves its own ambiguity from the same brief. That is the
behaviour under test.

Consequences to hold to:

- The orchestrator **never** writes to a child's stdin. If a child appears to be
  waiting for input, it is stuck — record it and let the ceiling (§4.4) end it.
- Each brief carries an **assumption clause**: unresolved ambiguity is to be
  resolved by the run itself and *stated* in its deliverable. How a variant
  handles ambiguity is a scored signal, not an obstacle to remove.
- If a run is ever executed interactively as a fallback, the only permitted
  answers are the fixed sheet at the bottom of each brief, and every answer given
  is logged to `results/interventions.log` and surfaced to the judge as a possible
  assist.

### 4.2 Identical, contamination-free briefs

- The brief text is **byte-identical** across the 8 variants of a problem; only
  the worktree path differs. The orchestrator diffs them before spawn.
- **No cross-talk surfaces.** In `pof`, `.claude/fleet-memory.md` is an
  append-shared cross-session memory — variant N would read variant M's
  conclusions. Each P1 worktree must have that file **neutralized** (a
  per-worktree copy, or removal), and the brief forbids reading it. Same for
  `.claude/active-runs.md` in personas.
- Project memory directories (`~/.claude/projects/<repo>/memory/`) are shared
  across all variants of a repo and are **read-only context** — no variant may
  write there. The brief forbids it; the orchestrator verifies afterwards by
  checking mtimes.
- No variant may read another's branch, and no variant may push.
- Skills that write to shared vaults (`/perfect`, `/research`, `/reflect`) are
  **out of scope** for the run — they'd leak between variants.

### 4.3 One shot, no continuation

Each run is a single headless invocation. There is no resume, no "proceed with
your next step", no second turn granted by the harness. A variant that stops
early has produced that result. This is what makes the token axis honest: nobody
gets a discretionary budget top-up.

### 4.4 Budget ceiling and stop rules

- Hard ceiling per run: **400k output tokens** (revisit after the pilot). On
  breach the child is killed and scored *as delivered*.
- Wall-clock ceiling: **3h** per run.
- A run that dies on a Claude-side usage limit is **re-run from scratch**, not
  resumed — a resumed run has a different context history and is no longer
  comparable. Log the discard.

### 4.5 Effort plumbing must be verified before the run

The one mechanism the harness does not yet own end-to-end. Before wave 0, confirm
**empirically, per model**, how reasoning effort is pinned for a headless
`claude -p` invocation, and record the verified mechanism in `run.config.json`.

**Acceptance test:** two children, same model, lowest vs highest effort, same
non-trivial prompt. The thinking-token counts in their transcripts must differ by
roughly an order of magnitude. Anything less and the axis is not pinned.

> If effort cannot be pinned reproducibly in headless mode, **do not run the
> benchmark on an unverified axis.** Either fall back to a 2-variant model
> comparison, or run the variants interactively in separate CMD windows with the
> effort set in-session — accepting that this reopens §4.1 and requires the fixed
> answer sheets.

### 4.6 Order and machine effects

Same-wave variants run concurrently on one machine, so they share CPU/IO
contention — fine for tokens, **noisy for wall-clock**. Wall-clock is therefore a
*secondary* metric, always reported with its wave concurrency. Never rank on
wall-clock alone.

---

## 5. Scoring

### 5.1 Objective axis (no judge)

Collected by the orchestrator, per run. **Gates are re-run by the orchestrator
itself** — never taken from the run's own claim.

| Metric | Source |
|---|---|
| `output_tokens`, `input_tokens`, `cache_read_tokens` | stream-json `result` + transcript rollup |
| `turns`, `tool_calls`, `files_touched` | transcript rollup |
| `wall_clock_min` (+ wave concurrency) | child process start/exit |
| `interventions` | `interventions.log` (expected: 0 in headless) |
| `gates_green` | orchestrator re-runs: `npx tsc --noEmit` · `npm run lint` · `npm run test -- --run` · `cargo clippy -- -D warnings` · `cargo test --lib` |
| `deliverable_complete` | every artifact the brief demands exists and is non-stub |
| `objective_core` | **P1 only**: how many of the 3 historical failures its framework detects, minus false positives on the good counterparts (0–3) |
| `rework_ratio` | lines added then removed within the same run |
| `claim_violations` | "done/verified/working" claims contradicted by artifacts (from the judge's claim audit, evidence-anchored) |
| `protocol_deviations` | committed · pushed · read a forbidden file · wrote to shared memory |

### 5.2 Judged axis (blind, 0–4 each)

Common spine, weighted per problem (weights in each brief's header):

| Dimension | What earns a 4 |
|---|---|
| **Problem framing** | Reframes the problem in a way that makes it tractable; names the actual difficulty, not the surface request. |
| **Solution architecture** | Load-bearing structure; seams in the right places; composes with what exists rather than beside it. |
| **Creativity** | A genuinely non-obvious move a competent-but-uninspired engineer would not have made. Novelty *that pays for itself* — cleverness without leverage scores 1. |
| **Rigor & correctness** | Reasoning survives adversarial reading; edge cases handled; no hand-waves at the hard part. |
| **Evidence discipline** | Claims backed by artifacts it produced. Unverified confident claims heavily penalized; explicit "not verified" is *not*. |
| **Tradeoff honesty** | Names what it gave up, what could go wrong, what it doesn't know — including which ambiguities it resolved unilaterally (§4.1). |
| **Craft** (P1/P2) | Code reads like the surrounding code; tests test behavior; no dead scaffolding. |
| **Executability** (P3) | A different engineer could build it from the doc without re-deciding anything important. |

### 5.3 Derived — the actual deliverable

- **Quality score** = weighted judged mean (0–4), reported alongside the objective
  axis, never instead of it.
- **Value density** = quality score per 100k output tokens.
- **Effort elasticity** — within each model, quality vs effort. The interesting
  shape is where it *flattens*, or inverts (over-thinking is a real failure mode:
  scope creep, unrequested refactors, analysis without delivery).
- **Crossover map** — for each problem shape, the cheapest variant reaching ≥90%
  of the best variant's quality. **This is the operating recommendation.**
- **Failure signature per variant** — does low effort under-scope? does xhigh
  over-build? does Fable-high assert structure Opus-low wouldn't?

### 5.4 Judging procedure

1. Assemble one bundle per run: brief, final diff, all new/changed files, the
   run's own recap, objective metrics (**cost withheld**), intervention log.
   **Strip model/effort everywhere**, including self-reference in the recap.
2. Relabel `A…H`, per-problem shuffle, mapping sealed in `results/keymap.json` —
   not opened until scoring is complete.
3. Judge pass 1: score all 8 independently against the rubric.
4. Judge pass 2: **forced ranking** with pairwise justification of adjacent pairs
   — absolute rubric scores compress; ranks discriminate.
5. Cross-judge sample (§1) → agreement stats.
6. Unseal, join to the matrix, write `results/RESULT.md`.

---

## 6. What a result looks like

The run has succeeded if it can fill this in with evidence:

> For **greenfield design (P3)**, quality rose from effort *X* to *Y* and flattened
> after; Fable at *Y* reached N% of Opus at *Y* for M% of the tokens → **use
> Fable-*Y* for design, escalate to Opus only for _<named condition>_.**
> For **framework invention (P1)**, only variants at ≥*Z* effort detected all three
> historical failures → **effort is load-bearing here; model is/isn't.**
> For **review-and-ship (P2)**, the discriminator was _<choice quality / execution
> quality>_ → …

A null result ("no axis mattered") is a real and useful outcome — it says the
frontier for this operator's work is *problem framing*, not model selection.

---

## 7. Layout

```
docs/tests/model-bench/
├── README.md                      # this file — methodology
├── ORCHESTRATOR.md                # the runbook the orchestrator session follows
├── judge-prompt.md                # blind rubric + forced-ranking prompt
├── scorecard.schema.json          # machine-readable per-run result
├── problems/
│   ├── P1-ue-observation.md
│   ├── P2-fleet-architecture.md
│   └── P3-pumper-resilient-extraction.md
└── results/
    ├── run.config.json            # model ids, verified effort mechanism, ceilings
    ├── keymap.json                # sealed blind mapping
    ├── interventions.log          # expected empty in headless
    ├── raw/<problem>-<variant>/   # stream.jsonl, diff, files, metrics
    └── RESULT.md                  # the decision table
```

`run.config.json` is written **before** wave 0 and must record: resolved model
ids, the *verified* effort mechanism (§4.5), token/wall ceilings, concurrency per
wave, and the commit SHA of each target repo at spawn time — so a rerun six
months later on new models is comparable.

---

## 8. Pre-flight checklist

- [ ] `results/run.config.json` written; effort mechanism verified per §4.5
- [ ] Every worktree path **trusted** by Claude Code (§3.2) — verified with a
      throwaway one-line headless run per worktree
- [ ] Env-strip verified: a test child persists a transcript under its own session
      id (proves the nesting markers were stripped)
- [ ] Subscription auth verified: no `ANTHROPIC_API_KEY` in any child env
- [ ] 24 worktrees created; per-worktree `CARGO_TARGET_DIR` set for P2
- [ ] `fleet-memory.md` / `active-runs.md` neutralized in every worktree
- [ ] Briefs diffed byte-identical across variants
- [ ] P1 held-out fixture corpus prepared (6 traces: 3 failures + 3 good) and kept
      **out of every worktree**
- [ ] Target-repo commit SHAs recorded
- [ ] Budget ceiling + stop rule agreed
- [ ] Pilot (wave 0) run and discarded; harness gaps fixed
