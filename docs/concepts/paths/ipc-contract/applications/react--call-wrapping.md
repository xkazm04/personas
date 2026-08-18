---
layer: application
subject: ipc-contract
technique: call-wrapping
stack: react
---

# Call wrapping in the React/TypeScript frontend

The repo's chokepoint is `invokeWithTimeout` at `src/lib/tauriInvoke.ts:305` —
every frontend→Rust IPC call passes through it. The ban on the raw primitive
is mechanical: `eslint.config.js` `no-restricted-imports` at `"error"` forbids
importing `invoke` from `@tauri-apps/api/core`, and it holds — exactly one
production call site of the raw API exists, and it is the wrapper's own core
at `tauriInvoke.ts:474`.

## The timeout ladder

Resolution is one line (`tauriInvoke.ts:333`):

```ts
const resolvedTimeout = explicitTimeout ?? BLOCKING_MUTATION_TIMEOUTS[cmd] ?? DEFAULT_TIMEOUT_MS;
```

Three tiers, exactly the standard's shape: explicit caller override wins,
then the **central per-operation table**, then the default (`DEFAULT_TIMEOUT_MS
= 90_000`, `:37`). `BLOCKING_MUTATION_TIMEOUTS` (`:69-81`) is the "blocking
mutation" class made concrete — a 30-minute ceiling (`LONG_MUTATION_TIMEOUT_MS`,
`:53`) for commands like `system_ops_run_now` that run a mutation inline with
no backend dedup, where each entry's comment states *why waiting beats timing
out*: "a post-timeout retry would start a SECOND scan." The table's own
doc-comment (`:55-68`) records the admission rule (blocks + mutates + can
exceed 90s) and the counter-example — `execute_persona` stays off the list
because it has server-side idempotency-key dedup, so a post-timeout retry is
already safe.

The standard's "watch the override ratio" warning is live here: the sibling
legacy sweep measured **52 ad-hoc call-site `timeoutMs` overrides against 3
central table entries** — the reusable mechanism used 3 times, the per-site
one 52 times, mostly clustered in the long-running API files. The mechanism is
right; the adoption is backwards.

## Outcome-unknown, spelled out at the point of failure

`InvokeTimeoutError` (`tauriInvoke.ts:115-136`) is the at-least-once hazard as
a first-class type: a readonly field literally named `backendMayStillBeRunning
= true`, and a message that tells the caller the backend "was NOT cancelled and
may still be running to completion; do not blindly retry a mutating command
(it could execute twice)". The timeout rejection path (`:482-499`) carries a
second copy of the reasoning as a comment. Tauri `invoke` has no cancellation,
so this is precisely the standard's "timeout is the caller giving up, not the
work stopping."

## Dedup — and the line the code itself draws

Two maps, two different guarantees, both inside the wrapper:

- `inflightByKey` (`:143`) — caller-supplied `idempotencyKey` folds *concurrent*
  duplicates into one pending promise, evicted on settle (`:372-377`).
- `inflightAutoDedup` (`:155`) — automatic fan-in for read-only commands
  (prefix-classified `list_`/`get_`/`fetch_`, `:161`), keyed by
  `cmd + stableStringify(args)`, held 250ms after settle, rejections evicted
  immediately so retries pass through. Every hand-out is `structuredClone`d
  (`:359-365`, `:407-413`) so one caller's in-place mutation cannot corrupt
  the shared cached value.

The code states the standard's "near-side dedup is not idempotency" rule in
its own comments (`:47-50`, `:486-495`): the key dedup "only collapses
CONCURRENT calls; a post-timeout retry is a brand-new call with no dedup" —
which is exactly why the retry-safe command (`execute_persona`) relies on
*server-side* key dedup instead.

## Policy that accreted at the chokepoint — the argument for having one

Everything else that lives in the wrapper because the wrapper exists:
`undefined`→`null` coercion so optional Rust params deserialize as `None`
(`coerceArgs`, `:223`, with class instances kept opaque to protect their
custom IPC serialization); IPC metrics recording on every settle (`:513-517`);
a breadcrumb per user-initiated call (`:471`); stampede detection above 50
concurrent in-flight calls (`:430-446`); session-token injection with a
one-shot anchored auth-failure retry (`:524-533`). None of these could have
been retrofitted across a thousand raw call sites.

## The adjacent boundary-absence door

`safeInvoke` (`src/lib/utils/tauri/safeInvoke.ts:61`) is the separated
"registration gap" category: it returns a fallback **only** when the error
matches Tauri's canonical `Command "<name>" not found` shape via an anchored
regex (`:14-15`), rethrowing everything else. Its header documents the
historical failure the anchoring fixed — a sibling copy used
`msg.includes("not found")` and silently swallowed genuine domain not-found
errors as "command missing", rendering empty-list UIs over real failures. The
wrapper taxonomy (refused / timed out / not registered) is therefore split
across two functions here rather than one, but the categories stay distinct,
which is what the standard actually requires.
