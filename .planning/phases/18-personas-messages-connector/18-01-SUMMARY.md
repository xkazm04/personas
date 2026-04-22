---
phase: 18-personas-messages-connector
plan: "01"
subsystem: vault-ui, i18n, credentials
tags: [connector, builtin, vault, empty-state, i18n, regression-tests]
dependency_graph:
  requires: []
  provides: [CONN-01-locked, CONN-02-locked, CONN-03-locked, CONN-04-empty-state]
  affects: [vault-add-credential-dialog, personas_messages-connector, arxiv-connector]
tech_stack:
  added: []
  patterns:
    - zero-config empty-state guard in TemplateFormBody (variantFields.length === 0 + auth_type gate)
    - source-grep regression guard for seed-path idempotency (no Rust integration test needed)
key_files:
  created:
    - src/lib/credentials/__tests__/builtinConnectors.test.ts
    - src/features/vault/sub_catalog/components/forms/__tests__/TemplateFormBody.test.tsx
  modified:
    - src/features/vault/sub_catalog/components/forms/TemplateFormBody.tsx
    - src/i18n/locales/en.json
    - src/i18n/generated/types.ts
decisions:
  - "Done button in zero-config state calls onCancel (not onCreateCredential): builtin credential already seeded by seed_builtin_credentials on every boot — calling onCreateCredential({}) would duplicate or error"
  - "Zero-config guard is connector-agnostic (variantFields.length===0 + auth_type in none/builtin) — covers both personas_messages and arxiv without per-connector special-casing"
  - "variant=primary used for Done button — confirmed valid ButtonVariant from Button.tsx"
  - "No migration added to incremental.rs — RESEARCH.md §CONN-02 confirmed both seed paths already run on every boot idempotently"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-21"
  tasks_completed: 2
  files_changed: 5
---

# Phase 18 Plan 01: personas_messages Builtin Connector Summary

**One-liner:** Zero-config empty-state guard in TemplateFormBody with onCancel CTA + 11 regression/render tests locking CONN-01 through CONN-04.

## What Was Built

Phase 18 was predominantly a verification + gap-close exercise. The audit (18-RESEARCH.md) confirmed CONN-01, CONN-02, and CONN-03 were already satisfied by existing code on master. Only CONN-04 required net-new implementation.

### Task 1: Regression Guards for CONN-01/02/03 (commit `3a1f5a3c`)

Created `src/lib/credentials/__tests__/builtinConnectors.test.ts` with 5 tests that lock the already-satisfied state:

- **CONN-03 (×2):** `connectorCategoryTags('personas_messages')` returns `['messaging', 'in_app_notifications']`; `connectorsInCategory('messaging')` includes `personas_messages`
- **CONN-01:** `local-messaging.json` shape locked (id, name, category, categories, fields:[])
- **CONN-02 (fresh install):** `builtin_connectors.rs` contains `r##"personas_messages"##`
- **CONN-02 (existing install):** `db/mod.rs` carries `INSERT OR IGNORE INTO connector_definitions` AND `SELECT COUNT(*) > 0 FROM persona_credentials WHERE id` — both seed paths confirmed idempotent via source-grep

### Task 2: CONN-04 Zero-Config Empty-State (commit `17067e46`)

**`src/features/vault/sub_catalog/components/forms/TemplateFormBody.tsx`** — added ~35 lines:
- `authType` reads `selectedConnector.metadata?.auth_type`
- `isZeroConfig = variantFields.length === 0 && (authType === 'none' || authType === 'builtin')`
- Early return renders a banner (`no_config_required_heading` + `no_config_required_description`) with a `<Button variant="primary" size="sm" onClick={onCancel}>` Done button
- T-18-01 mitigation: CTA is `onCancel` not `onCreateCredential` — the `builtin-personas-messaging` credential row is already seeded by `seed_builtin_credentials` on every boot

**`src/i18n/locales/en.json`** — 3 keys added under `vault.forms`:
- `no_config_required_heading`: "No configuration required"
- `no_config_required_description`: "This connector is built into Personas. It works out of the box — no credentials or API keys needed."
- `no_config_required_dismiss`: "Done"

**`src/i18n/generated/types.ts`** — regenerated via `node scripts/i18n/gen-types.mjs` (10,343 lines)

**`src/features/vault/sub_catalog/components/forms/__tests__/TemplateFormBody.test.tsx`** — 6 tests:
1. `personas_messages` (auth_type: none, fields: []) → banner renders, Credential Name absent
2. `auth_type: "builtin"` → banner renders
3. `arxiv` connector with same config → banner renders (connector-agnostic validation)
4. `variantFields` has 1 field → normal form renders (negative)
5. `auth_type: "oauth"` with empty fields → normal form renders (OAuth negative)
6. T-18-01: Done button click → `onCancel` called once, `onCreateCredential` never called

## Files NOT Changed and Why

| File | Reason not changed |
|------|-------------------|
| `scripts/connectors/builtin/local-messaging.json` | Already correct per CONN-01 audit — no JSON changes needed |
| `src-tauri/src/db/builtin_connectors.rs` | Auto-generated; entry verified present at line 866 |
| `src-tauri/src/db/mod.rs` | Seed paths already idempotent per CONN-02 audit — Pitfall 2 avoided |
| `src-tauri/src/db/migrations/incremental.rs` | No migration needed — `seed_builtin_credentials` runs on every boot from `lib.rs:516` |
| `CredentialEditForm.tsx` / `EditFormFields.tsx` / `FormActions.tsx` | Guard placed at `TemplateFormBody` level so generic form components stay connector-agnostic per RESEARCH.md primary recommendation |
| Non-English locale files | CLAUDE.md §"When Adding New UI Strings" — translation teams handle out-of-band |

## Deviations from Plan

None — plan executed exactly as written. The `variant="primary"` Button usage matched the available variants in `Button.tsx` (confirmed before implementation). No fallback to `variant="default"` was needed.

## Threat-Model Outcomes

| Threat | Outcome |
|--------|---------|
| T-18-01 (Tampering: duplicate credential row) | Mitigated — Done button calls `onCancel`, Test 6 asserts `onCreateCredential` never called |
| T-18-02 (Info disclosure: internal seed details in UI copy) | Accepted — copy audited, no implementation details leaked |
| T-18-03 (Repudiation: silent seed regression) | Mitigated — Task 1 Test 5 source-greps `db/mod.rs` for both idempotency substrings |
| T-18-04 (Elevation: guard fires on connector that needs credentials) | Mitigated — guard gates on BOTH `variantFields.length === 0` AND `authType in (none, builtin)`; OAuth with empty fields still renders normal form (Test 5) |

## Test Run Results

```
Test Files  2 passed (2)
     Tests  11 passed (11)
  Duration  ~1.5s
```

`npx tsc --noEmit` exits 0. Lint 0 errors on touched files.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 | `3a1f5a3c` | `test(18-01): regression guards for CONN-01/02/03 (seed path + category filter)` |
| Task 2 | `17067e46` | `feat(18-01): CONN-04 zero-config empty-state in TemplateFormBody + i18n + render tests` |

## Downstream Hand-Off

Phase 19 (DELIV-01 — `deliver_to_channels` `type: "built-in"` branch) can now assume:
- `personas_messages` row exists in both `connector_definitions` and `persona_credentials` on every boot
- The vault UI gracefully surfaces the connector with a "No configuration required" banner when `fields: []` + `auth_type: "none"`
- `connectorCategoryTags('personas_messages')` reliably returns `['messaging', 'in_app_notifications']` — safe to use in any category-filter consumer

## Known Stubs

None. All plan goals achieved without stubs.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- `src/lib/credentials/__tests__/builtinConnectors.test.ts` — FOUND
- `src/features/vault/sub_catalog/components/forms/__tests__/TemplateFormBody.test.tsx` — FOUND
- `src/features/vault/sub_catalog/components/forms/TemplateFormBody.tsx` — FOUND (contains `isZeroConfig` and `no_config_required_heading`)
- `src/i18n/locales/en.json` — FOUND (3 new keys under vault.forms)
- `src/i18n/generated/types.ts` — FOUND (regenerated, contains `no_config_required_heading`)
- Commit `3a1f5a3c` — FOUND
- Commit `17067e46` — FOUND
