# agents/connectors — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 2 high / 2 medium / 1 low)
> Context group: Credentials & Connectors | Files read: 30 | Missing: 0

## 1. Dead feature cluster: DependencyGraphPanel + dependencyGraph lib (~610 LOC, zero importers)
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_connectors/components/connectors/DependencyGraphPanel.tsx:157
- **Scenario**: `DependencyGraphPanel` (383 lines) is imported by no file in `src/` (verified repo-wide grep — only matches are its own definition, `context-map.json`, `lint-output.json`, and an archived deferred-backlog doc). `buildPersonaDependencyGraph` in `libs/dependencyGraph.ts:113` also has zero callers; `analyzeDepBlastRadius` is called only from the dead panel itself.
- **Root cause**: The credential-dependency-graph feature was shelved (it appears in `docs/_archive/concepts/persona-capabilities/10-deferred-backlog.md`) but the implementation was left behind.
- **Impact**: ~610 lines across two files that must be kept compiling, translated (`dg_*` i18n keys), and mentally accounted for on every refactor of `ConnectorStatus`/`PersonaAutomation`; also dead weight in the bundle if anything ever side-imports the module.
- **Fix sketch**: Delete `DependencyGraphPanel.tsx` and `libs/dependencyGraph.ts` entirely (the only external consumer of the lib is the panel). Sweep the now-orphaned `t.agents.connectors.dg_*` translation keys. If the feature is still wanted, the archived backlog doc is the right home for the spec, not live source.

## 2. Dead hook cluster: useSubscriptionManager + subscriptionHelpers (~340 LOC, zero consumers)
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_connectors/libs/subscriptionLifecycle.ts:41
- **Scenario**: `useSubscriptionManager` is exported but never imported anywhere in `src/` (grep matches only its own file plus a comment in `UseCasesList.tsx` and one in `useAutomationSetup.ts` referencing it as a "canonical shape" example). `subscriptionHelpers.ts` (`mergeSubscriptions`, `UnifiedSubscription`, stage derivation) is imported only by the dead hook.
- **Root cause**: The unified trigger/event-subscription lifecycle UI this hook served was removed or rebuilt elsewhere, leaving the state machine (abort controllers, activation sets, optimistic adopted-flag mutation) orphaned.
- **Impact**: 340 lines of nontrivial async/race-handling logic that reads as load-bearing (it wires `createTrigger`/`createSubscription`/`mutateSingleUseCase`) but never runs — a trap for future bug-hunts and API refactors, plus orphaned `lifecycle_error_*` i18n keys.
- **Fix sketch**: Delete `subscriptionLifecycle.ts` and `subscriptionHelpers.ts`; update the two code comments that cite it as the canonical cancelled-fetch pattern (point them at `useAutomationSetup.ts` instead). Sweep `t.agents.connectors.lifecycle_error_*` keys. Verify nothing in tests references `mergeSubscriptions` before removal.

## 3. Dead UI chain: ConnectorsSection → ConnectorStatusCard → ConnectorStatusBadges, plus orphaned hook API and never-opened design modal
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_connectors/components/connectors/ConnectorsTabSections.tsx:61
- **Scenario**: `PersonaConnectorsTab` imports only `ReadinessWarnings` from `ConnectorsTabSections.tsx`; `ConnectorsSection` has no renderer anywhere (the `ConnectorsSection` matches elsewhere in the repo are different, unrelated components in `sub_design`/`sub_n8n`/`sub_generated`). That makes `ConnectorStatusCard.tsx` and `ConnectorStatusBadges.tsx` (imported only by ConnectorsSection) dead too — ~290 LOC. Correspondingly, `useConnectorStatuses` has exactly one consumer (PersonaConnectorsTab) which destructures only `tools/requiredCredTypes/readinessCounts/fetchCredentials`, so its returned `statuses`, `testingAll`, `credentials`, `testConnector`, `handleTestAll`, `handleLinkCredential`, `clearLinkError` are all unused surface. Related micro-dead-code in the same context: `PersonaConnectorsTab.tsx:28-31` `designOpen`/`designInstruction` are never set true/non-empty (the CredentialDesignModal block at line 75 can never render), and `isExecutionReady` (connectorTypes.ts:31), `detectPlatformFromUrl` (automationTypes.ts:66), `canDeploy`/`timeoutSecsInvalid` (useAutomationSetup.ts:220,258 — the modal computes its own weaker disabled condition instead) have zero external callers.
- **Root cause**: The per-connector status-card UI (test / link-existing / swap) was dropped from the Connectors tab (readiness warnings + AgentCredentialDemands replaced it), but the component chain, the hook's action API, and the modal-open scaffolding were left in place.
- **Impact**: ~350 LOC of dead UI + a hook whose exported actions imply behavior that no longer exists; the unused `canDeploy` also means the Deploy button ignores the stricter `timeoutSecsInvalid`/in-flight checks the hook already computes (mild behavioral drift, not just cleanliness).
- **Fix sketch**: Delete `ConnectorsSection` (keep `ReadinessWarnings`, or move it next to PersonaConnectorsTab), `ConnectorStatusCard.tsx`, `ConnectorStatusBadges.tsx`; trim `useConnectorStatuses`' return to what PersonaConnectorsTab consumes (keep the internal auto-test machinery that feeds `readinessCounts`). Remove `designOpen`/`designInstruction` + the unreachable modal block from PersonaConnectorsTab. Either wire `s.canDeploy` into AutomationSetupModal's Deploy button (preferable — it restores the timeout validation) or drop `canDeploy`/`timeoutSecsInvalid`. Drop `isExecutionReady`/`detectPlatformFromUrl` unless Rust-side docs claim them.

## 4. AutomationSetupModal's heavy hook runs while the modal is closed
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_connectors/components/connectors/PersonaConnectorsTab.tsx:74
- **Scenario**: `AutomationSetupModal` is mounted unconditionally with `open={automationModalOpen}`; `useAutomationSetup` therefore runs on every render of the Connectors tab even when the modal has never been opened. It subscribes to four vaultStore slices plus `agentStore.personas`, and `availableUseCases` re-runs `personas.find` + `parseDesignContext` (a JSON.parse of the persona's whole `design_context` blob) on every `personas` array identity change; the credential auto-select effect (useAutomationSetup.ts:129) also fires while closed.
- **Root cause**: Modal open/closed state is passed down as a prop instead of gating the mount, so all of the hook's subscriptions, memos, and effects are always live.
- **Impact**: Every store update that touches personas/credentials/automations re-parses design_context JSON and re-renders the modal component tree for a dialog nobody opened — measurable waste on a tab that sits open while agents run, and it broadens the re-render blast radius of the whole Connectors tab.
- **Fix sketch**: Render `{automationModalOpen && <AutomationSetupModal open personaId=... />}` (state already resets on close via `handleClose`, and edit-mode state is seeded by an effect on mount, so conditional mounting is safe). Alternatively split the hook so only the cheap `open`-independent bits stay mounted.

## 5. DeliveryHealthBadge refetches stats once per delivery event with no coalescing
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/agents/sub_connectors/components/channels/DeliveryHealthBadge.tsx:41
- **Scenario**: `useTypedTauriEvent(EventName.NOTIFICATION_DELIVERY, handleDelivery)` calls `getNotificationDeliveryStats()` (a Tauri IPC round-trip into SQLite) on every single delivery event. A burst of notifications (e.g. test-all across channels, or an automation fan-out) issues one full stats query per event.
- **Root cause**: The event handler fetches eagerly instead of debouncing/coalescing bursts; the identical fetch closure is also duplicated between the mount effect and the handler.
- **Impact**: Bounded but pointless IPC + query chatter proportional to notification volume, with each response triggering a badge re-render; also the `.catch(() => {})` hides failures silently.
- **Fix sketch**: Extract one `refresh` callback used by both the mount effect and the event handler, and debounce it (~500ms trailing) so a burst collapses into one query. Keep the silent catch but route it through `silentCatch("DeliveryHealthBadge:stats")` for consistency with the rest of the context.
