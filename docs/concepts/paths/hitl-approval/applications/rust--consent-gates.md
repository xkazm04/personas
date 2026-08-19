---
layer: application
subject: hitl-approval
technique: consent-gates
stack: rust
---

# Consent gates in the companion lane and the autonomy front door (Rust)

The machine-asks-human flow runs through three layers in this repo: an
allowlist that decides what may even become a question, a per-trigger
autonomy dial with a held-fire queue, and one fail-closed function that
answers "may this act unattended at all".

## Allowlist first: what may become a question

`src-tauri/src/companion/dispatcher.rs` scans assistant output for op JSON
blocks and persists them as approval rows in `companion_approval` — but only
ops on `ALLOWED_ACTIONS` (`dispatcher.rs:239`) ever become approval cards; an
unknown action is dropped, not asked about. The read-only exemption is by
design and defended in comments that anticipate the misreading: read-only
connector capabilities auto-fire "no approval card — friction the user
explicitly [declined]" while "write/mutation capabilities
(`ConnectorCapability::requires_approval`) route through an approval card"
(`:276-282`, `:1848-1857`) — and the comment at `:281-282` warns against
reading "no approval card" as "writes fire unattended": the invariant is
locked by the test `every_write_capability_requires_approval`. Pure UI
navigation (`open_route`, `open_lab`) bypasses approval because "the user
already asked" (`:35-42`) — the manual-invocation-is-the-consent rule.

This is the technique's default posture realized: closed by construction
(allowlist, not blocklist), consequence-tiered (reads free, writes gated),
and the disclosure derives from the bound op envelope the executor will run,
not from the assistant's prose — the op JSON is stripped from the chat text
and the card renders in its place (`:13`).

## The autonomy dial, per trigger, with a held-fire queue

`set_trigger_unattended_mode` (`src-tauri/src/commands/tools/triggers.rs:160-170`)
sets a three-position dial per trigger — `auto` | `dry_run` | `approval` —
enumerated contracts, not a vague "balanced": fire normally, fire with
outbound suppressed (simulation), or hold for approval. In `approval` mode a
fire lands in `pending_trigger_fires` and surfaces in
`src/features/triggers/sub_triggers/PendingTriggerApprovals.tsx`;
`UnattendedModeSection.tsx` is the dial's UI, and its own comment declines to
render the control for trigger types the backend does not honor — "surfacing
a control the backend doesn't honor would be a worse (lying) signal".

The resolution path (`resolve_pending_trigger_fire`, `triggers.rs:184-224`)
is the decision-write discipline in miniature: the pre-check on `pending`
status is documented as "NEVER what authorises the publish" (`:190-193`);
only the compare-and-swap in `resolve_pending_fire` picks a single winner,
and the held event is published **gated on `won_cas`, not on the caller's
`approved` flag** — "without this gate, a losing concurrent call would still
publish from its own stale intent, firing an approval-gated automation twice
from one click" (`:202-206`). A lost CAS to the same verdict returns the
resolved row as success (`:220-223`): the human's approval *was* recorded,
just by the other delivery.

## One fail-closed front door

`src-tauri/engine/src/autonomy.rs` answers "may this act unattended, for
this project" once, for 13 named `Action`s. `global_enabled` reads
`== Some("true")`, so a missing row, a corrupt value, and a database error
all resolve to `false` — fail-closed by construction. Per-project modes
parse with `unwrap_or(AutopilotMode::Off)` so "a garbled row can never widen
autonomy past the global flag". The keys never leave the module
(`Action::global_key()`), and the precedence rule is unit-tested. Turning
the dial down is one settings write that the very next tick reads.

The measured caveat (from the legacy autonomy-gating audit) is the standard's
ceiling rule inverted: all 17 autonomy switches default `false`, but the
dollar ceilings default to "unlimited" (`0`/`None` = no limit) — the
accelerator fails closed and the brake fails open. A consent grant without a
default ceiling is exactly the unbounded trust the unattended-mode technique
exists to prevent.

## The counterexample: a re-ask that overwrites a refusal

`src/features/shared/components/overlays/FirstUseConsentModal.tsx:141-151`
is why the technique's re-ask rule exists. On a consent-version bump the
modal re-opens, initializes its telemetry checkbox from a literal
(`useState(true)`, never reading the stored answer), and `handleAccept`
persists whatever the checkbox says — so a user who refused telemetry and
then upgrades has the refusal overwritten by a click on a button that never
mentioned telemetry. Shipped history shows the bump has happened twice, once
to fix a hyperlink. The paired read (`telemetryPreference.ts:17`) returns
`true` from its own `catch` — a consent read failing *open*. Both defects
are one-line violations of rules the technique states: pre-fill every
control from the stored answer, and fail every consent read closed,
`catch` included.
