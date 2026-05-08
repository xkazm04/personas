# Personas as Long-Lived Processes — Design Sketch

**Status:** Shelved — kept for future consideration. Originally backlog idea
`476fd292-reframe-personas-as-long-lived` (generated 2026-05-07). Moved out of
the active backlog because the redefinition cost is too large to sequence
against current ship-readiness work, but the underlying problem is real and the
sketch is worth preserving so the idea can be picked back up cleanly.

---

## Problem

A persona today is configuration that occasionally runs. The "running" is
mediated by 7+ separate subsystems, each with its own state machine, retry
policy, and event vocabulary:

- `execution_engine` — synchronous turn execution
- `scheduler` — cron + interval triggers
- `queue` — fairness + concurrency caps
- `chain` — multi-step persona chaining
- `automation_runner` — event-triggered automations
- `file_watcher` — filesystem-driven invocations
- `ambient_context` — passive signal aggregation
- `replay` — re-running historical events

Symptoms of this fragmentation that already show up in the codebase:

- Several "is the persona running right now?" signals that drift apart in the
  UI (sidebar dot, overview card, run button label, execution count badge).
- Race conditions between scheduler-fired ticks and runner-held locks
  (existing backlog items: `0601ca5c`, `7e399420`, `d9766c5a`, `e166ec9d`).
- Duplicated retry/backoff logic per subsystem with magic-number drift.
- No unified replay — each subsystem replays its own history shape, so cross-
  subsystem causality is invisible.
- Quota and budget enforcement is bolted on per subsystem rather than per
  persona.

## Proposal

Reframe a persona as a **long-lived process** that always exists, driven by an
event-driven tick loop. Every wake-up source becomes one `Event` type in one
queue. Idle is "no events this tick." Memory updates are process state
mutations.

```
+-----------------------+
|   Persona Process     |
|  (long-lived, owned   |
|   by Tauri backend)   |
|                       |
|   +---------------+   |
|   |  Event Queue  | <-+--- cron tick
|   +---------------+   |    file event
|          |            |    webhook
|          v            |    manual click
|   +---------------+   |    chain hop
|   |  tick(): one  |   |    ambient signal
|   |  event drain  |   |    replay request
|   +---------------+   |
|          |            |
|          v            |
|   +---------------+   |
|   | process state |   |
|   | (memory, run  |   |
|   |  history, …)  |   |
|   +---------------+   |
+-----------------------+
```

## Design sketch

### Event schema

```rust
struct Event {
    id: Uuid,                  // stable across replay
    persona_id: PersonaId,
    source: EventSource,       // who produced it
    kind: EventKind,           // semantic intent
    payload: serde_json::Value,
    deadline: Option<Instant>, // soft deadline, scheduler hint
    causality: Option<Uuid>,   // parent event for chain hops
    enqueued_at: Instant,
}

enum EventSource {
    Cron, FileWatcher, Webhook, Manual, ChainHop,
    Ambient, Replay, Internal,
}

enum EventKind {
    Invoke { input: ... },
    Cancel,
    PauseUntil(Instant),
    MemoryWrite { key: String, value: ... },
    HealthProbe,
    BudgetReset,
    Shutdown,
}
```

### Tick semantics

- **Event-driven primarily.** A persona ticks when its queue is non-empty.
- **Bounded watchdog tick** every N seconds (default 60s) when the queue is
  empty, to surface stuck state and let `MemoryWrite` flushes happen even when
  no external source has fired.
- **Single in-flight invocation per persona.** Concurrency lives at the *fleet*
  level (the runtime decides how many persona processes can be `Working`
  simultaneously); inside a process, ticks are serial.
- **Backpressure via the queue.** Quota / budget caps simply drop or defer
  events at enqueue time rather than mid-execution.

### Persistence boundary

| State | Survives app restart? | Survives persona delete? | Survives upgrade? |
| --- | --- | --- | --- |
| `process state` (memory, last-N events, current budget) | yes (SQLite) | no | yes (versioned schema) |
| `event queue` (pending events at shutdown) | yes (SQLite, with `enqueued_at` clamp on restart) | no | yes |
| `replay log` | yes | retained 30d after delete (audit) | yes |
| transient `tick()` cancellation tokens | no | no | no |

Restart strategy: on app boot, hydrate process state and queue per persona,
then resume ticking. Events older than configured TTL are dropped with a
`replay` audit row.

### EventSource mapping

How the existing 7 subsystems collapse into the new model:

| Today | Becomes |
| --- | --- |
| `scheduler` cron tick | `EventSource::Cron` enqueue |
| `automation_runner` rule fire | `EventSource::Internal { rule_id }` enqueue |
| `file_watcher` change | `EventSource::FileWatcher` enqueue |
| `chain` hop | `EventSource::ChainHop` with `causality` set |
| `ambient_context` signal | `EventSource::Ambient` (debounced at producer) |
| manual UI click | `EventSource::Manual` |
| `replay` UI | `EventSource::Replay` enqueue with original `id` preserved |
| `execution_engine` | becomes the `tick()` body of the process |
| `queue` fairness | becomes the runtime's per-persona scheduler that decides which process gets a tick slot next |

## Risks

1. **Migration is the whole problem.** Each existing subsystem has live
   in-flight state on user machines. A wrong migration drops a scheduled
   trigger or replays a webhook. Needs a feature flag, dual-write window, and
   per-persona opt-in.
2. **"Always-on process" implies cost.** Even idle personas consume RAM for
   queue + state. With users running 50–100 personas, this needs hard caps and
   eviction (idle personas are passivated to disk, woken on first event).
3. **Memory semantics get harder, not easier.** "Memory is process state" is a
   nice slogan but raises real questions: is memory transactional with the
   tick? Does a panic mid-tick lose memory writes since last commit? Likely
   needs a per-tick write batch with commit-on-success.
4. **Observability surface needs rethinking.** Today's per-subsystem dashboards
   (cron list, chain runs, file_watcher activity) all collapse into one
   timeline. That's the *win*, but it requires a new view and a migration of
   ~6 dashboards.
5. **Concept overlap with `cadence-engine` (`6cb2e50b`) is total.** The tick
   loop *is* the cadence substrate. These two ideas should not be discussed
   separately — adopting one without the other produces two competing event
   abstractions.

## Migration plan (if/when picked back up)

1. **Slice 0:** define `Event` and `EventSource` types in `src-tauri` only,
   produce-side-only. Existing subsystems keep their state machines but
   *also* emit the new event shape into a shadow log. No consumer yet.
2. **Slice 1:** port `file_watcher` (the cleanest subsystem with the smallest
   footprint) to be a producer-only `EventSource::FileWatcher`. Build the
   single-persona `tick()` consumer for one persona behind a feature flag.
   Run shadow-side-by-side; compare outputs.
3. **Slice 2:** port `scheduler` (cron). This is the load-bearing one — if the
   tick model can't replace cron without dropping ticks across DST, restart, or
   sleep/wake, the redesign isn't ready and we stop here.
4. **Slice 3+:** port chain, then automation_runner, then ambient. `replay` and
   `queue` come last because they read from all the others.
5. **Cutover:** once all sources are dual-emitting and the new consumer matches
   for ≥ 1 week per persona, flip the consumer authoritative and decommission
   the old state machines.

## Open questions

- Does "always-on" mean a Rust task per persona, or a single tick scheduler
  iterating over hot personas? Lean toward the latter for fleet sizes >10.
- How does this interact with the **multi-draft build sessions** issue
  (`project_multidraft_build_gaps`)? Build sessions are themselves long-lived
  workflows — do they piggy-back on the same process abstraction?
- Are templates and the `build_session` engine in scope, or strictly runtime?
  Probably out-of-scope for the first cut; templates remain configuration.
- What's the test strategy for a model where time is observable? Likely needs
  a virtual clock for deterministic replay.

## Related concepts shelved alongside

**Cadence Engine — backend half (from idea `6cb2e50b`).** The original
proposal was a unified `Rhythm` primitive (`Cron`, `Interval`, `Debounce`,
`Backoff`, `Window`, `Once-At`) spanning both frontend and backend. On
2026-05-08 it was split: the **frontend half** moved to active backlog
(`unclear-wins/idea-6cb2e50b`) because typed timing primitives + auto-cleanup
on unmount are an independent win. The **backend half** — `Cron` rhythms,
retry/backoff unification, scheduler/queue/file_watcher poll consolidation —
is shelved here because it is the same problem as the tick-loop substrate
above. Ship one, not both, when this concept is revived: the backend
`Rhythm` types should be designed against the `Event` abstraction in this
doc, not as a parallel system.

## Decision gates before re-opening this

Pick this back up only if **two or more** of these become true:

- [ ] Three or more "scheduler/runner state mismatch" Sentry incidents in a
  quarter that point at the same root cause.
- [ ] User-research feedback that the "is my agent running?" mental model is
  breaking trust at a scale that affects retention.
- [ ] A new feature requirement that needs unified replay across cron + chain
  + automation (the current per-subsystem replay can't satisfy it).
- [ ] An existing concept (cadence-engine, capability-lattice, automation-mesh)
  is being implemented and would benefit from a unified process abstraction
  underneath it.

If only one of those is true, prefer to extract a smaller `EventBus` primitive
without the "personas as processes" reframe.
