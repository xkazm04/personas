# UI Perfectionist — Fix Wave 4 — Markdown / number / time reuse

> 5 commits, 5 findings closed (1 high Numeric + 4 high time-primitive adoptions).
> Baseline preserved: my 7 changed files are clean; 2 unrelated pre-existing TS errors remain in
> `PersonaLayoutAdoption.tsx` (untouched here). eslint clean on all changed files (pre-commit hook).
> One mental model: hand-formatted numbers/timestamps → catalog `Numeric` / `RelativeTime` / `AbsoluteTime`.

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `809cbcffa` | execution #2 — toFixed/toLocaleString | high | ExecutionSummaryCard.tsx |
| 2 | `b2e264dcd` | persona-chat #4 — static conversation times | high | ConversationMessageList.tsx |
| 3 | `5b332a6f4` | memories #3 — static memory times | high | MemoryCard.tsx |
| 4 | `7066f4585` | reviews #4 — review times | high | ReviewListItem.tsx, ReviewDetailPanel.tsx |
| 5 | `1e017654f` | triggers #5 — cloud-webhook times | medium→high | CloudWebhooksTab.tsx |

## What was fixed

1. **Execution figures → `Numeric`.** Duration `(ms/1000).toFixed(1)+'s'`, cost `'$'+toFixed(4)`, and
   `toLocaleString()+' tokens'` now render via `Numeric` (unit `ms` / `usd` / plain) with tabular lining
   digits and consistent locale/precision.
2. **Conversation timestamps → `RelativeTime`.** MessageBubble + ConversationCard used static
   `formatRelativeTime()` strings; now live-updating with an absolute-time tooltip.
3. **Memory timestamps → `RelativeTime`.** Desktop row + mobile card dropped the
   `formatRelativeTime().replace(/ ago$/)` static string for the live component.
4. **Review timestamps → `RelativeTime` / `AbsoluteTime`.** List row + detail panel 'created' times use
   `RelativeTime`; the 'resolved on' date uses `AbsoluteTime` (canonical fixed-date primitive) instead of
   raw `new Date().toLocaleString()`.
5. **Cloud-webhook timestamps → `RelativeTime`.** last-poll / last-triggered / fired-at now live-update;
   the nullable fired-at uses the component's `fallback`.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc` errors in changed files | — | **0** |
| `tsc` errors elsewhere (pre-existing) | 2 (`PersonaLayoutAdoption.tsx`) | 2 (untouched) |
| eslint (changed files) | — | clean (pre-commit) |

## DESCOPED — persona-chat #1 (the critical) needs its own session

The headline finding — `ChatMessageContent` re-implements ~247 lines of `MarkdownRenderer` — was
**intentionally not done in this wave.** Why: the catalog `MarkdownRenderer` is actually *more* capable
(collapse, wrap toggle, chart blocks, meta-filtering) and supports `codeBlockActions`, BUT the chat fork
carries two features the catalog lacks:
- **`onSendToLab`** — a "send to lab" action on shell/json code blocks (`LAB_ELIGIBLE_LANGUAGES`).
- **streaming-safe fences (`makeStreamSafe`) + a streaming caret.**

A clean swap would regress send-to-lab and streaming. The correct fix is to **extend the shared
`MarkdownRenderer`** with an optional code-block-action render-prop (threaded through `CodeBlockShell`)
and an opt-out for `filterMetaContent`, then make `ChatMessageContent` a thin wrapper that keeps
`makeStreamSafe` + the caret. That touches a ~20-call-site shared component and changes chat rendering
behavior — and **none of it is verifiable by `tsc`/`eslint` alone; it needs the app run** to confirm
streaming, send-to-lab, and meta-filtering still behave. Do it as a dedicated session with a real render check.

## Patterns established (catalogue items 8–9)

8. **Currency `Numeric` unit is `'usd'`, not `'$'`.** `NumericUnit = ms | s | usd | percent | ratio |
   count | compact | plain`. Reach for `unit` + `precision`; pass `children` only for pre-formatted values.
9. **`RelativeTime` for "x ago" (live), `AbsoluteTime` for a fixed "on <date>".** Replace
   `formatRelativeTime()` strings with `RelativeTime` (it live-updates + tooltips the exact time); replace
   `new Date().toLocaleString()` with `AbsoluteTime`. Don't hand-strip " ago" — the component owns the format.

## What remains (this theme)

memories #4 (KnowledgeRow Numeric), events/messages #5 (MessageDetailModal times), overview-director #3
(score Numeric), templates #5 / settings #7 / recipes #6 copy-buttons (CopyButton), triggers #7
(cost Numeric), persona-chat #1 (the critical, above) + #3/#9 (chat timestamps/markdown parity). Then
Waves 3/5/6/7/8 (states, lists, forms, hierarchy, polish/a11y).
