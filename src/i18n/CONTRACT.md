# i18n Contract — Four-Layer Model

This document reframes the Personas i18n system. It is **not** a string table or a translation workflow — it is a **typed contract between four layers**. Every i18n decision in this codebase should be judged against the invariants below.

If you are about to render user-facing text, pass a status string across IPC, or decide where an English label "belongs," read this first.

> Referenced from `.claude/CLAUDE.md` as the canonical i18n reasoning doc. For string-addition mechanics (keys, `tx()`, token maps), see CLAUDE.md § Internationalization.

---

## The Four Layers

```
┌───────────────────────────────────────────────────────────────┐
│  Layer 4 — Translators                                        │
│  Input:   English strings + translator comments (en.ts)       │
│  Output:  locales/<lang>.json                                 │
│  Knows:   natural language, tone, length budgets              │
│  Unaware: machine codes, IPC shapes, React                    │
├───────────────────────────────────────────────────────────────┤
│  Layer 3 — React Components                                   │
│  Input:   codes + structured params (from IPC, props, state)  │
│  Output:  rendered DOM                                        │
│  Knows:   which key to request, when to interpolate           │
│  Unaware: English prose (it asks `t`, never hardcodes)        │
├───────────────────────────────────────────────────────────────┤
│  Layer 2 — IPC Boundary (Tauri invoke + event bus)            │
│  Input:   typed Rust structs                                  │
│  Output:  JSON { code, params, severity, ... }                │
│  Knows:   serialization contract (generated types.ts)         │
│  Unaware: any human language                                  │
├───────────────────────────────────────────────────────────────┤
│  Layer 1 — Rust Engine (src-tauri)                            │
│  Input:   program state, errors, status transitions           │
│  Output:  machine tokens + structured params                  │
│  Knows:   what happened, with what data                       │
│  Unaware: how it will be described to humans                  │
└───────────────────────────────────────────────────────────────┘
```

The flow is strictly **bottom-up for data, top-down for presentation**. Codes originate at Layer 1; English only appears at Layer 4 and is requested by Layer 3 via `t`.

---

## Invariants

These are the rules that make the contract enforceable. A violation of any of them is a bug, regardless of how the code reads.

### I1 — No layer above Rust ever sees English prose from below

Rust emits **codes** (`"queued"`, `"rate_limit_exceeded"`, `"critical"`), not sentences. The IPC boundary carries codes. React components resolve codes to prose via `t` / `tokenLabel` / `resolveErrorTranslated`.

**Smell:** a Rust command returns `message: "Rate limit exceeded, retry in 30s"`.
**Fix:** return `{ code: "rate_limit", params: { retry_after_s: 30 } }`; add the sentence to `en.ts → error_registry.rate_limit_message` with `{retry_after_s}` interpolation.

### I2 — Every code has exactly one key

One token → one `en.ts` entry. No synonyms, no duplicates, no "there are two places this could live." Duplication is how `en.ts` rots into an unmaintained string heap.

**Enforcement today:** `scripts/check-locale-parity.mjs` catches missing keys per locale; token coverage is caught by the `warnedTokens` dev warning in `src/i18n/tokenMaps.ts`. When adding a new code, grep `en.ts` first.

### I3 — Params flow as structured data until the final `interpolate()`

A count is a number until the `<span>` renders. A duration is seconds until the label asks for "30s". A filename is a string path until the error message wraps it.

**Smell:** `` `Retry in ${seconds}s` `` built on the Rust side or in a hook.
**Fix:** pass `{ retry_after_s: number }`; let `tx(t.key, params)` handle the unit suffix per locale.

Corollary: plural forms, date formats, and number formats are the translator's problem, not the component's. Use ICU-style interpolation keys (`_one` / `_other`) rather than branching in TSX.

### I4 — The type system is the contract

`src/i18n/generated/types.ts` is authoritative. If a component reaches for a key that doesn't exist, TypeScript fails. If a Rust handler emits a token the frontend can't resolve, the dev-warning fires. Do not bypass the type with `as any` or `t['section']?.['key']`.

---

## What This Reframe Replaces

The old mental model ("text everywhere, translate as needed") produces predictable failures:

| Old framing | Why it leaks | Contract-based fix |
|---|---|---|
| "Add a string when you need one" | No home for codes; Rust invents English on the fly | Emit a code in Rust, add one key in `en.ts` |
| "Translate Rust error messages" | English crosses IPC; translators receive noise | Rust emits `code`; error registry owns prose |
| "Use `t.foo` everywhere" | Doesn't address params, pluralization, or tokens | `t` for static prose, `tx` for interpolation, `tokenLabel` for codes, `resolveErrorTranslated` for errors |
| "i18n = locale files" | Hides that the Rust surface is the *real* source of truth | Locale files are downstream of the code catalog |

---

## Subsystems, mapped to the contract

All three subsystems are expressions of the same contract. They are not independent features.

- **`tokenMaps.ts`** — resolver for Layer-1 status tokens. Category-scoped (`execution`, `severity`, `connector_status`, ...) so codes from different domains cannot collide.
- **`useTranslatedError.ts` + `error_registry` section** — resolver for Layer-1 error codes. `ERROR_KEY_MAP` is the Layer-1→Layer-4 bridge for errors that originate as Rust `Err` variants or HTTP failures.
- **`generated/types.ts` + `check-locale-parity.mjs`** — type-level and build-time enforcement of I2 and I4. The coverage script is a contract verifier, not a nice-to-have.

When adding a new user-visible concept (a new execution state, a new error kind, a new healing category), all three subsystems get touched in lockstep. If you only touch one, the contract is broken and a future contributor will paper over it with hardcoded English.

---

## Module Audit Rubric

Apply this rubric when touching any feature module under `src/features/`. The goal is not to migrate 3,800 hardcoded strings in one pass — it is to stop the bleeding and ratchet forward per I1–I4.

For a given module, grade it on each invariant (✅ / ⚠️ / ❌):

1. **I1 — English on the wire?**
   Grep the module for places it consumes `invokeWithTimeout` results and look for `.message`, `.description`, `.status_text` being rendered directly. If yes: ❌. Fix by routing through `tokenLabel` or `resolveErrorTranslated`.

2. **I2 — Code duplication?**
   Does the module define its own status→label map inline (e.g. a local `STATUS_LABELS = { queued: 'Queued', ... }`)? If yes: ❌. Fix by deleting the local map and using `tokenLabel(t, '<category>', token)`.

3. **I3 — Pre-concatenated strings?**
   Grep for template literals in JSX/props that mix prose and variables (`` `${count} agents` ``, `` `Retry in ${s}s` ``). If yes: ⚠️. Fix by extracting to `en.ts` with interpolation.

4. **I4 — Key-path typing bypassed?**
   Grep for `t as any`, `t['...']`, or string-indexed access into `t`. If yes: ❌. Fix by using the typed path.

### Module snapshot (as of 2026-04-24)

The 20 feature modules under `src/features/`:

```
agents  composition  deployment  execution  gitlab  home  onboarding
overview  personas  pipeline  plugins  recipes  schedules  settings
shared  sharing  simple-mode  templates  triggers  vault
```

Known hotspots (from CLAUDE.md: ~3,800 hardcoded strings across ~1,200 files):

- **agents, vault, overview, shared** — largest surface, most likely to harbor I1/I2 violations. Prioritize when touched.
- **home, settings, onboarding** — user-first screens; I3 violations (pluralization, counts) most visible here.
- **execution, triggers, schedules** — heaviest consumers of Layer-1 tokens; audit for I1 (English on the wire) and I2 (local status maps).
- **deployment, gitlab, sharing, plugins, recipes, composition, simple-mode, templates, personas, pipeline** — smaller surfaces; spot-check when touched.

This snapshot is a starting point, not a finished audit. Fix-as-you-touch (per CLAUDE.md) remains the migration policy; the rubric is the lens.

---

## When in Doubt

Ask: **which layer is this string crossing, and does it arrive as a code or as prose?**

If prose, you are violating I1 and the fix is upstream, not a quick `t.whatever` wrap at the render site.
