---
layer: application
subject: concurrency-guards
technique: single-flight-primitives
stack: rust
---

# Single-flight primitives in the Personas backend (Rust)

How this repo realizes the technique: one tiny reusable in-flight set adopted
across the tree, a per-flow-kind claim registry for heavyweight AI flows, and
one deliberate queue-policy exception for credential refresh.

## 1. The reusable primitive: `InflightGuard`

`src-tauri/engine/src/inflight_guard.rs` is the try-begin/end registry in its
minimal form: a `Mutex<HashSet<String>>` where `acquire(key)` is the atomic
test-and-insert (`HashSet::insert`'s return value *is* the verdict,
`inflight_guard.rs:35-38`) and `guard(key)` returns an RAII
`InflightHandle` that releases on `Drop` (`inflight_guard.rs:56-79`) — the
run-with-scope form, so early return and panic both release (the panic-unwind
release is proven by test, `inflight_guard.rs:116-127`). Two details worth
copying:

- **Poison recovery** — every lock acquisition is
  `unwrap_or_else(|e| e.into_inner())`, so a panic in one caller does not
  seal the guard for every future caller (`inflight_guard.rs:36`).
- **Provenance** — the module doc records that it began life as a bespoke
  static inside one command module and was lifted so future callers "reuse
  one mutex-management module instead of growing N copies"
  (`inflight_guard.rs:7-12`). The lift worked: **14 statics** now adopt it
  (`REBUILD_INFLIGHT`, `CONTEXT_GEN_INFLIGHT`, `INFLIGHT_TRIGGERS`, STT/TTS
  installer guards, `EVOLUTION_INFLIGHT`, `ADOPT_INFLIGHT`, …), each a
  one-liner instead of a re-derived mutex discipline.

The second-caller policy is uniformly **refuse**: e.g.
`src-tauri/src/commands/tools/automations.rs:132` —
`INFLIGHT_TRIGGERS.guard(&id).ok_or_else(...)` returns an explicit
already-running error rather than a bare false. The key is the automation id:
entity axis only, which is right — two different automations may fire
concurrently; the same automation may not double-fire.

## 2. Per-flow-kind claims: `ActiveProcessRegistry::try_begin`

Where the guarded operation is a spawned run with an id, a cancellation flag,
and a child PID, the richer registry in `src-tauri/src/lib.rs` applies.
`try_begin(domain, id)` (`lib.rs:187-197`) atomically checks "is a run live in
this domain?" and installs the new id under one lock acquisition. Its doc
comment preserves the motivating race: the previous `get_id()`-then-`set_id()`
pair "races across an `.await` and lets both pass the guard, spawning
duplicate tasks and silently discarding a result (bug-hunt 2026-06-07 recipes
#2)" — the technique's check-then-insert gap, observed in production before
being closed structurally.

The domain axis is a closed vocabulary of flow kinds — `"setup"`
(`commands/infrastructure/setup.rs:977`), `"recipe_execution"`,
`"recipe_generation"`, `"recipe_versioning"`
(`commands/recipes/crud.rs:218,307,452`), `"credential_design"`,
`"negotiation"` (via `commands/credentials/ai_artifact_flow.rs`) — one
single-flight slot per kind of AI flow.

Release is token-verified: `clear_id_if(domain, expected)` (`lib.rs:227-236`)
clears only if the stored id still matches the releaser's. The comment at the
setup call site (`setup.rs:966-990`) records why that matters: an earlier
fixed-key registration let a refused second install's cleanup delete the
*first* install's live entry, making it permanently uncancelable — the
cross-release failure the technique's token discipline exists to prevent.
The panic path is covered by a wrapper: `spawn_ai_artifact_task`
(`ai_artifact_flow.rs:139-160`) runs the flow under `catch_unwind` and, on
panic, calls `clear_id_if` and emits a failure event — release plus loud
failure, not a leaked domain.

`begin_run` (`lib.rs:160-178`) is the supersede variant: cancel the incumbent
via its `AtomicBool`, take its child PID for the kill, install the new id,
return a fresh token. Downstream, incumbency is re-checked before results are
applied: `ai_artifact_flow.rs:271` treats
`registry.get_id(&domain) != Some(&task_id)` as cancellation — the write-site
verification of attempt-attribution, living beside the guard that shares its
registry.

## 3. The queue-policy exception: `oauth_refresh_lock`

`src-tauri/engine/src/oauth_refresh_lock.rs` chooses **queue**, not refuse: a
per-credential `tokio` async mutex (`acquire()` awaits, `oauth_refresh_lock.rs:32-40`)
because the callers — proactive refresh tick, healthcheck, manual rotation —
all legitimately need the refresh to have happened before proceeding, and a
doubled refresh is not merely wasteful: the module doc explains that two
concurrent exchanges of one refresh token can leave the credential
*permanently broken* under RFC 6749 rotation. Key = credential id (entity
axis); release = `OwnedMutexGuard` drop (RAII again). One blemish: the
`LOCK_MAP` entries are never pruned, an unbounded-in-principle map that is
bounded in practice by the credential population.

## 4. The client-side join variant

`src/lib/utils/deduplicateFetch.ts` is the same primitive with the **join**
policy: concurrent calls with one key share the in-flight promise; the keyed
variant derives the key from the serialized arguments (arguments axis — a
fetch with `limit: 50` must not join one with `limit: 100`); release is bound
to settlement via `.finally(() => _inflight.delete(key))`, the
scope-bound-release idea in promise dress.
