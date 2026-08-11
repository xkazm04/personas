# Salvaged miner report — editor + use-cases + quick-answer/triage pocket (123/123 files read)
# Ground: src/features/agents/sub_editor/** (35), sub_use_cases/** + sub_settings/** (33), quick-answer/** + shared/quickConfig (55)

## P1 — Optimistic resolve with a THREE-way failure taxonomy (deferral / failed write / lost CAS)
A queue removing rows optimistically must distinguish: deferral (write nothing), failed write (restore row AND reader cursor), lost compare-and-swap (KEEP resolved — restoring would re-offer a decision that can never land).
- src/features/agents/quick-answer/triage/useUnifiedTriage.ts:1017-1105 (impl), :1064-1070 (lost-CAS ruling), :1120-1163 (undo reuse)
- __tests__/useUnifiedTriage.test.ts:392-449, :451-500, :561-609, :431-448 (no restore on SECOND failure)
evidence_count: 4

## P2 — Render cost as an assertion (spy on expensive leaf + render counter via a hook every component calls)
MarkdownRenderer mocked to a spy (re-parses countable); useTranslation wrapped to tick a render counter; budget asserts perKeystroke <= 8, < mounted/3, AND > 0 (sanity); anti-freeze pair asserts changed content STILL re-parses ("memo must be a cache, not a freeze").
- triage/__tests__/triageRenderCost.test.tsx:23-30, 41-52, 245-251, 130-140, 265-279, 12-17
evidence_count: 6 cases

## P3 — Memoise a hook's return BECAUSE a named downstream memo depends on it
Each memo documented with the consumer it protects; the whole prop chain tested (P2).
- usePendingInteractions.ts:160-191; useUnifiedTriage.ts:1186-1242; QuickAnswerPopover.tsx:50-98; TriageDeckVariant.tsx:101-106; MetricBadgeRow.tsx:61-69; DeckTopBar.tsx:165-174; DeckQueueRail.tsx:134-142; TriageCardBody.tsx:44-53
evidence_count: 8 sites

## P4 — Rebuild-cost tests with a legacy oracle
Keep the old implementation verbatim in the test as oracle; spy on the allocation itself (JSON.parse callcount = 1 per workspace; Storage.setItem length 1); total-order property test over shuffled inputs with deliberate ties. Micro: RFC3339 is fixed-width ASCII so `<`/`>` IS collation — drop localeCompare in hot comparators (triageTypes.ts:363-373).
- triage/__tests__/triageRebuildCost.test.ts:38-56, 69-86, 199-209, 249-266, 123-157, 159-175
evidence_count: 3 describes

## P5 — Exhaustiveness tests derived from the type's own constant + guard-the-guard
switch with no default returning Promise<void> = a new kind silently no-ops; test iterates TRIAGE_KINDS × verdicts asserting {kind, verdict, honoured:true} (failure NAMES the kind); second loop guards that every kind actually had a decidable case. Fixtures export ALL_KINDS derived from TRIAGE_KINDS. Compile-time sibling: PersonaDraft.ts:59-66 (_AssertAllCovered & _AssertNoExtra).
- triage/__tests__/triageDispatch.test.ts:104-149, :46-51 (writeCount); triageFixtures.ts:49-50
evidence_count: 4 files

## P6 — Cursor as an ID, never an index; bounded "not now" (MAX_SKIP_PASSES=2); numerator part of denominator
Polls replace the queue wholesale so a remembered NUMBER means a different card; missing id resolves to front. sessionTotal = resolved.size + pending.length by construction. withoutSkip exists because the bound makes accidental skips unrecoverable.
- triage/triageQueue.ts:54-69, :164, :33-42, :170, :104-119; triageQueue.test.ts:64-80, :94-113; DeckTopBar.tsx:189-193; triageRebuildCost.test.ts:88-109; deckQueueRail.test.tsx:34-60
evidence_count: 5

## P7 — Injected ports make an untestable branch testable; asymmetries documented not smoothed
Contract stated as invariant: "Every decision either DEFERS, or WRITES, or THROWS. Never nothing." Port asymmetries each justified (split apply/decline; omitted tokens named as deliberate; ordering with stated residual; Promise.all chosen so one failure reaches the caller; deep-links that write nothing still THROW when route absent).
- triage/triageDispatch.ts:1-21, :12, :34-116, :69-78, :89-100, :169-183, :266-270, :212-221, :272-283
evidence_count: 7 rulings

## P8 — seenStatus rides from the card that was RENDERED (client-side CAS); undo derives its expectation from the verdict just made
reversibleStatus returns null for kinds with no reverse door ("an undo button that cannot deliver is worse than no undo button"). Goals carry NO token because the backend has no CAS — "a token nothing reads would advertise a protection this queue does not have."
- triageAdapters.ts:810-815, 934-937, 1205, 1320-1325; triageDispatch.ts:168, 203, 235, 251, 317-323, 334-342; triageDispatch.test.ts:510-519; useUnifiedTriage.test.ts:794-836; triageGoalAdapter.test.ts:94-103
evidence_count: 6

## P9 — An empty surface must distinguish finished / filtered / batched / unread (+ per-source failures)
Total outage used to render "nothing is waiting on you". Model: failures[], backlog.remaining (exact, only the keyset source may report it), backlog.capped (fixed-limit query came back full = "told you nothing about what is behind it"). failed outranks cleared absolutely; filtered and batched are independent facts each keeping their own action; "deal next batch" not offered when there is no next page.
- useUnifiedTriage.ts:180-214, 243-252, 543, 384-399; DeckStates.tsx:11-16, 212-218; TriageDeckVariant.tsx:154-163; deckHonestEndings.test.tsx:94-119, 157-195, 197-216; quickAnswerHonesty.test.tsx:63-107
evidence_count: 5

## P10 — Identity travels with the async act; a mismatched report is DROPPED, never redirected
itemId captured at LAUNCH; receiver verifies before any write and refuses — even when the incoming card would take the same verdict. Companion: the lock that is also the queue needs a watchdog (FLIGHT_TIMEOUT_MS=1200 lands the decision anyway). Reset-dep root cause: re-dealt last card had same id and rank → add cycle (skip count) to reset deps.
- deck/TriageCard.tsx:76-86, 132-149, 60-68, 160-174; deck/useDeckControls.tsx:236-286, 19-24, 289-309; deckDragIdentity.test.tsx; useDeckControls.test.ts:309-407, 342-353, 363-390, 81-104
evidence_count: 5

## P11 — localStorage as a deliberate, bounded, single-module persistence tier (inline ADR)
ADR written in the file (SQLite vs zustand-persist vs localStorage, with the repoint line). Mechanics each tested: TTL; per-collection caps oldest-dropped; MERGE-patch so two hooks own two halves; version mismatch discarded not migrated; corrupt read = fresh session; test seam. startedAt passed explicitly rather than implicit in write timing. Journal: bounded ring; summary refuses to flatter (undone/conflicted excluded from throughput; median not mean); markUndone AMENDS rather than deletes.
- triage/triageSession.ts:14-45, 53-60, 62-66, 130, 142-147, 165-168, 170-227, 182-194, 242-245; triageSession.test.ts:63-74, 94-122, 138-159; triageJournal.ts:171-189, 225-230, 279-300; triageJournal.test.ts:122-127; useUnifiedTriage.ts:439-463
evidence_count: 6

## P12 — Persisted values stay canonical English; only labels are translated
Reason option = {label (translated), value (canonical, fed back to English-prompted scanners)}. Preset sets live in code not en.json ("data, not copy"). Tested by localising the copy object and asserting the value does not move. fill() templates with named placeholders ("word order is not universal").
- triageTypes.ts:136-153; triageAdapters.ts:491-564, 366-380, 1333-1344; triageAdapters.test.ts:449-457; triageProposalAdapters.test.ts:152-162; triageGoalAdapter.test.ts:246-252
evidence_count: 5

## P13 — EXCLUSIVE keyboard ownership through a registry, tested as "nothing beneath is called"
Priority ladder with neighbours named (deck 70, below KeyboardNavMode 30→? and palette 90). "Exclusivity, not just priority — a key the deck ignores must not reach an invisible surface either." DANGEROUS_KEYS table annotated with what each key does on each surface; symmetric unmount + yields-to-above cases. Vertical keys reserved for reading BEFORE reason mode; `?` dispatches the cheat sheet's own event rather than raising priority; `U` not mod+Z (exclusivity would swallow undo in a text box); recoverFocus because every verdict remounts the top card and drops focus on body.
- useDeckControls.tsx:89-101, 474-493, 538-546, 521-533, 587-591; deckKeyboardOwnership.test.tsx:99-133, 150-172, 174-194; useDeckControls.test.ts:613-627; useDeckDialog.tsx:95-103
evidence_count: 5

## P14 — Accessibility rulings tested as ABSENCES
One live region owned by the app, never the feature (role="status" is an implicit polite region — assert querySelectorAll('[aria-live],[role=status],[role=alert]').length===0 inside the deck). Identical consecutive messages must REMOUNT to be spoken twice ({text,seq} stamp; assert different NODE). Removing a region obliges saying where the fact is announced instead (byte-identical utterance asserted). No colour-only signal (glyph + sr-only word; duplicate meter aria-hidden). Depth-stacked cards: pointer-events-none removes mouse but NOT tab order → tabIndex isTop?0:-1, asserted [0,-1,-1].
- TriageDeckVariant.tsx:82-96, 126-147; TriageCardHeader.tsx:31-37; useDeckControls.tsx:207-217; DeckChips.tsx:64-103; MetricBadgeRow.tsx:12-19; TriageCardBody.tsx:88-99; deckDialog.test.tsx:214-226, 263-275, 296-330, 333-345; deckToneSignals.test.tsx:30-58
evidence_count: 5 rulings

## P15 — Guarding a paid, side-effecting action: sync reentrancy ref + stale-target re-check + idempotency window
Four layers: runInFlightRef claimed BEFORE first await (state in closure = two same-commit clicks both spawn paid runs); live selected-id re-check vs expected; budget gate (documented as frontend patch over backend gap — honest debt marker); short idempotency dedupe window so a deliberate re-run mints a fresh key. Shared by two surfaces so the guarantee cannot fork.
- sub_use_cases/libs/useManualPersonaRun.ts:37-61, 65, 72, 79-87, 90, 112-113, 10-15, 53-59; useUseCaseDetail.ts:144; PersonaLayoutView.tsx:227
evidence_count: 4

## P16 — A mutation queue that reports failure AS A VALUE must be checked, not assumed
`if (result.applied)` — clearing dirty unconditionally was success theater. Same class: failed review verdict closed modal like success; quick-answer fields cleared ONLY on landed write (typed answers are the only copy); success toast fired before the await. Write-first ordering: optimistic store mutation with no rollback moved AFTER the await ("the one failure mode where being optimistic costs data rather than latency").
- useUseCaseDetail.ts:99-108; ActivityModals.tsx:50-56; QuickAnswerQuestionGroup.tsx:44-58; QuickAnswerReviewStepper.tsx:90-107; quickAnswerHonesty.test.tsx:109-157; usePendingInteractions.ts:128-153
evidence_count: 5

## P17 — settingsRef so rapid toggles COMPOSE instead of clobbering
Any read-modify-write over a whole persisted object with async refresh needs a synchronous latest-known ref; each toggle reads+updates the ref, not the closure snapshot.
- recipes-prototype/shared/usePolicyControls.ts:72-80, 97-120; sub_settings NotificationsDimCard.tsx:37-52
evidence_count: 2

## P18 — Debounce with an UNMOUNT FLUSH; discard stale in-flight responses per row
Cleanup performs the write ("the unmount case IS the case"). Rename modal: debounced IPC, late responses discarded per row by comparing queried text to current text at resolve time (counts feed a destructive warning — stale numbers worse than late). Save deliberately NOT gated on advisory counts (backend authoritative).
- useDeckControls.tsx:79-148; useDeckControls.test.ts:567-586; EventRenameModal.tsx:61-106, 136-144
evidence_count: 3

## P19 — Draft keys chosen for the STABLE identity, not the render identity
Drafts keyed `${sourceId}::${fieldKey}`, never cleared on top-item change (poll landing mid-typing used to wipe the half-written answer). Card id deliberately folds in pending cell keys (sorted) so a changed set is a genuinely different card — stable against arrival order.
- useDeckControls.tsx:116-129; triageAdapters.ts:990-1013; triageAdapters.test.ts:160-192; useDeckControls.test.ts:516-545
evidence_count: 3

## P20 — Editorial cross-domain ranking stated ONCE with claims next to numbers, tested as RELATIONS between bands
Seven queues, no shared urgency scale → explicit weight table with the claim written next to each number (incl. arguments against itself: 60+40>95 is FALSE — deliberately). Tests assert relations (smashed>scraped, <120 never-an-incident, above practices, below halted build), not magic numbers. Table mirrored with claims in DESIGN.md; doc header records a dated rewrite + "still-true history" section.
- triageAdapters.ts:382-486; triageProposalAdapters.test.ts:243-262; triageGoalAdapter.test.ts:175-213; triageAdapters.test.ts:330-339, 391-395; quick-answer/DESIGN.md:3-7, 59-88, 188-203
evidence_count: 5

## P21 — Editor refinements
a. Partial-success as first-class error payload: TabSaveError{failedTabs,savedTabs}; saveAll marks succeeded tabs clean BEFORE throwing; per-tab error badge + retry button. (libs/EditorDocument.tsx:20-30, 171-180; usePersonaSwitchGuard.ts:33-37; EditorBody.tsx:70-82, 156-171; EditorTabBar.tsx:31-50)
b. Cross-tab dirty DEPENDENCIES as declared data w/ extension rule. (libs/editorTabConstants.ts:3-46)
c. Parse failure suppresses autosave rather than persisting the reset — block write-back until a human re-asserts. (PersonaDraft.ts:100-110, 146-160; useEditorDraft.ts:34-44, 102-104; useEditorSave.ts:83-90)
d. Deprecating a dangerous default with the cost named (timeout 1_000_000→180_000ms, "top source of unexpected cloud bills"; MIN/MAX exported). (PersonaDraft.ts:5-16; PersonaSettingsTab.tsx:10-11)
e. Registry callbacks held in refs because of Concurrent rendering (discarded render would leave registry pointing at aborted-state closure; stable trampoline dereferences ref at call time). (EditorDocument.tsx:303-334)
f. Event-driven cache invalidation with coalescing + first-load-only skeleton; fetch shape deliberately matched to sibling so read-dedup catches concurrent mounts. (hooks/useQuickStats.ts:26-83; __tests__/useQuickStats.test.ts:49-87)
g. Present-vs-zero distinguishable: hasLatencyData/hasCostData alongside numbers → '—' vs genuine $0; goals: no baseline ⇒ no score ⇒ no meter. (useQuickStats.ts:15-21; QuickStatsBar.tsx:60-78; triageAdapters.ts:1417-1422; triageGoalAdapter.test.ts:139-149)
evidence_count: 7 refinements

## Anti-evidence / debt noticed
DebtText untranslated markers: ActivityFilters.tsx:96-103, CapabilityDisableDialog.tsx, EventRenameModal.tsx, UseCasesRefineCard.tsx; displayUseCase.ts:235-241 TODO(i18n); useHealthyConnectors.ts:23-26 refiring fetch-if-empty; useUseCasesTab.ts:42-44 bare setTimeout(100) scroll.

## Coverage
123/123 files read (editor 35, use-cases+settings 33, quick-answer 55 incl. DESIGN.md + 19 tests + deck 15).
