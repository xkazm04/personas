# Golden path — Backend-to-frontend events

> Situation node: `backend-runtime/eventing/backend-to-frontend-events` · [situation spine](../situation-spine.json)
> `sides: both` · `twoSided: true` · `convergence: diverged` · `risk: medium` ·
> **`recurrence: 365` — the highest in the corpus** · dimensions: ui, function, performance, code-quality
> Fuses the retired topics *Streaming to the frontend*, *Emitting to the frontend*,
> *Event-name declaration*, *Backend event subscription*, *Tauri event subscription*,
> *Change capture and live updates*.
>
> Composed 2026-08-14 from a ground-truth sweep: **963 `.rs` files** and **4,829
> `.ts`/`.tsx` files** walked twice by two independent matchers (a scratch resolver
> and the census engine, which agreed exactly on both proposed signals); every
> emission and subscription call site resolved to a concrete event name where
> statically possible; both registries, the parity script, and all nine
> emit/subscribe primitives read in full; plus a read-only convergence census of
> two sibling repos (`brainiac` — Rust/Next.js; `personas-cloud` — TS monorepo with
> SSE + Kafka + WS + an in-process bus) used as a portability oracle.
>
> **Sibling leaves — cross-referenced, not absorbed.**
> [`snapshot-plus-stream`](../situation-spine.json) owns *reconciling* a pushed
> stream against a fetched snapshot (the id-keyed dedupe-merge at
> `useEventLog.ts:227-230`, and the CDC startup replay that depends on it). This
> path owns the *transport*: which name, which payload, which channel, and who
> owns the subscription. `domain-event-publication` owns the **persona event bus**
> (`persona_events` rows with an `event_type`), a completely different namespace
> that this repo's registry currently conflates with Tauri channel names — see §7 F.
> `long-running-job-progress` owns the progress UX; this path owns only the wire.
>
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

## 1. Trigger

- "The backend finished something — how does the UI find out?"
- "I'm about to write `app.emit("my-thing-status", …)`" — **stop; the name must be declared first.**
- "I need a `const MY_EVENT: &str = "…"` for this module." — **stop; that is a shadow registry (there are already five of them).**
- "I'm adding `listen('some-event', …)` inside a `useEffect`" — **stop; you want `useTypedTauriEvent`.**
- "This panel shows another run's output / two panels fight over the same event."
- "The spinner never stops — the completion event never arrives." / "I navigated away and the progress was lost."
- "Should this stream over a `Channel`, a broadcast event, or should the UI just poll?"
- "My listener fires twice." / "The listener is still attached after the component unmounted."

## 2. The one way

Declare the event name **once**, in `personas_core::events`' `event_names!` block, and
in `EventName` + `EventPayloadMap` on the TypeScript side — those two files are the
contract, and a name that is not in both does not exist. Give the payload a **named
Rust struct that derives `Serialize`**, never an inline `serde_json::json!` literal,
because a struct is the only thing a type can be generated from and an inline literal
is a shape only a human can check. Emit it with `emit_event(&app, event_name::X, &payload)`
from the command layer, or — when the code must also run headless (the daemon, a test) —
take an `&dyn ExecutionEventEmitter` and call `emit_to(emitter, event_name::X, &payload)`,
never `app.emit` directly. On the client, **do not call `listen()`**: pick the primitive
by lifetime — app-lifetime side effects (a toast, a store write, a notification) become a
declarative entry in `eventBridge.ts`'s `registry`, which owns attach order, retry and
teardown for the whole process; component-lifetime subscriptions use
`useTypedTauriEvent(EventName.X, handler)`, which owns the async-registration race that
a hand-rolled `.then(f => unlisten = f)` gets wrong; a stream many components watch at
once uses `createSingletonListener` so N consumers share one underlying subscription and
one per-frame flush. **Every `app.emit` in this app is a global broadcast** — there is no
window-scoped or per-subscriber emit anywhere in the repo — so a payload that concerns one
run MUST carry its own `execution_id` / `run_id` / `session_id` and every handler MUST
filter on it as its first statement; a broadcast without a discriminator is cross-talk
waiting for the second concurrent run. Reach for a per-invocation `tauri::ipc::Channel<T>`
only when the stream belongs to exactly one in-flight command *and* the surface that
started it is the only consumer, and expect to *also* broadcast for the
navigated-away case (`build_session/events.rs:237,258` does both, deliberately). Then
stop: do not write a second event-name const, a second subscription manager, a second
idle/debounce scheduler, or a hand-rolled payload interface — all four already exist.

**Warrant of each clause** (per [`research/portability-test.md`](../research/portability-test.md)
recommendation 2 — a reader in another repo must be able to sort physics from local
calibration). Convergence evidence is from the two sibling repos named in the header.

| Clause | Warrant | Evidence it is not local taste |
|---|---|---|
| A payload type is **generated/shared**, never mirrored by hand | **physics** | `brainiac` reinvented it with a different tool — `openapi-typescript` into `console/src/lib/api-schema.d.ts`, **79 generated vs 5 hand-written**, doctrine stated in-file at `console/src/lib/types.ts:1` ("change a response shape in Rust, regenerate, and TypeScript fails here until the console agrees"). `personas-cloud` reinvented it as a shared workspace package (`@dac-cloud/shared`, 47 shared types imported by both producer and consumer) |
| One place owns every subscription | **physics** | `personas-cloud` reinvented it exactly: `dispatcher.ts:1033-1105`, ten contiguous `pool.on(...)` calls 1:1 with the declared event map, and no ad-hoc `.on` anywhere else |
| An emitter **seam** (real impl + no-op) so core logic runs headless | **physics** | `personas-cloud` reinvented the identical shape with no shared code or language: `KafkaClient` interface (`kafka.ts:4`), `createNoopKafkaClient` (`:311`), selected at the composition root (`index.ts:66`). Our `CapturingEmitter` test double (`events.rs:142`) is *ours alone* — neither sibling has one |
| Delivery is **scoped**, not blindly broadcast | **physics** | `personas-cloud` reinvented scoping at three levels: `projectTopic()` (`types.ts:325`), an ingress check that recomputes the expected topic so a message cannot claim a project it didn't arrive on (`index.ts:88`), and `validateExecutionOwnership` gating 6 of 9 message cases (`workerPool.ts:416+`) |
| The event name is **unrepresentable** unless registered | **physics where a compiler can enforce it for free; local calibration across a serialization boundary** | `personas-cloud` reinvented it *in-process*: `TypedEventEmitter<T>` with `emit<K extends keyof T & string>` (`workerPool.ts:53-57`), all 12 emit and 10 subscribe sites compiler-checked. But the constraint dies at the wire in **both** siblings — its SSE emitter is `sendEvent(event: string, …)` (`httpApi.ts:1715`) and it launders a nested name with `eventType as any` (`connection.ts:338`); `brainiac` had an enum precedent (`mcp.rs:1861`) and its *newer* wrapper took `&'static str` anyway (`demand.rs:32`), explicitly citing the older one as its model. **Do not claim this is universal — claim it is available and cheap, and note that everyone drops it at the boundary.** |
| A **central registry** for the UI-facing channel | **suspect: local calibration** | Neither sibling has one for the layer the UI consumes. `personas-cloud` declares 31 names centrally for its three *internal* layers and **0 of 6** for SSE — the exact layer the frontend reads. Registries get built where a compiler consumes them, not where a human needs them. Ours is the exception, which is why it is worth defending |
| A shared helper for the async-subscribe/unmount race | **local calibration — reinvented nowhere** | `brainiac` solved it once, beautifully, in `useIngestFeed.ts` (in-flight ref, `AbortController`, post-unmount clobber guard) and **did not share it**: `NavDashboard.tsx:63` and `NavStatus.tsx:23` re-derive it independently for the same endpoint. Nobody extracts this by default |
| A singleton/fan-out layer so N consumers share one subscription | **local calibration — reinvented nowhere** | `personas-cloud` runs one 500 ms timer *per SSE connection* (`httpApi.ts:1743`); `brainiac` runs two independent pollers against one endpoint. Both pay for it visibly. Ours is a genuine local advantage, not doctrine |
| A written rule choosing broadcast vs per-request stream vs poll | **an unmet need in every repo checked** | Neither sibling has one; both agonize inline in comments (`alerts.rs:1-29`, `workerPool.ts:71-79`). §4 step 1 below is the first draft anyone has written |
| A machine gate on name parity | **local calibration** | **Zero** parity gates in either sibling. `brainiac` has a strong gating culture (workspace tests, eval-regression baselines against `results/baseline.json`) and still built none — that is a considered absence, not neglect. Ours (`check-event-registry.mjs`) is ahead of both, and §7 A shows what it still cannot see |

## 3. Mandated primitives

### Rust (the emit half)

- **`personas_core::events::event_names!`** (`src-tauri/core/src/events.rs:16-30`, table at
  `:32-321`) — the macro that generates `event_name::CONST` plus `ALL_EVENT_NAMES`. **149
  names.** It lives in `core` and not in `engine` because `db::cdc` and `db::repos` also
  name events and sit below the engine (`:5-7`). Adding a name here is step 1 of everything.
- **`emit_event(&app, event_name::X, &payload)`** (`src-tauri/engine/src/event_registry.rs:36-38`)
  — the canonical emit. Read its signature before trusting its docstring: it takes
  `event: &str`, **not** a typed name (§8 Gap 1), and it swallows the `Result` with `let _ =`.
- **`emit_event_bus(&app, &persona_event)`** (`event_registry.rs:44-48`) — the only emit
  helper that **logs its failure**. Use for anything on the `event-bus` channel.
- **`try_emit_event`** (`event_registry.rs:52-58`) — same, returning `Result`. Currently
  `#[allow(dead_code)]`: **zero call sites.** If you care whether the emit landed, this is
  the one to adopt rather than re-deriving it.
- **`ExecutionEventEmitter`** (`src-tauri/engine/src/events.rs:31-52`) with **`TauriEmitter`**
  (`:59-77`), **`NoOpEmitter`** (`:85-103`) and the test-only **`CapturingEmitter`**
  (`:142-165`) — the headless seam. Any engine code that must also run under
  `personas-daemon` takes `&dyn ExecutionEventEmitter` and emits via **`emit_to(emitter,
  event_name::X, &payload)`** (`:115-120`). **Naming hazard:** this `emit_to` is *not*
  Tauri's window-targeted `Emitter::emit_to`; Tauri's is used **zero** times in this repo.
- **`emit_process_activity(&app, domain, action, run_id, label)`**
  (`src-tauri/engine/src/process_activity.rs:39-55`) — the one lifecycle event every
  long-running background job should raise so it appears in the global activity dock.
  Its `ProcessActivityEvent` struct (`:5-21`) is the best-documented payload in the repo.
- **`BackgroundJobManager<S>`** (`src-tauri/src/background_job.rs:105-124`) — if you are
  building a status/output job pair, this already owns the ring buffer, the 4 KB per-line
  clamp, TTL eviction, cancellation and both emits. Pass `event_name::X_STATUS` /
  `event_name::X_OUTPUT` at construction; all nine production constructors do.
- **`tauri::ipc::Channel<T>`** — the per-invocation transport. Exactly **four** real
  command signatures use it (`commands/design/build_sessions.rs:115`,
  `engine/build_session/{mod.rs:125,runner.rs:323,fanout.rs:1056}`), plus four `dummy_channel`
  constructions for headless re-entry (`build_sessions.rs:185`, `management_api.rs:2176`,
  `approval_exec_core.rs:793`, `test_automation.rs:1030`) — note that pattern before
  inventing your own `Option<Channel<T>>` (the reason is written at `build_sessions.rs:160`).

### TypeScript (the subscribe half)

- **`EventName`** (`src/lib/eventRegistry.ts:30-…`) — **150 names**, the mirror of the Rust
  table. **`EventPayloadMap`** (`:742-1180`) — **150 payload entries**, and the two are held
  in lockstep by a compile-time exhaustiveness assertion (`:1192-1202`) that fails the
  typecheck if either grows without the other. That assertion is the single best mechanic
  in this file; copy its shape, don't work around it.
- **`typedListen(EventName.X, handler)`** (`eventRegistry.ts:1218-1226`) — the typed
  `listen`. `K extends keyof EventPayloadMap` means **an unregistered name is a type error**.
- **`useTypedTauriEvent(EventName.X, handler)`** / **`useTauriEvent(name, handler)`**
  (`src/hooks/useTauriEvent.ts:76-101` / `:34-59`) — component-lifetime subscription that
  owns the async-registration race with a `cancelled` flag. Its own docstring names the
  incident it exists for (`:68`, "the asynchronous-cleanup race that bit `ContextMapPage`
  and friends"). **Use this instead of a `useEffect` + `listen()` — always.**
- **`registry` in `src/lib/eventBridge.ts:186-1013`** — the declarative app-lifetime
  subscription table (27 registrations). It owns: critical-vs-bulk attach waves with a
  frame yield between them (`:1085-1114`), per-registration failure isolation, a 500/1500/4500 ms
  retry ladder with a generation token so a teardown mid-retry cannot leak
  (`:1161-1216`), a user-visible toast when a listener is permanently unattached
  (`:1211-1215`), HMR-surviving handles via `globalThis` (`:141-146`), and
  `teardownAllListeners()`. **If your handler writes to a store, raises a toast or adds a
  notification, it belongs here and nowhere else.**
- **`createSingletonListener<T>(EventName.X)`** (`src/hooks/realtime/createSingletonListener.ts:18`)
  — one Tauri subscription fanned out to N React consumers, with a 50-slot early-arrival
  buffer (`:32,94-101`), a per-`requestAnimationFrame` batch flush so a bursty backend tick
  collapses into one React commit (`:42-63`), drop accounting, and setup/teardown
  race-safety (`:106-130`). Five hooks use it. **Reach for it whenever ≥2 components want
  the same stream.**
- **`useRunEventListener(bindings)`** (`src/hooks/realtime/useRunEventListener.ts:56`) —
  N run-status subscriptions with per-binding `filter`, terminal-phase detection and
  `Promise.allSettled` teardown.
- **`usePolling`** (`src/hooks/utility/timing/usePolling.ts`) — the third transport. If the
  answer is "just re-fetch on an interval", this already exists; do not write a `setInterval`.
- **`scripts/check-event-registry.mjs`** (wired into `npm run check` via `check:contracts`) —
  the existing parity gate. **Read §7 A and §9 before trusting it.**

## 4. Steps

1. **Choose the transport first, and write down why.** This decision has no home in the
   repo today (§8 Gap 6), so make it here:
   - **Broadcast `app.emit`** — the default. Choose it when the news outlives the command
     that produced it, when more than one surface cares, or when the user may navigate away
     before it lands. Cost: every listener in the process sees it, so the payload MUST carry
     a discriminator.
   - **Per-invocation `Channel<T>`** — only when the stream belongs to one in-flight command
     *and* one consumer, and back-pressure/ordering matter. Cost: it dies with the caller.
     If the surface can unmount mid-stream you need the broadcast too — and then you need an
     arbitration rule, which is `build_session`'s `__BUILD_CHANNEL_ACTIVE_SESSIONS__` set
     (`useBuildSession.ts:70`, honoured at `eventBridge.ts:404-406`).
   - **Poll a snapshot** — when the state is idempotent, the consumer can miss ticks, and
     you want recovery-after-restart for free. `BackgroundJobManager`'s snapshot + `usePolling`
     is the pairing. This is also the correct *complement* to a stream; the reconciliation
     rules live in the `snapshot-plus-stream` path, not here.
2. **Declare the name in `core/src/events.rs`'s `event_names!` block.** Group it with its
   neighbours; add a comment if the name is a bus `event_type` rather than a Tauri channel
   (§7 F — and prefer not to mix them at all).
3. **Define a named payload struct that derives `Serialize`.** Not `serde_json::json!`.
   Put it in the module that owns the feature, not in the registry (`event_registry.rs:60-65`
   records why the registry stopped re-exporting payload types). **Decide the serde casing
   deliberately and write down the decision** — `process_activity.rs:6-15` is a fifteen-line
   comment explaining that adding `#[serde(rename_all = "camelCase")]` once collapsed every
   concurrent run into one dock row, because the contract is prose and prose does not
   typecheck.
4. **Ask the type question before you write any gate.** Can the signature make the wrong
   call impossible? Here it can, and cheaply — see §9's "Prefer a type over a gate". If you
   are extending the primitive rather than calling it, do that instead of adding a rule.
5. **Emit it.** `emit_event(&app, event_name::X, &payload)` from a command; or take
   `&dyn ExecutionEventEmitter` and `emit_to(...)` if the code path also runs headless. If a
   dropped emit is a bug (not just a missed pixel), use `try_emit_event` or `emit_event_bus`
   and log the failure — `emit_event` throws the `Result` away.
6. **Mirror the name into `EventName` and the payload into `EventPayloadMap`.** The
   exhaustiveness assertion at `eventRegistry.ts:1192-1202` will fail the typecheck until
   both exist, and `npm run check` will fail until the Rust and TS name tables agree.
   **Prefer a `@/lib/bindings/*` type over a hand-written interface** — if the payload struct
   carries `#[derive(TS)] #[ts(export)]`, `cargo test -p personas-core export_bindings`
   generates the TypeScript and the CI binding-drift job holds it. Only 7 of 150 entries do
   this today (§7 E); be the eighth.
7. **Subscribe with the primitive that matches the lifetime**, never a raw `listen()`:
   app-lifetime → an `eventBridge.ts` registry entry; component-lifetime →
   `useTypedTauriEvent`; multi-consumer stream → `createSingletonListener`; a family of
   run-status events → `useRunEventListener`.
8. **Filter on the discriminator as the handler's first statement.**
   `if (payload.run_id !== myRunId) return;`. `StandardsScanCard.tsx:39` and
   `IngestProgressBar.tsx:30` are the shape. Skipping this works perfectly until the user
   starts a second run.
9. **And then stop.** Do not add a module-local `const X_EVENT`, a `status_event` field on
   a config struct, a second subscription manager, a `let unlisten` + `.then` dance, a
   debounce/throttle scheduler (`eventBridge.ts:38-105` has named, justified constants for
   all of them), or a hand-written payload interface. Steps 2, 3, 5, 6 and 7 delivered all six.
10. **Verify the round trip.** Start the app, trigger the backend path, and confirm the
    handler fires. There is no gate that will tell you a name is emitted-but-unlistened or
    listened-but-never-emitted (§7 C found one of each shipped on `master`).

## 5. Anti-patterns

- **`const MY_EVENT: &str = "my-event";` in a feature module.** The name is now invisible to
  both registries, to the parity gate, and to every future reader looking for "what events
  exist". **31 distinct names** live this way today (§7 A) and it is by far the largest class.
- **A raw string literal at the emit site** — same, minus the const. Also makes the name
  ungreppable from the TypeScript side, because the two spellings can drift independently.
- **An event name in a config struct field** (`AiArtifactMessages.status_event`,
  `LabRunCallbacks.event_name`) — a *sixth* declaration site that looks like configuration.
  Nine unregistered names hide here, including five `lab-*` names one of which
  (`lab-consensus-status`) is emitted and has **zero** references anywhere in `src/`.
- **An enum method returning `&'static str` as the event name** (`mcp/pending.rs:43-48`) —
  a seventh. The enum is nice; the strings should still come from the registry.
- **`serde_json::json!({...})` as the payload.** No struct means no `ts-rs` derive, no
  generated TypeScript, no compile error when a field is renamed — the contract becomes a
  hand-copied interface plus a comment. **83 of 278 payload-carrying emits** do this.
- **Copying a registry *value* instead of referencing its *const*** —
  `cdc.rs:229` writes `Some("persona-health-changed")` while
  `event_name::PERSONA_HEALTH_CHANGED` holds the same string. Renaming the const compiles
  clean and silently unhooks CDC. Six sites do this.
- **`app.emit(...)` inside engine code that the daemon also runs.** It forces an `AppHandle`
  into a code path that has no window; that is what `ExecutionEventEmitter` exists to prevent.
- **`useEffect(() => { let un; listen(...).then(f => un = f); return () => un?.(); })`.**
  If the effect tears down before `listen()` resolves, `un` is still `undefined`, the cleanup
  is a no-op, and the subscription attaches afterwards and **never detaches**. Seven live
  sites (§7 D). The cleanup must close over the *promise* (`return () => p.then(f => f())`)
  or use a `cancelled` flag — which is exactly what `useTypedTauriEvent` already does.
- **Two components subscribing to the same event independently.** `healing-event` has three
  subscribers, `team-assignment-progress` six, `execution-output` / `execution-status` /
  `fleet-session-state` three each. That is N Tauri subscriptions and N React commits per
  backend tick where `createSingletonListener` gives you one of each.
- **A handler with no discriminator check.** `app.emit` is global; there is no window- or
  subscriber-scoped emit anywhere in this repo, and the app does open a second WebView
  (`commands/infrastructure/auth.rs:438`, the OAuth window). One run's output reaching
  another run's panel is the default behaviour, not an edge case.
- **`listen('literal-string', …)`.** Bypasses `EventPayloadMap`, so the payload type is
  whatever you typed inline, and the name is invisible to the parity gate. 14 sites; one of
  them (`ExecutionStep.tsx:55`) has been waiting on an event nobody emits.
- **Declaring a persona-event-**bus** `event_type` in the Tauri channel registry.** Ten
  entries do this "for discoverability" and it makes every "is this listened to?" question
  unanswerable. Cross-reference `domain-event-publication`; keep the namespaces apart.

## 6. Evidence

**The one site to copy, emit half:** `src-tauri/engine/src/process_activity.rs` — 76 lines
that do everything right. A named `#[derive(Serialize)]` payload struct (`:5-21`); a
constructor that stamps the timestamp so no caller can forget (`:23-37`); the registry
constant at the emit (`:47`); a `tracing::warn!` on failure with the identifying fields
(`:48-54`); a second entry point taking `&dyn ExecutionEventEmitter` for the headless path
(`:57-69`); and — the part worth the whole file — a fifteen-line comment (`:6-15`) recording
the production bug that a serde-casing change caused, why the wire format is snake_case, and
exactly which two frontend surfaces break if you "tidy" it.

**The one site to copy, subscribe half:** `src/lib/eventBridge.ts` — the declarative
registry (`:186-1013`) plus its lifecycle (`:1049-1236`). Every timing constant is named and
carries a "what breaks if you halve/double this" note (`:38-105`); attach is waved
critical-then-bulk with a frame yield (`:1085-1114`); a failed registration is retried on a
generation-guarded backoff and, if it never lands, the user is told rather than left staring
at a dead spinner (`:1161-1215`); teardown is real and HMR-safe (`:141-157`, `:1222-1236`).

- `src-tauri/core/src/events.rs:16-30` — the `event_names!` macro; `:9-14` the (partly
  stale, §7 G) five-step ritual.
- `src/lib/eventRegistry.ts:1186-1202` — the `EventName` ⇄ `EventPayloadMap` exhaustiveness
  assertion, with a docstring that tells you what to do when it fires.
- `src/hooks/useTauriEvent.ts:9-33` — the boilerplate this hook collapses, written out in
  the docstring, including *why* the `cancelled` flag is needed. If you are about to
  hand-roll a subscription, read this instead.
- `src/hooks/realtime/createSingletonListener.ts:34-63` — the per-frame flush rationale;
  `:88-130` the setup/teardown race handling; `:65-76` the drop accounting.
- `src-tauri/engine/src/events.rs:193-206` — a test that proves the emitter substitution
  contract (the same function driven by a capturing impl and a no-op) rather than asserting
  a mock was called.
- `src-tauri/src/engine/build_session/events.rs:237,258` — the only place in the repo that
  emits to **both** a `Channel` and the broadcast, with per-transport failure warnings; the
  frontend arbitration is `useBuildSession.ts:70` ⇄ `eventBridge.ts:404-406`.
- `src-tauri/db/src/cdc.rs:332-341` — why the CDC drain waits 6 s before its first emit
  ("send was called before connect"), and `:345-351` the startup replay that depends on the
  frontend deduping by id.
- `src/features/overview/sub_events/libs/useEventLog.ts:227-230` — the id-keyed dedupe-merge
  the CDC replay relies on. **Owned by the `snapshot-plus-stream` leaf; cited here only
  because the emit-side comment points at it.**
- `src-tauri/src/background_job.rs:20-35` — the per-line 4 KB clamp and 500-line ring, with
  the reason stated in terms of the WebView's JS heap. Payload-size discipline for streams.
- `src/features/plugins/dev-tools/sub_overview/StandardsScanCard.tsx:39` — the
  discriminator filter as the handler's first statement.

## 7. Deviations found

### A. Event names declared outside the registry — **54 names, 71 emit sites, 31 files**

The registry declares **149** names. Another **54** cross the Rust→JS boundary without it,
so the "single source of truth" covers **73%** of the traffic. Six mechanisms declare a name
in this repo today:

| Mechanism | Distinct names | Unregistered | Example |
|---|---|---|---|
| `event_names!` in `core/src/events.rs` | 149 | — | the intended one |
| module-local `const X_EVENT: &str` | 31 | **30** | `companion/session.rs:234-348` declares **13**; `engine/kb_extract.rs:42`; `commands/radio.rs:16` |
| raw literal at the emit site | 7 | **5** | `cloud/remote_commands.rs:160`, `engine/mod.rs:959`, `commands/infrastructure/task_executor.rs:1322` |
| `table_to_event()` match arms | 8 | **7** | `db/src/cdc.rs:223-247` |
| config-struct fields (`status_event` / `progress_event` / `event_name`) | 13 | **9** | `commands/recipes/recipe_execution.rs:10-11`, `engine/src/test_runner.rs:2064,2160,2333,2417,2570` |
| enum method returning `&'static str` | 2 | **2** | `companion/orchestration/mcp/pending.rs:43-48` |

The heaviest single cluster is the companion/Athena surface: `companion/session.rs:234-348`
declares **fifteen** `companion://…` name constants — fourteen of them unregistered — and
emits fifteen times (`:963,1315-1541,2789`); `commands/companion/proactive.rs:28` declares
`companion://proactive`, emitted from **six sites across five files**. None of them is in
either registry.

**Six more names are the mirror hazard:** a raw literal that *duplicates* a registry value
rather than referencing its const — `cdc.rs:229` `"persona-health-changed"`,
`companion/session.rs:348` `"companion://remote-job-turn"`,
`commands/tools/automation_design.rs:23` `"automation-design-status"`, and the three
`recipes/recipe_*.rs` `*-status` fields. Renaming the const compiles clean and silently
breaks the frontend.

### B. Payloads with no type — **83 of 278 payload-carrying emits, 31 files**

`serde_json::json!({...})` inline at the emit. No struct, therefore no `ts-rs` derive,
therefore no generated TypeScript, therefore the frontend interface is hand-copied. Worst
clusters: `engine/mod.rs` (14), `cloud/runner.rs` (8), `commands/credentials/auto_cred_browser.rs` (8),
`commands/credentials/vector_kb.rs` (4), `commands/infrastructure/standards_scan.rs` (4),
`engine/rotation.rs` (3), `commands/recipes/crud.rs` (3).

`cloud/runner.rs:124-129` is the clean illustration: it emits
`json!({"execution_id":…, "progress":…})` while `eventRegistry.ts:344-351` declares
`ExecutionProgressPayload { execution_id; progress: { stage?; tool?; percent? } }`. The
nested shape exists only in the TypeScript. Nothing checks it.

### C. Names that reach nobody, and a listener that waits forever

- **`execution-complete` is subscribed and never emitted.**
  `src/features/onboarding/components/ExecutionStep.tsx:55` gates the onboarding tour's
  completion on `listen('execution-complete', …)`. The string appears **nowhere** in
  `src-tauri/`. The step's `onComplete()` can only ever fire from another path; the listener
  is dead code wearing a 20-line comment about its own teardown correctness. (Do not confuse
  it with the *tour* event `tour:execution-complete`, `tourSlice.ts:61`, which is a different
  thing on a different bus.)
- **Seven CDC event names have zero subscribers.** `cdc.rs:223-247` maps eight tables to
  emit names; `memory-updated`, `credential-updated`, `trigger-updated`,
  `subscription-updated`, `automation-updated`, `audit-entry-created` and `tool-updated`
  have **0** references in all of `src/`. Every row change on those seven tables pays
  serialization + IPC + WebView dispatch for a message nobody reads.
- **`lab-consensus-status`** is emitted from `engine/src/test_runner.rs:2160` and has **0**
  references in `src/`. Its three siblings (`lab-arena-status`, `lab-ab-status`,
  `lab-eval-status`) are subscribed from `src/hooks/lab/useLabEvents.ts` by hardcoded string.
- **86 of the 150 `EventName` entries have no subscriber anywhere in `src/`.** ~10 of those
  are persona-event-**bus** names registered "for discoverability" (§7 F), so the honest
  figure for unsubscribed Tauri channels is ~76. Symmetrically, **57 of the 149 Rust names
  have no statically resolvable emit site** — many are reachable only through the `&str`
  indirections in §7 A, which is precisely why neither question can be answered by a machine.

### D. Subscriptions that leak on a fast unmount — **7 `listen()` calls in 6 effects**

The shape: `let un; listen(...).then(f => { un = f; }); return () => un?.();`. Unmount
before the promise resolves ⇒ cleanup sees `undefined` ⇒ the subscription attaches
afterwards and is never detached.

| Path | Note |
|---|---|
| `features/plugins/dev-tools/sub_overview/StandardsScanCard.tsx:38` | re-mounts per project selection |
| `features/teams/sub_factory/passport/improve/StandardsScan.tsx:62` | same event, same bug, different feature — a copy |
| `features/plugins/obsidian-brain/sub_graph/GraphPanel.tsx:91` | also leaves the backend vault watcher running |
| `features/settings/sub_network/components/PeerDetailDrawer.tsx:51` | drawer — opens/closes constantly |
| `features/vault/shared/vector/tabs/ExtractTab.tsx:61` | |
| `features/vault/shared/vector/ingest/IngestProgressBar.tsx:29,35` | `void setup()` with two `await listen(...)` into outer `let`s — same bug, async spelling |
| `hooks/utility/data/useAutoInstaller.ts:61,67` | handles go into a ref *after* two awaits; the unmount `cleanup()` at `:94-98` sees an empty array |

`useTypedTauriEvent` exists, is documented with this exact race and the incident that
motivated it (`useTauriEvent.ts:68`), and has **6 call sites in 5 files**. The correct
sites — `useDecisionQueue.ts:437,440`, `useMcpRequestBridge.ts:50,53`,
`useContextScanBackground.ts:76`, `useCreateTemplateSnapshot.ts:163`, `FleetGridPage.tsx:191`
— all use the other safe spelling (`return () => promise.then(f => f())`), so the repo
demonstrably knows the answer at 8 sites and gets it wrong at 7.

### E. The payload contract is hand-maintained — **143 of 150 entries**

`EventPayloadMap` has 150 entries: **98 inline object literals**, 52 named types, and only
**7** whose type comes from `@/lib/bindings/*` (`PersonaEvent`, `PersonaMessage`, `TraceSpan`,
`ExecutionTrace`, `AuthStateResponse`, `CircuitTransitionEvent`, `PendingPairingView`). Plus
**32 hand-written `*Payload` interfaces** in the registry file itself.

This repo has a `ts-rs` pipeline with a **CI drift gate** (`git diff --quiet src/lib/bindings/`),
and the boundary that crosses 365 times a corpus-recurrence opted out of it. The cost is
recorded in the codebase: `process_activity.rs:6-15` documents a shipped bug where adding
`#[serde(rename_all = "camelCase")]` made the bridge read `payload.run_id === undefined`,
collapsing every concurrent run into one dock key. That is the failure mode of a hand-copied
contract, written down by the person who fixed it, and it is still hand-copied.

### F. The registry conflates two namespaces

Ten entries are not Tauri channel names at all — they are `persona_events.event_type` values
on the **persona event bus**, registered "for discoverability + the Rust↔TS parity gate"
(`core/src/events.rs:79-90`, `:146-156`, `:295-299`): `review_decision.{approved,rejected,resolved}`,
`incident_resolved`, `sla.breach.{opened,recovered}`, `signal.{raised,verified}`,
`dev_tools.context_scan_{started,completed}`. They are `format!`-constructed at their real
call sites, never emitted over a Tauri channel, and their presence is why "86 registry names
have no subscriber" cannot be read as a defect count. Two namespaces in one table make both
unauditable. (Owner: `domain-event-publication`.)

### G. Doctrine that describes an API that does not exist

`src-tauri/engine/src/event_registry.rs:1-12` — the module docstring of the emit primitive —
instructs the next author to "add a variant to `[TauriEventName]`", "add an entry in the
`[event_name!]` block", and "register the (name, payload) pair via `[impl TauriEvent for
YourPayload]`". **`TauriEvent` does not exist** (0 definitions in 963 files);
`TauriEventName` does not exist; the macro is `event_names!` and lives in another crate. The
same claim is repeated at `core/src/events.rs:12`. And `:4` states "the payload type is
enforced by the generic on `emit_event`" — `emit_event` is
`fn emit_event<P: Serialize + Clone>(app, event: &str, payload: &P)`; `P` is unconstrained by
the name, so nothing is enforced. Three of the five documented steps are fiction, at the
exact file a new author reads first. `src/lib/eventRegistry.ts:5` compounds it, pointing at
`src-tauri/src/engine/event_registry.rs` — a path that has not existed since the crate split.

### H. The frontend bypasses its own subscription layer — **68 raw `listen()` calls in 45 files**

Against **37** `typedListen` calls (32 of them inside `eventBridge.ts` itself), **6**
`useTauriEvent`/`useTypedTauriEvent` call sites, **5** `createSingletonListener` hooks and
**1** `useRunEventListener`. So roughly **85% of component-level subscriptions are
hand-rolled**, and with them their teardown, their race handling and their payload type.

Of the 120 total subscription sites, **14 name the event with a hardcoded string** —
`useRunnerState.ts:152` and `HealingToast.tsx:58` both write `'healing-event'` while
`EventName.HEALING_EVENT` exists; `DriveKnowledgeDrawer.tsx:47` writes `"kb:ingest_complete"`;
`TauriPlaywrightAdapter.ts:63,81` write two `auto-cred-*` names that are in the registry. The
other eight name events that are in **neither** registry.

**26 sites resolve the name dynamically** (a variable, a binding field), which is how the
five `lab-*` names and the three `companion://*-install` names stay invisible to every
audit — including this one, until the indirections were traced by hand.

### I. Broadcast with no scoping mechanism

`app.emit` is global. Tauri's window-scoped `Emitter::emit_to` is used **zero** times, and
the repo's own `emit_to` free function is an unrelated helper over `ExecutionEventEmitter`
(a naming collision that will mislead the next reader). The app does open a second WebView
(`commands/infrastructure/auth.rs:438`, `:571` — the OAuth window), so every event is already
delivered to more surfaces than intended; it is harmless only because that window hosts a
third-party page with no listeners.

Correctness therefore rests entirely on per-handler discriminator checks, which are
convention. Where two features listen to one event, both currently filter
(`StandardsScanCard.tsx:39` / `StandardsScan.tsx:63` both compare `project_id`) — but nothing
requires it, and `eventBridge.ts:418` documents a shipped bug from exactly this class:
filtering on a *scalar* "active session id" instead of set membership silently froze every
backgrounded build.

## 8. Gaps in the primitive

1. **`emit_event` takes `&str`, so "registered" and "invented" are the same type.** This is
   upstream of §7 A, §7 C and half of §7 H. Contrast `invokeWithTimeout`, whose typed
   `CommandName` *and* an ESLint `no-restricted-imports` entry make the raw call
   unreachable. §9 proposes the fix.
2. **`emit_event` swallows the `Result`** (`event_registry.rs:37`, `let _ = app.emit(...)`).
   `try_emit_event` exists for this and has **zero** callers; `emit_event_bus` and
   `emit_process_activity` each re-derive their own `tracing::warn!`. Three answers to one
   question, and the default is the silent one.
3. **`ExecutionEventEmitter::emit` is unreachable through a trait object** (`Self: Sized`,
   `events.rs:45-51`) and is marked `#[allow(dead_code)] // pending: callers currently route
   through emit_json`. Every real caller goes through the free `emit_to`, which serializes to
   `serde_json::Value` and then `unwrap_or(Value::Null)` — **a payload that fails to
   serialize is emitted as `null` rather than erroring** (`events.rs:118`). The typed path
   the trait advertises is not the path anyone takes.
4. **No `ts-rs` bridge for payloads.** There is no macro or convention that says "an event
   payload struct derives `TS`", so the 143 hand-written TypeScript shapes have no forcing
   function. This is the single highest-value structural fix in the document and it is
   mechanical: add `#[derive(TS)] #[ts(export)]` to each payload struct, replace the
   `EventPayloadMap` entry with the generated import, and the existing CI binding-drift job
   holds the line for free.
5. **No fallback primitive for a Channel-based stream.** `build_session` needed
   "stream to the live surface, broadcast for the navigated-away case" and solved it with a
   `window`-global `Set<string>` (`useBuildSession.ts:70`, `eventBridge.ts:404-406`). The
   solution is good; it is also unshared, undiscoverable and untyped. A
   `useChannelWithFallback(channel, EventName.X, sessionId)` would generalise it.
6. **No written decision procedure for transport choice.** Three transports, zero rules —
   and the convergence check found the same hole in both sibling repos, which suggests this
   is a genuinely unmet need rather than local sloppiness. §4 step 1 is a first draft; its
   right home is a doc comment beside `emit_event`, cited by line number from the feature docs.
7. **`createSingletonListener` cannot express a per-run subscription.** It keys on the event
   name only, so an execution-scoped stream still fans out every payload to every subscriber
   and each one re-filters. A `createKeyedSingletonListener(name, keyOf)` would let the
   primitive do the discriminator check that §7 I leaves to convention.
8. **The 6-second CDC blackout is a fixed sleep** (`cdc.rs:332-341`). It is compensated by a
   DB replay (`:345-351`) and frontend dedupe, which is a good design — but the number is a
   guess about WebView readiness, not a signal from it, and on a slow cold start the replay
   is doing all the work.
9. **No sequence number, no delivery guarantee, no ordering guarantee.** Correctly noted at
   `eventRegistry.ts` for `REMOTE_JOB_UPDATED` ("Ordering is not guaranteed by Tauri, so the
   merge and the stale-push guard live in `upsertRemoteJob`"). That guard exists at exactly
   one call site. Every other listener assumes ordered, exactly-once delivery.

**Not a gap — confirmed working:** the `EventName` ⇄ `EventPayloadMap` exhaustiveness
assertion genuinely fails the typecheck on drift; `check-event-registry.mjs` genuinely fails
when one side's table is missing a name (it is *not* vacuous in that case — see §9 for the
case where it is); `eventBridge.ts`'s retry ladder and generation token are correct and the
teardown-must-not-mutate-state rule at `:739-744` is the right call; `createSingletonListener`'s
setup/teardown race handling (`:106-130`) is correct including the subscriber-left-during-setup
branch.

## 9. The missing gate

**Every deviation above shipped under a green `npm run check`** — including
`check:contracts`, which runs `check-event-registry.mjs` on every check and passes.

### Prefer a type over a gate — and here the type is available

Before proposing a signal, the contract asks whether the primitive's signature can make the
wrong call impossible. **On this leaf, on both sides, it can — and one side already proves it.**

**The frontend already has the type.** `typedListen<K extends keyof EventPayloadMap>`
makes an unregistered name a compile error. It is not adopted (37 vs 68) for one reason: raw
`listen` is importable. The repo *already knows* the fix — `eslint.config.js:73-82` restricts
`invoke` from `@tauri-apps/api/core` with a message pointing at `invokeWithTimeout`. Adding
`{ name: "@tauri-apps/api/event", importNames: ["listen", "once", "emit"] }` with a message
naming the four primitives converts 68 hand-rolled subscriptions into 68 lint errors with a
mechanical fix, and closes deviation classes D and H at the same time. **This is a
five-line change to an existing config and it should land before any census rule.**

**The backend can have it.** Make the event name a newtype whose field is private to
`personas_core::events`, so only the macro can construct one:

```rust
// personas_core::events
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct EventName(&'static str);          // field private to this module
impl EventName { pub fn as_str(self) -> &'static str { self.0 } }

macro_rules! event_names {
    ($($c:ident => $s:literal),* $(,)?) => {
        pub mod event_name { use super::EventName;
            $(pub const $c: EventName = EventName($s);)* }
    };
}

// engine::event_registry
pub fn emit_event<P: Serialize + Clone>(app: &AppHandle, event: EventName, payload: &P)
    -> Result<(), tauri::Error>                      // and stop swallowing it (Gap 2)
{ app.emit(event.as_str(), payload.clone()) }
```

`emit_event(&app, "my-thing", &p)` then fails to compile, everywhere, forever. The 54 shadow
names become 54 compile errors with an obvious fix (add the name to the table). The remaining
hole is direct `app.emit`, which Rust cannot restrict by import — but **clippy can**, and this
repo already runs `cargo clippy -- -D warnings` in its PR gate. A `src-tauri/clippy.toml` with

```toml
disallowed-methods = [
  { path = "tauri::Emitter::emit", reason = "use emit_event(&app, event_name::X, &payload) — the registry is the contract" },
]
```

turns every bypass into a denied lint. **Type + clippy closes deviation classes A and B
permanently; the census rules below are the ratchet that holds the line until they land.**

### The census rules (emit as-is; the orchestrator merges into `scripts/census/rules.json`)

```json
{
  "rules": [
    {
      "id": "unregistered-tauri-event-name",
      "goldenPath": "docs/concepts/golden-paths/backend-to-frontend-events.md",
      "title": "Tauri event emitted under a name the shared registry does not declare",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\b(?:app[A-Za-z0-9_]*|[A-Za-z0-9_]*handle[A-Za-z0-9_]*)\\s*\\.\\s*emit\\s*\\((?!\\s*(?:&\\s*)?(?:[a-z_][A-Za-z0-9_]*\\s*::\\s*)*event_name\\s*::)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "an AppHandle-shaped receiver calling Tauri .emit() whose first argument is NOT an `event_name::` constant - a module-local const, a raw literal, or an untyped &str threaded in from a config struct. Proxy for: an event name crosses the Rust->JS boundary without being declared in the one registry both sides read."
      },
      "exclude": [
        {
          "path": "src-tauri/engine/src/event_registry.rs",
          "reason": "the emit_event / try_emit_event wrappers themselves - they take the name as a parameter by design; this is the primitive the rule routes callers TO"
        },
        {
          "path": "src-tauri/engine/src/events.rs",
          "reason": "TauriEmitter::emit_json is the headless-safe emitter primitive; its &str parameter is the abstraction boundary the trait exists to provide, not a violation"
        },
        {
          "path": "src-tauri/src/background_job.rs",
          "reason": "BackgroundJobManager holds two &'static str event names given at construction; all nine production constructors pass event_name:: constants, so this indirection is registry-backed"
        },
        {
          "path": "src-tauri/src/engine/system_ops.rs",
          "reason": "its two consts are `pub const X: &str = event_name::Y;` aliases re-exported for the system-op catalog, so both emits are registry-backed by construction"
        }
      ],
      "baseline": { "files": 31, "matches": 71 },
      "floor": 900
    },
    {
      "id": "unmanaged-tauri-subscription",
      "goldenPath": "docs/concepts/golden-paths/backend-to-frontend-events.md",
      "title": "Tauri event subscription created outside the five subscription primitives",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "(?<![.\\w$])listen\\s*(?:<[^>()]*>)?\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a bare listen() call outside the five primitives that own subscription lifecycle (eventBridge registry, useTauriEvent/useTypedTauriEvent, createSingletonListener, useRunEventListener, typedListen). Proxy for: a subscription whose teardown, async-registration race and event-name typing are re-derived per call site instead of owned by one layer."
      },
      "exclude": [
        {
          "path": "src/lib/eventRegistry.ts",
          "reason": "typedListen is the typed wrapper the rule routes callers to; it must call the raw API"
        },
        {
          "path": "src/lib/eventBridge.ts",
          "reason": "the declarative app-level subscription registry - the primitive that owns attach/retry/teardown for process-lifetime listeners"
        },
        {
          "path": "src/hooks/useTauriEvent.ts",
          "reason": "useTauriEvent / useTypedTauriEvent are the component-lifetime primitives that own the cancelled-flag teardown race"
        },
        {
          "path": "src/hooks/realtime/createSingletonListener.ts",
          "reason": "the singleton fan-out primitive - one underlying subscription shared by N React consumers"
        },
        {
          "path": "src/hooks/realtime/useRunEventListener.ts",
          "reason": "the run-status binding primitive that owns terminal-phase detection and multi-binding teardown"
        },
        {
          "path": "**/__tests__/**",
          "reason": "test doubles legitimately stub and call listen() directly to drive fixtures"
        },
        {
          "path": "**/*.test.ts",
          "reason": "test doubles legitimately stub and call listen() directly to drive fixtures"
        },
        {
          "path": "src/test/**",
          "reason": "the test-automation harness drives the real event API on purpose"
        }
      ],
      "baseline": { "files": 45, "matches": 68 },
      "floor": 4000
    }
  ]
}
```

**Measured** — `node scripts/census/run-census.mjs --rules <tmp> --check` exits **0**:

```
rule                            files  base  matches  base  walked  floor
OK  unregistered-tauri-event-name   31    31       71    71     963    900
OK  unmanaged-tauri-subscription    45    45       68    68    4829   4000
census OK — 2 rule(s), 5792 file-visits, 139 surviving violation(s) across 76 file(s)
```

A second, independently written matcher (not sharing `scripts/census/lib/engine.mjs`) reports
**31 / 71 / 963** and **45 / 68 / 4829** — exact agreement on both, per the contract's
"verify through a second implementation before baselining". The merged registry
(`npm run census:check`, 9 rules) still passes.

**Precision, by reading all 139 matches.** Rule 1: 71/71 true positives after the four
excludes. The four excluded files were each verified by tracing their callers — every
`BackgroundJobManager::new` and `system_ops` const resolves to an `event_name::` constant.
Three matches deliberately kept as true positives are *indirection carriers* whose threaded
names are unregistered: `db/src/cdc.rs:394,424` (7 unregistered names via `table_to_event`),
`engine/src/test_runner.rs:1329,1585,1734,1842` (5 unregistered `lab-*`), and
`companion/orchestration/mcp/handlers.rs:239,325` (2 unregistered `athena://mcp/*`) — the
fix is at the declaration, but the emit is where the boundary is crossed. Rule 2: 68/68
true positives; the five primitives are excluded by name.

**The semantic conditions these signals proxy for.** Rule 1: *an event name crosses the
Rust→JS boundary without being declared in the one registry both sides read.* Rule 2: *a
subscription whose teardown, async-registration race and payload typing are re-derived at
the call site instead of owned by one layer.* The regexes are not those conditions; they are
the shapes the conditions wear **here**, where `AppHandle::emit` is the only emit transport
and `@tauri-apps/api/event`'s `listen` the only subscribe transport. An adopting repo must
re-derive its own proxies — in `personas-cloud` the same first condition is "an SSE
`sendEvent(...)` call, or a `produce(topic, …)` whose topic is not from `TOPICS`", and an
`app.emit` signal scores **0** there while **6 of 6** UI-facing event names sit undeclared in
plain sight. That is the wave-1 failure mode, which is why the condition is stated and not
only the regex.

**Preconditions, stated so they can be invalidated.** Rule 1 assumes (a) `AppHandle::emit`
is the only way to reach the WebView with a named event — it becomes partially inert the day
someone adopts Tauri's window-scoped `Emitter::emit_to` (0 uses today, §7 I) or a second
`Channel`-shaped transport grows a name; and (b) that a Tauri `AppHandle` binding is spelled
`app*` or `*handle*` — true at **209 of 233** `.emit` receivers today, and the 24 exceptions
are all non-Tauri `emit` methods on local structs (`StatusEmitter::emit(status, …)` ×8,
`p2p::RemoteJobs::emit(&job)` ×9, `jobs::sink.emit(&x)` ×4, test emitters ×3), which is why
the receiver filter *raises* precision rather than lowering recall. Rule 2 assumes the raw `listen` import remains possible; **if the ESLint restriction
above lands, rule 2's count should collapse to near-zero and the rule should then be
deleted, not baselined at 0** (the engine treats a zero-match rule as structurally broken,
which is the correct behaviour). **Fail-loud is delegated to the census engine**, which exits
1 when the walk sees fewer files than `floor`, when a rule matches zero files, when an
`exclude` goes stale, when a count rises, and — critical for migrations this size — when a
count *drops* without the baseline being ratcheted.

**Expected trajectory.** Both should ratchet **down** to zero and then be removed: every one
of the 71 is a mechanical edit (add the name to `event_names!`, reference the const), and
every one of the 68 is a mechanical swap to `useTypedTauriEvent` / an `eventBridge` entry.

### What the existing gate cannot see, and its one vacuous mode

`scripts/check-event-registry.mjs` compares **two registries to each other**. It never reads
an emit site or a subscribe site. Therefore it is structurally blind to:

- all **54** names emitted outside both registries (§7 A) — they are in neither table, so
  neither list reports them missing;
- `execution-complete`, subscribed and never emitted (§7 C);
- the 7 CDC and 1 lab event names with no subscriber;
- every payload shape, which its own header concedes ("Payload shape parity remains a
  TypeScript/Rust binding concern").

Its **allowlist is a hardcoded inline filter** — `.filter((name) => name !== "system-trace-updated")`
with a one-line comment and no structured reason, which is the thing the census `exclude`
contract exists to prevent.

**On fail-loud, precisely:** the earlier claim that this script passes vacuously is *false in
the realistic case* and I confirmed it by reading and by execution. If the TS `EventName`
object cannot be found it exits 1 (`:22-25`); if **one** side's extraction breaks, the other
side's names all report as missing and it exits 1. There is exactly one vacuous mode — **both**
extraction regexes failing at once — which I verified by replicating its decision logic with
two empty maps: it prints `Event registry OK (0 Rust events, 0 TypeScript events)` and exits
**0**. A two-line floor (`if (rustEvents.size < 100 || tsEvents.size < 100) process.exit(1)`)
closes it, and would have cost nothing to add.

### The third assertion, which needs ESLint rather than the census

Deviation class D — the 7 leaking subscriptions — **cannot** be a text count. The
discriminator is whether the cleanup closure captures the *promise* or a *variable assigned
inside `.then`*, which is AST shape, not text. The rule:

- **Name:** `custom/no-unmanaged-tauri-subscription` (or extend the existing
  `custom/no-unmanaged-effect-resources`, whose measured precision on this class is 0/3 —
  the census runner's own header records that).
- **Signal:** inside a `useEffect` callback, a `CallExpression` to `listen`/`typedListen`
  whose result flows into an outer `let` via a `.then` callback assignment **or** an `await`,
  where the effect's returned cleanup function references that binding without any
  guard variable also assigned in the effect body. Report: *"a subscription that resolves
  after unmount is never detached — use `useTypedTauriEvent`, or return
  `() => promise.then(f => f())`."*
- **Allowlist, named:** none needed — all 8 correct sites use the promise-capturing form,
  which the rule does not match.
- **Autofix:** none; the correct rewrite is usually "use the hook", not "add a flag".
- **Fixture-tested** with `RuleTester` covering both correct spellings and both broken ones,
  so it fails loudly rather than silently matching nothing if the JSX/effect shape changes.

The three compose in the documented way: **the type change removes the class, the ESLint
rules report what the type cannot reach, and the census ratchets both to zero.**

### What no gate can cover

Transport choice (Gap 6) and discriminator correctness (§7 I) are judgements. A machine can
see that `payload.run_id` is never read in a handler; it cannot know whether that handler
*should* be run-scoped. The available substitute is documentation placed where the decision
is made — §4 step 1 belongs as a doc comment beside `emit_event`, cited by line number from
`docs/features/execution/README.md`, which is what the convergence check found *both* sibling
repos wishing for and neither having. That is a finding, not an omission.
