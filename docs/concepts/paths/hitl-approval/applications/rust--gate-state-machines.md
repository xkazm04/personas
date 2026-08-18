---
layer: application
subject: hitl-approval
technique: gate-state-machines
stack: rust
---

# Gate state machines in the build-session interviewer (Rust)

The repo's cleanest specimen of "the gate lives in the substrate, not the
prompt" is `src-tauri/src/engine/build_session/gates.rs`. The build prompt's
Rule 16/17 instructs the LLM to ask a clarifying question before resolving
any gated capability field — and the module header states the measured
reality: "In practice Sonnet 4.x treats the rule as advisory and jumps to
resolution" (`gates.rs:3-8`). The response was not a sterner prompt; it was a
state machine on the Rust side that makes the rule structural.

## The FSM

`Gate` is a three-state enum — `Closed`, `Pending`, `Open` (`gates.rs:30-36`)
— held per capability across five gated fields (`CapabilityGates`,
`:38-51`): trigger, connectors, review_policy, memory_policy, sample_output.
The transitions match the technique's asymmetry exactly:

- the machine may only move a gate toward asking: `mark_pending` refuses to
  touch anything but `Closed` (`:71-83`);
- only a **user answer** flips a gate `Open` — the answer handler maps the
  UI's answered cell back to the field (`legacy_cell_to_v3_field`,
  `:142-154`) and calls `mark_open`;
- the executor consults recorded state, not the model's claim: out-of-order
  `CapabilityResolutionUpdate` events for unopened gates are **suppressed**,
  and `find_first_unopen_gate` (`:964-976`) blocks `agent_ir` emission while
  any gate is unopen — the model cannot narrate its way past the checkpoint.

Two paths harden the door against the gated party's own behavior:
`ensure_capability_in_coverage` (`:902-910`) lazily seeds gates for a
capability the LLM resolved *without ever enumerating* — "an LLM that skips
enumeration … bypasses the gate entirely" is closed off — and when the LLM
skips the question itself, the module **synthesizes** the clarifying question
locally (`synthesize_gate_question`, `:1125+`), so the human-facing surface
never depends on the model cooperating.

## Consent already spoken, conservatively read

`gate_seed_for_intent` (`:747-756`) implements the consent-gates rule that an
instruction can carry its own answer: "every morning" auto-opens the trigger
gate; "no review needed" auto-opens review policy. The heuristics are
explicitly conservative — "when in doubt, ask" (`:159-160`) — and the
2026-05-04 regression note (`:266-273`) records the cost of over-opening: a
shortcut that flipped all four gates open dropped users into testing with an
uninterviewed design, and was removed even though it "paced" better.

The ambiguity guard is the sharpest detail.
`intent_implies_connectors_with_ambiguity` (`:590-632`) re-closes the
connectors gate when the intent names a service with 2+ stored credentials —
even though the keyword matched — because pre-fix the runtime picked a
credential "deterministically but arbitrarily" and "the user never knew which
credential their persona was using until they checked the audit log"
(`:577-588`). A keyword match is not an answer when the answer is ambiguous.
The 2026-05-06 fix note (`:598-602`) goes further: *any* ambiguous service in
a multi-service intent forces `Closed` — the scan does not stop at the first
clean match.

## Batched asks

`synthesize_all_unopen_gates` (`:1038-1083`) is the batching rule with its
own incident report attached: the pre-fix synthesizer fired one question per
turn, producing "two-minute gaps between questions for what should have been
a single batch" (`:1017-1024`). The batched path walks the canonical gate
order, skips `Open` and already-`Pending` gates, and marks each emitted gate
`Pending` so the same call cannot re-fire it — questions batch; each answer
still flips exactly one gate.

## Where it deviates from the standard

The gate state lives in a per-session in-memory map
(`HashMap<String, CapabilityGates>` threaded through the runner), not in
durable storage — a crash mid-interview loses the pending state. Defensible
for a synchronous interview where the human is present at the keyboard, but
it means this gate answers on interactive time only; the durable-pending
requirement is carried elsewhere in the repo (`pending_trigger_fires`,
`persona_manual_reviews`).
