# Sheet · Cinema: a live blueprint in the centre during the silent turn

**Status: proposal, unbuilt (2026-09-30).** Read-only analysis of master on 2026-09-29. The builder has since moved to `claude-sonnet-5-5` at `--effort low` (`src-tauri/src/engine/build_session/mod.rs`, `BUILD_MODEL` / `BUILD_EFFORT`); the 57-201 s silent-turn measurements below were taken on `claude-sonnet-4-6` at the CLI default effort and must be re-measured on 5.5 (P0).
Paths below are relative to the repo root. `cinema/` = `src/features/agents/sub_glyph/contactSheet/cinema/`.

## 0. The problem in one paragraph

During casting, the centre shows a crowd of silhouettes. A **timer** eliminates them, not the build
(`cinemaMotion.ts:25-44`, `useCinemaCast.ts:9` `CASTING_MS = 28000`), and the panel under them says "usually 50 s to
2 min 35 s" (`copy.ts:64`). Nothing in the centre is driven by the build until the first streamed object closes:
`behavior_core` first (crowning), then provisional capabilities (`provisional.rs:1-33`). On the 8 measured builds that
came 57-201 s after launch. The machine was not idle in that time, though. It had already read the brief locally, and
the stream had been sending envelopes the whole time. None of that reaches the screen. The blueprint below shows that
work, labels each item with how sure it is, and adds cheap parallel lanes that produce real milestones early.

---

## 1. Signal inventory (what can honestly feed the blueprint)

### 1a. Known at launch (t = 0), frontend, already in memory

| Signal | Where | Certainty | Used in the centre today? |
|---|---|---|---|
| Intent text (the launched brief) | `useSheetState.ts:31`, frames `useFrameValues.ts:89` | the user's words | no (task frame caption only in compose) |
| Quick-setup picks (when / apps / events / messages) + memory/review toggles, snapshotted at launch | `useSheetState.ts:59-70` (`launched`) | **picked by you** | frames only |
| Persona core state + archetype | `useSheetState.ts:67` (`onLaunchCoreSnapshot`), `usePersonaCore` | picked by you | no |
| Recipe the build starts from | `useCinemaRecipes.ts:38` `picked`; shown as one line in `BuildAside.tsx:48` | picked by you | one text line |
| Recipe matches for the intent | `useRecipeStarters.ts` (semantic `match_recipes_to_intent`) | a match, not a plan | **dropped at launch** (`useCinemaRecipes.ts:36` matches only while composing) |
| Vault credentials + health per service | `quickSetup/useVaultConnectorTiles.ts:18-51` (`readCredentialHealthState`) | verified fact | no |
| Connector definitions (names/labels to match the intent against) | `useVaultStore.connectorDefinitions` | lexical detection | no |
| Published-template lexical match (`companion_match_templates`, under a second, no LLM) | `components/create/useTemplateIntentMatch.ts:23`; mounted by `components/matrix/BuildTemplateSuggestion.tsx` | a match | only after the first questions land |

### 1b. Computed by the backend at launch, **never emitted**

| Signal | Where | Why it matters |
|---|---|---|
| Top-3 similar templates (name, category, service flow) | `build_session/mod.rs:308` → `templates.rs:301-367` | Goes into the prompt only. It is a real reference the model reads. |
| Services named in the intent (registry snapshot + aliases) | `templates.rs:245-293`, `gates.rs:556-636` | Deterministic "apps it will likely use". |
| **Gate seed**: which gated fields the brief already answers (trigger / connectors / review / memory / sample output) | `gates.rs:655-700`, heuristics `gates.rs:162, 249, 276, 317` | Closed gates forecast which questions the build will ask. |
| Ambiguous services (2+ credentials for one service) | `runner.rs:426-430` | A credential-picker question is **certain** in interactive mode: "you have 4 GitHub accounts". |
| Credentials + connector list (with `emits[]`) | `mod.rs:253-301` | Which named apps are connected and which are missing. |

### 1c. CLI stream during the turn (the "silent" stretch is not silent)

The runner reads **every** stream line (`runner.rs:760-779`). Only text deltas are used, and only for the preview:
`stream_delta_text` skips thinking deltas (`provisional.rs:44-60`), and `parse_build_line` drops `system` and turns
`stream_event` lines into nothing (`parser.rs:86`). The recorded fixtures show which events exist:

- `scripts/test/fixtures/stream-timing/thinking-then-text.jsonl`: `message_start` at **6.2 s**, then
  `content_block_start{thinking}`, then `thinking_delta` envelopes with **empty text and `estimated_tokens: 50`** at
  7.8 / 9.3 / 10.3 s (about one every 1-1.5 s), then `signature_delta`, then `content_block_start{text}`, the text deltas,
  `message_stop` and `result.usage`. So when the thinking display is omitted, the thinking **events and their cadence
  are still there**. `scripts/test/lib/stream-timing.mjs:1-18` documents exactly this: an envelope, not a token.
- `text-only.jsonl` (claude-sonnet-5): `message_start` at **3.1 s**, and **no thinking block at all**. At low effort
  Sonnet 5 can skip thinking entirely on simple input.
- The CLI's `system`/`init` line arrives before `message_start` (skipped at `parser.rs:86`). It is a free "model
  process up" mark.

**Honest heartbeat available**: process up → model has the brief (`message_start`, which also carries input/cache
usage) → reasoning (thinking deltas, summed `estimated_tokens`) → writing (first text delta) → objects closing
(provisional) → turn ended (`message_stop`/`result`) → validating (gate pass, until the authoritative events arrive).

**Unverified, must be measured first**: whether thinking deltas keep coming evenly through a 60-200 s design turn on
claude-sonnet-5-5 at low effort. The fixtures are short turns. The runner's silence watchdog assumes they do
(`runner.rs:70-80`), but nothing has measured it.

### 1d. Backend events already flowing (store: `stores/slices/agents/matrixBuildSlice.ts`)

- `Progress` with activity. One per turn start, with fixed text: "Analyzing intent and matching templates..."
  (`runner.rs:616-633`). Per resolved cell (`runner.rs:1482`), per question (`:1520`), draft ready (`:1882`). The store
  field is `buildActivity`, read at `centre/ActPanel.tsx:37`.
- Non-JSON CLI lines become `Progress` messages (`parser.rs:42-49`), which feed `cliOutputLines` (the log line).
- `BehaviorCoreUpdate` streamed mid-turn (`runner.rs:781-797`). This crowns the identity (`IdentityCentre.tsx:49`).
- `ProvisionalCapabilityEnumeration/Resolution` + `ProvisionalSettled` (`provisional.rs`, slice `:70-102`, dispatch
  `hooks/build/useBuildSession.ts:248-254`). Frames "develop" from these (`provisionalFrames.ts`).
- Confirmed capabilities / cells / questions / phase / tests (`BuildSessionState`, slice `:115-178`).
- Honest clock ledger (`centre/buildClock.ts`). It already has `marks`, which the film rail tints by.

---

## 2. Parallel tasks worth adding

| Task | What it yields | Latency | Cost | Honesty risk | Feeds |
|---|---|---|---|---|---|
| **A. Launch reading** (emit what 1b already computes) | detected apps, schedule/event phrase, forecast questions (closed gates + ambiguous creds), top template refs | about 0 s (already computed before spawn) | none | Low. Deterministic, labelled "read from your brief". The forecast can be wrong in one direction: the model may still ask about a gate the seed opened. | Brief + Wiring columns, "will ask you" chips |
| **B. Connector readiness** for detected/picked apps | connected? health (verified / failed / untested)? missing? | 0 s from the vault store; 1-3 s for a fresh `healthcheckCredential` (`api/vault/credentials.ts:75`) on a stale credential | one provider ping per stale credential | None. It is a fact. It also gives the user **something to do** during the wait ("Connect Slack now"). | Wiring nodes' badge |
| **C. Template / recipe match at launch** (run `useTemplateIntentMatch` at launch, not after questions; keep the top recipe match instead of dropping it) | "Close to: Inbox Zero (template)" | under 1 s | none (lexical) / one semantic query | Low if worded "close to", never "building". The "Faster path" row still waits for the questions act, so it does not interrupt. | Brief column reference chip |
| **D. Sketch lane** (Studio's pattern: `webbuild/sketch.rs:1-18`, command `commands/infrastructure/webbuild.rs:17-37`) | draft capability list (≤5) with when/apps/delivers-to + ≤3 likely questions | MICRO tier = claude-sonnet-5 at low (`companion/model_routing.rs:44-47`), p90 about 9 s in that file's bench; tiny prompt vs the builder's ~1100-line one | one short tracked micro call (`cli_text_tracked`) per build | **Medium.** The builder runs `claude-sonnet-5-5` at low effort (`mod.rs`, `BUILD_MODEL`), one generation ahead of the MICRO tier, and the sketch is also a much smaller prompt. It can disagree with the real design. It must be drawn dashed, labelled "sketch", never develop a frame, and fade out on draft. Ship only after measuring agreement (P0). | Capabilities column (sketched) |
| **E. Stream pulse** (emit a throttled pulse from 1c) | phase + token estimate + "last signal Ns ago" | continuous, from about 3-6 s | none | None if it shows only observed events and never a percentage | Pulse line + rail notches |
| **F. Persona-core inference** (a model guesses the tone/role) | a guessed identity | 5-10 s | a micro call | High, and it duplicates `behavior_core`, which already streams first. **Skip.** Show the core the user picked (1a) instead. | none |

---

## 3. The blueprint in the centre

### Placement

In the acts **casting / wiring** (and the pre-review questions act), the blueprint replaces the silhouette crowd in
`IdentityCentre`. The ActionPanel stays underneath, compacted to slate + one line. Estimated centre cell at 1280×800
(`tight`, stage height < 700): about **470 × 330 px**. That comes from the 1 : 1.5 : 1 columns and 1 : 2.3 : 1 rows in
`stage/SheetPrint.tsx:58-59`, so measure it before designing to the pixel. The blueprint gets about 470 × 190. The
eight frames stay the outer ring. The blueprint is the wiring diagram *between* the brief and those frames.

### Columns, left to right (the milestone path)

`BRIEF → CAPABILITIES → WIRING (when · apps · delivers to · review/memory) → CHECKS → READY`

- **Brief**: your brief (read), the core you picked, and a "close to: <template/recipe>" reference. The identity
  crowns here: when `behavior_core` streams in, this node becomes the persona's name and role (keep the existing
  `CrownedName` letter-develop).
- **Capabilities**: sketched (D), then drafting (provisional), then confirmed. The count shows only once enumerated.
- **Wiring**: one chip per trigger / app / channel / review / memory. An app chip carries its readiness badge (B).
- **Checks**: "tests after the draft". It fills per tool in screening from `toolTestResults`.
- **Ready**: an empty ring until draft ready. Never animated before that.

Edges draw once, when both ends exist (a single path-length draw). They connect each capability to the wiring chips it
uses. Confirmed wiring chips get a hairline to their outer **frame**, and at that moment the frame lights. This is the
same rule as today: only confirmed values light a frame (`sheetModel.ts:95-105`).

### Node states (one visual grammar, reused from the frames)

| State | Source | Look |
|---|---|---|
| `picked` | quick setup, core, recipe | solid, small "you" mark (matches `by: "you"` on frames) |
| `detected` | launch reading / vault match | solid outline, no fill, caption "from your brief" |
| `sketched` | sketch lane | **dashed** outline, 60 % ink, the column carries a "sketch" tag |
| `drafting` | provisional stream | the frame "filling" treatment (developing emulsion) |
| `confirmed` | authoritative pass | filled in the dimension's colour, hairline to its frame |
| `needs-you` | pending question / certain forecast | amber ring + "?" |
| `blocked` | app not connected / credential failed | status-warning ring + inline action ("Connect") |
| `dropped` | provisional retraction / sketch not confirmed at draft | strikes through for one beat, then leaves. Never silently vanishes. |

### Calm rules (honesty contract)

1. No percentage and no progress bar. A column shows a count only once its denominator is real (after enumeration).
2. No looping motion. Nodes enter one per beat (reuse `useTimedReveal`, `cinemaMotion.ts:47`), edges draw once. The
   pulse line moves **one step per real stream event** (like a seismograph). With no events, it stays flat.
3. Silence is stated, not hidden: "No new signal for 40 s. Normal: design turns have run up to 224 s." Past a threshold
   the same line offers "Open the log" (the existing `LogLine`).
4. A certainty is never shown higher than its source. Sketch and drafting never light a frame, feed the sigil or count
   as populated (the same rule `provisionalFrames.ts` already follows).
5. Retire the timed casting elimination for the silent stretch. It is a timer dressed as progress. Keep the
   crowning, driven by `behavior_core` as today.
6. Reduced motion: static nodes, no edge draw, the pulse becomes a text line only.

### Sketch at 1280×800 (centre cell, tight)

```
┌──────────────────────────── centre cell ≈ 470 × 330 ─────────────────────────────┐
│ BRIEF            CAPABILITIES          WIRING                 CHECKS   READY      │
│                                                                                   │
│ ● Your brief ──┬─ ┆Triage the inbox┆ ──── ● Gmail      ✓ verified     ○ tests  ○  │
│   read          │   sketch        ╲      ┆Weekdays 08:00┆  from brief             │
│ ● Calm analyst ├─ ▒Draft replies▒  ╲──── ◆ Which Gmail? (2 accounts)             │
│   your core     │   drafting             ◌ Slack      ! not connected [Connect]   │
│ ◇ close to:    └─ ·                      ● Review: you approve  (picked)         │
│   Inbox Zero                                                                      │
│ ▁▁▂▁▃▁▂▁▁▃▂▁  Reasoning · ~1.4k tokens · last signal 1 s ago                     │
├───────────────────────────────────────────────────────────────────────────────────┤
│ SCENE 2 · READING YOUR BRIEF                       00:47   usually 1-3 min        │
│ Next: the design lands and the frames confirm. You can connect Slack meanwhile.   │
└───────────────────────────────────────────────────────────────────────────────────┘
legend: ● solid (picked/detected/confirmed)  ┆ ┆ sketch  ▒ ▒ drafting  ◆ needs you  ◌ blocked
```

At 1600×1000 (not tight) the Brief column also shows the mission line, and Wiring shows up to 5 rows. Overflow
collapses to "+2", which opens the existing capabilities layer (`openCaps`).

### Hand-offs

- **→ Questions.** A pending question marks its node `needs-you`. The existing auto-open after 2.6 s
  (`ContactSheetCinemaLayout.tsx:113-116`) should push the camera in **from that node's rect** instead of the centre,
  so the user sees *which part of the plan* is asking. A forecast chip that turns into a real question is the same
  node changing state, not a new node.
- **→ Wiring.** Answered nodes flip to `picked`, and only unresolved chips stay drafting. The pulse restarts on the
  new turn.
- **→ Draft.** Confirmed chips fly (`layoutId`) into their frames and the capabilities column docks into the title
  card's film strip. Sketch chips that never confirmed strike through and leave. Then `TitleCard` takes the centre as
  today.
- **→ Screening.** A reduced blueprint keeps only Checks: one tick per tool as `toolTestResults` land (tests take
  20-50 s).
- **Film rail.** Each milestone leaves a notch at the second it happened ("brief read 0:04 · identity 0:52 · 3
  capabilities 1:10 · asks you 1:31"). This is the "gathering the milestones" record, it survives remounts through
  the clock ledger, and it is honest by construction.

---

## 4. Milestone model

**Principle: derive, don't duplicate.** The blueprint is a pure projection `deriveBlueprint(inputs) → Blueprint`
over the existing build store plus three new, non-persisted per-session slices. There is no second event log to
drift from confirmed state. The only stateful addition is a `firstSeenAt` map for the rail notches.

```ts
// cinema/blueprint/blueprintModel.ts (new, pure)
type Certainty = "picked" | "detected" | "sketched" | "drafting" | "confirmed" | "needs-you" | "blocked" | "dropped";
type Column = "brief" | "capability" | "wiring" | "checks" | "ready";
type Source = "launch" | "vault" | "reading" | "sketch" | "provisional" | "confirmed" | "question" | "test";

interface BlueprintNode {
  id: string;                 // stable across certainty upgrades: `cap:<id>`, `app:gmail`, `when`, `review` …
  column: Column;
  dim?: GlyphDimension;       // which frame it lights once confirmed
  label: string;
  certainty: Certainty;
  source: Source;
  detail?: string;            // "2 accounts", "verified 2 d ago"
  action?: "connect" | "answer";
}
interface BlueprintEdge { from: string; to: string; certainty: Certainty }
interface Pulse { phase: "starting" | "reading" | "reasoning" | "writing" | "validating" | "waiting";
                  tokensEst: number | null; lastSignalAt: number; turn: number }
type MilestoneKind = "brief-read" | "apps-checked" | "sketch" | "identity" | "enumerated"
                   | "capability" | "asks-you" | "draft" | "tests";
interface Blueprint { nodes: BlueprintNode[]; edges: BlueprintEdge[]; pulse: Pulse | null;
                      milestones: { kind: MilestoneKind; at: number }[] }
```

Merge rule: per node id, the **highest-authority source wins**, in this order:
confirmed > question > picked > provisional > reading/vault > sketch. The one downgrade allowed is an explicit
retraction (`ProvisionalSettled.retracted_*`, or a sketch/forecast still unconfirmed at draft), which renders as
`dropped` for one beat.

| Piece | Exists? | Change |
|---|---|---|
| Launch snapshot (qc, toggles, core, picked recipe) | yes, `useSheetState.ts:59-70` | expose to the deriver |
| Vault health | yes, `useVaultConnectorTiles` | none |
| Provisional / behavior core / capabilities / questions / tests / phase | yes, `matrixBuildSlice` | none |
| Clock + marks | yes, `buildClock.ts` | add `milestones: {kind, at}[]` beside `marks` (same ledger, same localStorage mirror) |
| `launchReading` slice | **new** | backend event `BuildEvent::LaunchReading { detected_services, ambiguous_services, gate_forecast: {field, open}[], template_refs: {name, category}[] }`, emitted once before turn 0 from values `mod.rs`/`runner.rs` already compute (a small `pub(super)` refactor so `gates.rs` returns the matched service names, not only `Gate`) |
| `pulse` slice | **new** | backend `BuildEvent::TurnPulse { turn, phase, tokens_est, at_ms }`, derived in the runner's line loop (`runner.rs:760`) from `system/init`, `message_start`, `content_block_start{thinking/text/tool_use}`, `thinking_delta.estimated_tokens`, `message_stop`/`result`. **Throttle to ≤1/s and send only on phase change or a ≥1 s tick.** `dual_emit` does not persist (`events.rs:217-275`), but every send is a Channel send, and a dropped Channel counts as cancel, so keep the rate low. |
| `sketch` slice | **new** | `build_sketch(intent)` command (a clone of `webbuild_sketch`, with a persona-shaped schema and caps) → `BuildSketch` ts-rs type. The frontend fires it at launch in parallel with `start_session`. |
| Both new events | | ts-rs binding regen (`npm run test:rust -- export_bindings` on Windows), dispatch in `hooks/build/useBuildSession.ts:~248`, reset on session switch like `provisional` |

Frontend layout: `cinema/blueprint/{blueprintModel.ts, useBlueprint.ts, BlueprintCentre.tsx, BlueprintNode.tsx,
PulseLine.tsx}`. `SheetCentre.tsx:45-48` mounts `BlueprintCentre` in place of the crowd for casting/wiring. All strings
go through `COPY`/`t` in 14 locales. No spinner: this is a surface, so the loading doctrine applies.

---

## 5. Phased plan

| Phase | Scope | Size | Backend? | Perceived-wait effect (estimate) |
|---|---|---|---|---|
| **P0 Measure** | Record 3 real sonnet-5-5/low build turns with the stream-timing bench (`scripts/test/lib/stream-timing.mjs`): time to `message_start`, thinking-delta cadence across the whole silent stretch, `estimated_tokens` fill rate. Offline, run a sketch prompt on the 8 recorded intents and score its agreement with the final capabilities/apps. | S | no | None directly. Decides whether E and D are worth building. |
| **P1 Blueprint from existing signals** | `blueprintModel` + `BlueprintCentre` replacing the timed crowd. Nodes from the launch snapshot, a lexical match of the intent against `connectorDefinitions`, vault health (+ "Connect" action), top recipe/template match kept at launch, provisional, `behavior_core`, confirmed, questions, tests. Rail notches. Silence line from the clock + last store change. | M | no | The first real content moves from **~70-220 s** (first streamed object) to **0 s**, when the brief names anything or quick setup was used. A bare, vague brief still gets only its Brief column until the stream starts, and the layout says so. |
| **P2 Launch reading + stream pulse** | `LaunchReading` (replaces the P1 TS matcher with the backend's own heuristics, so one heuristic, not two) + `TurnPulse` + `PulseLine`. Forecast "will ask" chips, including the certain credential-picker. | M (backend S + S, frontend S, bindings) | yes | Liveness from **~3-6 s** ("the model has your brief") with a tick about every 1-1.5 s through the reasoning. Questions are forecast at 0 s. Depends on P0 confirming the cadence. |
| **P3 Sketch lane** | `build_sketch` micro call at launch → sketched capabilities column. Shown only if P0 agreement is acceptable (bar: ≥70 % of sketched apps present in the final build). Otherwise show only its apps/when chips. | M | yes | The full draft *shape* by **~5-10 s** instead of 60-200 s, clearly labelled as a sketch. |
| **P4 Answer ahead** | Let the user answer forecast/sketch questions during the silent turn. Queue answers on the session. When the runner would synthesize that gate question (`gates.rs:886`), open the gate from the queued answer and fold it into the next follow-up instead of stopping at `AwaitingInput`. The model's own questions still come through. | L | yes (runner + `send_answer` semantics) | Removes the **human round trip** for forecast questions (think time + one stop). It does not remove the wiring turn (1-3 min). The biggest real saving, and the riskiest. |
| **P5 Checks column live** | Per-tool ticks in screening from `toolTestResults`, and the Ready node lands with the verdict. | S | no | 20-50 s tests read as progress through named tools instead of a tail of log lines. |

**Recommendation:** P0 → P1 now. P1 needs no backend change and fixes the honesty problem (the timed casting). Build
P2 once P0 shows the pulse is real. P3 only on a measured agreement rate. Take P4 as its own `/spark`, because it
changes build semantics and not just the view.

**Risks to watch:** Sonnet 5.5 at low may skip thinking entirely (the Sonnet 5 fixture did) (text-only fixture). In that case the pulse is mostly
"reading → writing", and that is fine as long as the UI does not invent a reasoning phase. The sketch uses the same
model as the builder, so its value is its speed, not a second opinion. Every new chip must pass the existing census
rules (no native `title`, no raw palette colours, no spinner branch).
