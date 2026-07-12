> Context: api/agents
> Total: 4
> Critical: 0  High: 0  Medium: 2  Low: 2

## 1. Most `executePersona` callers pass no idempotency key — manual/trigger runs have zero double-submit protection
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary / dedup
- **File**: src/api/agents/executions.ts:50-65 (callers across `features/` and `stores/`)
- **Scenario**: `executePersona` only threads `opts.idempotencyKey` when the caller supplies one (`idempotencyKey ? { idempotencyKey } : undefined`). Confirmed callers that pass **nothing**: `useScheduleActions` (manual trigger), `ExecutionStep` (onboarding), `MonitorCapabilities`, `useRunnerExecution`, `useTriggerOperations`, `useTriggerHistory`, `useDeploymentTest`, `ApiPlayground`, `useUseCaseExecution`, `CommandPalette`, `ExecutionDetailContent` (rerun), `runPersona.ts`. If a user double-clicks "Run", a schedule/trigger fires twice inside the window, or React re-invokes the handler, two concurrent `execute_persona` invokes both spawn — the inflight `idempotencyKey`/`inflightByKey` dedup only collapses calls that *share a key*, and a keyless call produces `idempotencyKey: null` on the wire.
- **Root cause**: The dedup safety net is opt-in per call site; `execute_persona` is also deliberately kept OFF `BLOCKING_MUTATION_TIMEOUTS` (tauriInvoke.ts:65-67) *because* it "already has server-side idempotency-key dedup" — a guarantee that only holds when a key is actually sent, which most manual paths don't do.
- **Impact**: duplicate executions (duplicate side effects, notifications, and token/cost spend) on a normal double-submit path; and if a spawn ever exceeds the 90s default and the user retries, at-least-once double-execution.
- **Fix sketch**: Default `idempotencyKey` inside `executePersona` when absent (e.g. `idempotencyKey ?? crypto.randomUUID()`) so every call is at least self-dedup'd against concurrent duplicates, or require the key at the type level and generate it in a shared runner hook.

## 2. `upsertPolicy` spreads a partial opts object, leaving unset `Option<T>` fields as *missing* keys
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case / convention-divergence
- **File**: src/api/agents/evolution.ts:14-28
- **Scenario**: `invoke("evolution_upsert_policy", { personaId, ...opts })` only emits keys for the opts fields the caller actually set. Every *other* wrapper in this module (and the codebase generally) passes each optional explicitly (`limit: limit`, `useCaseFilter: useCaseFilter`, …) so `coerceArgs` can turn `undefined` into an explicit `null`. `coerceArgs` cannot null a key that isn't present, so an omitted field (e.g. call `upsertPolicy(id, { enabled: true })`) arrives with `mutationRate`/`variantsPerCycle`/… entirely absent rather than `null`.
- **Root cause**: object-spread of a partial instead of the module's explicit "pass every field, let coerceArgs null it" contract that tauriInvoke.ts:280-291 documents.
- **Impact**: relies on Tauri/serde treating a missing arg as `None`; the module's own defensive pattern exists precisely to not rely on that. If a backend field is ever tightened to require present-null, a partial upsert throws instead of no-op'ing the unset fields.
- **Fix sketch**: List each opt field explicitly (`enabled: opts.enabled, fitnessObjective: opts.fitnessObjective, mutationRate: opts.mutationRate, …`) so `undefined`→`null` coercion applies uniformly.

## 3. `buildSession.ts` hand-rolls `SimulationArtefacts` / `SimulatedExecution`, shadowing the generated ts-rs bindings
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication / type-drift
- **File**: src/api/agents/buildSession.ts:168-215
- **Scenario**: A generated single-source binding already exists at `src/lib/bindings/SimulationArtefacts.ts` (typing `reviews: PersonaManualReview[]`, `memories: PersonaMemory[]`). buildSession.ts instead declares its *own* `SimulationArtefacts` and `SimulatedExecution` interfaces with loose inline shapes and `[key: string]: unknown` escape hatches, and `BuildSimulatePanel.tsx` imports the hand-rolled ones from `@/api/agents/buildSession`. This is the exact drift class the codebase already got bitten by and fixed for `ExecutionPreview` — see the comment at executions.ts:126-130 ("The hand-rolled duplicate previously drifted: it typed the token counts as `number` where the Rust u64 generates `bigint`").
- **Root cause**: local interfaces authored before/instead of consuming the generated binding; the `[key: string]: unknown` index signature actively hides future field drift from the compiler.
- **Impact**: maintainability — backend struct changes to reviews/memories/executions silently diverge from the frontend types, with no compile error to catch it.
- **Fix sketch**: Re-export the generated `SimulationArtefacts` (mirroring the `ExecutionPreview` fix) and type `SimulatedExecution` off the generated `PersonaExecution` binding; drop the inline index signatures.

## 4. Scattered mid-file imports break the module header convention
- **Lens**: code-refactor
- **Severity**: low
- **Category**: cleanliness
- **File**: src/api/agents/automations.ts:40; src/api/agents/personas.ts:95-99, 178
- **Scenario**: `import type { BlastRadiusItem } from "@/api/agents/personas"` sits at automations.ts:40 (between exports), and personas.ts pulls `ImportResult`/`GalleryPublishResult`/`PresetPublishResult`/`ReferralStats` at lines 95-99 plus an inline `import('@/lib/bindings/PersonaGatewayExposure')` at line 178 — all in the middle of the file rather than the import header. Verified these are ordinary type imports with no circular-dependency reason to be deferred.
- **Root cause**: imports appended next to the code that first needed them instead of hoisted to the top block.
- **Impact**: maintainability only — harder to see a module's dependency surface at a glance; easy to duplicate an import.
- **Fix sketch**: Hoist the mid-file `import type` lines into the header import block (keep the `import()` type-only reference inline if preferred, or promote it too).
