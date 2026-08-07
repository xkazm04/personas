# Decision Mirror — learning how the operator decides

> Athena's decision policy ("approve the maximum the session recommends unless
> a choice would harm architecture or security") was hand-written from one
> conversation. The Decision Mirror makes that observation permanent and
> cumulative: capture the operator's real decisions wherever they happen,
> distill them into a behavioral profile, and let Athena's autonomy grow
> exactly as fast as her agreement with the operator is *measured* to justify.

The operator has explicitly chosen extraction depth over privacy for this
system; the data never leaves the machine (local-first, gitignored, neutral
directory) — the blast radius is the operator's own disk.

## Design principle

**Automate the habits, escalate the deliberations, and mirror the level.**
Fast, consistent picks are habits — the first thing a proxy may safely decide.
Slow picks with annotations are the deliberation frontier — where the
operator's judgment adds value and a proxy must ask, or reason at the same
level it observed. A strategic question answered with a reflex is how a proxy
loses trust.

## The five phases

### Phase 1 — Capture (LIVE, Personas-only scope)

Hook the decision surface itself; never trust session discipline alone.

- **Hard channel:** a `PostToolUse` hook on `AskUserQuestion` (registered in
  `.claude/settings.local.json` — hook registration is per-machine; the
  capture script is tracked) appends every question + option set + the
  operator's answer + "Other" annotations to the ledger, verbatim.
- **Soft channel:** sessions journal *corrections* — moments the operator
  overrides course mid-turn — via
  `node scripts/decision-ledger/capture-decision.mjs --correction …`
  (see the Decision Mirror section of `.claude/CLAUDE.md`). Corrections are
  the strongest signal of model error and weigh ~10× a select at distillation.
- **Prose channel (LIVE since 2026-08-06):** a `UserPromptSubmit` hook records
  every message the operator types, verbatim and secret-redacted; a paired
  `Stop` hook records what the turn then *did* (tools, files touched, duration,
  subagents) and links it by `ref`. Both run
  `scripts/decision-ledger/capture-prose.mjs`, dispatched on `hook_event_name`.
  Decisions capture what he chose; prose captures how he frames, asks and
  reacts. See Phase 1c below.
- **Ledger:** `.claude/decision-ledger/events-YYYY-MM.jsonl` (decisions) and
  `prose-YYYY-MM.jsonl` (prose) — append-only, schema-versioned, gitignored
  (explicit entry in `.gitignore` on top of the `.claude/*` default, so future
  whitelist edits can't leak it). Separate streams so prose volume never
  perturbs the Phase 3 decision consumer.

Descoped for now: the other repos and the machine-wide (`~/.claude`) hook.
When the schema settles, the same hook + script transplant to each repo (or
one machine-wide hook with per-repo tagging) — that decision is Phase-1b.
Reconfirmed 2026-08-06 for the prose channel too: offered machine-wide capture
(which would have tripled the corpus — only 402 of 1,233 surviving messages
were written in this repo) and the operator chose personas-only, keeping one
privacy boundary and one ledger.

### Phase 1c — Prose capture (LIVE)

The decision ledger records explicit acts. It cannot see framing, register, or
the shape of a request — and those are most of what an operator communicates.

- **`UserPromptSubmit` → `{kind:"prompt"}`** — verbatim text, redacted for
  secret-shaped strings, tagged with session, cwd, and whether it was a slash
  command. The hook is silent on every path: on this event stdout is injected
  into the model's context, so a chatty hook would poison every prompt.
- **`Stop` → `{kind:"turn_outcome"}`** — appended (never edited into the
  prompt row; the ledger stays append-only) with `ref` pointing at the prompt
  id, carrying `tools`, `tool_calls`, `files`, `duration_s`, `subagents`,
  `assistant_chars`. Pairing prompt with outcome is what turns a style corpus
  into a *cognition* corpus: it shows how much work a given phrasing licensed.
- **Backfill:** `scripts/decision-ledger/backfill-prose.mjs` recovers what is
  still on disk (idempotent, keyed on transcript `uuid`). This matters because
  the CLI prunes transcripts — at first run the oldest surviving message was
  five weeks old, so unrecorded prose is *actively expiring*.
- **Human-vs-agent discrimination:** `promptSource ∈ {typed,
  suggestion_accepted, queued}`. This is the only reliable signal —
  `userType` is `"external"` for humans and dispatched agents alike, and
  SDK-dispatched prompts are otherwise indistinguishable apart from length
  (23k chars mean vs 342 for typed).

Distilled into **§5 Communication profile** and **§6 Cognitive profile**.
Both are **describe-only by operator decision (2026-08-06)**: sessions and
Athena read them to mirror his level and avoid known redirect triggers, but
nothing generates her voice or policy from them. Prose may corroborate a
§1-§4 claim; it may never be the floor-clearing evidence for one, because
those sections drive autonomy and autonomy requires an explicit act.

Event schema (v1):

```json
{
  "schema": 1, "ts": "ISO", "repo": "personas",
  "kind": "select | multiselect | correction",
  "session_id": "…", "transcript_path": "…",
  "question": "verbatim", "header": "chip",
  "options": [{"label": "…", "description": "…"}],
  "chosen_raw": "comma-joined labels as returned",
  "chosen": ["best-effort split"],
  "annotation": "Other-note verbatim | null",
  "provenance": "human",
  "source": "askuserquestion-hook | manual-correction",
  "was": "(corrections only) what the agent was doing",
  "context": "(corrections only) one-line situation"
}
```

Fields that matter more than they look: **rejected options** (implicit —
`options` minus `chosen` — half the signal), **annotations** (they carry the
*reasoning*), **provenance** (once Athena decides like the operator and gets
rubber-stamped, the ledger fills with her echo — human-originated decisions
must stay distinguishable forever). Latency is not capturable at hook time;
`reflect-me` recovers it best-effort from the transcript (`transcript_path` +
timestamp proximity).

### Phase 2 — Distillation: the `reflect-me` skill (LIVE)

Sibling of `/reflect` (which analyzes the *agent's* behavior): `/reflect-me`
analyzes the *operator's* decisions. It reads unprocessed ledger events, joins
transcripts for context and latency, and updates four artifacts in
`.claude/decision-ledger/profile.md` (gitignored with the ledger):

1. **Trait vector** — scored axes (scope appetite, risk posture by domain,
   evidence demand, sequencing philosophy, pragmatism, reversibility
   sensitivity), each with confidence + evidence links. Recency-weighted;
   traits contradicted by fresh evidence are *retired*, not averaged.
2. **Escalation boundary** — the learned never-ask / always-ask /
   ask-in-context rule set (the future NEEDS-YOU classifier).
3. **Level-of-thought map** — per situation class, which cognitive level the
   operator engages: L1 reflex · L2 local tradeoff · L3 strategic
   (references arcs/sequencing) · L4 values. Consumers must mirror the level.
4. **Values ledger** — durable stated principles with provenance and the
   situations where they were expressed.

Guards: only `provenance: human` events feed traits; corrections weigh ~10×;
with < 20 events the skill writes *observations*, never conclusions; context
carries its domain (a pof choice is not a personas choice — no averaging
across domains).

### Phase 3 — First consumer (NEXT)

Generate the fleet batch directive's decision-policy paragraph from
`profile.md` instead of the hand-written constant in
`fleet_bridge.rs::drain_assessment_batch`. Lowest-risk consumer: the debug
recorder makes any verdict drift immediately visible. Candidates after that:
`fleet_action_auto_fires` boldness matrix → per-class learned thresholds;
`/perfect` Director pre-ranking slates by predicted acceptance.

### Phase 4 — Calibration loop

Every Athena decision the operator later sees gets an agree/disagree bit
(the approvals ledger already stores her decisions; the UI needs one thumb).
This turns the profile from a description into a *measured* model: precision
per decision class, over time. Human-corrected Athena decisions feed back at
correction weight.

### Phase 5 — Graduation mechanics

Per-class autonomy expansion: a decision class where Athena has sustained
> ~95% measured agreement over N decisions graduates from "ask" to "act"
(and demotes on regression). Graduation is per *level*, not per topic —
L1/L2 classes graduate; L3/L4 stay escalated regardless of agreement, because
being predictable is not the same as wanting to be replaced.

## Known risks

- **Staleness** — taste evolves; recency decay + trait retirement (Phase 2).
- **Context collapse** — every trait carries its domain; no cross-domain
  averages.
- **The echo loop** — provenance separation (Phase 1) + correction
  over-weighting (Phase 2/4).
- **Performative distortion** — the operator knowing they're tracked; accepted
  as a cost by explicit choice.

## Long-view

The same ledger is the training corpus for the twin plugin: first predicting
picks, then drafting replies, then representing the operator in the A2A /
negotiation surfaces. Fleet is the proving ground because its decisions are
frequent, low-stakes, and measurable — but the profile is product-wide.
