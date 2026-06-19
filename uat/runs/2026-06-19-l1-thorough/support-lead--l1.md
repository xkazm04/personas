# Yuki Tanaka — Customer-Support Lead — L1 report

**Character:** `support-lead` (Yuki Tanaka) · semi-technical · Team tier · promotion: discovery
**Level:** L1 (theoretical, code-grounded). No live app. Surfaces modeled from source; every claim carries `file:line` + a `code_check`.
**Reachable set:** Personas, Events (triggers), Overview → manual-review + messages + knowledge, Templates. NOT Dev Tools / Engine / BYOM / Admin.
**Run slug:** `2026-06-19-l1-thorough/support-lead`

Yuki's lens is narrow and unforgiving: *what's the confidence, and what happens on a miss?* She'll forgive a clunky form. She will not forgive (a) anything that auto-sends to a customer without a gate, or (b) a review step that teaches the agent nothing. Both of those are the spine of this run.

---

## Journey 1 — `set-trigger-automate` (Make it run on its own)

**Verdict: `L1-pass`**

### Surface model (affordance → handler → command → engine)
- Events → Triggers tab. Each trigger renders as `TriggerListItem` → `TriggerRow`. The enabled state is a literal green/grey toggle: `ToggleRight` (emerald) vs `ToggleLeft` (grey), with an `enable_item`/`disable_item` tooltip — `src/features/triggers/sub_triggers/TriggerRow.tsx:53-57`. `code_check: present` — "is this on?" is legible at a glance without expanding the row.
- Toggling calls `onToggleEnabled(trigger.id, trigger.enabled)` (`TriggerRow.tsx:48`), threaded up through `TriggerListItem` (`TriggerListItem.tsx:65`).
- Schedule legibility: interval triggers render `SchedulePreview` with "First run: {time} then every {interval}" plus a 5-dot timeline (`TriggerSchedulePreview.tsx:41-99`); cron triggers render `CronSchedulePreview` with a human-readable cron `description` + "Next run: {local time}" (`TriggerSchedulePreview.tsx:101-160`). `code_check: present`.
- Next-fire is **real**, not a saved-form illusion: the cron preview's `next_runs` come from the backend `preview_cron_schedule` command, which parses the cron with a per-trigger seed and computes fire times timezone-aware via `next_fire_time_in_tz` / `next_fire_time_local` — `src-tauri/src/commands/tools/triggers.rs:734-778` (struct `CronPreview { description, next_runs }` at :739-742). Validation rejects an unparseable cron with a "Cron syntax" error before save (`triggers.rs:241-313`). `code_check: present`.

### Cognitive walkthrough (as Yuki)
1. Right effect / right affordance — yes; a labelled toggle + a tabbed Events surface is the obvious move for a non-dev.
2. Connect affordance to effect — yes; emerald toggle = armed, the preview tells her *when* it'll fire next in her local time. That's exactly the reassurance she wants ("trust it'll run").
3. Feedback after acting — the preview re-renders on config change; cron is validated server-side.

### Rubric scoring
- completion: **pass** — she can arm a schedule/event trigger and read its armed/next-fire state.
- effort: **pass** — collapsed row + expand-to-configure is low-friction.
- clarity: **pass** — green/grey + "Next run" in local time is the legibility the journey demands.
- trust: **pass** — next-fire is computed from the real cron engine, not faked.
- missing: **pass** — both schedule and event triggers reachable (the tab set includes Triggers/Chains/Subscriptions).
- time-saved: **pass** (structural) — this is the "I stop doing it" lever; the actual fire is `l2_priority`.
- senior-quality: n-a at L1 (no AI output in this journey).

**Why not a finding:** nothing here threatens her core fear. Triggers fire *runs*, and the runs route customer-facing output through the review gate audited in Journey 2 — so arming a trigger does not arm an auto-send.

**`l2_priority`:** confirm a trigger actually fires and produces a run, and that the "next run" wall-clock is accurate to the tick (Journey-1 L2 checklist).

---

## Journey 2 — `run-and-review-execution` (Run, read the result, handle a review)

**Verdict: `L1-pass`** (with two `minor` clarity findings + one `l2_priority` on whether the loop changes behavior in practice)

This is Yuki's make-or-break journey, so I traced both her core lenses to the engine.

### A. Confidence-gate audit — does a low-confidence / customer-facing result route to review instead of auto-sending?

**The architecture is default-safe, but the gate is prompt-enforced, not a numeric runtime threshold.**

- The agent itself decides to route to a human by emitting a `manual_review` protocol message; the engine then writes a `persona_manual_reviews` row with `status='pending'` — `src-tauri/src/engine/dispatch.rs:513-619`. `code_check: present`.
- The decisive instruction: **"manual_review is REQUIRED whenever your run produces an actionable external change that the user should approve before it ships — drafting a reply email, generating a customer-facing proposal, classifying a lead…"** — `src-tauri/src/engine/prompt/templates.rs:196`. The suggested actions are explicitly `Approve & send / Reject / Edit first` (`templates.rs:200`). `code_check: present`. There is **no "send to customer" protocol message** in the output protocol (`ProtocolMessage` variants, `protocol.rs:184-195`); customer delivery only happens through tools the agent invokes, and the prompt funnels the deliverable into a review first. So a customer-facing draft is **default-NOT-sent** — it lands in the human queue.
- The review **policy** is per-capability (`ReviewPolicy`): `off` (drop), `on` (human queue — the default, `dispatch.rs:1116` "Default ReviewPolicy::On"), `auto_triage` (a second-pass LLM evaluator judges and resolves), `trust_llm` (store-and-auto-resolve). The build-LLM maps `review_policy.mode: "on_low_confidence"` → `ReviewPolicy::On` — `dispatch.rs:1108-1116`. `code_check: present`.

**Finding F1 (clarity / trust, minor, `confirmed-absent` of a numeric signal).** Yuki asks "what's the *confidence*?" The word "confidence" exists in the protocol only on `knowledge_annotation` and `propose_improvement` (`parser.rs:522`, `:532-535`; `templates.rs:165-174`), **not on `manual_review`**. The `KnowledgeAnnotation` confidence is even discarded at dispatch (`confidence: _`, `dispatch.rs:946`). So there is no numeric confidence score on a routed review and **none is shown in the review UI** (`ReviewDetailPanel.tsx` renders severity + context, never a confidence number). The gate is the agent's qualitative judgment expressed as `severity` (info/medium/high), not a calibrated threshold she can tune or audit. For Yuki this is a *clarity* gap, not a blocker — the default-safe posture (don't auto-send; require approval) is exactly what she wants — but she can't answer her own headline question quantitatively, and she can't set "anything below X routes to me."
  - `code_check: confirmed-absent` (no confidence field on the review path / UI).

**Finding F2 (trust, minor, `by-design`).** The gate that keeps a customer-facing draft out of auto-send is **prompt policy**, not a hard runtime interlock. `trust_llm` and `auto_triage` policies *do* auto-resolve reviews without a human (`dispatch.rs:638-683`) — and `auto_triage`'s evaluator can flip a review to `Approved` on its own. A capability configured to `trust_llm` would let the agent's customer-facing output ship without Yuki ever seeing it. The default is `On` (safe), and Team tier can't reach the Engine/BYOM dev surfaces that might expose these knobs — so for *her reachable configuration* the safe default holds. But "auto-send is gated" is a default + a prompt convention, not an enforced invariant. She would want this surfaced ("this capability is set to auto-approve — turn off?").
  - `code_check: present-but-missed` (the auto-resolve paths exist and are reachable via capability config, just not via her tier's primary UI).

### B. Learning-loop audit — does accept/reject feed memory / improve the agent, or dead-end?

**This is the strongest part of the build for Yuki, and it is genuinely wired end-to-end — not a dead-end.**

1. **Decision is recorded + memorized.** Approve/Reject in `ReviewDetailPanel` (`ReviewDetailPanel.tsx:305,318`) carries `reviewer_notes` into `update_manual_review_status` → `manual_reviews::update_status`. On a terminal status the repo **writes a learning memory**: team personas get a shared `team_memories` row (approved → `decision`/imp-7, rejected → `constraint`/imp-8, deduped by title); solo personas get a per-persona `learned` memory — `src-tauri/src/db/repos/communication/manual_reviews.rs:267-435`. `code_check: present`.
2. **Learning is visible + correctable.** `update_status` returns a `LearnedMemoryRef`; the command emits `MANUAL_REVIEW_RESOLVED` with it (`commands/design/reviews.rs:1093-1102`); a global listener raises a **"Learned: {title}"** success toast with a **View** action that deep-links to the editable Knowledge/memories surface — `src/lib/eventBridge.ts:447-473`. `code_check: present`. This directly answers her pet peeve "a review step that doesn't teach the agent anything."
3. **THE behavior change — the loop actually feeds the next run.** `manual_reviews::get_recent_resolved` (`manual_reviews.rs:168-187`) is **called by the runner**: `src-tauri/src/engine/runner/mod.rs:797` pulls the last 14 days / 5 resolved reviews and injects a **"## Prior Human Feedback — Apply These Decisions … Repeat what was approved; do NOT repeat what was rejected"** block into the next execution's prompt (`runner/mod.rs:792-827`). The window keys on `resolved_at`, so a review she approves today reaches the loop even if it was opened weeks ago (tested: `manual_reviews.rs:880-897`). `code_check: present`. This is the single most important line for Yuki — the loop is not cosmetic; it changes the prompt the agent runs next.
4. **Resume + carry-out.** For a *blocked* team step, approval resumes the held assignment (`react_to_review_decision`, `reviews.rs:1141-1225`); for an *advisory* review, picking a suggested action dispatches a follow-up run that carries it out (`dispatch_review_action`, `reviews.rs:1235-1283`). Both paths publish `review_decision.*` and bridge it to the team channel. `code_check: present`.

### Output legibility (find the result, success vs failure)
- Reviews carry persona identity, severity indicator, relative time, markdown-rendered content, context preview, a link back to the execution, and a conversation thread — `ReviewDetailPanel.tsx:104-271`. Multi-item reviews get per-decision accept/reject with accept-all/reject-all (`:152-222`). `code_check: present`. A senior support lead can read a draft, edit it inline via the reply box, and approve — exactly the "drafts her team approves with light edits" workflow.

### Cognitive walkthrough (as Yuki)
1. Right effect — yes; run a persona, find its output in Overview, handle the flagged ones.
2. Right affordance — yes; the manual-review inbox + Approve/Reject/Edit is the obvious control.
3. Connect to mental model — strong; "Approve & send / Reject / Edit first" is literally her macro-and-escalate workflow.
4. Feedback — strong; the "Learned: X" toast is the receipt she's been missing in every other "AI support" tool she's distrusted.
5. AI surface grounded + senior-quality — **deferred to L2.** The wiring guarantees the *loop closes*; it cannot prove the *draft quality* meets her senior bar.

### Rubric scoring
- completion: **pass** — execute → find output → handle review → decision respected & remembered, end to end.
- effort: **pass** — inbox + 2-button decide + inline edit; number-key shortcuts for suggested actions.
- clarity: **partial** — review legible, BUT no confidence number and no surfacing of which capabilities auto-resolve (F1, F2).
- trust: **partial** — default-safe (don't auto-send) is real; the gate is prompt+default, not a hard invariant (F2).
- missing: **pass** — the learning loop she demands is present and wired to the next run.
- time-saved: **pass** (structural) — drafts + triage + learning loop is the half-the-first-response lever.
- senior-quality: **`l2_priority`** — output quality vs a senior agent is unprovable at L1.

**`l2_priority`:** (1) Does the injected "Prior Human Feedback" block *measurably* change the next draft (the loop changing behavior, not just appending text)? (2) Is a real low-confidence/ambiguous customer case actually routed to review by the agent's own judgment, or does it sometimes charge ahead? (3) Draft quality against the senior bar (correct, empathetic, on-policy, no hallucinated account facts). (4) Confirm the "Learned" toast fires on a real resolution and the memory is editable.

---

## Findings

| # | Type | Severity | Title | Evidence | code_check | reachable |
|---|---|---|---|---|---|---|
| F1 | quality-gap / trust | minor | No numeric confidence on routed reviews; she can't answer "what's the confidence?" or set a threshold | `manual_review` protocol has no confidence field (`templates.rs:105`, `:196`); confidence exists only on knowledge/improvement and is discarded at `dispatch.rs:946`; UI shows severity not confidence (`ReviewDetailPanel.tsx:113-114`) | confirmed-absent | yes |
| F2 | trust | minor | "Auto-send is gated" is a default + prompt convention, not a hard invariant; `trust_llm`/`auto_triage` capabilities auto-resolve with no human, and the UI doesn't warn her | `dispatch.rs:638-683` (auto-resolve paths); default On at `dispatch.rs:1116` | present-but-missed | partial (config-reachable, not her primary UI) |
| S1 | strength | — | Learning loop closes AND feeds the next run — the runner injects prior approved/rejected decisions into the next prompt | `runner/mod.rs:792-827` calling `manual_reviews.rs:168-187` | present | yes |
| S2 | strength | — | Resolution is visible + correctable — "Learned: X" toast deep-links to an editable memory | `eventBridge.ts:447-473`; `reviews.rs:1093-1102` | present | yes |
| S3 | strength | — | Default-safe posture: customer-facing deliverables route to a human review by prompt policy; no direct "send" protocol message exists | `templates.rs:196,200`; `protocol.rs:184-195` | present | yes |
| S4 | strength | — | Trigger armed/next-fire is legible and real (green toggle + backend-computed next-run timeline) | `TriggerRow.tsx:53-57`; `TriggerSchedulePreview.tsx:101-160`; `triggers.rs:734-778` | present | yes |

No blockers. No majors. Both journeys are structurally sound for Yuki.

---

## What passed

- **The learning loop is real, not theater** (S1, S2). Accept/reject writes a typed memory, surfaces it as a "Learned" toast, makes it editable, and — critically — the runner reads recent resolved reviews back into the next execution's prompt. This is the one thing every "AI support" tool Yuki has distrusted *failed* to do, and it's wired here at `runner/mod.rs:797`.
- **Default-safe customer posture** (S3). Nothing auto-sends to a customer by default: the agent produces a draft + a `pending` review, and the prompt explicitly requires routing customer-facing changes to a human with `Approve & send / Reject / Edit first`. Reviews don't block the run, but the *customer-facing artifact* doesn't ship without her approval.
- **Triggers are legible** (S4). She can tell armed from disarmed at a glance and see a real, timezone-aware next-fire — she'll believe it runs unattended.
- **Drafts are send-ready-with-light-edits shaped** — the review panel renders the draft as markdown, lets her edit via reply, shows context, and links to the execution. That's the senior workflow, pending only the L2 quality check.

---

## Character voice

> The thing I actually came for is here, and that surprised me. When I approve a draft, the app tells me "Learned: …" and I can click through and *fix* the lesson — and they didn't fake it, the next run literally gets a "do what the human approved, don't repeat what they rejected" block stitched into its instructions. That's the loop I've never seen a support tool close. And nothing goes out to a customer behind my back by default — the agent writes the draft and hands it to me with Approve / Reject / Edit. I can live with that.
>
> My one nag: when I ask "what's the confidence?", the app answers with a severity badge, not a number. I can't set "anything the agent is unsure about, send to me" — I'm trusting its judgment about its own judgment. And if someone on my team flips a capability to "trust the LLM," its replies could ship without ever hitting my queue, and the screen wouldn't warn me. Give me a confidence number on the card and a loud banner when a capability is set to auto-approve, and I'd hand this the overnight queue. As is, I'd run it on the day shift, watch the first week of drafts against my senior bar, and measure whether first-response actually halved before I trust it unattended.

---

### L1 limits (stated honestly)
This is a code-grounded thought experiment. I verified the *plumbing* — that low-confidence-by-judgment routes to a human, that accept/reject writes memory and feeds the next prompt, that triggers compute a real next-fire. I did **not** verify the two things that would actually decide adoption for Yuki: that the agent's *drafts* meet a senior support bar, and that the injected feedback *changes behavior* rather than just lengthening the prompt. Both are tagged `l2_priority`.
