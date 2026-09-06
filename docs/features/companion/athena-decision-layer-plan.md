# Athena Hands-Free Decision Layer (P3) — build spec

**Status:** built 2026-05-30. The orb + voice + guided-walkthrough infra is ALREADY SHIPPED
(see [`athena-orb-overlay-plan.md`](./athena-orb-overlay-plan.md) Steps 2a/2b/2c/3 +
[`athena-guided-walkthroughs.md`](./athena-guided-walkthroughs.md)). This spec is the
**decision/approval layer on top**: a voice-first, numbered-choice surface that lets the user
clear approvals / human-reviews / incidents hands-free.

## Status (verified 2026-09-06)

**All seven slices shipped.** Real anchors:

| Slice | Where it lives now |
| --- | --- |
| 1 store model | `companionStore.ts:679-683` (`pendingDecision`, `decisionExplained`) + `:1389-1406`; types in `companion/decision/types.ts` |
| 2 bubble | `companion/orb/OrbDecisionBubble.tsx`, mounted in `orb/AthenaGuideLayer.tsx:49` |
| 3 queue | `companion/decision/useDecisionQueue.ts` (+ the headless `DecisionDriver` mounted at `AthenaGuideLayer.tsx:52`) |
| 4 explain / `0` | `companion/decision/resolveDecision.ts` (`explainDecision`) |
| 5 `;` leader key | `orb/AthenaOrbLayer.tsx:124-190` |
| 6 TTS on explain | `chat/athenaChatTriggers.ts:55-67` |
| 7 spoken numbers | `companion/decision/parseSpokenDecision.ts`, branched in `useHoldToTalk.ts:108-120` |

**Four things the spec below does not describe, because they landed after it was written:**

1. **The queue is no longer gated.** Slice 3 specified a `companionHandsFreeDecisions`
   opt-in, default off. The setting still exists (`companionPluginSlice.ts:225,301`,
   toggled in `sub_setup/SetupPanel.tsx:48`) but the queue ignores it: the auto-surfacing
   path is unconditional, and the settings now govern only how far Athena may act
   *without* asking. Rationale is written into `useDecisionQueue.ts:397-406`.
2. **A fourth source: `message_attention`.** `DecisionSource` is
   `approval | human_review | incident | message_attention | adhoc`
   (`decision/types.ts:28`); `messageAttentionToDecision` (`useDecisionQueue.ts:284`)
   turns a triage-flagged report into a decision and marks it read via `markReportRead`.
3. **A chat-side twin.** `decision/ChatDecisionCard.tsx` renders the same pending decision
   with the same numbered options whenever the orb bubble cannot (the bubble docks against
   the orb, which does not exist while the chat panel is open). Its visibility predicate is
   the exact complement of the bubble's, so a decision always has exactly one surface.
   Both resolve through the shared `resolveDecision.ts`.
4. **Failure is surfaced in place.** `runDecisionOption` awaits `option.run()` and, on
   failure, keeps the decision pending and sets `decisionError` (rendered by both surfaces)
   instead of clearing the bubble. It records a `decision_resolved` UX signal on success.

**Renamed since the spec:** `CompanionPanel.tsx` no longer exists as a file. The chat panel
is `companion/chat/AthenaChatPanel.tsx` plus ~45 sibling modules in `companion/chat/`
(it is still imported under the name `CompanionPanel` at `src/App.tsx:136`). Every
`CompanionPanel.tsx:<line>` citation below is stale as a path.

## The goal (user's words, distilled)
1. A **bubble above the orb** that shows text (markdown — bullets/bold) and **requests a DECISION** with numbered options ("Shall I deploy? 1) yes 2) no"). TTS is **not** auto-spoken on surface — only on `0` (Explain/Recommend), see Slice 6. The **arrow/handle** between the bubble and the orb is a **show/hide toggle** (`athena-decision-toggle`): collapse the bubble down to a small source-iconned symbol chip (`athena-decision-expand`, with a pulse dot) that floats above the arrow, so a pending decision stays visible without occupying the screen; click the chip or the handle to re-open. A fresh decision always opens expanded. **Shipped with three states, not two:** full bubble, the collapsed chip, and a *fully hidden* 36px round restore peek dotted at the orb (`athena-decision-dismiss` X in the bubble's top-right collapses to it at `OrbDecisionBubble.tsx:334`; `athena-decision-restore` at `:191` brings it back). The minimize/expand handle is `athena-decision-toggle` at `:346` and the collapsed chip is `athena-decision-expand` at `:209`. The `0` affordance shipped as an icon-only lightbulb button (`athena-decision-option-0`), not a numbered chip.
2. User answers by **clicking** an option OR by a **`;` leader-key then a digit** (numeric decision syntax). **`0` = Athena explains the options + gives her recommendation**, then re-asks.
3. The same surface presents **proactive incidents** (open high/critical `audit_incidents` — the P2.5 thread) and **pending approvals / human-reviews** as these numbered decisions.
4. Athena can **highlight/navigate** the app while asking (reuse the guided-walkthrough glide+glow).

## What's SHIPPED (reuse, do NOT rebuild) — verified anchors
- Orb: `src/features/plugins/companion/orb/AthenaOrb.tsx` (renders only when `state==='minimized'`), `AthenaOrbLayer.tsx` (mounts the orb + owns Cmd/Ctrl+Shift+A + the single `useHoldToTalk()` instance; as shipped this is a `useAppKeyboard` registration at `ROUTE_DECISION_PRIORITY`, not a raw `window` listener; see Slice 5), `AthenaGuideLayer.tsx` (ALWAYS-ON portal, `z-[60]`, hosts `useGuidanceRunner` + `TrackedGlowRing` + `GuideCaption`).
- Walkthrough mechanism (reuse to "operate app while asking"): store actions `setOrbGuideTarget`, `setGuidanceHighlightTestId`, `flashHighlight` in `companionStore.ts` — independent of `activeWalkthrough`. `GuideCaption.tsx` is the structural template for a positioned, tailed, interactive bubble.
- Numbered-chip primitive: `QuickReplies.tsx` (renders `{i+1}` badges, binds keyboard digits 1-9 via `parseInt(e.key)`; guards typing targets). Copy its chip render + digit idiom.
- Voice OUT: `voicePlayback.ts` `synthesize(text, credentialId, voiceId, settings?, engine)` + `play(url)`. The orb does NOT own voice context — credential/voiceId/engine/settings live in the chat panel. As shipped that is `chat/athenaChatVoice.ts` (`useTtsSettings()`, `voiceActive`, and `playProgressClip` at `athenaChatVoice.ts:150`, the ready "speak this short text now" helper).
- Voice IN: `useHoldToTalk.ts` (`{supported,talking,interimText,start,stop,abort}`; on session end calls `setVoiceTurnRequest(text)` at `useHoldToTalk.ts:120` → consumed by a chat-panel effect → full chat turn, no panel). `useSpeechInput.ts` picks browser vs whisper.
- Decision data sources (backend + api, all exist):
  - Approvals: `api/companion.ts` `companionListPendingApprovals()`, `companionApproveAction(id)`, `companionRejectAction(id, reason?)`; `PendingApproval = {id, action, rationale, paramsJson, humanReviewId, createdAt}`; store `approvals`/`setApprovals`/`removeApproval`; UI `ApprovalCard.tsx` (`actionLabel(t, action)` for human text). Event `companion://approvals`.
  - Human reviews: `api/overview/reviews.ts` `listManualReviews(personaId?, status?)`, `getPendingReviewCount()`, `updateManualReviewStatus(id, status, reviewerNotes?)`. Type `PersonaManualReview`. (No companion store array — fetch directly.)
  - Proactive incidents (P2.5): `api/companion.ts` `companionListProactiveMessages(onlyUnresolved?, limit?)`, `companionEngageProactive(id)`, `companionDismissProactive(id)`; `ProactiveMessage = {id, triggerKind ('incident_blocker'|…), triggerRef, message, status, …}`; `ProactiveCard.tsx` (engage/dismiss; for `incident_blocker` deep-links via `setPendingIncidentDeepLink` + `storeBus.emit('incidents:open-detail',{incidentId})`). `IncidentDetailModal.tsx` lifecycle (`getAuditIncident`, `resolveAuditIncident`, etc.). Incident apis in `api/overview/incidents.ts`.
- i18n: `plugins.companion.*` in `src/i18n/locales/en.json` (block starts ~L11430). Orb uses `useTranslation()`; runner uses `getActiveTranslations()`.
- E2E idiom: `tests/playwright/athena-guided-walkthrough.spec.ts` + `tests/playwright/companion-bridge.ts` (`CompanionBridge`). Unit idiom: `companion/__tests__/RefineChips.test.tsx`, `SlashPalette.test.tsx` (chip+keyboard), `guidance/__tests__/guidance.test.ts` (store logic).

## RISKS (from recon — design around these)
- **Orb renders only in `state==='minimized'`.** Mount the decision bubble in `AthenaGuideLayer` (always-on portal), NOT inside `AthenaOrb`. If `state` is `collapsed`/`closed`, a decision must first promote `state='minimized'` (the guidance runner already does this).
- **TTS gated on `voiceActive`.** Speaking is best-effort; the bubble MUST be fully usable text-only + keyboard-only when voice is off/unconfigured.
- **STT is batch turn-only.** `useHoldToTalk` always routes the final transcript to a chat turn. Spoken-number answering = branch on `pendingDecision != null` BEFORE `setVoiceTurnRequest` and parse the transcript for a number/word; do NOT fire a chat turn for a decision answer.
- **Two keyboard systems.** Registry (`AppKeyboardProvider`/`useAppKeyboard`, priority) + the orb's raw `window` listener. Put the `;` leader in the orb raw listener (already the hands-free entry point). `;` is a common literal key → guard hard against typing targets (`INPUT/TEXTAREA/isContentEditable`) and only arm when `pendingDecision != null`.
- **No native option list on approvals.** `PendingApproval` has no title/options — synthesize prompt = `actionLabel(t, action)` + `rationale`, options = fixed {approve, reject, explain}.
- Build only against `src/...` — ignore `.claude/worktrees/*` stale copies.

## THE 7 PIECES (build order — each slice must compile + tsc-clean before the next)

### Slice 1 — `pendingDecision` store model (foundation; no UI yet)
In `companionStore.ts` add (near the walkthrough block), and the type in `companion/types.ts` (or a new `companion/decision/types.ts`):
```ts
export interface DecisionOption {
  key: string;                 // stable id
  label: string;               // shown + spoken ("Approve")
  hint?: string;               // optional sub-label
  run: () => void | Promise<void>;  // the action (approve/reject/navigate/open-modal)
  danger?: boolean;
}
export interface PendingDecision {
  id: string;
  prompt: string;              // "Shall I resolve this critical incident?"
  options: DecisionOption[];   // 1..9 (digit-pickable)
  recommendation?: string;     // spoken/shown on "0" (explain+recommend)
  detail?: string;             // longer explanation for "0"
  source: 'approval' | 'human_review' | 'incident' | 'adhoc';
  // SHIPPED: `source` also carries 'message_attention', and the interface gained
  // `payload?: string` (serialized context of the underlying row, handed to Athena
  // as grounding for the `0` explain turn). See `decision/types.ts`.
  sourceRef?: string;          // approval id / review id / incident id
  highlightTestId?: string;    // optional: ring the element being asked about
  navigateRoute?: string;      // optional: take user to context first
}
```
Store fields (ephemeral, NOT persisted): `pendingDecision: PendingDecision | null`, `decisionExplained: boolean` (tracks whether "0" was used, to re-ask). Actions: `setPendingDecision(d)`, `clearPendingDecision()`, `markDecisionExplained()`. Mirror the existing ephemeral walkthrough setters. Unit test in `companion/__tests__/decisionStore.test.ts` (set/clear/explain transitions) — mirror `guidance.test.ts`.

> Shipped as specified (`companionStore.ts:679-683`, `:1389-1406`), plus three fields the explain/failure work added later: `decisionError`, `explainComposing`, `explainComposeError`.

### Slice 2 — `OrbDecisionBubble` component (visual + click, no voice yet)
`src/features/plugins/companion/orb/OrbDecisionBubble.tsx`. Mount it in `AthenaGuideLayer.tsx` (always-on portal), positioned ABOVE the orb (off `orbGuideTarget` / `companionOrbPos`, with a tail toward the orb — copy `GuideCaption`'s positioning + `rounded-card bg-background/95 border shadow-elevation-3` chrome). Renders nothing unless `pendingDecision != null`. Shows: `prompt`, then a numbered list of `options` as chips (copy `QuickReplies` chip render with `{i+1}` badge; `option.run()` on click → then `clearPendingDecision()`), plus a `0` "Explain / recommend" chip. On mount, if `state !== 'minimized'` promote it; if `navigateRoute`/`highlightTestId` set, call the guidance setters to take the user there + ring the element. Fully keyboard + click usable WITHOUT voice. i18n new keys under `plugins.companion.decision_*` (e.g. `decision_explain`, `decision_recommend_prefix`). doc-sync: README touch.

### Slice 3 — the unified decision queue (aggregator)
`src/features/plugins/companion/decision/useDecisionQueue.ts` — a hook/service that builds `PendingDecision`s from the three sources and feeds them one-at-a-time into `pendingDecision` (FIFO; only when none is pending). Mapping:
- **approval** → prompt `actionLabel(t, action) + ': ' + rationale`; options [Approve→`companionApproveAction(id)`, Reject→`companionRejectAction(id)`]; recommendation from a simple heuristic (low-risk action → recommend approve; else explain); source `approval`, sourceRef id. On resolve → `removeApproval(id)` + apply any `clientAction`.
- **incident** (proactive `incident_blocker`) → prompt = `message`; options [Resolve→open `IncidentDetailModal` via the existing `storeBus.emit('incidents:open-detail',{incidentId: triggerRef})` + navigate, Dismiss→`companionDismissProactive(id)`]; recommendation by severity; highlightTestId none (it navigates). source `incident`.
- **human_review** → prompt = review title/description; options [Approve→`updateManualReviewStatus(id,'approved')`, Reject→`updateManualReviewStatus(id,'rejected')`, Open→navigate to the review inbox]; source `human_review`.
Drive it from a single place (e.g. `AthenaGuideLayer` or a small `DecisionDriver` mounted next to it) that subscribes to `companion://approvals` + `companion://proactive` events + polls `getPendingReviewCount`, and calls `setPendingDecision` when idle. ~~Keep it OFF by default behind a setting `companionHandsFreeDecisions` (persisted, default false).~~

**Shipped differently, deliberately.** `DecisionDriver` is mounted in `AthenaGuideLayer.tsx:52` and the queue is **always active**. The gate was removed when the third notification dimension (footer popover / toasts) was deleted, because a gated queue would make pending approvals, incidents and reviews invisible outside their own pages. `companionHandsFreeDecisions` survives as a setting but no longer controls surfacing; it governs how far Athena may act *without* asking. The queue also re-fetches on every pump rather than polling `getPendingReviewCount` (it calls `listManualReviews(undefined, 'pending')` directly), and a **fourth** mapping exists: `message_attention` proactives → a decision whose resolve path calls `markReportRead`.

### Slice 4 — `0 = explain + recommend, then re-ask`
When the user picks `0` (click or key), do NOT clear the decision: speak/show `recommendation` + `detail` (set `decisionExplained=true`), and keep the same `pendingDecision` so the numbered options remain. The bubble shows the recommendation text above the options after `0`.

**Explain-in-Cockpit escalation (shipped 2026-06-10).** `0` now ALSO fires a
synthetic `decision-explain` turn carrying the decision's full context
(including the new `PendingDecision.payload` — approval params / incident
trigger / review body). Athena answers with an `explain_in_cockpit` op; the
spec rides in the `EXPLAIN_COCKPIT_EVENT` payload (never persisted) and
renders as a contextual cockpit overlay at Home → Cockpit, built from the
explainer widget palette (`verdict`, `flow_steps`, `comparison_cards`,
`timeline`, `stat_grid`, `log_excerpt`). While composing: orb plays the
`composing` clip (`athena_shows_loop.mp4`), bubble shows a processing row;
on failure the static recommendation remains the floor. The `verdict`
widget renders the live decision options, so the user can resolve from the
Cockpit. See [`../cockpit.md`](../cockpit.md) → "Explainer widgets".

### Slice 5 — `;` leader-key numeric syntax
In `AthenaOrbLayer.tsx` (next to the Shift+A block): a small leader state machine via `useRef`. **Shipped on the app keyboard registry (`useAppKeyboard` at `ROUTE_DECISION_PRIORITY`), not a raw `window` listener**, because the leader's `1`-`9` are the same digits the full-app triage deck binds, and with both on `window` one press fired both (`AthenaOrbLayer.tsx:124-190`). When `pendingDecision != null` and the user presses `;` (and not in a typing target), arm a 2s window; the next `0-9` resolves: `1..n` → `options[n-1].run()` + clear; `0` → explain (slice 4). `Esc` disarms. Mirror the guard pattern from `QuickReplies`/`WorkspaceShortcuts` (skip when `tagName` INPUT/TEXTAREA or `isContentEditable`).

### Slice 6 — TTS speaks ONLY the Explain/Recommend response
The walkthrough narration is NOT spoken today. TTS does **not** auto-read the decision `prompt`/description when the bubble surfaces — that text is on-screen to read, and auto-reading a full review description over the user was noise. Athena speaks **only** when the user picks `0` (Explain/Recommend): a chat-panel-owned reaction (shipped at `chat/athenaChatTriggers.ts:55-67`) watches `decisionExplained` and speaks the `recommendation` via `playProgressClip`, with markdown stripped first (`stripMarkdownForSpeech`) so she never reads `**`/`-`/`#` aloud. Best-effort; silent when voice off. The bubble itself renders `prompt`/`recommendation` as **markdown** (bullets + bold), so a well-formatted `request_review` description is legible in the bubble too.

### Slice 7 — spoken-number answering
When `pendingDecision != null`, branch the STT result in `useHoldToTalk` (before `setVoiceTurnRequest`; shipped at `useHoldToTalk.ts:108-120`): parse the transcript for a number word/digit (`"one"|"1"|… "zero"|"explain"|"yes"|"no"`). If it maps to an option (or 0), resolve the decision instead of firing a chat turn. Small pure `parseSpokenDecision(transcript, optionCount)` helper + unit test. If it doesn't parse to a decision answer, fall through to the normal chat turn.

## Verification (every slice)
- `npx tsc --noEmit` EXIT 0 (the primary oracle — run after EVERY slice).
- `npm run test` for new unit tests (decisionStore, parseSpokenDecision, bubble render/keyboard) — mirror existing companion `__tests__` idiom (vitest).
- `git show HEAD:<file> | grep` proof each piece is wired (component imported+rendered in AthenaGuideLayer; store field present; leader-key present in AthenaOrbLayer) — NOT narration.
- i18n: `node scripts/i18n/check-coverage.mjs` no EXTRAS.
- Atomic commit per slice; per-file `git add`; leave leonardo + `docs/test/` (ignored) untouched.
- doc-sync: this plan + `docs/features/companion/README.md` (the Stop hook will nag on `src/features/plugins/companion/**` edits).

## Out of scope (note, don't build)
- Multi-persona orb decisions (Athena-only for now).
- Live whisper interim number parsing (batch only — parse final transcript).
- Replacing the existing ApprovalCard/ProactiveCard chat surfaces — the decision bubble is an ADDITIONAL hands-free surface, not a replacement.

> Amended: `decision/ChatDecisionCard.tsx` was added later as the chat-side face of the *same* `pendingDecision`, rendered from `chat/AthenaChatAlerts.tsx:45`. It does not replace ApprovalCard/ProactiveCard; it covers the sources that had no chat card at all (human reviews, `adhoc`) for the window in which the orb, and therefore the bubble, is not on screen.
