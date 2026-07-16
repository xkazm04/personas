# studio — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Persona Authoring & Design | Files read: 15 | Missing: 0

## 1. Every CLI stream delta triggers a full StudioPage re-render via wholesale `runtimes` subscription
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/studio/StudioPage.tsx:52 (plus studioStore.ts:429-431, StudioChatInput.tsx:37, StudioTabBar.tsx:24)
- **Scenario**: During a build turn the Rust CLI emits many small `cli` stream events per second; each one calls `patch(id, { stream: cur.stream + delta })` — a separate zustand `set`. StudioPage subscribes to the entire `runtimes` map (`useStudioStore((s) => s.runtimes)`), so every delta re-renders the whole Studio tree: the tab strip, the warm-iframe list reconciliation, the preview toolbar, and the dock — even though none of them display the stream. StudioChatInput and StudioTabBar likewise select whole runtime objects and re-render per delta.
- **Root cause**: No batching of stream deltas at the store boundary, combined with coarse selectors — the only component that actually needs `stream` is StudioMessages (which already budgets its markdown re-parse via the typewriter), but the subscription granularity makes every ancestor pay per delta.
- **Impact**: Sustained tens of React commits per second across the largest component tree in the module for the entire duration of every build turn (turns run minutes in autonomous mode), on a page that is also hosting live iframes. This is the hottest path in Studio.
- **Fix sketch**: (1) Buffer stream deltas in the `initStream` listener and flush into the store on a rAF/50ms throttle (one `set` per frame instead of one per chunk). (2) Narrow StudioPage's selectors: it never reads `stream` — select `tabOrder`, `activeId`, and a `useShallow`-derived array of `{id, phase, healthy, url}` for the warm previews instead of the whole `runtimes` object. StudioChatInput can select the specific fields it uses (`busy`, `question`, `autonomous`, `name`, `phases`) with `useShallow` rather than the whole runtime.

## 2. `reload` store action is a no-op self-assignment and has no callers; `clearCreateError` is also never called
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/studio/studioStore.ts:531 (and :467)
- **Scenario**: A future maintainer looking for "reload the preview" finds `useStudioStore.getState().reload(id)`, calls it, and nothing happens — the real reload mechanism is StudioPage's local `iframeNonces` (`reloadActive`, StudioPage.tsx:172).
- **Root cause**: `reload: (id) => patch(id, { status: get().runtimes[id]?.status ?? null })` re-writes `status` to its current value — a pure no-op left over from an earlier iframe-remount design. Grep across `src/` (including the test-automation bridge) finds zero callers of `reload` or `clearCreateError`; `lastCreateError` is only ever cleared implicitly at the top of `createWithVision`.
- **Impact**: Misleading public store API; the no-op body actively suggests behavior it doesn't have. Pure maintenance hazard, no runtime cost.
- **Fix sketch**: Delete `reload` from the `StudioStore` interface and implementation. Either delete `clearCreateError` too, or wire it up where it arguably belongs (StudioVisionStart dismissing the error banner); today the error only clears on the next create attempt.

## 3. Dev-server boot poll retries forever when the server never becomes healthy
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: unbounded-polling
- **File**: src/features/studio/studioStore.ts:248-272
- **Scenario**: `webbuildDevStart` succeeds (process spawned, port bound) but the app never serves HTTP — e.g. a broken `next.config`, a crash right after spawn, or a port conflict the Rust side didn't detect. `beginPoll` then fires a `webbuildStatus` IPC call every 1.5s with no attempt cap and no failure path; the tab shows "Starting the dev server…" forever.
- **Root cause**: The poll's only exits are `status.healthy` (→ live) and `closeTab`/a new `start()`. Errors are swallowed as "transient while booting" and unhealthy statuses just loop.
- **Impact**: Indefinite 1.5s IPC + HTTP-probe churn per stuck tab (multiplies across warm tabs), and a UX dead-end — the user gets no error state and no way to see why it never came up.
- **Fix sketch**: Count polls in `beginPoll`; after ~40 attempts (≈60s) without `healthy`, `stopPoll`, `patch(id, { phase: 'error' })`, and surface the failure (the `COPY.error` panel already exists in StudioPage). Optionally back off the interval from 1.5s to 5s after the first ~20 attempts.

## 4. Pulsing bot-orb badge markup duplicated three times across two files
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/studio/StudioPage.tsx:286-291 (also :303-308, StudioAttention.tsx:40-43)
- **Scenario**: Any tweak to the "Athena is here" visual signature (ping ring + Bot icon in a primary-tinted circle) must be made in three places; the precise-pointer and coarse-pointer variants in StudioPage have already drifted slightly in sizing (h-7 vs h-9) beyond the intentional difference.
- **Root cause**: The `animate-ping` ring + `Bot` icon badge was copy-pasted for the precise orb pointer, the coarse decision region, and the global attention pill instead of extracting a tiny shared component.
- **Impact**: Bounded maintenance cost — three near-identical ~6-line JSX blocks that should evolve together (it is the product's core "needs you" affordance).
- **Fix sketch**: Extract `<OrbPing size={7|9} />` (ring + icon, size prop) into the studio folder and use it in all three places; keep positioning wrappers local to each call site.

## 5. `statusLabel` prop on StudioVisionStart is never passed, and its busy card duplicates StudioPage's status card
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/studio/StudioVisionStart.tsx:53 (and :72-88 vs StudioPage.tsx:314-327)
- **Scenario**: StudioPage is the only consumer and passes `onSubmit`, `busy`, `error` — `statusLabel` always falls through to the default 'Setting up your project…'. Meanwhile StudioPage renders its own nearly identical Bot-icon status card for the scaffolding/starting phases, so the two "setting up" surfaces drift independently.
- **Root cause**: The prop looks like a leftover from before the scaffolding/starting copy moved into StudioPage's `COPY` block; the card markup was duplicated rather than shared at that point.
- **Impact**: Small dead API surface plus one duplicated status-card layout; cosmetic drift risk only.
- **Fix sketch**: Remove the `statusLabel` prop (verification done: no other callers in src/). Optionally extract a `StudioStatusCard({ label })` used by both the vision-start busy state and StudioPage's scaffolding/starting/error panel.
