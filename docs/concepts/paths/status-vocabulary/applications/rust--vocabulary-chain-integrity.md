---
layer: application
subject: status-vocabulary
technique: vocabulary-chain-integrity
stack: rust
---

# Rust/ts-rs application — vocabulary chain integrity

This repo is the technique's largest measured specimen: every layer of the
chain exists here, every joint has been measured, and the deep audit is
`docs/concepts/golden-paths/status-and-severity-badges.md` (composed
2026-08-14; ground truth below reproduces it).

## The four layers, as built here

- **Storage constraint:** 82 `CHECK(col IN (…))` occurrences in
  `src-tauri/db/src/migrations/incremental.rs` and siblings — **66 unique
  vocabularies** over 38 distinct columns / 184 distinct tokens (e.g.
  `CHECK(status IN ('observed','proposed','adopted','deprecated','rejected'))`
  at `incremental.rs:6939`).
- **Wire token:** Rust enums with `#[derive(TS)] #[ts(export)]` +
  `#[serde(rename_all = "snake_case")]`, exported to
  `src/lib/bindings/*.ts` as string-literal unions — **88 exist**
  (`PersonaEventStatus`, `ExecutionState`, `AutomationRunStatus`, …).
- **Label catalog:** `status_tokens.<category>` in
  `src/i18n/locales/en.json` — 26 categories / 156 labels, each category
  emitted as a closed object type by `scripts/i18n/gen-types.mjs`.
- **Presentation:** `tokenLabel(t, category, token)`
  (`src/i18n/tokenMaps.ts:35`) + a per-vocabulary table feeding
  `StatusBadge` (see the react--status-color-mapping application).

## The measured drift, joint by joint

- **The root deviation is at serialization:** **155** status-shaped fields
  cross the wire typed `string` across 136 binding files, against the 88
  that crossed as unions. Downstream of a bare string, `Record<string, …>`
  is the only lookup that compiles.
- **Authority ↔ catalog:** of 66 storage vocabularies, **0 fully
  labeled, 17 partial, 49 with zero coverage**. Where a union and a
  category do pair, they drift: `status_tokens.event` lacks labels for 5
  of `PersonaEventStatus`'s 8 members (`delivered`, `completed`,
  `skipped`, `dead_letter`, `discarded`) and defines two (`processed`,
  `retrying`) the union cannot emit. Two severity scales
  (`ErrorSeverity`, `AlertSeverity`) share one `severity` category;
  `warning` has no label and `AlertRulesPanel.tsx:194` renders the raw
  token as its fallback.
- **Authority ↔ constraint:** mirrored by convention, verified by
  nothing — in this repo and in the `brainiac` sibling, whose
  `library.rs:4-6` states the same convention and also has no mechanism.
- **The door check:** `validate_one_of`
  (`src-tauri/db/src/repos/dev_workspaces.rs:260`) returns
  `AppError::Validation` with the allowed list — 1 definition, 6 call
  sites, one file, against 66 vocabularies. Everywhere else an invalid
  token surfaces as a raw `SQLITE_CONSTRAINT_CHECK`.

## The compile-time coverage gate — verified working here

The type-level check the technique prescribes was probed during the 2026
audit and produced exactly the right failure:

```ts
type Covers<Labels, Union extends string> =
  [Exclude<Union, keyof Labels>] extends [never]
    ? true : { MISSING_LABELS_FOR: Exclude<Union, keyof Labels> };
const _event: Covers<Translations['status_tokens']['event'], PersonaEventStatus> = true;
// error TS2322 … '{ MISSING_LABELS_FOR: "delivered" | "completed" | "skipped" | "dead_letter" | "discarded" }'
```

It names the missing tokens at the keystroke, and the probe file doubles
as the missing category→union declaration (today that pairing exists
nowhere and must be inferred by member overlap — four categories pair
with nothing). Precondition it depends on: `gen-types.mjs` continuing to
emit closed object types, not `Record<string, string>`. The
hand-maintained fallback exists twice
(`src/i18n/__tests__/chainStopReasons.parity.test.ts` — written *after*
`healing_capped` shipped as a raw token) for 26 categories.

## The unknown path and the registry class

`tokenLabel`'s miss path is dev-only (`tokenMaps.ts:40-50`): a
`console.warn` behind `import.meta.env.DEV`, then the raw token —
production renders it silently. Registered as deferred-fix anchor
**#w3-i18n**. The registry-drift class the technique names is registered
twice more in this repo's ledger: **#w2-realtime-events** (six event
names minted as literals in `cdc.rs::table_to_event`, outside both event
registries and invisible to `check-event-registry.mjs`) and
**#w5-alerting** (two evaluators of one alert-rule vocabulary; the
client-side one never reads `rule.persona_id`, so scope diverges per
consumer). Same defect, three vocabularies: members exist that the
vocabulary's own gate cannot see.
