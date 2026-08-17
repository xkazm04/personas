# Golden path — Streaming chat transcript

> Situation node: `product-surfaces` › `canvas-and-media` › `streaming-chat-transcript` ·
> [situation spine](../situation-spine.md) · recurrence 3 · risk **high** ·
> sides: **client** — **upheld**, and for the structural reason the ledger records
> (§12.1: the whole leaf is about where a DOM node's scroll offset is, and the server
> never sees the DOM) ·
> convergence: **converged** — **FAILED**, and in two opposite directions at once
> (§6: the fleet converged on the *disease* for the autoscroll clause, and is 5-of-5
> **silent** on the prepend clause where this repo is alone and correct) ·
> dimensions: **ui · performance · resilience · function**
> Leaf definition: *"A paginated message list swapping the streaming placeholder for
> the persisted row."*
> Composed 2026-08-17 against `master` @ `52b0a6ba8`.
>
> **Sweep.** All **4,801** `.ts`/`.tsx` under `src/` (**4,390** excluding tests). The
> whole companion chat surface read — **56 files** under
> `src/features/plugins/companion/chat/` plus `useChatScroll.ts`,
> `useTranscriptPages.ts` and `companionStore.ts` — and its backend half
> (`src-tauri/src/commands/companion/chat.rs`,
> `src-tauri/src/companion/brain/episodic.rs`). Every pin-to-bottom assignment in the
> tree enumerated and classified guarded/unguarded by **two** implementations. Every
> whole-collection message setter enumerated. `npm run orphans` run to establish which
> transcript surfaces are alive.
>
> **Measured by EXECUTING, not by reading.** `companion_list_recent_messages(50, …)`
> was replayed **statement for statement** — `query_recent_rows`
> (`episodic.rs:348-366`), `role_from_episode_path`
> (`core/src/retrieval/mod.rs:199-208`), `is_machine_episode` (`episodic.rs:53-57`),
> `to_message` (`chat.rs:376-386`) — against the operator's real brain: **1,068
> episodes across 3 conversations**. `windowStartIndex` (`athenaChatWindow.ts:56-84`),
> `setMessages` and `prependMessages` (`companionStore.ts:808-818`) were transcribed
> verbatim and driven through the real paging sequence.
>
> **⚠ Data is the 2026-08-17 PURGE BACKUP.** `%APPDATA%\com.personas.desktop\`
> `purge-backup-2026-08-17\personas_data.db`, copied read-only. The companion brain
> lives in the **second** database (`personas_data.db`, `companion_node`) and was **not**
> in the purge cascade — the 1,068 episodes measured here are intact and reproduce on
> the live file. Copies deleted; nothing written.
>
> **`cargo` was not run.**

---

## §0 — Headline

**The user scrolls up to re-read this morning. A background turn finishes. Two hundred
rows vanish under them.**

Executed against the real reducers, `setMessages` and `prependMessages` transcribed
from `companionStore.ts:808-818` and driven through the real paging sequence:

```
after the panel opens (companionListRecentMessages(50))   :  50 rows
after four "load earlier" pages (useTranscriptPages)      : 250 rows
after ONE finished backend turn (athenaChatStream.ts:158) :  50 rows
>> ROWS DISCARDED: 200 of 250 (80.0%) — every page the user paged in
```

There are **five** call sites that replace the whole message list with the newest fifty,
and one of them fires on a turn the user never asked for. The store has a merge door
right beside the clobber door — `prependMessages` (`:811-818`) is careful, dedupes by
id, and returns `{}` when nothing is fresh — and the refresh path does not use it. The
pager's own docstring records the loss as a *design constraint* it routes around
(`useTranscriptPages.ts:11-14`: *"a finished turn replaces the list with the newest
50… the anchor simply moves back to that page's oldest row"*), which is true about the
cursor and silent about the reader's place in the conversation.

**That is the leaf's law-1 violation, and a sibling has already fixed it and written
down why.** `personas-web/src/stores/eventStore.ts:91-117` merges instead of replacing,
with a comment naming the exact failure — *"a destructive `set({ events })` dropped any
events that arrived locally between the dispatch and the response — most painfully
during reconnect"*. Cost evidence, pointed at us, from the strongest class the oracle
produces.

**Everything else about this surface is the best answer in the fleet, and by a margin.**
`useChatScroll` is the only bottom-aware autoscroll in this repo that a shared primitive
could be made of; the two upward-history mechanisms — window expansion
(`athenaChatEarlier.ts:29-40`) and backend paging (`useTranscriptPages.ts:188`) — **both
anchor the scroll position by measuring how much the container grew**, and *"prepend
anchoring exists in exactly one repo in the family: this one"* (§6: 5 of 5 siblings
return zero hits for all eight anchoring idioms). The stream listener reads focus **at
event time**, never from a render closure, keys every write by conversation id, and
re-checks focus **after** the await before it commits — an entity-keyed staleness guard,
which is exactly what [`stale-response-guard`](./stale-response-guard.md) §2 prescribes
in preference to a mount-keyed one.

And the brief's premise about where to look was wrong. The transcript under
`src/features/agents/` — `ChatThread.tsx` and `ChatMessageContent.tsx` — is **dead
code**: unreachable from `src/main.tsx`/`App.tsx`, transitive orphan closure **0**, tests
referencing it **0**. §12.2.

---

## §1 — Trigger

1. *"Show the conversation, and keep showing it while the model is still talking."*
2. *"Load earlier messages when they scroll to the top."*
3. *"The reply is streaming — do I render the tokens as they arrive?"*
4. *"It jumps me back to the bottom every time a line lands."*
5. *"Long threads get sluggish."*
6. **The if-you-are-about-to-write-X test:** if you are about to write
   `el.scrollTop = el.scrollHeight` in an effect, or `setMessages(await fetch(…))`, or
   `{streaming && <div>{streamingText}</div>}` — you are here.

Adjacent but **not** this leaf: a machine log with no turns is
[`live-log-stream-view`](./live-log-stream-view.md); a bounded event ring with a filter
is [`live-event-console`](./live-event-console.md); the transport that carries the
tokens is [`backend-to-frontend-events`](./backend-to-frontend-events.md).

---

## §2 — The one way

**Never let a fetch shorten the list. Never move a viewport the reader is holding.
Key every write by the conversation it belongs to, read that key at event time, and
re-check it after every await.** In order:

**(a) One subscription, keyed by conversation, focus read at event time.** The stream
listener must not close over the focused thread — the user can switch mid-turn. Read
`useCompanionStore.getState().activeConversationId` inside the handler, write
per-conversation state unconditionally, and gate only the *flat/visible* mirror on
`isActive` (`athenaChatStream.ts:56-63`). This is the guard the leaf needs; it is
entity-keyed, not generation-keyed, and for a chat that is the right axis.

**(b) Coalesce token deltas to one store write per conversation per frame.** Accumulate
in a ref keyed by conversation, flush in a `rAF`
(`athenaChatDeltas.ts:34-57`). A `text_delta` per token straight into a store is
hundreds of notifications a second.

**(c) Decide *deliberately* whether the live tokens are rendered, and write the reason
down.** This repo decided **not to** and the reason is good
(`AthenaChatStreamingTurn.tsx:86-92`): reflow on every frame, plus the model's machine
grammar (`OP:`/`QR:`/`TTS:`) leaking before the server strips it. If you make the same
call, you owe the user a *different* progress signal — this surface pays it with
authored `PROGRESS:` beats, a typing indicator, an inline Stop, a plan checklist and a
slow-turn notice. A bare spinner is not that payment.

**(d) Autoscroll only while the reader is already at the bottom.** Keep the
distance-from-bottom in a **ref** so the pin callback stays stable, recompute it in a
passive `scroll` listener, and pin with `el.scrollTop = el.scrollHeight` **only** when
the ref says yes (`useChatScroll.ts:33-64`, threshold `NEAR_BOTTOM_PX = 80`). Surface a
jump-to-latest affordance off the `atBottom` **state**. Do not key the autoscroll effect
on the streaming text — key it on the committed message list.

**(e) Anchor every prepend.** Growing the list upward moves the reader's content down by
exactly the height that appeared. Capture `scrollHeight` and `scrollTop` before,
restore `scrollTop + grew` after the paint (`athenaChatEarlier.ts:29-40`;
`useTranscriptPages.ts:188`). Do this for **both** kinds of growth — revealing rows you
already had, and fetching rows you did not — or one gesture will feel broken and the
other will not.

**(f) Two upward mechanisms, in order, never at once.** Local window expansion first;
hand off to backend paging **only** once nothing loaded is hidden
(`athenaChatSession.ts:80-88`, `enabled: … && transcriptWindow.fullyExpanded`).
Otherwise scrolling up fetches history the panel is already hiding.

**(g) Window by rounds AND by a message cap, whichever hides more.** A round is a user
turn and everything said in reply; cutting mid-turn orphans an answer from its question.
But rounds alone do not bound a transcript that is mostly not-user
(`athenaChatWindow.ts:29-46`) — take `max(roundStart, capStart)` and snap the cap
*backwards* to a user message so the window still opens on a whole round.

**(h) Merge, never replace.** When the persisted transcript arrives, reconcile it into
what is on screen: dedupe by id, keep rows the fetch could not have known about, sort,
and cap. **Replacing is the defect in §0.** The implementation to copy is
`personas-web/src/stores/eventStore.ts:95-112`.

**(i) The swap needs a failure arm.** Tearing down the placeholder and fetching its
replacement are two steps, and the second can fail. Do not unmount the bubble until the
row is in hand, or surface an error if you do.

**(j) Reset the window on a thread switch, not on a new message.** Recompute the slice
from the **end** so arriving turns push the oldest round out of view and the reader's
expansion choice survives (`athenaChatWindow.ts:97-115`).

---

## §3 — Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `plugins/companion/useChatScroll.ts` | Bottom-aware autoscroll: `scrollRef`, `atBottom` (state, for the pill), `atBottomRef` (the mirror that keeps `maybeAutoScroll` stable), `scrollToBottom(behavior)`, `maybeAutoScroll`. `NEAR_BOTTOM_PX = 80`. **The only correct one in the repo.** |
| `plugins/companion/useTranscriptPages.ts` | Keyset paging with the cursor **derived** from the oldest loaded row, prepend anchoring, an `exhausted` marker compared against the current oldest id so a refetch re-arms, and `MAX_PAGES_PER_LOAD = 5` so an all-filtered page does not force a second gesture. |
| `chat/athenaChatWindow.ts` | `windowStartIndex` + `useTranscriptWindow`. Rounds ∨ message cap, snapped to a user turn. |
| `chat/athenaChatEarlier.ts` | Scroll-to-top window expansion, anchored. `EXPAND_TRIGGER_PX = 120`, matching the pager's. |
| `chat/athenaChatDeltas.ts` | Per-conversation token buffering, one `appendLiveText` per conversation per `rAF`, `sawDeltas` so the trailing whole message is not appended twice, stable identity via `useMemo` so the Tauri subscription is not rebuilt each render. |
| `chat/athenaChatStream.ts` | The turn lifecycle: `started` / `cli` / `finished` / `error`, focus at event time, backend-vs-client turn ownership. |
| `hooks/useTauriEvent` | The subscription. Never a bare `listen(` — [`backend-to-frontend-events`](./backend-to-frontend-events.md) ratchets that. |
| `chat/AthenaChatJumpToLatest.tsx` | The affordance `atBottom === false` earns. |

**Explicitly NOT a primitive:** `feedback/LoadingSpinner`. It renders `null`
(`LoadingSpinner.tsx:12-21`), or an `sr-only` `<span role="status">` when given a
`label`. It is used twice in this surface and both are dead pixels — §7.3.

---

## §4 — Steps

1. Mount the **listening** half (send pipeline, stream, events) independently of the
   **view** half, so a turn started from a collapsed orb still runs
   (`athenaChatEngine.ts` vs `athenaChatSession.ts`). Stage only *rendering* behind the
   open animation — nothing behind that gate may need to hear an event.
2. Pass the mount gate into every hook that touches the scroll container. An effect that
   runs once against a null ref and has no dep changing when the container appears will
   never retry — that was the real "opens scrolled to the top" bug
   (`athenaChatSession.ts:33-41`, `useChatScroll.ts:20-27`).
3. Jump to the newest message **once per conversation**, after layout, behind a double
   `rAF`, with `behavior: 'auto'` (`athenaChatSession.ts:63-77`). `maybeAutoScroll`
   alone fires while the restored transcript is still laying out and parks at the first
   message.
4. Bind autoscroll: `useEffect(maybeAutoScroll, [messages, streaming, maybeAutoScroll])`.
5. Window the slice; render rows keyed by message id; keep every prop handed to a
   `memo`'d row a primitive, a store object or a `useCallback`
   (`AthenaChatTranscript.tsx:24-25` — a shared `NO_JOBS` constant exists purely so an
   empty array is not freshly allocated per row).
6. Wire the two upward mechanisms with the handoff of §2(f).
7. On turn end: land buffered deltas, promote the in-flight side channels onto the
   persisted episode, **merge** the canonical transcript (§2(h)), and only then unmount
   the placeholder.
8. **Stop.** No virtualization — §8.1 says why the window makes it unnecessary here.

---

## §5 — Anti-patterns

- **`el.scrollTop = el.scrollHeight` in an effect with no distance measurement.**
  *Failure mode:* the reader is returned to the bottom before finishing a sentence.
  [`live-log-stream-view`](./live-log-stream-view.md) measured the corpus that proves it
  (median inter-line gap 0.36 s over 2,998 runs) and ratchets it at 13 sites; this
  document contributes a **14th** its pattern cannot see — §12.3.
- **`setMessages(newestPage)` as the refresh.** §0. And note the tell: the store already
  has `prependMessages` with id-dedupe next to it.
- **Keying the autoscroll effect on the streaming text.** *Failure mode:* one scroll
  write per frame of the reply, each one a layout read plus a write, for a value that is
  not rendered. Correctly avoided and the reason is in the code
  (`athenaChatSession.ts:44-49`).
- **Windowing by rounds alone.** *Failure mode:* it ships and does nothing. Replayed
  against the operator's real `cli` thread (41 messages, 17% user): a 10-round window
  hides **0 of 41**. The message cap hides 11.
- **Unmounting the placeholder before the replacement is in hand.** §2(i), and §7.2 for
  the one path that does it.
- **`<LoadingSpinner>` as a loading affordance.** It renders nothing. Wrapping it in
  `aria-hidden="true"` — which this surface does — removes even the `sr-only` escape
  hatch, so the element is invisible to *everyone*.
- **A bare `listen(` for the stream channel.** Use `useTauriEvent`; teardown, the
  async-registration race and event-name typing are not yours to re-derive.
- **Rebuilding the deltas object every render.** The stream listener lists it in a dep
  array; a fresh object re-subscribes the Tauri event on every render
  (`athenaChatDeltas.ts:69-75`).

---

## §6 — Evidence, and the convergence oracle

### The site to copy

**`src/features/plugins/companion/useChatScroll.ts`** for the autoscroll, and
**`useTranscriptPages.ts:180-195`** for the anchored prepend. If you need the whole
composition, `athenaChatSession.ts` is 96 lines and wires all six mechanisms with the
reason for each.

### Convergence — the label is `converged`, and it fails twice, in opposite directions

**Effective independent cohort for this leaf: 2**, not 5 — established at measurement
time, per the doctrine's per-leaf rule.

- **brainiac: silent.** No chat transcript surface exists. `role: "assistant"`,
  `messages.map`, `setMessages`, `ChatMessage`, `useChat` → **zero** hits across
  `console/`; no `*chat*`/`*message*` directory; the Rust crates have zero
  `text_delta`/`Sse`/`event-stream`. It *ingests* transcripts
  (`ingest-data.ts:64`, `kind: "session_transcript"`) and never renders one.
  **`scrollTop = scrollHeight` appears nowhere in the repo.**
- **ascent: silent.** No transcript. Its only `role: "user"` hits are outbound LLM
  request payloads (`src/lib/llm/{bedrock,openai,openrouter}.ts`). It *does* stream — a
  three-event progress SSE with a `\r?\n\r?\n` frame boundary
  (`useReportScan.ts:257-262`) — and swaps the whole report in atomically at `result`
  (`:246-249`). **Zero autoscroll pins in the entire repo.**
- **personas-cloud: a producer, not a renderer.** It emits the stream
  (`orchestrator/src/httpApi.ts:1690-1750`, `text/event-stream`, offset paging, 500 ms
  poll) and `packages/shared/src/types.ts:295` names its consumer: *"produced to Kafka
  for **Vibeman** SSE consumption"*. No client, no DOM, 5 commits, last 2026-03-23.

So two repos remain, and they split the label:

| clause | personas | vibeman | personas-web | verdict |
| --- | --- | --- | --- | --- |
| pin guarded by a distance measurement | ✅ 80 px | 3 of 5 (50 px) | 2 of 6 (24 px, 16 px) | **fleet converged on the DISEASE** |
| **prepend anchoring** | ✅ **both mechanisms** | ❌ 0 hits | ❌ 0 hits | **5-of-5 SILENCE — we are alone** |
| delta coalescing | ✅ rAF | ✅ **rAF** | ❌ (1 s poll only) | independently reinvented |
| refetch is non-destructive | ❌ **replace 50** | ❌ replace 10 | ✅ **merge, cap 1,000** | **a sibling is ahead of us** |
| backing collection bounded | ✅ 30 mounted | ❌ uncapped array | tail-drop at 500 | mixed |

**Clause 1 — the fleet converged on the disease.** 9 unguarded pins across the two
siblings against 5 guarded, and the two worst are in the chat components themselves
(`vibeman/src/app/features/TaskRunner/components/CLISessionModal.tsx:238-242`;
`personas-web/src/components/feature-sections/lab/components/ChatTab.tsx:43-48`, which
wraps the unguarded pin in a `requestAnimationFrame` and still measures nothing). Per the
doctrine: perfect-ish agreement on an omission is evidence the situation is universal
and evidence *against* an answer existing to adopt. It is not confirmation.

**Clause 2 — this repo is alone, and that makes it a house convention until something
rediscovers it.** All eight anchoring idioms return **0 hits** in all five siblings,
because none of them has a load-older path at all. Stated as self-comparison: Personas
is ahead of the fleet here, and the clause is labelled a house convention rather than
physics.

**Clause 3 — a genuine independent reinvention, and it is the strongest positive
signal in this sweep.** `vibeman/src/components/cli/CompactTerminal.tsx:286-297`
accumulates into `pendingLogsRef` and flushes in a `requestAnimationFrame`, with the
comment *"Collects logs and flushes once per animation frame to reduce re-renders"* —
the same principle as `athenaChatDeltas.ts`, reached in a different module with a
different data shape and no shared text. Dated 2026-01-11, **four months before**
`useChatScroll.ts` (2026-05-28).

**Clause 4 — cost evidence against us.** `personas-web/src/stores/eventStore.ts:91-117`
fetches `limit: 100`, then merges: `fetchedIds` set, `preserved = s.events.filter(e =>
!fetchedIds.has(e.id))`, sort, `slice(0, MAX_EVENTS_BUFFER)` with `MAX_EVENTS_BUFFER =
1_000`. Its comment names the failure it was written to fix. That is a sibling that
*paid* for the absence and wrote the receipt — the class of evidence no shared
authorship explains away.

### Lineage — checked, and it inverts a direction I would have assumed

Zero port markers (`NEAR_BOTTOM_PX`, `maybeAutoScroll`, `atBottomRef`,
`useTranscriptPages`, `prependMessages`) in any of the five. And on dates:
**`personas-web/src/app/dashboard/executions/executions-page/ExecutionOutput.tsx` first
committed 2026-05-16; `useChatScroll.ts` first committed 2026-05-28 — the sibling's
sticky-bottom is TWELVE DAYS OLDER than ours**, and
`components/sections/platform-command/index.tsx` (`stickToBottomRef`,
`distanceFromBottom <= 16`) is older still, 2026-04-14. Constants, ref names and
comments all differ (`STICKY_BOTTOM_THRESHOLD_PX = 24` / bare `<= 16` vs our named
`NEAR_BOTTOM_PX = 80`; `stickyBottomRef`/`stickToBottomRef` vs `atBottomRef`), so this
is one author's idiom independently retyped rather than a copy — **but the direction of
any borrowing runs personas-web → personas, not the reverse.**

---

## §7 — Deviations

**7.1 — Five whole-list replacements; one of them is reachable without user action.**

| site | trigger | what it discards |
| --- | --- | --- |
| `chat/athenaChatStream.ts:158-162` | a **backend-initiated** turn finishing | every paged-in row — **the reachable one** |
| `chat/athenaChatSend.ts:103-111` | the user's own send completing | every paged-in row |
| `chat/athenaChatHydration.ts:29-34` | panel open / thread switch | nothing yet loaded (benign) |
| `chat/athenaChatActions.ts:46-47` | an explicit refresh action | intentional |
| `chat/AthenaChatProposals.tsx:40-41` | an approval resolving | every paged-in row |

The store's setter is `setMessages: (messages) => set({ messages })`
(`companionStore.ts:808`) — a bare assignment. **Fix:** a `mergeMessages(incoming)`
action modelled on `personas-web/src/stores/eventStore.ts:95-112`, and point all five
at it; `prependMessages` (`:811-818`) already holds the dedupe half.
*(Behaviour-changing — deferred, §11.)*

**7.2 — The placeholder→row swap has no failure arm on the backend-turn path.**
`athenaChatStream.ts` tears the bubble down at `:148` (`streamingPhase: null`) and
`:151` (`endLiveTurn` → `streaming: false`, which unmounts
`AthenaChatStreamingTurn`), and *then* fetches its replacement at `:158`, whose only
failure handling is `.catch(silentCatch('companion_list_recent_messages'))`. On a failed
refetch the turn **disappears**: no bubble, no persisted row (the deltas were never
rendered, §7.6), no error surfaced. The user-send path is the control — it has a real
`catch` that calls `setSendError` (`athenaChatSend.ts:125-129`), rendered by
`AthenaChatErrorNotice`. Same swap, two paths, one failure arm. *(Deferred, §11.)*

**7.3 — Both of the transcript's loading states render nothing.**
`AthenaChatBody.tsx:116-120` — the "an earlier page is in flight" indicator — is
`<LoadingSpinner size="sm" />` inside a wrapper carrying `aria-hidden="true"`, and
`LoadingSpinner` returns `null` without a `label`. So it is invisible to sighted users
*and* to assistive tech, and the `aria-hidden` would suppress the `sr-only` escape hatch
even if a label were added. `:121-126` (the initializing state) survives only because a
sibling `<span>` carries text. This is a population
[`inline-busy-state`](./inline-busy-state.md) §9 Signal 1 already partitions and assigns
— its two standalone sites belong to [`page-loading`](./page-loading.md)'s leaf — so this
document reports them and declines to re-gate them (§9).

**7.4 — The transcript read post-filters where the recall read filters in SQL.**
`companion_list_recent_messages` (`chat.rs:355-365`) runs `LIMIT 50` and *then* drops
machine correlator rows in Rust (`to_message`, `:376-386`), so the page can return fewer
than 50. `list_recent_conversation` — the recall window — applies
`machine_marker_exclusion_sql()` **inside** the query, and its docstring
(`episodic.rs:59-62`) states exactly why: *"Filtering in SQL rather than in Rust is what
makes the window fill up… a post-filter would just shrink a 20-row page to 8."* Two
readers of one table; one learned the lesson, the other did not. **Measured today: the
shrink is 0 on all three conversations** — no machine-marked episode falls in any
thread's newest 50 — so the condition is **latent, not active**. Machine rows are 25.0%
of the corpus (267 of 1,068), so it is one busy fleet day away from active.

**7.5 — Windowing is bounded by a constant that the operator's data can outgrow.**
`MAX_VISIBLE_MESSAGES = 30`, `DEFAULT_VISIBLE_ROUNDS = 10`. Replayed against the real
default thread (1,025 episodes; newest 50 = 33 assistant / 13 user / 4 system): the
rounds boundary hides **7 of 50**, the cap hides **17 of 50** — so the cap is load-bearing,
as designed. On the `cli` thread (41 messages, 17% user) rounds hide **0** and the cap
hides **11**. Both bounds are correct today; neither is derived from anything, so both
are a re-measure away from being wrong. See §12.4.

**7.6 — `streamingText` is accumulated and never rendered.** The delta pipeline appends
into `liveTurns[conv].streamingText` (`companionStore.ts:851-858`) and mirrors it onto a
flat field. Enumerated: **outside `companionStore.ts` there is exactly one non-test
consumer** — `chat/athenaChatVoice.ts:109-111`, which diffs it to fire spoken progress
beats. The other four occurrences are two resets in `athenaChatSend.ts` and two
*comments explaining that nothing renders it*. This is deliberate and reasoned
(`AthenaChatStreamingTurn.tsx:86-92`) and is recorded as a **deviation from the leaf's
own definition**, not a defect: the spine's *"swapping the streaming placeholder for the
persisted row"* describes a placeholder that grows, and this one does not.

**7.7 — `useChatScroll` is a companion-local hook, not a shared primitive.** It is the
only correct implementation in the repo and it lives four directories deep inside one
plugin. [`live-log-stream-view`](./live-log-stream-view.md) §9 already proposes
promoting it to `shared/` as `useStickyBottom()` returning `containerProps` that carry
**both** the ref and the `onScroll` handler, so the bare element is never handed out and
the unguarded pin becomes unwriteable. **That is the right fix and this document
seconds it** — the type change outranks the gate.

---

## §8 — Gaps

**8.1 — No virtualization, and correctly so.** The window mounts ≤ 30 messages, so
`long-list-rendering`'s `unbounded-shared-table-render` condition cannot arise here. The
cost is that a message is a `MarkdownRenderer`, so 30 is already the right order of
magnitude; virtualizing variable-height markdown would trade a solved problem for an
unsolved one.

**8.2 — The window resets on a thread switch and cannot be restored.**
`useTranscriptWindow` re-collapses to 10/30 on any `conversationId` change
(`athenaChatWindow.ts:112-115`). Switching away and back loses however far the user had
expanded. Deliberate ("a different conversation entirely") and defensible; it is still a
lifetime decision nobody wrote down as one — the concern
[`view-state-persistence`](./view-state-persistence.md) exists for.

**8.3 — Nothing bounds `messages` itself.** The window bounds what is *mounted*, not
what is *held*. `prependMessages` grows the array without a cap; only `setMessages`
shrinks it, which is precisely the operation §7.1 wants removed. **Fixing 7.1 without
adding a cap converts a data-loss bug into an unbounded array** — `personas-web` shipped
both halves together (`MAX_EVENTS_BUFFER = 1_000`), and so must this. Recorded here
because it is a composition hazard between §2(h) and this section, not a defect in
either.

**8.4 — No type reaches the interleaving.** Deltas from two concurrent turns are
separated by a `Map<conversationId, string>` key, and nothing in the type system says a
`conversationId` passed to `appendLiveText` is the one the event carried — both are
`string`. A branded `ConversationId` would help at the boundary and stops at the
serialization edge (`ev.sessionId` arrives as JSON), which is the doctrine's item 5. The
mitigation that actually works is structural and already present: **read the key from
the event, never from a closure.**

---

## §9 — The missing gate: a reasoned DECLINE

**This leaf publishes no census rule.** Four candidates were built and measured; each is
declined with its numbers.

**Candidate 1 — the unguarded tail pin.** Already ratcheted by
[`live-log-stream-view`](./live-log-stream-view.md)'s `unconsulted-tail-pin`
(baseline 13/13, hand-verified 13/13). My independent pass found **22 pin sites, 8
guarded, 14 unguarded** — a superset of one. Publishing a second rule over the same
condition would be duplication; the 14th site is contributed as a **recall correction**
to that rule instead (§12.3), which is worth more than a competing gate.

**Candidate 2 — `<LoadingSpinner>` renders nothing.** Measured **247 sites / 178
files**, against compliant busy affordances `<AsyncButton>` **49/39** and
`<Button loading=>` **16/13** — so **79% of the 312 busy-affordance render sites in the
tree render nothing**. It is a real and large condition, and it is **already
partitioned and owned**: `inline-busy-state.md:157` splits all of them (21 labelled, 75
a busy ternary — its leaf; 152 standalone + 4 `&&`-guarded — `page-loading`'s leaf) and
its §9 Signal 1 gates the ternary half. Poaching a neighbour's partitioned territory
from a transcript leaf would be the 83%-overlap decline the doctrine already records.
Declined; §12.5 corrects its arithmetic instead.

**Candidate 3 — the whole-list clobber, which is this leaf's headline.** The honest
signal is *a collection with both a merge door and a clobber door, where the refresh
path uses the clobber*. Measured across all 4,390 production files: **3 declarations, in
1 file** (`companionStore.ts`: `setMessages`, `setConversations`, `setProactive`). A
census rule anchored on one file does not survive that file being renamed, and a
baseline of 3 is a baseline on nothing. The related surface form — a literal-limit list
read piped into a whole-collection setter — returns **5 matches**, of which **2** are
the real ones. Declined for population.

**Candidate 4 — the post-filtered page (§7.4).** One site, and its shrink is **0
today**. A rule that matches once and reports zero cost is a rule that will be deleted
at the first refactor. Declined.

### What to do instead — and it outranks a gate

**Make the clobber unspellable.** The doctrine ranks "prefer a type over a gate" above
§9, and here a type genuinely reaches, because the value never crosses a serialization
boundary on the way in:

1. **Delete `setMessages` from the store's public interface.** Replace it with
   `mergeMessages(incoming: CompanionMessage[])` (dedupe by id, preserve locally-known
   rows, sort, cap) and `resetMessages()` for the two sites that legitimately want a
   clean slate (thread switch, explicit refresh). Then `setMessages(fresh)` **does not
   compile**, and all five sites in §7.1 must state which they meant.
   This is **Q5 — withholding beats requiring**: do not hand the caller the dangerous
   door and then police its use.
2. **`mergeMessages` owns the cap**, so §8.3's hazard cannot be introduced by fixing
   §7.1 — one function, one invariant.
3. **Second `useChatScroll`'s promotion** to `shared/useStickyBottom()` returning
   `containerProps` (§7.7). That makes the *other* half of this leaf unspellable too,
   and it is already specified by a neighbour — the corpus should not specify it twice.

Both are signature changes to live code and are deferred (§11).

### A test-shaped instrument, since the census cannot express it

The clobber is a *behavioural* property of a reducer, which is what a unit test is for
and a regex is not. One test, in
`src/features/plugins/companion/__tests__/`, that replays exactly §0: open (50) → four
`prependMessages` pages (250) → the refresh path → **assert the length did not fall**.
It fails today, which is the point; it is the cheapest possible statement of the
invariant, and unlike a census rule it cannot be satisfied by renaming anything.

---

## §10 — Verification performed

- Every count produced twice: the census engine's own `scanRule` and a **bespoke**
  walker sharing no code (own directory walk, own comment stripper, own line
  arithmetic). Populations agreed at 4,801 / 4,390 files.
- **They disagreed on the pin census — 14 unguarded vs the registry's 13 — and the
  disagreement was the finding** (§12.3).
- Behavioural claims come from statement-for-statement transcriptions run in Node
  against the operator's real 1,068-episode brain and the real store reducers, not from
  reading.
- **The full census registry was NOT run** (doctrine §4). No rule is proposed, so
  nothing needed baselining.
- `npm run orphans` (`scripts/analysis/orphan-modules.mjs`) — 758 orphans — plus
  `--delete src/features/agents/components/ChatThread.tsx
  src/features/agents/components/ChatMessageContent.tsx`: transitive closure **0**,
  tests referencing the removed set **0**.
- `npx tsc --noEmit` not run — this document changes no code.

---

## §11 — Deferred fixes

7.1 (merge instead of replace), 7.2 (a failure arm for the swap), 7.3 (a real loading
affordance) and §9's `setMessages` → `mergeMessages` signature change all alter what a
live surface shows while the operator is using it. Written to
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md) rather than applied.

---

## §12 — Corrections

**12.1 — `sides: "client"` is UPHELD, and the mechanism is worth naming.** The third
upholding in the ledger, and it joins the other two for the same structural reason: this
leaf is about *where a DOM node's scroll offset is*, and **the server never sees the
DOM**. The backend half exists and is real (`chat.rs`, `episodic.rs`) but it answers a
different leaf — [`paginated-list-query`](./paginated-list-query.md) — and the one
backend finding here (§7.4) is a *latent* one whose cost is currently zero. Where the
label survives, name the mechanism; that is what separates a correct label from a lucky
one.

**12.2 — The brief's premise about where this surface lives is wrong, and the code it
pointed at is dead.** It said *"chat/stream surfaces live under
`src/features/agents/**`"*. The only transcript there is `ChatThread.tsx` (+
`ChatMessageContent.tsx`), and `npm run orphans --delete` reports both **unreachable
from `src/main.tsx`/`App.tsx`, transitive orphan closure 0, 0 referencing tests**. The
sole remaining mention of `ChatThread` in the tree is a *comment* in
`stores/slices/agents/chatSlice.ts:305`. The live surface is
`src/features/plugins/companion/chat/**` (56 files). A brief-scoped composer would have
documented dead code as the standard.

**12.3 — `unconsulted-tail-pin` has an unstated recall limit, and it costs exactly one
real site.** Its pattern anchors on `[\w$.?]+\.scrollTop\s*=\s*[\w$.?]+\.scrollHeight`.
My independent pass classified **22** pin sites (8 guarded, 14 unguarded) and the
registry rule sees 13 — the fourteenth is
**`src/features/agents/sub_connectors/libs/useAutomationSetup.ts:238-241`**:

```ts
useEffect(() => {
  tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight, behavior: 'smooth' });
}, [design.outputLines.length]);
```

`scrollTo({ top: …scrollHeight })`, not `scrollTop =`. No position measurement. Hand-read
and confirmed a true positive of the same condition; its practical blast radius is small
(the surface renders `slice(-3)`), which is why it has never been noticed. **Correction
owed to [`live-log-stream-view.md`](./live-log-stream-view.md) §9:** add the
`scrollTo({top:…scrollHeight})` form to the recall-limits paragraph — or to the pattern,
which takes the baseline from 13/13 to 14/14. All 8 of my "guarded" sites were also
opened and are genuinely guarded (`shouldAutoScroll`, `stuckToBottomRef` at 16 px,
`userScrolledUp`, and one explicit `End` keypress at
`useDeckDialog.tsx:113`) — the rule's precision is intact; only its recall moves.
Same file also carries a second compliant reference implementation the rule's
description does not mention: `shared/components/progress/TerminalBody.tsx:29-45`
(`useTerminalScroll`, 10 px), beside the cited `shared/components/terminal/TerminalBody.tsx`.

**12.4 — A code comment states a measurement without a date and no longer reproduces.**
`athenaChatWindow.ts:32-42` justifies `MAX_VISIBLE_MESSAGES` with *"Measured on the live
default thread: 50 loaded messages contain **6 user messages** — 15 assistant, 9 system,
and the rest machine rows — so a 10-round window never finds a tenth user turn, returns
0, and mounts everything."* Replayed against the operator's brain on 2026-08-17: the
default thread's newest 50 are **13 user / 33 assistant / 4 system**, and the rounds
boundary returns **7**, not 0. **The conclusion survives** — the cap still hides more
(17 vs 7) and on the `cli` thread the original figure reproduces exactly (17% user,
rounds hide 0) — **but the number does not, and the comment gives a reader no way to
know that.** Date your measurements in comments, or a future reader will treat a
snapshot as an invariant.

**12.5 — Two published paths carry a `<LoadingSpinner>` count that today's deletion
invalidated.** [`inline-busy-state.md`](./inline-busy-state.md) (`:35`, `:157`) and
[`idempotent-invocation.md`](./idempotent-invocation.md) (`:1078`) state **252** call
sites. Measured at `78e9bff68^`: **252**. At `HEAD`: **247**. The delta is exactly the
`sub_canvas` tree deleted on 2026-08-17 (`78e9bff68`). Full detail and the other four
paths citing deleted canvas files in
[`canvas-state-persistence.md`](./canvas-state-persistence.md) §12.4–12.5.

**12.6 — The brief's `executionSink` lead is correct and does not transfer, and the
reason is worth recording.** It pointed at the `generation` counter
(`src/lib/execution/executionSink.ts:339`) as the repo's best staleness guard. It is —
and this surface deliberately does not use that shape. `executionSink` guards against a
**stale copy of one stream**, so a monotonic generation is the right axis. A transcript
guards against **two concurrent streams belonging to different entities**, where the
right axis is the entity: `liveTurns[conversationId]`, focus read at event time, plus a
post-await re-check (`athenaChatStream.ts:160-162`, `:158-169`). That is precisely the
discrimination [`stale-response-guard`](./stale-response-guard.md) §2 opens with —
*"decide first whether the result belongs to an entity or merely to a mount"* — and
this surface answers it correctly. **No correction is owed to either path; the two
guards are different by design and the corpus should not homogenise them.**

**12.7 — `docs/design/overview-loading.md`'s law 1 is violated here at its most
visible, and the violation is the leaf's headline.** *"A fetch never hides rendered
rows."* Executed: 200 of 250. The five laws were written for a surface fetching its
first page; this is the case where a *successful* fetch of fresh data destroys older
data already on screen, which the document does not currently name. Offering it upward:
law 1 would be sharper as **"a fetch never shortens the list"**.
