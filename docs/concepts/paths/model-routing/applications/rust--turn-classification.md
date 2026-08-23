---
layer: application
subject: model-routing
technique: turn-classification
stack: rust
---

# Turn classification in the Personas companion (Rust)

How this repo realizes the turn-classification technique: a three-class closed
vocabulary for companion calls, each class a tier-and-effort pair carrying the
benchmark that chose it — plus the repo's own measured demonstration of what
happens when callers take half the pair.

## 1. The vocabulary: three classes, one table, evidence attached

`src-tauri/src/companion/model_routing.rs` is the whole mapping — 47 lines,
declared as "One source of truth for 'which model + reasoning effort does this
kind of Athena call run on'". The class vocabulary is exactly the technique's
recurring taxonomy:

- `MAIN` (`:24-27`) — interactive main turns ("full op grammar, gated
  proposals, the quality-critical surface");
- `ASIDE` (`:32-35`) — background asides ("awareness-heavy, carries NO op
  grammar");
- `MICRO` (`:44-47`) — headless micro-calls ("titling, one-shot
  classifications, digest summaries, triage legs").

Each is a `TurnTier { model: &'static str, effort: Option<&'static str> }` —
the pair as one value, exactly the shape the technique mandates. And every
constant carries its calibration in the docstring, with sample sizes: `MAIN`
cites "Opus@low matched Opus@default accuracy exactly (93.9% over 114 runs per
cell) at 16% lower p50 latency"; `MICRO` even records a **negative** result —
"reinforcement at low effort regressed awareness 94→78%" — which is what makes
the cheap tier defensible against the next person who wants to route it up.
The calibration source is named at the top: the 1,026-turn bench in
`docs/plans/athena-model-bench-report.md`.

## 2. The caller asserts the class; overrides live at the consumer

The module doc names the consumers per class: `session.rs` asserts `MAIN` for
chat turns, `athena_reaction.rs` asserts `MICRO` for headless legs — the
caller states what it is; the table says what it gets. The consumer-overrides
seam is spelled out in the same doc comment: "Bench-only env overrides
(`PERSONAS_ATHENA_MODEL` / `PERSONAS_ATHENA_EFFORT`) are applied by the
main-turn consumer in `session.rs`, **not here**." The consumer side
(`src-tauri/src/companion/session/:1791-1813`) validates the effort override
against the closed level set ("so a typo can't inject an arbitrary flag
value") and routes the resolved model into *both* the spawn flag and the
`companion_turn.model` ledger column — "preserving the one-source invariant
under override."

## 3. The measured counter-example: taking `.model` and dropping `.effort`

The repo also demonstrates the technique's "pair travels whole" rule by
violating it, measurably. The 2026-08-17 census
(`docs/concepts/golden-paths/model-and-effort-selection.md` §7.D) counted
accesses across 963 Rust files: **seven call sites read `MAIN.model` /
`ASIDE.model` / `MICRO.model`; one reads `.effort`** (`session.rs:2199`). The
mechanism is a signature: `oneshot::call_claude_text(pool, prompt, model, leg,
call_timeout)` (`src-tauri/src/companion/brain/oneshot.rs:122`) has no effort
parameter, so all eight of its callers run at the CLI's default — and per
`model_routing.rs:14`, `None` means "the model's default (high)", i.e. the
dropped effort lands *above* the calibrated level on exactly the calls the
bench was run to make cheaper. The asymmetric-visibility prediction, live.

## 4. The terminal constant and the floor

Where a call cannot be classified statically (persona executions, whose model
resolves through a six-layer cascade), the chain terminates in a named
constant with its incident report attached: `DEFAULT_CAPABILITY_MODEL`
(`src-tauri/engine/src/prompt/capabilities.rs`), whose docstring records that
a profile-less persona "silently rides the CLI ACCOUNT default — observed live
as opus-4-8[1m] on every team step, the dominant fleet cost driver (2026-06-12
cost review)". The enforcement point is `src-tauri/src/engine/runner/mod.rs:339-359`:
default provider + no resolved model → pin the constant, with a traced debug
line. The census verified the effect: 141 of 141 expensive account-default
runs predate the floor commit; zero since. "Unspecified resolves upward,"
fixed by a constant supplied where the value was missing — not by a policy or
a warning.
