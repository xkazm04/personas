# Perf-Optimizer Scan — Companion Runtime & Approvals

> Project: Personas (frontend-only)
> Scope: 4 paths in src/ (companion subtree, `src/api/companion.ts`, `src/stores/slices/system/companionPluginSlice.ts`)
> Total: 8 findings (C/H/M/L = 0/4/3/1)

## Scope notes

- The supposed file `src/features/plugins/companion/ApprovalCard.tsx` is real and was read in full.
- `companionPluginSlice.ts` is purely settings/toggles — no perf-relevant logic. The interesting state lives in `src/features/plugins/companion/companionStore.ts` (read for context but technically out-of-scope).
- The runtime hot-path is concentrated in `CompanionPanel.tsx` (`Body` component) — most findings cluster there.
- `useTauriEvent` (`src/hooks/useTauriEvent.ts`) re-subscribes when its `handler` identity changes. Body wraps every listener handler in `useCallback`, so listener churn is bounded — but `Body` re-renders on every streaming chunk, which has its own cascade (see Finding 1).
- No analysis of `src-tauri/`.

---

## 1. streamingText store update re-renders entire CompanionPanel Body per CLI chunk
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:115` (subscription) and `:582-585` (append) plus `src/features/plugins/companion/companionStore.ts:222-223` (setter)
- **Scenario**: An assistant turn streams hundreds of `kind: 'cli'` stream-json lines. Each line that contains an assistant text delta calls `appendStreamingText(text)`, which does `set((s) => ({ streamingText: s.streamingText + chunk }))`. Every subscriber of `streamingText` re-runs — `Body` subscribes via `useCompanionStore((s) => s.streamingText)` and on each tick re-evaluates `messages.map`, all `ApprovalCard`s, `InlineChatCard`s, `RecallStrip`s, `ConnectorCallCard`s, plus the `IIFE` that computes `lastAssistantIdx`.
- **Root cause**: Streaming text is co-located with the rest of the chat state in a single Zustand store, with no slicing / memoization between the streaming bubble and the static transcript. The transcript block is recomputed by hand inside an IIFE on every render rather than being a memoized child.
- **Impact**: With 20+ historical messages + a 30s assistant turn, expect 200-500 React renders of a tree containing markdown-rendered bubbles. CPU spikes, jank, and visible lag in the composer/voice toggle. Effectively scales with `messages.length × stream-chunk-count`.
- **Fix sketch**: Split the streaming bubble into its own child (`<StreamingBubble />`) that subscribes to `streamingText` directly; have `Body` subscribe only to `streaming` (boolean) and let the transcript map memoize on `messages`. Optionally batch `appendStreamingText` with `requestAnimationFrame` so multiple chunks coalesce into a single set.

## 2. ApprovalCard re-parses JSON params on every parent re-render
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/plugins/companion/ApprovalCard.tsx:115-120`
- **Scenario**: Each `ApprovalCard` body computes `prettyParams` as `JSON.stringify(JSON.parse(approval.paramsJson), null, 2)` at the top level of the function. Cards are rendered as `approvals.map((a) => <ApprovalCard … />)` in `CompanionPanel.tsx:1092` — and the parent re-renders on every streaming chunk (see Finding 1). Result: every approval's params are parsed + serialized for every assistant text chunk.
- **Root cause**: Pretty-printed params not memoized, and `ApprovalCard` is not `React.memo`'d, and `onResolved` is an inline arrow at the call-site (`(id) => { removeApproval(id); … }`), so even memo would be defeated by referential instability.
- **Impact**: For a turn with 3 pending approvals and 300 stream chunks, that's ~900 `JSON.parse` + `JSON.stringify` round-trips on params blobs that may be a few KB each. Trivially observable on flame charts.
- **Fix sketch**: `const prettyParams = useMemo(() => { try { return JSON.stringify(JSON.parse(approval.paramsJson), null, 2); } catch { return approval.paramsJson; } }, [approval.paramsJson]);` and wrap the component in `React.memo`. Move `onResolved` to a stable handler in the parent (`useCallback`).

## 3. Auto-scroll writes scrollHeight on every streaming chunk (layout thrash)
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:797-802`
- **Scenario**: `useEffect(() => { el.scrollTop = el.scrollHeight; }, [messages, streamingText, streaming]);` runs on every `streamingText` change (i.e., every CLI chunk). Reading `scrollHeight` forces a synchronous layout (reflow) before each set, and the assignment then triggers another scroll-recalc.
- **Root cause**: Auto-scroll keyed on full streaming text rather than rAF-throttled or coalesced. The DOM measurement happens during React's commit phase, locking the main thread.
- **Impact**: Compounds with Finding 1 — for a long transcript with many bubbles and markdown content, every stream chunk pays a full-document reflow. This is one of the most expensive jank sources during streaming.
- **Fix sketch**: Throttle with `requestAnimationFrame` (single rAF-scheduled scroll per frame, clear pending handle on re-entry) or use a `ResizeObserver`/`MutationObserver` on the streaming bubble only. Also consider `scrollIntoView({ behavior: 'instant', block: 'end' })` on a sentinel `<div>` so the browser handles the heavy work natively.

## 4. Approvals refetched in full on every approval event + every resolve
- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:786-794` (event listener) and `:1100-1102` (post-resolve)
- **Scenario**: `COMPANION_APPROVALS_EVENT` carries a `CreatedApproval[]` payload of *just the new* approvals, but the listener ignores the payload and unconditionally calls `companionListPendingApprovals()`. Separately, `ApprovalCard.onResolved` triggers a `companionListRecentMessages(50)` refetch of the entire transcript for every approve/reject click.
- **Root cause**: "Refetch canonical" pattern applied indiscriminately — every backend signal causes a full collection re-pull instead of merging the diff. The transcript-refetch on resolve is especially wasteful (50 messages over IPC for a tiny system-episode append).
- **Impact**: Per assistant turn with N created approvals you pay one extra IPC round-trip plus deserialization of every pending approval. Per resolve you pay a 50-row transcript pull. Latency under quick approve/reject loops becomes noticeable.
- **Fix sketch**: Merge the event payload into the store with a deduping append (`setApprovals(prev => [...prev, ...newOnes])`). For resolve, only append the outcome system-episode locally (or have the backend emit it on `COMPANION_STREAM_EVENT`'s `finished` channel); avoid a full transcript pull.

## 5. BrainViewer TypesView fires 13 parallel IPCs on every mount, no cache
- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/features/plugins/companion/BrainViewer.tsx:212-225`
- **Scenario**: `useEffect(() => { KINDS.forEach(({ kind }) => companionListBrainItems(kind).then(…)); }, [])` blasts 13 `companion_list_brain_items` IPCs every time the user opens the Brain Viewer. The result is used only to display a count badge, then discarded on close. Reopening repeats the entire fan-out.
- **Root cause**: No client cache layer; the counts feature was implemented as "easy parallel fan-out" without considering reopen frequency. Each IPC also fully serializes the item list just to read `.length`.
- **Impact**: 13 round-trips on every Brain Viewer open. Each row of `BrainListItem` (title, preview, meta) crosses IPC unnecessarily. Magnitude is bounded by the rolling-window/audit caps but still wasteful.
- **Fix sketch**: Add a backend `companion_brain_kind_counts` command returning a `Record<BrainKind, number>` in one call. Cache the result in `companionStore` with a short TTL so reopens within ~30 s skip the refetch.

## 6. AthenaAvatar renders two full-panel video elements as a 5%-opacity watermark
- **Severity**: medium
- **Category**: re-render / memory
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:204-208` and `src/features/plugins/companion/AthenaAvatar.tsx:156-183`
- **Scenario**: Whenever the panel is open, two `<video>` elements (idle + thinking loops) are mounted full-bleed (`fill` mode → `absolute inset-0 w-full h-full`) at the panel's 760×900 dimensions and rendered at `opacity-[0.05]`. Browsers still decode the active video continuously; the inactive one is paused but holds GPU texture memory. The active one drives a `transition-opacity duration-200` on every state change.
- **Root cause**: Watermark feature kept the same DOM as the small avatar — no `<picture>` fallback or reduced-decode mode. At 5% opacity the visual differs negligibly from a static poster image, but the cost is full video decode.
- **Impact**: Continuous CPU (video decode) + GPU (texture memory) cost whenever the panel is open. On modest hardware this adds ~3-8% baseline CPU even when no streaming is happening. Combined with Finding 1's render churn the panel feels heavier than it needs to.
- **Fix sketch**: For `fill` mode, render only `athena_baseline.jpg` (the poster) as the watermark and keep the two-video crossfade reserved for the small (`size=36`) avatar. Alternatively, only animate the watermark when `state !== 'idle'`.

## 7. Inline `onResolved` / `onEngaged` / `onDismissed` arrows break memoization across all transcript cards
- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:993-1003` (`ProactiveCard`), `:1092-1104` (`ApprovalCard`), `:1042-1047` and `:1078-1083` (`ConnectorCallCard`)
- **Scenario**: Every map iteration constructs fresh arrow-function props. Even if `ApprovalCard` / `ProactiveCard` / `ConnectorCallCard` were wrapped in `React.memo`, the unstable callback identity would defeat it. Combined with Finding 1's per-chunk parent re-render, every card in every list rerenders on every chunk.
- **Root cause**: Convenience inline closures capturing `m.id` / `id` from the `.map` scope. The handlers do referenceable work (`removeApproval`, `removeProactive`, refetch) that could live in stable parent callbacks.
- **Impact**: Cards stay non-memoizable; transcript size linearly multiplies streaming cost. Particularly painful for `ConnectorCallCard` whose `MarkdownRenderer` body is heavy.
- **Fix sketch**: Hoist handlers to module-level or `useCallback` with `id` derived from the child's own `approval.id` / `m.id` / `job.id`. Wrap each child with `React.memo` (`approval.id` is stable per card, so the memo predicate is trivial).

## 8. Object-URL leaks on rapid TTS replacement & uncached extractAssistantText parse
- **Severity**: low
- **Category**: memory / algorithmic
- **File**: `src/features/plugins/companion/companionStore.ts:279-284` (audioUrl setter) and `src/features/plugins/companion/CompanionPanel.tsx:1463-1479` (`extractAssistantText`)
- **Scenario**:
  - (a) `setPlaybackAudioUrl` overwrites `pendingPlayback.audioUrl` without revoking the previous URL. Only `setPendingPlayback` revokes. If `synthesizeTts` is called twice for the same playback record (e.g., race in footer + panel) the prior blob URL is dropped without `URL.revokeObjectURL`.
  - (b) `extractAssistantText` does `JSON.parse(line)` for every CLI stream line, even ones that obviously aren't assistant content (e.g., tool_use, system blocks). For a 30 s turn this is hundreds of parses per turn, none cached.
- **Root cause**: (a) Two setters share the same record but only one cleans up. (b) No fast-path bailout (e.g., skip when `line[0] !== '{'` or when `line` doesn't contain `"type":"assistant"`).
- **Impact**: (a) ~50 KB-300 KB blob leaks per duplicate-synth event. Bounded but observable across a long session. (b) ~0.5-1 ms per chunk wasted on `JSON.parse` failures. Sub-1% CPU but lives in a hot path.
- **Fix sketch**: (a) In `setPlaybackAudioUrl`, revoke the existing `s.pendingPlayback.audioUrl` if it differs from the incoming one. (b) Add a `if (!line.includes('"type":"assistant"')) return '';` substring pre-check before `JSON.parse`.
