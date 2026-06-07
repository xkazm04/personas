# Team Channel Orchestration — "C-on-B" multi-author design

Status: **DECIDED — ready to build** (2026-06-07; open questions resolved by the user, see §8). Design B (the Collab
living chat: channel read-model + acknowledged directives) is SHIPPED; this
doc defines the Design C scope — a relay chat where **all orchestration
actors write and listen** — against what the codebase actually has.

Companion docs this builds on: [`athena-team-orchestration.md`](../features/companion/athena-team-orchestration.md)
(post-run reconciliation seam), [`athena-decision-layer-plan.md`](../features/companion/athena-decision-layer-plan.md)
(approval executor), [`conversation-orchestration.md`](../features/companion/conversation-orchestration.md)
(mid-turn capability inventory). Channel v1: [`docs/features/pipeline/README.md`](../features/pipeline/README.md)
→ *sub_collab*.

---

## 1. The actors and their existing machinery

Four participant classes interact with a team's work today, through disjoint
surfaces:

| Actor | Writes today | Listens today |
| --- | --- | --- |
| **User** | Channel directives (`post_team_directive`), review resolutions (`resolve_team_assignment_review`: skip/abort/edit/reassign), assignment creation, goal authoring | Collab Live, Red Room, Flight Deck board, Approvals inbox |
| **Team personas** | Result summaries, bus events (`persona_events`), team memories, protocol verbs (e.g. the Strategist's `{"triage": …}` in `idea_scanner.rs`) | Step input (`user_directives`, `predecessor_outputs`, `rework_feedback`) + prompt blocks (`team_context`: alignment, standards, USER DIRECTIVES) |
| **Athena** | `companion_assign_team` (source='athena', `companion_op_id` → OperativeMemory; routes through the C3 **approval executor** when autonomous), proactive nudges, decision log | Post-run reconciliation — **designed seam, not yet built**; MCP request panel (inbound from fleet sessions); D7 orchestration digest |
| **Director** | `DirectorVerdict`s (scores + coaching recommendations) → `director_verdicts` table — **dead-ends in the Overview UI**, never reaches the coached persona's work | Post-hoc `gather_context` over executions; no live awareness of team runs |

The gap is not capability — each actor has an engine. The gap is that there is
**no shared medium**: the user talks through the channel, Athena through
OperativeMemory, Director through a report table, personas through the bus.

## 2. Doctrine constraint (do not relitigate)

`athena-team-orchestration.md` codifies the division of labour: **no LLM in
the orchestrator tick loop**. The deterministic orchestrator is plumbing —
predictable, cheap, 1s ticks. The 2026-06 autonomy campaign reinforced this
the hard way: free event chatter as coordination produced subscriber-less
telemetry (767 dead `task_completed`/wk), bounce storms, and stalls (G4,
W1–W3). Any C design that makes dialogue the *control plane* re-opens that.

**Therefore: C-on-B.** The dialogue is a *communication* plane over the
deterministic *execution* plane. Channel messages inform steps (injection at
step boundaries); they never sequence them.

## 3. The C-on-B architecture

One channel per team; four author kinds; every actor keeps its engine and
gains a thin adapter.

### 3.1 Message schema (graduates directives out of `team_memories`)

```sql
CREATE TABLE team_channel_messages (
  id            TEXT PRIMARY KEY,
  team_id       TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
  author_kind   TEXT NOT NULL,        -- 'user' | 'athena' | 'director' | 'persona'
  author_id     TEXT,                 -- persona id when author_kind='persona'/'director'
  body          TEXT NOT NULL,
  addressed_to  TEXT,                 -- JSON array of persona ids; NULL = whole team
  reply_to      TEXT,                 -- threading (message id)
  assignment_id TEXT,                 -- optional anchor to a mission
  consumer      TEXT NOT NULL,        -- 'inject' | 'mention' | 'display' (see §5)
  deliveries    TEXT,                 -- JSON [{step_id, persona_id, at}] receipts
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The `list_team_channel` read-model gains one source branch; existing
`category='directive'` memories migrate (or are dual-read during transition).

### 3.2 Write adapters

- **User** — `post_team_directive` re-targets the new table (UI unchanged).
- **Personas** — a `{"channel_post": {text, reply_to?, mentions?}}` protocol
  verb parsed from step outputs, exactly like the Strategist triage verb.
  Opt-in per use case; **first wave (decided): Implementer (Dev Clone), QA
  Guardian, Architect** — the three roles whose acknowledgments and questions
  carry the most coordination signal. This is the persona *reply* path —
  acknowledging directives, asking the channel, announcing.
- **Athena** — `companion_post_team_message(team_id, body, addressed_to?)`.
  Interactive use posts directly. Autonomous use is **free (no approval gate)
  when the relevant `autonomous_*` setting is on** (decided — mirrors review
  triage); with autonomy off, posts route through the approval executor.
  Rate caps (§5) are the backstop either way.
- **Director** — on verdict insert, if the persona is a team member: post the
  recommendation into that team's channel, `author_kind='director'`,
  `addressed_to=[persona]`, `consumer='inject'`. Coaching finally reaches the
  coached work.

### 3.3 Listen adapters

- **Personas** — step-boundary injection widens from "user directives" to
  "channel messages addressed to me or the team since my last step"
  (windowed, capped — same cost guardrail as today's USER DIRECTIVES block).
  Receipts written per delivery, as shipped.
- **Athena** — (a) build the designed post-run reconciliation hook with its
  output going INTO the channel (terminal assignment → summary message,
  author='athena') as well as OperativeMemory; (b) `@athena` mentions route
  to `setPendingPrompt` — the user summons her inside the team conversation.
- **Director** — (a) `gather_context` gains the channel slice for team-scoped
  runs; (b) **decided:** scheduled batches AND a rework-storm / failure-burst
  heuristic on channel traffic both trigger focused `runDirectorOnPersona`
  runs (rate-limited).
- **User** — Collab Live renders all four author kinds (styling per kind);
  Red Room's Transcript becomes a raw lens over the same read-model (§6).

## 4. Interrupt semantics — the honest line

A running execution is a non-interactive CLI subprocess; **mid-turn input is
not possible** (`conversation-orchestration.md` capability inventory). C's
"interrupt" therefore means:

1. **Step-boundary delivery** (shipped) — a message lands in the next step.
2. **Soft-pause** (new, C4) — user/Athena flags an assignment
   `pause_requested`; the orchestrator finishes in-flight steps but launches
   no new ones until resumed (mirrors `awaiting_review` mechanics). The C
   mock's "pause at checkpoint" maps to exactly this.
3. **Abort** (exists) — unchanged.

## 5. Governance — the G4 lesson applied

- **Defined-consumer rule:** every message declares `consumer`:
  `inject` (reaches step input/prompt), `mention` (routes to an actor),
  or `display` (human-only). No subscriber-less chatter class again.
- **Author rate caps per assignment:** Athena and Director each ≤ N posts
  per assignment (start N=3); persona `channel_post` ≤ 1 per step.
- **Loop prevention:** Director reacts only to `persona` traffic; Athena
  never reacts to Director posts (and vice versa) — the rate caps bound any
  residual feedback through persona replies.
- **Cost guardrail:** injection window stays recency- and length-capped
  (today: 5 newest / 14d / 240 chars per line).
- **Retention:** channel messages TTL-pruned with the run history.
  **Decided:** channel slices ARE exported into the certification bundles
  (`docs/test/` harness) as graded cooperation evidence — retention must
  outlive the eval window of any in-flight cert campaign.

## 6. Surface impact summary

| Surface | Impact |
| --- | --- |
| **Teams / orchestrator** | + messages table, + injection widening, + soft-pause flag. Tick loop untouched. |
| **Collab (sub_collab)** | Author-kind styling, threading (reply_to), mention autocomplete, pause button. The C mock tab retires once real. |
| **Red Room (sub_redRoom)** | **Stays a separate surface for now (decided)** — likely converges into one Channel surface later. C1 only re-points its Transcript at the unified read-model so both surfaces show identical data; no folder fold-in yet. |
| **Athena (companion)** | + `companion_post_team_message`, + reconciliation hook (channel-targeted), + @mention → pendingPrompt. Autonomy gated by the existing approval executor. |
| **Director (sub_director + engine)** | + verdict→channel bridge (addressed coaching with receipts), + channel-aware context, + traffic-triggered focused runs. The Overview UI keeps the analytics; the channel carries the coaching. |

## 7. Phasing

| Phase | Scope | Effort |
| --- | --- | --- |
| **C1** | ✅ **DONE** — messages table + author model + read-model branch + persona `channel_post` verb (Implementer/QA/Architect) + multi-author UI; Red Room sources channel-native rows via the unified read-model (commits 6c06eecbc, 517109a58, 5e209b247) | ~1 week |
| **C2** | ◑ **PARTIAL** — write adapter (companion_post_team_message + post_team_message approval op on the autoapprove allowlist) + @athena composer summon DONE; LLM reconciliation→channel deferred (needs a real async Athena turn) | ~1 week |
| **C3** | ✅ **DONE** — Director bridge (verdict→channel addressed+injected with receipts, channel-aware context digest, opt-in storm-trigger subscription) | days |
| **C4** | Soft-pause (orchestrator flag + UI) | days |
| **C5** | **Flagship UI polish** (§9) — header band, author voice, threading, intervention affordances, demo | ~1 week |

## 8. Decisions (resolved 2026-06-07)

1. **Athena autonomy** — free (no approval gate) when the relevant
   `autonomous_*` setting is on; approval-gated otherwise. Rate caps remain.
2. **Director triggers** — both: scheduled batches AND channel-traffic storm
   triggers (thresholds tuned during C3; start conservative).
3. **Persona reply scope** — first wave: Implementer (Dev Clone) + QA
   Guardian + Architect.
4. **Surface identity** — Red Room and Collab stay SEPARATE for now (likely
   one "Channel" surface later); C1 unifies only the read-model underneath.
5. **Certification** — yes: channel slices enter the cert bundles as graded
   cooperation evidence.

**Build order:** ~~C1~~ ✅ → ~~C3~~ ✅ → C2 ◑ (write+summon done;
reconciliation deferred) → **C4 (soft-pause, next)** → C5 (flagship polish).

## 9. C5 — flagship UI polish (final phase)

Once the channel is functionally complete (C1–C4), one dedicated phase turns
it from "a working feature" into a **flagship surface** — the component we
demo. Scope (calibrate against `.claude/Design.md` tokens + the most polished
existing surfaces, e.g. the questionnaire adoption flow):

- **Identity & header band** — a real channel header (team crest, live member
  presence with role colours, mission context, run/cost glance) instead of the
  utilitarian strip; decorative-but-restrained background per Design.md (no
  always-on motion — entry/hover/click-gated only).
- **Author voice** — each author kind reads distinctly at a glance: user
  (right-aligned directive), persona (avatar + role colour), Athena (companion
  sigil + her accent), Director (coaching ribbon). Threading (`reply_to`)
  rendered as indented sub-conversation, not flat rows.
- **Live texture** — typing/working indicators from presence, message
  entry animation (the shipped fade-slide, once-on-mount only), receipt
  transitions (✓ → ✓✓), a "new messages" jump-to-latest pill when scrolled up.
- **Intervention affordances** — review gates and the soft-pause control as
  first-class inline cards (reuse the Flight Deck StepRelay intervention row),
  `@mention` autocomplete in the composer, quick-directive chips.
- **Empty/onboarding state** — a designed first-run state (what the channel is,
  how directives steer the team) using `feedback/EmptyState`, not a bare line.
- **Density & a11y** — typography per Design.md (no sub-`text-sm` body, no
  pixel sizes), keyboard nav through messages, reduced-motion honoured, full
  i18n extraction (the prototype's raw strings graduate here).
- **Record a demo** — close the phase with `/record-demo` so the flagship has
  a walkthrough.

This phase is a `/prototype` candidate in its own right: treat the polished
channel as a pillar component and iterate directional variants of the header +
message-row treatment before consolidating.
