# Bug Hunter Fix Wave 4 — Recovery / healing & execution-runtime

> 4 criticals closed across 3 commits, 0 regressions.
> Theme: recovery code that fails silently — don't treat a failed/missing
> recovery step as success, don't act on a lost diagnosis, and don't strand or
> drop work. The deepest, most central engine internals fixed so far.
> Baseline preserved: `cargo check --features desktop` 0 → 0 errors. No frontend
> changes (tsc still 0; the 5 pre-existing vitest failures are unrelated).

## Commits

| # | Commit | Finding(s) closed | File(s) |
|---|---|---|---|
| 1 | `141fab909` | pipeline-agent-chains #1 — fan-in drops predecessors | `src-tauri/src/engine/pipeline_executor.rs` |
| 2 | `6acedb8f1` | incidents-manual-review #5 — continuation with lost context / simulation | `src-tauri/src/engine/incident_continuation.rs` |
| 3 | `965e3449e` | self-healing-auto-rollback #1 **+** execution-runner-inspector #1 (same file) | `src-tauri/src/engine/mod.rs` |

## What was fixed

1. **Fan-in nodes silently drop all but one predecessor's output.** `resolve_node_input` used `find_map` over predecessors, returning the first non-empty (last-listed) output and discarding the rest. In a diamond topology the aggregator/synthesizer ran on one arbitrary branch while the pipeline reported `completed`, and `create_node_memory` persisted the partial result as authoritative. Fix: when ≥2 predecessors produced output, merge them into `{ "inputs": { member_id: output } }`; single/zero-predecessor cases unchanged.
2. **Continuation re-runs blocked work with no context / from a simulation.** The continuation loop collapsed both NULL and unparseable `input_data` into a silent `None`, starting a contextless re-run (the agent fabricates work / runs against empty input) that logs a "successful continuation" and can take real irreversible actions — and it never re-checked simulation origin. Fix: refuse `is_simulation` origins, and distinguish absent/empty/unparseable input → abort (warn, leave the incident claimed-but-not-continued for a human) instead of running contextless.
3. **AI healing success theater (engine/mod.rs).** `process_healing_result` + the `phase:"completed"` emit + the retry-of-original-task spawn fired unconditionally after the healer session, trusting LLM-reported `should_retry` even when the healing run timed out / was rate-limited / cancelled — painting a failed heal green and retrying off a wrong diagnosis (burning budget, possibly applying a bad DB fix). Fix: gate all of it on `result.success && !cancelled`; a non-success heal emits `phase:"failed"` and applies nothing.
4. **Queue starvation on lost context (engine/mod.rs).** `drain_and_start_next` claims a queued slot AND a running slot via `drain_next_global`, then looks up the saved context. The "context missing" `else` branch (queue/context-map divergence, e.g. a cancel that popped after the drain) released the running slot but never re-drained — so a single divergence permanently stranded the persona's whole queue (the zombie reaper only sweeps `running`). Fix: mark the orphan failed (`persist_status_if_not_final`) and re-invoke `drain_and_start_next` so the freed slot reaches the next candidate (every other terminal path already re-drains).

## Verification (before / after)

| Gate | Baseline | After Wave 4 | Notes |
|---|---|---|---|
| `cargo check --features desktop` | 0 errors | 0 errors | All four verified together; the drain re-drain is the same boxed-async recursion the success path already uses. |
| `tsc --noEmit` | 0 errors | 0 errors | No frontend files changed. |
| `vitest run` | 5 pre-existing failing | 5 (same) | Unchanged — no frontend changes. |

No regressions introduced.

## Cumulative status (across all waves)

| Wave | Theme | Criticals closed | Commits |
|---|---|---:|---|
| 1 | Concurrency / missing-CAS double-execution | 5 | `c3ab4aa7f` `6e960f1b5` `fa326eb14` `9d1de3d78` `0ff899369` |
| 2 | Security & trust-boundary | 5 | `b8f759842` `a3eebc13c` `a02e21210` `34a3fc3f3` `a0b13eaec` |
| 3 | Data-loss: watermark/cursor | 3 | `906645e6d` `d39a6f503` |
| 4 | Recovery/healing & execution-runtime | 4 | `141fab909` `6acedb8f1` `965e3449e` |

Criticals closed: **17 / 42**. Findings closed overall: **17 / 260**.

## Patterns established (catalogue additions, items 12–14)

12. **Gate a recovery action on the recovery itself succeeding.** A healer/retry/rollback that reads `should_retry`/`fixes`/`diagnosis` from a sub-run's output must first check that sub-run's `success` (and not-cancelled). A timed-out or cancelled run can have emitted an optimistic marker earlier in its stream; trusting it presents a failed recovery as success and acts on a wrong diagnosis. Fail closed.
13. **Every slot-releasing branch must re-offer the freed slot.** A scheduler that claims a slot then dead-ends on one branch (missing context, error) without re-draining permanently strands the queue. Ensure ALL exit paths — success, panic, cancel, divergence — re-drain, and write the orphaned item to a terminal status so a reaper can observe it.
14. **Collapsing N→1 (or absent+malformed→one None) hides loss.** `find_map` over multiple sources silently drops all but one; `.ok()` conflates "absent" with "malformed". When the count or the distinction matters, branch on it: merge multiple inputs, and separate absent-vs-unparseable so each gets the right handling (abort vs default vs merge).

## What remains

25 criticals across the other themes (see `INDEX.md`). Related recovery/runtime items still open (High/Med): auto-rollback picks "previous" by version number with no health check, healing retry-count collision, AI-heal can revive a circuit-breaker-disabled persona, queued executions never reaped during quota cooldowns, pipeline approval pre-arm race / persona-node timeout zombies, incident reopen never clears `continued_at`. Next highest-leverage wave per the INDEX plan: **Foundation multipliers** (tauriInvoke dedup shared-mutable reference, i18n interpolate panel-blank, credential-ledger regex wipe + ledger races).
