# Team Channel Deliberation Engine — "Design D"

Status: **PLAN — awaiting build approval** (drafted 2026-06-24). Author decisions captured
in §0.2. This is the implementation plan for turning the team channel from a *communication*
plane (Designs B/C) into an **autonomous deliberation** plane where personas converse to
*produce work*, moderated by a cheap LLM, terminating in proposals that spawn deterministic
assignments.

Builds on: [`team-channel-orchestration.md`](../architecture/team-channel-orchestration.md)
(Designs B/C, the C-on-B doctrine), [`athena-decision-layer-plan.md`](../features/companion/athena-decision-layer-plan.md)
(approval executor), [`athena-team-orchestration.md`](../features/companion/athena-team-orchestration.md)
(post-run reconciliation seam).

---

## 0. Framing

### 0.1 The lineage

| Design | What it is | Status |
| --- | --- | --- |
| **B** | Living chat: channel read-model + acknowledged user directives injected at step boundaries | SHIPPED |
| **C** | Multi-author relay: user/Athena/Director/persona all write; `consumer` governs who hears whom | C1/C3/C4 done, C2/C5 partial |
| **D** | **Autonomous deliberation: personas converse to produce decisions/work, moderated, budgeted, terminating in a proposal that feeds the execution engine** | **THIS PLAN** |

### 0.2 Decisions (locked with the author, 2026-06-24)

1. **Architecture — deliberation *feeds* the DAG.** The conversation is a new LLM
   "deliberation plane" that produces decisions/proposals, then spawns real work through the
   existing `run_assignment` engine. **The LLM stays out of the execution tick loop** — this is
   what keeps the whole feature inside the C-on-B doctrine that prevented the G4 failure.
2. **Scope — full vision in one plan** (phased build, §10, but the plan covers all six pillars).
3. **Viewpoints — typed dials + authored prose.** Each persona core gets machine-legible dials
   the moderator can reason over *and* authored stance prose for voice.

**Operational decisions (resolved 2026-06-25 — supersede the §12 open questions):**

4. **Who starts** — both **user and Athena** can open a deliberation from day one.
5. **No turn budget — bound by *progress*, not by turn count.** The point of the feature is *long
   conversations interleaved with real tasks/capabilities*, not chatter that a counter kills. The
   loop-safety burden moves onto **advanced moderation** (§3, §6): an agenda backbone,
   progress/stall accounting, bias-to-action, and rate-shaping — with cost / wall-clock / quota as
   the only hard floors. The moderator becomes a *conversation manager*, not just a router. This is
   the riskiest change in the plan and the locus of the D2/D7 test effort.
6. **One channel ↔ one team; channels run concurrently across teams.** v1 cap: one active
   deliberation per team-channel at a time; many teams deliberate in parallel in isolation.
7. **All participants eligible, moderator selects the *key* ones.** Never chain through the whole
   roster (inefficient) — the moderator picks the 1–3 personas whose cores are most relevant to the
   open agenda item. This raises the bar on core authoring (§7): cores must be rich enough that
   selection is accurate.
8. **Capability self-promotion is *always gated* in v1.** Every capability invocation routes
   through approval first, to keep initial tests controlled. Loosen toward autonomy only after the
   moderation mechanisms are proven (a later phase).

### 0.3 The doctrine this must not break

`team-channel-orchestration.md` §2: **"No LLM in the orchestrator tick loop … dialogue never
sequences execution."** The G4 autonomy campaign proved the cost of violating it (767 dead
events/wk, bounce storms, a 2-day silent deadlock). The current safety model depends on personas
**not being able to hear each other** — persona channel posts are written `consumer='display'`
so they are never injected into another persona's prompt (`team_assignment_orchestrator.rs:1204`).

Design D removes that firebreak *inside a deliberation*. The plan therefore treats **loop
prevention as a load-bearing structural replacement** (§6), not a feature add-on. The doctrine is
preserved because the deliberation loop is a **separate, budgeted, moderated** loop that *emits*
into `run_assignment`; the execution tick loop itself never gains an LLM.

---

## 1. Architecture — three planes

```
┌─────────────────────────┐   ┌──────────────────┐   ┌────────────────────────────┐
│   DELIBERATION (new)     │   │  DECISION GATE   │   │   EXECUTION (existing)      │
│                          │   │                  │   │                            │
│  Haiku moderator picks   │──▶│  moderator says  │──▶│  run_assignment / DAG tick │
│  next speaker(s) →        │   │  "converged" OR  │   │  loop (UNCHANGED, no LLM)  │
│  persona deliberation    │   │  persona proposes│   │                            │
│  turns (opinion, or      │   │  assignment →     │   │  result posts back into    │
│  self-promote to a       │◀──│  user approval / │◀──│  the deliberation channel  │
│  capability execution)   │   │  autonomous flag │   │                            │
└─────────────────────────┘   └──────────────────┘   └────────────────────────────┘
        ▲ budgeted, moderated, terminating            deterministic, already shipped
```

**Invariant restated:** a deliberation is the only context in which persona→persona injection is
allowed, and only while it is non-terminal (within cost/idle floors) and moderated. Outside a
deliberation the existing `consumer='display'` firebreak stands unchanged.

---

## 2. Data model

All new structs `#[derive(TS)] #[ts(export)]`; run `cargo test ... export_bindings` and commit
`src/lib/bindings/`. All new Tauri commands need `scripts/generate-command-names.mjs`.

### 2.1 `team_deliberations` (new table)

A deliberation is a bounded conversation with a goal, a budget, and a termination contract.

```sql
CREATE TABLE team_deliberations (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
  topic         TEXT NOT NULL,              -- the question the team is deliberating
  goal          TEXT,                       -- optional link-prose: what a good outcome looks like
  status        TEXT NOT NULL DEFAULT 'open', -- open | converging | resolved | escalated | paused | aborted
  -- NO turn budget (decision 5): length is bounded by PROGRESS, not a turn count.
  round         INTEGER NOT NULL DEFAULT 0, -- moderator rounds (escalation cadence)
  consecutive_stall_rounds INTEGER NOT NULL DEFAULT 0, -- circularity bound — the turn-budget replacement (§6)
  cost_budget_usd  REAL,                    -- HARD floor: pause + escalate when exceeded
  cost_spent_usd   REAL NOT NULL DEFAULT 0, -- rolled up from companion_turn for this deliberation
  idle_deadline    TEXT,                    -- HARD floor: auto-pause if no progress / no user activity by this time
  resolution    TEXT,                       -- JSON: {kind:'proposal'|'assignment'|'none', ...}
  spawned_assignment_id TEXT,               -- set when a proposal feeds the DAG
  created_by    TEXT NOT NULL,              -- 'user' | 'athena' (decision 4)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_delib_team_status ON team_deliberations(team_id, status, updated_at DESC);
-- v1 concurrency cap (decision 6): at most one non-terminal deliberation per team.
CREATE UNIQUE INDEX idx_delib_one_active_per_team ON team_deliberations(team_id)
  WHERE status IN ('open','converging','escalated','paused');
```

**The agenda backbone (new table) — replaces the turn budget as the termination contract.**
A deliberation ends when its agenda is empty (every item `resolved`/`spawned`) or the user closes
it — *not* at a turn count. The moderator curates it (§3).

```sql
CREATE TABLE deliberation_agenda (
  id              TEXT PRIMARY KEY,
  deliberation_id TEXT NOT NULL REFERENCES team_deliberations(id) ON DELETE CASCADE,
  item            TEXT NOT NULL,            -- an open question / sub-goal under discussion
  status          TEXT NOT NULL DEFAULT 'open', -- open | resolved | spawned
  resolution      TEXT,                     -- decision text, or the spawned assignment_id
  opened_by       TEXT,                     -- 'moderator' | persona_id | 'user'
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT
);
CREATE INDEX idx_agenda_delib_status ON deliberation_agenda(deliberation_id, status);
```

### 2.2 `team_channel_messages` — extend (deliberation turns live in the existing channel)

Add one nullable column so deliberation turns reuse the shipped read-model + UI for free:

```sql
ALTER TABLE team_channel_messages ADD COLUMN deliberation_id TEXT
  REFERENCES team_deliberations(id) ON DELETE CASCADE;
```

- Deliberation turns are written with `author_kind='persona'|'athena'|'user'` and
  `deliberation_id` set. Their human-visible rendering rides the existing `list_team_channel`
  union (rows already carry `kind`/`author`).
- **Injection is by `deliberation_id`, not by `consumer`.** A new repo fn
  `list_deliberation_turns_for(deliberation_id, since, limit)` is the injection source for the
  persona turn primitive (§4). This is the firebreak boundary: persona-to-persona injection
  exists *only* through this deliberation-scoped path; the default-channel `consumer='inject'`
  rules (`list_injectable_for_persona`) are untouched.

### 2.3 Persona core — typed dials + authored prose (new column)

A typed `PersonaCore`, serialized to a new `core_profile TEXT` column on `personas`, sourced from
the template's persona block at adoption time (§7).

```rust
#[derive(Serialize, Deserialize, TS)] #[ts(export)]
pub struct PersonaCore {
    pub motivation: String,          // authored prose: why this persona cares
    pub stance: String,              // authored prose: its distinctive point of view
    pub north_star_commitment: String, // how IT believes the team reaches #1 (route, not the goal)
    // typed dials the moderator reasons over (0.0..1.0):
    pub risk_tolerance: f64,
    pub speed_vs_quality: f64,        // 0 = quality-max, 1 = speed-max
    pub conflict_style: String,       // 'challenger' | 'harmonizer' | 'analyst' | 'pragmatist'
    pub deference: f64,               // how readily it yields to stronger arguments
}
```

`personas` gains `core_profile TEXT` (nullable; NULL = legacy persona, deliberation falls back to
role + identity text). Parsed via a `parsed_core_profile()` helper mirroring
`parsed_design_context()`.

### 2.4 Team north-star (new typed field)

The shared motivation — "be #1 in category" — lives at the **team** level so every member shares
it, and is **authored at the template/preset level** (§7).

```rust
#[derive(Serialize, Deserialize, TS)] #[ts(export)]
pub struct TeamNorthStar {
    pub aim: String,            // "Become the #1 <category> product"
    pub category: String,       // the category the team competes in
    pub success_signals: Vec<String>, // what winning looks like (≤5)
}
```

Stored on `persona_teams` (new `north_star TEXT` column) and on `TeamPresetGroupSpec`. Injected
into every deliberation turn alongside the persona's own `north_star_commitment` — shared goal,
distinct routes.

### 2.5 Conversation memory — reuse `persona_memories`, add scope

Per the memory investigation, per-persona long-term memory already exists (`persona_memories`,
tiered core/active/working/archive, auto-injected). Add one nullable scope column so a persona can
recall "what I argued in this deliberation and why":

```sql
ALTER TABLE persona_memories ADD COLUMN deliberation_id TEXT;  -- nullable scope
```

- Within-deliberation recall: `get_for_injection_v2` gains a `deliberation_id` OR-clause (same
  pattern as the existing `use_case_id` / `home_team_id` scoping).
- **Write-back is gated, not per-turn.** Durable facts mined from a concluded deliberation flow
  through the **existing Director memory curation** (`director_memory.rs`) to avoid the
  memory-poisoning failure mode (`project_byom_mixed_engine`). Raw turns stay in
  `team_channel_messages`; only synthesized lessons graduate to `persona_memories`.

---

## 3. The moderator — Haiku conversation manager

Because there is **no turn budget** (decision 5), the moderator is not a simple router — it is the
**conversation manager** that keeps a long, task-mixed deliberation productive and bounded. It is
still a cheap headless Haiku call, **reusing** the shipped headless decision pattern
(`athena_reaction.rs::cli_text_tracked` + `build_cli_args(None,None)`, no repo, tool-less) with
`--model claude-haiku-4-5-20251001` (tier already mapped in
`prompt/capabilities.rs::tier_slug_to_model_id`), and it is a **function, not an actor** — it
routes and curates, it never authors channel content.

**One call per tick, batched.** Given: topic + team north-star, the live **agenda**, the roster's
`PersonaCore`s (dials + stance) so it can pick the *key* personas (decision 7), and the last N
turns. It returns:

```json
{"deliberation": {
  "next_speakers": ["persona_id", ...],          // SELECTIVE — the 1-3 personas whose cores fit the
                                                  // current open agenda item; never the whole roster
  "agenda_add": ["new open question surfaced", ...],   // moderator curates the backbone
  "agenda_resolve": [{"id": "...", "resolution": "..."}],
  "round_outcome": "progressed" | "stalled",     // drives consecutive_stall_rounds (§6)
  "action": "discuss" | "invoke_capability" | "spawn_assignment" | "escalate_to_user" | "conclude",
  "status": "continue" | "converged" | "stuck",
  "reason": "audited rationale"
}}
```

The moderator's four jobs (this is the "advanced moderation" decision 5 asks for):
1. **Selective routing** — pick only the key personas for the open item (relevance against their
   cores happens inside this single call; no per-message × per-persona fan-out).
2. **Agenda curation** — open items as they surface, resolve them as decisions/tasks land. The
   agenda *is* the termination contract.
3. **Progress classification** — judge each round `progressed` vs `stalled`. This replaces the turn
   counter as the circularity bound.
4. **Bias-to-action** — when an open item is answerable by a *capability* rather than more talk,
   return `action: "invoke_capability"` / `"spawn_assignment"`. This is what stops it being "just
   chatting" (the author's explicit goal).

**Deterministic backstops (the moderator is never unbounded authority — and with no turn cap, these
matter more, not less):**
- Round-robin fallback + treat the round as `stalled` if the moderator output fails to parse.
- Never selects an author to respond to its own immediately-prior turn (anti-self-loop).
- Anti-domination: a single persona may not take more than `MAX_CONSECUTIVE_PERSONA_TURNS` in a row.
- Anti-groupthink: if the roster has converged to agreement on an open item, the moderator must
  either resolve it (decision/spawn) or inject a challenger — never keep the agreement loop running.
- Mandatory `escalate_to_user` forced when `consecutive_stall_rounds >= STALL_LIMIT` or
  `round >= ESCALATE_ROUND`, regardless of LLM output.
- Every decision logged to the `companion_turn` ledger (`trigger_kind="deliberation_moderate"`).

---

## 4. The persona turn primitive — activate vs. self-decide

**New, genuinely missing primitive.** Today the only execution primitive is the multi-step DAG
assignment (`run_assignment`); there is no ad-hoc single-turn run. Add
`run_persona_deliberation_turn(pool, app, engine, deliberation_id, persona_id)`:

- Prompt = `PersonaCore` (motivation/stance/dials) + team north-star + deliberation topic +
  recent turns (`list_deliberation_turns_for`) + the persona's scoped memory. **Tool-less by
  default** (an opinion is cheap).
- The persona **decides for itself** whether to just opine or to act, via the output protocol:

```json
{"turn": {
  "message": "the persona's contribution to the conversation",
  "invoke_capability": {"use_case_id": "...", "rationale": "..."},   // optional self-promotion
  "propose_assignment": {"title": "...", "steps": [...], "rationale": "..."} // optional
}}
```

- `invoke_capability` → **always gated in v1 (decision 8)**: the persona's request becomes an
  approval card; on approval, spawn a real `engine.start_execution` for that use case and post its
  result back into the deliberation as a turn. **This is the only place a deliberation turn costs
  full-execution money.** Autonomous (un-gated) self-promotion is a later phase, only after the
  moderation mechanisms are proven. Capability cost still rolls into `cost_spent_usd`.
- `propose_assignment` → routed to the decision gate (§5).

The turn writes one `team_channel_messages` row (`deliberation_id` set) and rolls its CLI usage
into the deliberation's `cost_spent_usd`. There is no turn counter to increment (decision 5).

---

## 5. Decision gate & handoff (feeds the DAG)

When the moderator returns `status:"converged"` **or** a persona emits `propose_assignment`:

1. Synthesize a structured **Proposal** (one Haiku/Sonnet call summarizing the deliberation into
   a concrete assignment spec).
2. **Gate:**
   - Autonomy OFF (default) → Proposal becomes an **approval card** via the existing approval
     executor (`commands/companion/approvals.rs`); user approves → spawn.
   - `AUTONOMOUS_DELIBERATION` ON → spawn directly (mirrors the autonomous-review-triage
     precedent), rate-limited.
3. **Spawn** via the existing `companion_assign_team` / `run_assignment` path. Record
   `spawned_assignment_id` on the deliberation; set status `resolved`.
4. The assignment's terminal summary posts back into the deliberation channel (close the loop),
   reusing the designed post-run reconciliation seam.

No new execution machinery — the deliberation's entire output is a call into the shipped
orchestrator.

---

## 6. Loop prevention & governance — the load-bearing part

This replaces the firebreak Design D removes. **With no turn budget (decision 5), the conversation
is bounded by *progress*, rate-shaping, and hard cost/time floors — not by a turn count.** The
principle: *a deliberation may run indefinitely as long as it is productive; the moment it stops
being productive it is throttled, escalated, or paused.*

### 6.1 The progress model (the turn-budget replacement)

- **Agenda-driven termination.** A deliberation ends when its `deliberation_agenda` is empty
  (every item `resolved`/`spawned`) or the user closes it. Length is decoupled from turn count.
- **Stall accounting.** The moderator classifies each round `progressed` vs `stalled` (§3). A
  `progressed` round resets `consecutive_stall_rounds` to 0; a `stalled` round increments it. At
  `STALL_LIMIT` (default 3) the moderator must act — force-resolve an open item, escalate to user,
  or `paused`. This is the primary circularity bound.
- **Bias-to-action.** Open items answerable by a capability are converted to tasks rather than
  discussed further — the mechanism that keeps it from being "just chatting."

### 6.2 Rate-shaping (what makes uncapped length safe)

The `DeliberationSubscription` ticks on an interval and advances the conversation by **at most
`MAX_TURNS_PER_TICK` (default 3) speaker turns per tick**, then yields. A long deliberation is
therefore *many ticks over hours*, not a burst — cost-per-unit-time stays bounded even though total
turns is unbounded, and the user can watch and interject between ticks. **This is the single
mechanism that substitutes for the deleted turn cap.**

### 6.3 Hard floors (non-negotiable backstops — generous, but present)

| Floor | Mechanism | Reuses |
| --- | --- | --- |
| **Cost ceiling** | `cost_budget_usd`; when `cost_spent_usd` exceeds it → `paused` + escalate | `companion_turn` rollup |
| **Idle / wall-clock** | `idle_deadline`: no progress and no user activity by then → auto-`paused` | orchestrator pattern |
| **Quota cooldown** | skip ticks when AI quota exhausted | `quota_cooldown_active` |
| **Stall limit** | `consecutive_stall_rounds >= STALL_LIMIT` → forced escalation | new (§6.1) |
| **Rate cap** | `MAX_TURNS_PER_TICK` per tick | new (§6.2) |
| **Anti-self-loop** | moderator may not pick an author to answer its own prior turn | new |
| **Anti-domination** | `MAX_CONSECUTIVE_PERSONA_TURNS` per persona | new |
| **Anti-groupthink** | unanimous agreement on an item → resolve or inject challenger | new |
| **Firebreak boundary** | persona→persona injection ONLY via `list_deliberation_turns_for` on a non-terminal deliberation | preserves C doctrine |
| **Master flag** | `AUTONOMOUS_DELIBERATION`, default **OFF** | `AUTONOMOUS_*` pattern |
| **Audit** | every moderator + turn + gate decision in the ledger | `companion_turn` |

Defaults (`STALL_LIMIT=3`, `MAX_TURNS_PER_TICK=3`, `ESCALATE_ROUND`, `cost_budget_usd`,
`idle_deadline`) are config constants, tuned during D2/D7. They are floors, not the primary
control — the agenda + progress model is.

### 6.4 Actor hierarchy (no three-way loop)
- **Moderator** = distinct cheap Haiku *function* (routes, never authors).
- **Athena** = a *participant* and the *escalation target* (can be a `next_speaker`; receives
  `escalate_to_user`-adjacent summons). Athena is never asked to respond to her own post.
- **Director** = **out of deliberation** — coaching stays in its existing lane (verdict→channel,
  `consumer='inject'`). No new Director surface here.

---

## 7. Template-level enrichment (where the #1-product motivation is imprinted)

The motivation is *designed*, not emergent. This is the highest-risk-of-disappointment pillar
(multi-agent debate converges to bland agreement unless authored otherwise), so it gets explicit
content work.

1. **Extend the template persona block** (`agent_ir.rs` persona schema) with a `core` object =
   the `PersonaCore` fields (typed dials + `motivation`/`stance`/`north_star_commitment` prose).
2. **Extend `TeamPresetGroupSpec`** with `north_star` (`TeamNorthStar`).
3. **Re-author the SDLC team templates** (the 5 personas) with *deliberately divergent* cores
   that share the north-star but disagree on the route — e.g. Architect (quality-max, low risk),
   Implementer (speed-leaning, pragmatist), QA Guardian (challenger, risk-averse). The prompt for
   a deliberation turn must **license disagreement** ("you are expected to push back when a
   proposal conflicts with your core").
4. **Adoption path carries `core_profile` + `north_star` through.** Mirror the diligence from the
   SDLC adoption defects (the adopt path that *didn't* wire `persona_event_subscriptions`) —
   add a test that a freshly-adopted team has non-null cores and a north-star.

---

## 8. UI — the channel becomes the deliberation surface

Builds on the C5 flagship-polish scope (author voice, threading, intervention cards).

- `ChannelTimelineWorkspace` / `VirtualStream` / `MergedRow` render deliberation turns as a
  threaded sub-conversation (reuse `reply_to` + the new `deliberation_id` grouping).
- A **deliberation header**: topic, the live **agenda** (open/resolved items) as the primary
  progress indicator, a **cost meter** (`cost_spent_usd` vs `cost_budget_usd`), live status
  (open/converging/escalated/paused/resolved), participant cores at a glance. *No turn meter* —
  progress is shown by agenda burn-down, not a turn count.
- **Moderator decisions** rendered as a thin system ribbon ("→ Architect, QA to respond").
- **Proposal card** at convergence (reuse the Flight Deck StepRelay intervention row); **"your
  decision needed"** escalation card wired to the approval executor.
- **Start-deliberation** affordance (user or Athena seeds a topic).
- Full i18n (`t.monitor.*` / a new `t.deliberation.*` section) — the prototype `COPY.*` strings
  graduate here; translate all 14 locales via the pipeline (`translate-extract` → subagents →
  `translate-merge`).

---

## 9. Cost model

- **Moderator:** Haiku, 1 batched call per tick → ~5% of a Sonnet decision; negligible.
- **Opinion turns:** tool-less persona calls (no repo, no tools) → ~30-40% of a full run.
- **Capability self-promotion:** full execution cost — **always approval-gated in v1** (decision 8).
- **Cost ceiling + rate-shaping are the ceiling** (§6.2/6.3), enforced deterministically — there is
  no turn budget. A long deliberation amortizes its cost over many ticks. Stamp model + thinking on every call
  (the cost-observability work, `2ce332e13`) so deliberation spend is attributable in §11 cost
  blocks / KPI ledger.

---

## 10. Phasing (full vision, built safely)

Each phase is independently shippable behind the default-OFF flag; together they deliver the
whole vision.

| Phase | Scope | Gate to next |
| --- | --- | --- |
| **D1 — schema & bindings** | `team_deliberations`, `team_channel_messages.deliberation_id`, `personas.core_profile`, `persona_teams.north_star`, `persona_memories.deliberation_id`; ts-rs bindings; command-name regen | migrations apply clean; bindings committed |
| **D2 — moderator + advanced moderation** | `DeliberationModerator` (Haiku conversation manager: selective routing, agenda curation, progress/stall classification, bias-to-action), `DeliberationSubscription` (default OFF), the full §6 progress/rate-shaping/floor machinery, ledger audit. **This is the heart of the build and the main test surface** (decision 5). | a long deliberation runs over many ticks, stalls are detected and escalated, cost/idle floors hold, agenda drives termination — all logged, no runaway |
| **D3 — persona turn primitive** | `run_persona_deliberation_turn` (opinion-only first, then always-gated `invoke_capability`); deliberation-scoped memory injection | personas produce *divergent* turns on a seeded topic (eval, §11) |
| **D4 — decision gate & handoff** | Proposal synthesis → approval card (v1 always-gated) → `run_assignment`; result posts back | a deliberation spawns a real assignment that ships |
| **D5 — template enrichment** | `core` in template persona block, `north_star` in preset; re-author SDLC team; adoption carries cores + north-star (+ test) | adopted SDLC team has non-null cores; deliberations show authored tension |
| **D6 — UI** | deliberation surface, budget meter, proposal/escalation cards, i18n (14 locales) | flagship-quality per Design.md; `/record-demo` |
| **D7 — certification & telemetry** | cert § (graded cooperation evidence into the `docs/test/` bundles), cost stamping, KPI wiring | cert run green; spend attributable |

---

## 11. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| **Bland convergence** (the big one) | Authored divergent cores (§7) + disagreement-licensing prompt + moderator scores divergence; D3 gate requires demonstrable divergence before proceeding; eval Character checks "did the dialogue change the outcome vs a single agent" |
| **Runaway loops (elevated — no turn cap)** | §6 progress model (agenda termination + stall limit) + rate-shaping (≤N turns/tick) + hard cost/idle/quota floors + firebreak boundary + default-OFF flag. Removing the turn budget concentrates this risk on moderator quality → D2 *is* the test surface; D7 eval stress-tests it explicitly |
| **Memory poisoning** | Director-curated write-back only; raw turns never auto-graduate to `persona_memories` |
| **Cost blow-up** | Haiku moderator + batching + hard budgets + capability sub-cap + approval gate when autonomy off |
| **Output theater** | "Feeds the DAG" architecture makes shipping the success condition; D4 gate is "spawns an assignment that ships" |
| **Adoption defects** | Carry `core_profile`/`north_star` through adoption with a regression test (the `persona_event_subscriptions` lesson) |
| **Three-way actor loop** | Strict hierarchy (§6): moderator routes, Athena participates/escalates, Director excluded |

---

## 12. Decisions (resolved 2026-06-25) & remaining tuning

All five original open questions are resolved (see §0.2 decisions 4–8):

1. **Who starts** → user *and* Athena (decision 4).
2. **No turn budget** → bounded by progress + rate-shaping + cost/idle floors (decision 5, §6).
3. **Concurrency** → one channel ↔ one team; one active deliberation per team; concurrent across
   teams (decision 6).
4. **Presence** → whole roster eligible; moderator selects key personas via their cores (decision 7).
5. **Self-promotion** → always gated in v1 (decision 8).

**Remaining tuning (resolve empirically during D2/D7, not blocking D1):** `STALL_LIMIT` (default 3),
`MAX_TURNS_PER_TICK` (default 3), `MAX_CONSECUTIVE_PERSONA_TURNS`, `ESCALATE_ROUND`, the tick
interval (reuse `wake_window`), `cost_budget_usd` default, and the `idle_deadline` window. These are
config constants; D2 ships sensible defaults, D7 tunes them against real deliberations.

---

## 13. Surfaces to keep in sync at build time (per CLAUDE.md doc-sync)

- `docs/features/` — new deliberation feature doc; update `scripts/docs/feature-doc-map.json`.
- `src/features/onboarding/` — if a tour step is warranted (likely at D6).
- `../personas-web/` marketing guide — if a `marketingModule` maps (likely at D6).
- `docs/architecture/team-channel-orchestration.md` — add a "Design D" pointer to this plan.
