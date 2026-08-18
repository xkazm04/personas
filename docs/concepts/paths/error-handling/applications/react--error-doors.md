---
layer: application
subject: error-handling
technique: error-doors
stack: react
---

# React application — error doors

How this repo implements the door pair, and what its own measurements say
about where the invariant holds and where it doesn't.

## The one-call pair: `toastCatch` / `silentCatch`

`src/lib/silentCatch.ts` is the routing decision made cheap and named,
exactly as the technique prescribes — one call, two arguments (the error
arrives via the returned handler; the call site supplies a stable
`context` tag):

- **`toastCatch(context)`** (`silentCatch.ts:102-136`) is the user-facing
  route: structured log with category, telemetry breadcrumb, and a toast.
  The **breadcrumb-before-rewrite** comment (`silentCatch.ts:107-109`)
  encodes the two-representations rule: the RAW error string is logged
  first ("operators reviewing tickets need the real string, not the
  friendly copy"), classification attached as structured data, and only
  the rendering layer applies the friendly mapping.
- **`silentCatch(context)`** (`silentCatch.ts:73-88`) is the background
  route: log + breadcrumb + `recordSwallow`, no user interruption. Its
  sibling `silentCatchNull` (`silentCatch.ts:138-152`) is the
  fallback-plus-telemetry form — it returns `null` for data-fetch chains,
  so the graceful default never becomes a doorless swallow.
- Both use one message extractor (`extractMessage`, `silentCatch.ts:21-55`)
  that preserves the cause chain and never emits `[object Object]`, and
  both preserve the stack in log payload and breadcrumb data.

## The door instruments itself

`recordSwallow` (`src/lib/silentFailureTelemetry.ts:86-107`) makes the
background route *measurable*: per-tag counts with first/last timestamps,
a windowed rollup, and sampled full captures for high-frequency tags — the
technique's suppression-with-counter design, living inside the door rather
than at call sites, and explicitly "no-op-cheap; never throws into the
caller's catch" (`silentCatch.ts:84-86`) — the door-never-throws rule.
The dedup window on the resolution breadcrumb
(`src/i18n/useTranslatedError.ts:23-52`, `BREADCRUMB_DEDUP_MS`) is the
same throttle discipline on the render-loop side, keyed so a
re-classification still surfaces.

## The measured gap: the door exists, the invariant doesn't

The repo's own census (documented in
`docs/concepts/golden-paths/swallowed-error-telemetry.md` and
`.claude/CLAUDE.md`) is the technique's evidence base:

- The empty-catch lint (`custom/no-silent-catch`) runs at `"error"` with
  **0 findings** — the syntactic shell is extinct.
- Yet **760 of 2,752** production try/catch bodies reach no door at all,
  and only ~10.6% of catch sites produce a telemetry *event*.
- Rejection-handler adoption of the door helpers sits at **99.5%** against
  try/catch's **58.6%** — same codebase, same authors; the only difference
  is that a lint rule visits one syntax and not the other.

Two nuances the door pair carries that generalized upward into the
technique: the telemetry these doors emit is mostly a *breadcrumb* — a
trail record that ships only if a later event fires — which is why the
event rate (10.6%) is so far below the door-call rate; and the engine-side
repeat-failure breaker (`src-tauri/engine/src/failure_signature.rs`)
normalizes volatile message fragments before signing, the prerequisite for
identity-keyed suppression to fire at all.
