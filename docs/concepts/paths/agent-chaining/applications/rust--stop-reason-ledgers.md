---
layer: application
subject: agent-chaining
technique: stop-reason-ledgers
stack: rust
---

# Stop-reason ledgers — chain_stop_reasons

Where the technique lands in this repo:
`src-tauri/db/src/repos/execution/chain_stop_reasons.rs` (the ledger table
and repo) plus the `stop_reason` token module and its writers in
`src-tauri/db/src/chain.rs` (`evaluate_chain_triggers`), rendered to users
by `src/features/agents/sub_executions/detail/chain/ChainTraceView.tsx`.
The module doc states the technique's thesis verbatim: "Before this table,
every non-continuation was silent … Each is now recorded as a row keyed by
`chain_trace_id`, so the Chain tab can render the end-of-chain reason and
an operator can answer 'why did this chain stop?' per distributed trace."

## What conforms

- **Closed, owned vocabulary — with both families.** `chain::stop_reason`
  (`chain.rs:45-92`) defines 15 tokens in one place, resolved to labels via
  `status_tokens.chain_stop` on the frontend
  ([one-authority-per-vocabulary] in practice). Policy reasons —
  `depth_limit`, `predicate_unmet`, `outside_window`, `budget_exceeded`,
  `breadth_exceeded`, `cycle_detected` — sit beside the machinery-side
  family the technique says arrives with operational experience:
  `lookup_failed` (the relay could not even load edges), `publish_failed`,
  `cas_lost` (a concurrent evaluator won the fire — informational),
  `quarantined`, `malformed_config`, `cost_ceiling_corrupt` (corrupt guard
  config fails restrictive, explicitly distinguished from unset), plus
  `handoff_suppressed` (the dual-driver stand-down recorded as a typed
  stop, not a silent skip) and the healing-abandonment pair.
- **Records carry evidence and coordinates.** Each row holds
  `chain_trace_id`, `link_execution_id`, optional `trigger_id` and
  `target_persona_id` (None for whole-cascade halts like the depth
  ceiling), `reason_token`, free-text `detail` ("chain depth 8 reached
  limit 8", cost vs ceiling), and `chain_depth`
  (`chain_stop_reasons.rs:25-49`) — the "answerable entirely from the
  ledger row" bar.
- **Written at the decision point.** Every non-continuation path in
  `evaluate_chain_triggers` calls the one `record_stop` closure
  (`chain.rs:245-269`) — depth (`:271-288`), lookup failure (`:295-300`),
  corrupt/exceeded cost ceiling (`:318-368`), breadth (`:381-420`),
  window, malformed config, suppression, cycle, predicate, CAS — one
  writer, exhaustively placed.
- **User-facing, in the user's vocabulary.** `ChainTraceView` renders the
  chain per `chain_trace_id` with total cost, a `partial` flag, and each
  stop reason through `tokenLabel(t, 'chain_stop', reason.reason_token)` —
  the leaf-level "why it stopped" the technique demands, plus the honest
  partial-rollup labeling that chain-identity-and-rollup prescribes.

## Where it deviates from the standard (kept, reported)

- **Best-effort writes.** A failed ledger insert is warn-logged and
  swallowed ("a lost audit row must never fail a cascade",
  `chain_stop_reasons.rs:63-65`, `chain.rs:262-267`) — a deliberate
  availability trade against the technique's same-transaction rule. The
  cost is exactly the one the technique predicts: a lost row re-creates
  stopped/stuck ambiguity for that link.
- **No happy-path record.** A leaf whose persona simply has no chain
  triggers returns early (`chain.rs:306-309`) with nothing written —
  "completed" is the absence of a row, not a written reason. Stopped-by-
  completion and stuck therefore still render identically unless the
  reader cross-references outgoing wiring.
- **Unevaluable collapses into `predicate_unmet`.** An unknown condition
  type and an unresolvable path expression both return `false` from
  `evaluate_predicate` (`chain.rs:1023-1075`) — honestly fail-closed and
  loudly warn-logged (the comment names "silent non-firing is the worst
  failure mode"), but the *ledger* token is the same `predicate_unmet` a
  legitimate not-fired verdict gets. The unevaluable/not-fired distinction
  lives only in logs, not in the queryable vocabulary.
- **Only traced chains get a ledger.** `record_stop` no-ops when the hop
  carries no `chain_trace_id` (`chain.rs:249`) — an untraced relay's stops
  remain silent by construction.
