# P1 — pof: make Unreal's runtime output readable by a machine

**Repo:** `C:\Users\kazda\kiro\pof` (the Next.js app repo; the UE project lives at
`C:\Users\kazda\Documents\Unreal Projects\PoF`)
**Shape:** invent a framework for a problem that has resisted solution
**Deliverable:** design doc + working implementation over recorded fixtures + tests
**Weights:** framing 1.5 · architecture 1.5 · creativity 1.0 · rigor 1.5 · evidence 1.5 · tradeoffs 1.0 · craft 1.0

---

## The brief (this text is what the session receives, verbatim)

> ### Context
>
> This project builds a game in Unreal Engine 5.8 with an LLM in the loop. The
> loop works for everything symbolic — assets, Blueprints, C++, data tables — and
> breaks at exactly one place: **the agent cannot see what the game actually
> did.** Animations and mechanics are therefore composed blind. The scar tissue is
> real and documented:
>
> - A locomotion clip passed *every* structural gate and shipped a character
>   T-posing across the map.
> - A freshly created UE 5.8 `IKRetargeter` ships with an **empty op stack**, so a
>   retargeted AnimSequence transfers nothing and plays perfectly static — while
>   every asset-existence and property check says PASS.
> - The capture harness's `play_anim` scrub silently no-op'd (the gameplay AnimBP
>   re-asserted AnimationBlueprint mode after BEGIN and dropped the single-node
>   instance), so every "verification" filmstrip rendered the idle pose.
>
> Read `docs/features/harness-llm-unreal/llm-ue-interface.md` (the Observation
> Spine, tiers T0–T4), `docs/animation-capture-pipeline.md`, and
> `docs/concepts/UE/l4-autonomous-visual-capture.md` before deciding anything.
>
> Two things are already known and must be treated as **constraints, not open
> questions**:
>
> 1. **Every VLM is unreliable at fine-grained motion and physical-plausibility
>    judgement.** The existing critique tier scores 6 aesthetic dimensions and
>    disagrees with itself across providers. It is an advisory signal. It is not a
>    gate. Any design that puts a vision model on the critical path of correctness
>    is wrong before it starts.
> 2. **The only thing that has ever been ground truth here is numeric measurement
>    of the evaluated system** — e.g. bone *rotation* range read via
>    `get_bone_pose_for_frame` (note: limb *translation* in local space is ~0 by
>    construction; measuring it produced a false "static" verdict twice).
>
> ### Your task
>
> Design **and implement** a general framework that turns what a UE scene actually
> did into **structured, diffable, assertable evidence an LLM can reason over** —
> for arbitrary animations and mechanics, not one hand-wired case.
>
> The framework must answer, mechanically and cheaply: *did the thing I authored
> do what I intended, and if not, which mechanism failed?*
>
> Scope it yourself, but a credible answer will have to take a position on:
>
> - **A trace schema.** What a scenario run emits per sample — and what it must
>   emit for the evidence to be sufficient rather than merely voluminous. (Pose /
>   root motion / velocity / montage + AnimBP state / GAS ability + tag events /
>   damage + health deltas / overlaps / input actually applied / VFX activity are
>   all candidates. Choosing well *is* the design.)
> - **Derived features.** Raw per-frame numbers are not evidence of intent.
>   Something must turn a trace into semantically comparable measures.
> - **An expectation language.** How an agent states what it intended, in a form a
>   deterministic checker can evaluate. Consider carefully whether absolute
>   thresholds are even knowable, and what the alternative is.
> - **Diagnosis.** A failed check must point at the mechanism. "Looks wrong" is
>   the status quo and is worthless.
> - **Integration.** It must land inside the existing Observation Spine tiers and
>   the deferred-gate / `pipeline_artifacts` machinery, not beside them.
> - **Cost.** It has to be cheap enough to run in a loop, headless, with no paid
>   API on the critical path.
>
> ### Hard constraints
>
> - **Work only in this repo (`pof`), on the branch you are on.** Do not touch the
>   UE project tree, and do not attempt to launch the Unreal editor — it is a
>   single shared GPU resource and is unavailable to you.
> - Your implementation must therefore run against **recorded fixtures**: the
>   scenario run logs, sample JSON and shot directories already in this repo, plus
>   any fixtures you synthesize. Building the fixture corpus is part of the task.
> - Ship real code with real tests (`npm run typecheck`, `npm test`). Not a
>   prototype in a markdown fence.
> - Your framework will be graded by running it against a **held-out fixture set
>   you will not see**, containing captures of the three historical failures above
>   plus their known-good counterparts. Design for that: the interface by which a
>   trace enters your system must be documented well enough that someone else can
>   feed it new data without reading your source.
> - You are in a git worktree. **Do not commit, do not push, do not `git stash`,
>   do not `git add -A`, do not touch any other branch.** Leave your work in the
>   working tree — that is the deliverable.
> - Do not modify or read `.claude/fleet-memory.md`, and do not write to this
>   project's memory directory.
> - **You will not be able to ask anyone anything.** Where the brief is ambiguous,
>   resolve it yourself and *state the assumption you made* in your design doc.
>   How you handle the ambiguity is part of what is being read.
> - End your final message with `RUN:DONE — <one-line summary>`.
>
> ### Deliverables
>
> 1. `docs/concepts/UE/observation-framework.md` — the design: the problem as you
>    understand it, the schema, the mechanism, what you rejected and why, and the
>    honest limits.
> 2. The implementation, with tests, in the appropriate existing directories.
> 3. A short `EVIDENCE.md` at repo root listing every claim you make about your
>    framework working, each with the command or test that backs it. Claims you did
>    not verify go in a clearly separate "unverified" section — that is a correct
>    answer, not a failure.

---

## Why this problem

It is the operator's longest-standing unsolved problem, and it has a rare
property for a benchmark: **an objective core with known ground truth.** Three
real failures already happened, their causes are documented, and each is exactly
the class of failure that structural gates miss. A framework either detects them
or it doesn't. That bounds judge inflation on the most subjective-feeling task in
the set.

It also punishes the most common LLM failure mode on this kind of prompt —
reaching for a vision model because "look at the frame" is the intuitive answer.
The brief forecloses it explicitly, so a variant that still centres perception on
a VLM has failed to read its constraints, and that is *visible* in scoring.

## Objective core (operator-run, after the wave)

Prepare **once, before the run, shared across all 8 variants** (pre-flight item):
a held-out corpus of six traces — the three known failures and their known-good
counterparts:

| # | Failure | Good counterpart |
|---|---|---|
| 1 | T-posing locomotion (ref-pose passthrough) | the fixed walk |
| 2 | Retarget with empty op stack (static clip) | a correctly retargeted clip (`upperarm_r` range ≈55–75°) |
| 3 | `play_anim` scrub no-op (every sample = idle pose) | a scrub that actually advances |

Score `objective_core` = number of the three each variant's framework flags
**correctly and with a diagnosis naming the right mechanism** (0–3). Flagging the
good counterpart as a failure costs a point — false positives are the thing that
kills an autonomous loop.

## Fallback answer sheet

Runs are headless — there is no question surface, and the brief tells the run to
resolve ambiguity itself. This sheet applies **only** if a run is executed
interactively as a fallback (README §4.5). Then these are the *only* permitted
answers, and every one given is logged to `results/interventions.log` and shown to
the judge as a possible assist.

| If the session asks | Answer verbatim |
|---|---|
| "Can I launch the UE editor / run a headless capture?" | "No. The editor and GPU are unavailable for this task. Work from recorded fixtures." |
| "Should I extend the existing anim-critique tier or replace it?" | "Your call — argue for it in the design doc." |
| "Which UE-side changes may I assume?" | "You may *specify* UE-side changes in the design doc as a contract; you may not implement them. Everything you implement must run in this repo." |
| "Is a paid vision/LLM API allowed at runtime?" | "Not on the correctness path. Advisory use is allowed if you justify the cost." |
| "How much scope should I take?" | "Use your judgment; take the option you'd defend in review." |
| anything unanticipated | "Use your judgment; take the option you'd defend in review." (log it) |
