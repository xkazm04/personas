---
layer: application
subject: alerting
technique: rule-authoring-validation
stack: rust
---

# Rule-authoring validation — always-true rejection at the storage door

`src-tauri/src/commands/communication/observability/alerts.rs` implements
the technique's hard core: a rule that can only ever fire is an invalid
program, rejected where rules are stored — not warned about in a UI layer
that imports can bypass.

## The rejection

```rust
/// Reject a rule whose operator + threshold are trivially always-true. Every
/// alert metric is non-negative (rates 0-100, executions/cost >= 0), so `>= 0`
/// (or `> negative`) fires on every evaluation — a constantly-firing alert is
/// useless spam (bug-hunt: default threshold 0 + `>=`).
fn reject_always_true_rule(operator: AlertOperator, threshold: f64) -> Result<(), AppError> {
    let always_true = (operator == AlertOperator::Gte && threshold <= 0.0)
        || (operator == AlertOperator::Gt && threshold < 0.0);
    if always_true {
        return Err(AppError::Validation(
            "This rule would fire on every evaluation — metrics are non-negative, so a `>=` (or `>`) rule at/below 0 is always true. Use a threshold above 0.".into(),
        ));
    }
    Ok(())
}
```

Three technique properties in one function:

- **Decidable from domain knowledge.** The metric domain ("every alert
  metric is non-negative") is what makes always-true statically decidable —
  the comment states the domain as the premise.
- **The door is the command layer, not the form.** `create_alert_rule`
  calls `is_finite()` + `reject_always_true_rule` before the repo write, so
  every writer (UI, automation, import) hits the same check.
- **The rejection explains itself.** The error names the domain fact and
  the fix ("Use a threshold above 0"), per the technique's "every rejection
  names the fix".

The comment's `bug-hunt: default threshold 0 + >=` note records the
motivating incident: the editor's default values composed into exactly the
always-true rule the validator now rejects — the "fatigue engine installed
by defaults" case.

## The partial-edit hole, disclosed in place

`update_alert_rule` can only re-check always-true when the update carries
**both** operator and threshold:

```rust
// Guard the degenerate always-true case when this update sets both the
// operator and the threshold. (A threshold-only edit can't be validated
// here without the existing operator; create-time validation covers the
// common path.)
if let Some(op) = input.operator {
    reject_always_true_rule(op, t)?;
}
```

A threshold-only edit to `0` on an existing `>=` rule slips through — the
technique's "edits pass the same door as creations" rule is honored in
routing but not in completeness, because the door validates the *delta*
rather than loading the row and validating the *resulting rule*. The
honest comment marks the gap; the fix shape (fetch-merge-validate) is the
technique's standard.

## What the door does not yet cover

Measured against the technique's full field list:

- **Never-true rules pass.** Only the always-true family is rejected;
  `success_rate > 150` (domain [0,100]) saves fine and provides fake
  coverage. Per-metric domain tables exist implicitly (the comment knows
  rates are 0–100) but are not consulted as bounds.
- **No preview-before-save.** Nothing tells the author how often the rule
  would have fired against `fired_alerts`-era history — notable because on
  the install measured 2026-08-17, `alert_rules` held zero rows, i.e. the
  editor's defects survive precisely because the preview that would
  exercise them doesn't exist to invite use.
- **Window and scope are not part of the stored predicate.** The window
  lives as evaluator constants (`SUMMARY_WINDOW_DAYS = 1` server-side,
  `ALERT_EVAL_WINDOW_DAYS = 1` client-side, the viewed range on the tab
  path), so the same row means different questions to different
  evaluators — the technique's "whole predicate lives in the rule" section
  is the standing gap here.
