# Athena Hands-Free Decision Layer (P3) — build spec

**Status:** building 2026-05-30. The orb + voice + guided-walkthrough infra is ALREADY SHIPPED
(see [`athena-orb-overlay-plan.md`](./athena-orb-overlay-plan.md) Steps 2a/2b/2c/3 +
[`athena-guided-walkthroughs.md`](./athena-guided-walkthroughs.md)). This spec is the
**decision/approval layer on top**: a voice-first, numbered-choice surface that lets the user
clear approvals / human-reviews / incidents hands-free.

## The goal (user's words, distilled)
1. A **bubble above the orb** that shows text (markdown — bullets/bold) and **requests a DECISION** with numbered options ("Shall I deploy? 1) yes 2) no"). TTS is **not** auto-spoken on surface — only on `0` (Explain/Recommend), see Slice 6.
2. User answers by **clicking** an option OR by a **`;` leader-key then a digit** (numeric decision syntax). **`0` = Athena explains the options + gives her recommendation**, then re-asks.
3. The same surface presents **proactive incidents** (open high/critical `audit_incidents` — the P2.5 thread) and **pending approvals / human-reviews** as these numbered decisions.
4. Athena can **highlight/navigate** the app while asking (reuse the guided-walkthrough glide+glow).

## What's SHIPPED (reuse, do NOT rebuild) — verified anchors
- Orb: `src/features/plugins/companion/orb/AthenaOrb.tsx` (renders only when `state==='minimized'`), `AthenaOrbLayer.tsx` (mounts the orb + owns the raw Cmd/Ctrl+Shift+A keydown at ~L43-69 + the single `useHoldToTalk()` instance), `AthenaGuideLayer.tsx` (ALWAYS-ON portal, `z-[60]`, hosts `useGuidanceRunner` + `TrackedGlowRing` + `GuideCaption`).
- Walkthrough mechanism (reuse to "operate app while asking"): store actions `setOrbGuideTarget`, `setGuidanceHighlightTestId`, `flashHighlight` in `companionStore.ts` — independent of `activeWalkthrough`. `GuideCaption.tsx` is the structural template for a positioned, tailed, interactive bubble.
- Numbered-chip primitive: `QuickReplies.tsx` (renders `{i+1}` badges, binds keyboard digits 1-9 via `parseInt(e.key)`; guards typing targets). Copy its chip render + digit idiom.
- Voice OUT: `voicePlayback.ts` `synthesize(text, credentialId, voiceId, settings?, engine)` + `play(url)`. The orb does NOT own voice context — credential/voiceId/engine/settings live in `CompanionPanel.tsx` (`useTtsSettings()`, `voiceActive` at ~L1368-1372, `playProgressClip` ~L1391-1417 is a ready "speak this short text now" helper).
- Voice IN: `useHoldToTalk.ts` (`{supported,talking,interimText,start,stop,abort}`; on session end calls `setVoiceTurnRequest(text)` at ~L99 → consumed by `CompanionPanel` effect ~L1637 → full chat turn, no panel). `useSpeechInput.ts` picks browser vs whisper.
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
  sourceRef?: string;          // approval id / review id / incident id
  highlightTestId?: string;    // optional: ring the element being asked about
  navigateRoute?: string;      // optional: take user to context first
}
```
Store fields (ephemeral, NOT persisted): `pendingDecision: PendingDecision | null`, `decisionExplained: boolean` (tracks whether "0" was used, to re-ask). Actions: `setPendingDecision(d)`, `clearPendingDecision()`, `markDecisionExplained()`. Mirror the existing ephemeral walkthrough setters. Unit test in `companion/__tests__/decisionStore.test.ts` (set/clear/explain transitions) — mirror `guidance.test.ts`.

### Slice 2 — `OrbDecisionBubble` component (visual + click, no voice yet)
`src/features/plugins/companion/orb/OrbDecisionBubble.tsx`. Mount it in `AthenaGuideLayer.tsx` (always-on portal), positioned ABOVE the orb (off `orbGuideTarget` / `companionOrbPos`, with a tail toward the orb — copy `GuideCaption`'s positioning + `rounded-card bg-background/95 border shadow-elevation-3` chrome). Renders nothing unless `pendingDecision != null`. Shows: `prompt`, then a numbered list of `options` as chips (copy `QuickReplies` chip render with `{i+1}` badge; `option.run()` on click → then `clearPendingDecision()`), plus a `0` "Explain / recommend" chip. On mount, if `state !== 'minimized'` promote it; if `navigateRoute`/`highlightTestId` set, call the guidance setters to take the user there + ring the element. Fully keyboard + click usable WITHOUT voice. i18n new keys under `plugins.companion.decision_*` (e.g. `decision_explain`, `decision_recommend_prefix`). doc-sync: README touch.

### Slice 3 — the unified decision queue (aggregator)
`src/features/plugins/companion/decision/useDecisionQueue.ts` — a hook/service that builds `PendingDecision`s from the three sources and feeds them one-at-a-time into `pendingDecision` (FIFO; only when none is pending). Mapping:
- **approval** → prompt `actionLabel(t, action) + ': ' + rationale`; options [Approve→`companionApproveAction(id)`, Reject→`companionRejectAction(id)`]; recommendation from a simple heuristic (low-risk action → recommend approve; else explain); source `approval`, sourceRef id. On resolve → `removeApproval(id)` + apply any `clientAction`.
- **incident** (proactive `incident_blocker`) → prompt = `message`; options [Resolve→open `IncidentDetailModal` via the existing `storeBus.emit('incidents:open-detail',{incidentId: triggerRef})` + navigate, Dismiss→`companionDismissProactive(id)`]; recommendation by severity; highlightTestId none (it navigates). source `incident`.
- **human_review** → prompt = review title/description; options [Approve→`updateManualReviewStatus(id,'approved')`, Reject→`updateManualReviewStatus(id,'rejected')`, Open→navigate to the review inbox]; source `human_review`.
Drive it from a single place (e.g. `AthenaGuideLayer` or a small `DecisionDriver` mounted next to it) that subscribes to `companion://approvals` + `companion://proactive` events + polls `getPendingReviewCount`, and calls `setPendingDecision` when idle. Keep it OFF by default behind a setting `companionHandsFreeDecisions` (persisted, default false) so it never surprises a user — the orb decision surface only activates when they opt in OR when they explicitly summon it.

### Slice 4 — `0 = explain + recommend, then re-ask`
When the user picks `0` (click or key), do NOT clear the decision: speak/show `recommendation` + `detail` (set `decisionExplained=true`), and keep the same `pendingDecision` so the numbered options remain. The bubble shows the recommendation text above the options after `0`.

### Slice 5 — `;` leader-key numeric syntax
In `AthenaOrbLayer.tsx`'s raw keydown handler (next to the Shift+A block): a small leader state machine via `useRef`. When `pendingDecision != null` and the user presses `;` (and not in a typing target), arm a 2s window; the next `0-9` resolves: `1..n` → `options[n-1].run()` + clear; `0` → explain (slice 4). `Esc` disarms. Mirror the guard pattern from `QuickReplies`/`WorkspaceShortcuts` (skip when `tagName` INPUT/TEXTAREA or `isContentEditable`).

### Slice 6 — TTS speaks ONLY the Explain/Recommend response
The walkthrough narration is NOT spoken today. TTS does **not** auto-read the decision `prompt`/description when the bubble surfaces — that text is on-screen to read, and auto-reading a full review description over the user was noise. Athena speaks **only** when the user picks `0` (Explain/Recommend): a `CompanionPanel`-owned reaction watches `decisionExplained` and speaks the `recommendation` via `playProgressClip`, with markdown stripped first (`stripMarkdownForSpeech`) so she never reads `**`/`-`/`#` aloud. Best-effort; silent when voice off. The bubble itself renders `prompt`/`recommendation` as **markdown** (bullets + bold), so a well-formatted `request_review` description is legible in the bubble too.

### Slice 7 — spoken-number answering
When `pendingDecision != null`, branch the STT result in `useHoldToTalk` (before `setVoiceTurnRequest` at ~L99): parse the transcript for a number word/digit (`"one"|"1"|… "zero"|"explain"|"yes"|"no"`). If it maps to an option (or 0), resolve the decision instead of firing a chat turn. Small pure `parseSpokenDecision(transcript, optionCount)` helper + unit test. If it doesn't parse to a decision answer, fall through to the normal chat turn.

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
