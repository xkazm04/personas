---
subject: form
evidence:
  - src/features/shared/components/forms/FormField.tsx        # the field unit: label+control+feedback, timing gate, a11y wiring minted once
  - src/features/shared/components/forms/FormErrorContext.tsx  # the form-level error registry (enroll/withdraw, phantom-free on unmount)
  - src/features/shared/components/forms/FormErrorSummary.tsx  # jump-to-field error summary, announced as an alert
  - src/features/shared/components/forms/useAsyncFieldValidation.ts  # advisory availability checks: debounced, superseded-request-cancelled, fail-open
  - docs/concepts/golden-paths/form-field-and-validation.md    # the measured application census this standard reconciles against
counter_evidence:
deviations:
  - w1-form   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Form - evidence

How this codebase measures against the [`form`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
