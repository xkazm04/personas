---
status: partial
phase: 02-unified-matrix-build-surface
source: [02-VERIFICATION.md]
started: 2026-04-13
updated: 2026-04-13
---

## Current Test

[awaiting human testing]

## Tests

### 1. Legacy Persona SQLite Walkthrough (INTG-01)
expected: Open a persona created before 2026-03-14 (old Chat/Build/Matrix schema) via `npm run tauri dev`. Click a resolved cell, edit it, save. Quit and reopen the app. Confirm no errors thrown, persona reloads correctly with edits intact.
why_human: `featureParity.test.ts` Block 4 seeds the Zustand store directly via `initEditStateFromDraft()` — it never exercises the real SQLite IPC path (`invoke("get_agent")` → Rust deserialization → TypeScript). Only an on-disk legacy persona exercises the full INTG-01 runtime compatibility claim.
result: [pending]

### 2. Feature Inventory Walkthrough (INTG-03 sanity check)
expected: Walk `02-RESEARCH.md` §"Feature Inventory from Retired Modes". For each listed capability from the old Chat/Build/Matrix modes, verify it is reachable and functional in the unified matrix UI.
why_human: The parity test confirms code paths exist and components render without throwing. It cannot detect UX-level gaps where a capability exists in code but is unreachable from the UI, hidden behind confusing affordances, or otherwise broken in practice. `02-VALIDATION.md` §"Manual-Only Verifications" mandates this walkthrough before phase close.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
