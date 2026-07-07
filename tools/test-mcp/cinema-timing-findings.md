# Cinema build-timing findings (2026-07-07)

Measured the real persona-build event timeline behind the Cinema loading
experience, via `cinema-timing-harness.mjs` over the 10 vault-grounded
`cinema-scenarios.json`. Raw data: `cinema-timing-results.json`.

**Prerequisite bug found + fixed first:** builds were producing only `Progress`
events (never reaching a question) because the build CLI used the **retired**
model `claude-sonnet-4-20250514` (retired 2026-06-15) → 404 every turn. Fixed to
`claude-sonnet-4-6` (commit c79ca0315). All timing below is post-fix.

## Results

| scenario | complexity | first question | caps | connectors | outcome |
|---|---|---|---|---|---|
| s01 memory-log | trivial | **154.8s** | 2 | 0 | ok |
| s02 db-digest | simple | — | — | — | launch flake (surface not ready) |
| s03 github-discord | medium | 49.6s | 1 | 0 | ok |
| s04 gmail-triage | medium | 49.6s | 1 | 0 | ok |
| s05 finance-alert | medium | — | 0 | 0 | **timeout >180s** |
| s06 linear-notion | multi-tool | 74.9s | 3 | 0 | ok |
| s07 drive-knowledge | multi-tool | — | 0 | 0 | **timeout >180s** |
| s08 sentry-responder | complex | 61.6s | 2 | 0 | ok |
| s09 meeting-concierge | complex | — | 0 | 0 | **timeout >180s** |
| s10 daily-ops-brief | pipeline | — | 0 | 0 | **timeout >180s** |

Successes (n=5): first question at **49.6–154.8s, avg 78s**.

## The three findings that reshape the design

### 1. No incremental streaming — everything lands in ONE burst at the first question
Every successful build's signal trace is identical in shape: `core@ == caps@ ==
cells@ == question@`. The resolved-cell trajectory is literally `[0 → N]` — a
single atomic jump at the `awaiting_input` transition (e.g. s01 held `cells=0`
for 154s, then jumped to 9). **During the entire analyzing wait the frontend
sees nothing** — no behavior_core, no capability titles, no connectors, no
partial cells.

→ The Cinema's founding premise — *"get intermediate results from the LLM as it
works and populate the loading screen with semi-real data"* — **is not
achievable with the current build-session event model.** The frontend state is
binary: empty during `analyzing`, fully populated at the first question.

### 2. Connectors never resolve before the first question
`connectorCount = 0` in **all 10** runs at the first-question point.
`buildPersonaResolution.connectors` is empty until after the clarifying Q&A
(resolves nearer `draft_ready`). → A "connectors docking" beat is impossible
pre-question. The real connector data simply isn't there yet.

### 3. Duration is long, highly variable, and uncorrelated with complexity
- Range 49.6s → 154.8s for successes; **trivial s01 took the LONGEST (154.8s)**,
  a medium took 50s. Intent complexity does not predict wait length.
- **4 of 10 timed out (>180s)** without ever producing a question (s05, s07,
  s09, s10). That's a 40% "never finishes in 3 min" rate — a build-reliability
  problem in its own right, independent of the cinema.

## Implications for the Cinema design

- **The 30s casting + ~30s capability choreography (round 5) is too short and
  mis-shaped for the real wait.** The wait is 78s avg (up to 155s+), and 40%
  exceed 180s. A fixed ~60s cinema finishes long before the build does, leaving
  dead time. The cinema must be **self-sustaining for an unbounded duration**,
  not a fixed-length film.
- **Real data can only populate at the very end** (the fast-forward/handoff
  moment). The "capability act" cannot show real capability titles or connectors
  during the wait — they don't exist yet. It must be **abstract discovery**, not
  a real-data reveal, right up until handoff.
- **The fast-forward-on-first-question model is correct** — signals arrive
  exactly at the question, so snapping to populated + handing off is the right
  transition. It's the *pre-question* content that has no real data to show.

## Design options (pick a direction)

**A. Abstract-until-handoff (frontend-only, no backend change).**
Accept that no real data is available during the wait. Make the Cinema a
premium, unbounded, self-breathing abstract loader (silhouette casting →
abstract capability-assembly) that loops/evolves indefinitely and only fills in
the real crowned identity + capabilities at the handoff. Add a graceful
"still composing…" long-wait state for the 40% that run past ~120s.

**B. Backend change: emit incremental build events (realizes the original vision).**
Investigate whether the runner *can* flush `BehaviorCoreUpdate` /
`CapabilityEnumerationUpdate` per turn instead of batching at `awaiting_input`.
The build runs many turns (we saw 12+); if cells resolve per-turn server-side
but are only surfaced to the frontend at the end, exposing them mid-flight would
let the cinema populate real data as designed. Needs a build-session emission
investigation + likely a runner/store change.

**C. Fix build reliability first.** 40% timeout >180s and erratic 50–155s
timing is a product problem the cinema can't paper over. Worth its own pass
(why do finance/drive/meeting/pipeline intents stall?).

Recommendation: **A now** (make the cinema robust to the real, long, data-less
wait), and scope **B** as the follow-up that would make it truly "semi-real."

---

## B investigation + B1 result (2026-07-07, tried and REVERTED)

Chose to pursue B ("B1 now, B2 later"). Investigation established the real
mechanism behind the end-of-wait burst:

- **The build front-loads into a SINGLE turn.** A simple build reached its
  question in `turn=1`, which emitted `BehaviorCore + CapEnum + ClarifyingV3`
  **together**. The prompt already says "behavior_core FIRST" — but that's
  ordering *within the text*; the whole text arrives in one assistant envelope,
  and the runner buffers the turn until its CLI process exits (emit is per-turn,
  post-exit). So the batching is the LLM's single-turn cadence, not our
  plumbing. → **B is a protocol change, not a flag.**

- **B1 attempt (`f64df0e97`, reverted in `e9753b6dd`):** scope turn 0 to Phase A
  ("emit ONLY behavior_core, then stop"), gated to interactive builds; let
  capabilities + question follow in turn 1 via `--continue`.

**B1 measured result — the identity-early goal WORKS, but the extra turn is a
net regression:**

| scenario | pre-B1 first-Q | B1 core@ | B1 outcome |
|---|---|---|---|
| s03 github-discord | 49.6s | **10.9s** | **timeout >200s** |
| s06 linear-notion | 74.9s | **15.7s** | **timeout >200s** |
| s08 sentry-responder | 61.6s | **21.8s** | **timeout >200s** |

The LLM **honored** the split cleanly (turn 1 = `[BehaviorCore]` only, landing
at 10–22s — the real role/mission reaches the frontend early, exactly the
vision). **But turn 2 then balloons and stalls**: the per-turn log shows turn 2
emitting **56 events** with *duplicate* `CapEnum` and 27 `CapRes` — the split
disrupts the LLM's single-pass flow, and the "resolve everything NOW"
continue-prompt makes it churn far longer than the equivalent work took in one
turn. **3/3 clean runs timed out** (baselines were 50–75s), which would worsen
the already-40% timeout rate. Reverted.

**Conclusion:** the identity-early *value* is real and reachable (core at
10–22s), but **not via an extra turn** — the extra CLI round + turn-2 ballooning
costs 150s+/timeout, not the "+~10s" estimated. To get identity early *without*
the extra-turn cost, the only path is **B2: stream `behavior_core` out of the
SINGLE turn** (`--include-partial-messages` + parse/emit the first complete JSON
object mid-read-loop, before the turn's process exits). No extra turn, no turn-2
regression — but invasive (partial-JSON accumulation, mid-turn emit) with real
per-build regression risk. That's the decision now open: **B2, or fall back to
A** (abstract-until-handoff, which needs no backend change and can't regress
build reliability).
