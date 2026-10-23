# WP12 Phase A - Conversations restructured, three variants

Owner decision (2026-10-16, binding): **restructure, not restyle**. Runs and deliberations show the outcome first;
reviews are decided in the deck's anatomy (outcome pair + fixed verdict dock with keys, no raw Reject/Approve);
the projects rail uses the Stewards row grammar. The variants differ on the one open question: **where the
decision surface lives** - a right rail (V1), inside the thread with a fixed dock (V2), or a briefing on top with
a lane-like peek (V3).

Nothing under `src/` changed. All three are page-harness modules that mount the variant **in place of today's tab
inside the real Monitor** (its header, tabs, fleet strip and dispatch dock are the app's own):

| Module | What |
|---|---|
| `monitor/conversations/before` | today's tab on the same tape |
| `monitor/conversations/v1` (`/drive`) | three plates, NEEDS YOU rail |
| `monitor/conversations/v2` (`/drive`) | thread + inline asks + fixed verdict dock, no rail |
| `monitor/conversations/v3` (`/drive`) | briefing first: needs you, what happened, then the thread |

Files: `scripts/style/page-harness/conversationVariants*.tsx|ts|mjs` (Surfaces, Frame, Rail, Bands, Deck, Drive,
V1-V3, Data, Tape). Tape: `conversationVariantsTape.mjs` (the WP8 roof tape plus an operator reply, three held
steps, a held question line, an outcome on the settled run, two persona threads). Content: Personas Desktop with
a settled run, a run waiting on review, a converging deliberation, persona lines, two operator lines, a routed
proposal, and **four asks** (three reviews + one held question).

```bash
node scripts/style/page-harness/conversationVariantsTape.mjs tmp/style-tapes/conv-variants.json
node scripts/style/shoot.mjs --module monitor/conversations/v2 --tape tmp/style-tapes/conv-variants.json \
  --reduced-motion --settle 3000 --out <dir> --label v2 --sizes 1280x800,1920x1080 --themes dark-midnight,light
```
(The shooter wrote its PNGs and report and then did not exit on this machine, twice; kill only your own pid
once the report lands.)

## Shots

`<name>-<size>-<theme>.png` for `before`, `v1`, `v2`, `v3` at 1280x800 and 1920x1080, dark-midnight and light;
`v1-drive`, `v2-drive`, `v3-drive` at both sizes in dark-midnight; `sheet-dark-midnight.png` and
`sheet-light.png` (before | V1 / V2 | V3, 1920x1080 at half scale).

## The behaviour checklist (today's tab, scouted)

Every behaviour of today's tab, where it lives now, and where it lives in each variant. "same" = the same part in
the same place, restyled in the variant's grammar.

| # | Behaviour | Today (file:line) | V1 | V2 | V3 |
|---|---|---|---|---|---|
| 1 | Project list, select a team | `ConversationSidebar.tsx:73-164`, `ConversationBriefing.tsx:86-90` | rail rows | rail rows | rail rows |
| 2 | Unread per team (D6 watermark) | `ConversationSidebar.tsx:93,118` | NEW column | NEW column | NEW column |
| 3 | Member presence (working / waiting / idle, last seen) on a minute clock gated on visibility | `ConversationSidebar.tsx:94-101,124-146,281-287` | share strip + tooltip | same | same |
| 4 | Live deliberation mark on a row | `ConversationSidebar.tsx:96,112-117` | tooltip line + working share | same | same |
| 5 | Last message time | `ConversationSidebar.tsx:154-158` | tooltip | tooltip | tooltip |
| 6 | Persona threads group (previews, unread, persona scope) | `ConversationSidebar.tsx:183-228,249-267,305-318` | PERSONAS rows | same | same |
| 7 | Mark read on open | `ConversationBriefing.tsx:113-117` | unchanged (no UI) | unchanged | unchanged |
| 8 | Deep link preset (team + the line) | `ConversationBriefing.tsx:62-69,112` | unchanged | unchanged; the line it points at can be the focused ask | unchanged |
| 9 | Slack bridge chip | `ConversationBriefing.tsx:134` | frame head (not in fixture) | same | same |
| 10 | Two resizable, remembered rails | `ConversationBriefing.tsx:75-76,151,162` | both kept | left only (no right rail) | left only |
| 11 | Thread: virtualised, older on top, pinned to newest, day rules | `ConversationPane.tsx:228-235`, `useConversationRows.tsx:261-268` | same | same; pinned to the ask in hand | thread plate, talk only |
| 12 | Ghosts / empty / pick a project | `ConversationPane.tsx:216-226` | unchanged | unchanged | unchanged |
| 13 | Talk lines (markdown, author glyph, open detail modal, pin to team memory) | `ConversationCards.tsx:34-100`, `ConversationBriefing.tsx:177-182` | TalkLine | TalkLine | TalkLine |
| 14 | Machine event lines | `ConversationCards.tsx:42-50` | unchanged one-liner | same | same |
| 15 | Run card: rollup, n/m steps, rework, progress strip, persona stack, steps with output, Pause / Resume | `ConversationCards.tsx:115-229` | RunBand, outcome title, steps + Pause/Resume folded | same + the held ask inside the band | WHAT HAPPENED row (outcome first); the thread keeps a one-line mark |
| 16 | Deliberation card: topic, status, round, spend meter, Drive, turns | `ConversationCards.tsx:253-325` | DelibBand, leaning as title | same | WHAT HAPPENED row + Drive |
| 17 | Deliberation controls: advance, run to budget / stop, split / run tracks / merge, gated capability, escalation (resume / resolve / abort + note), proposal to assignment, agenda | `DeliberationRail.tsx:249-366` | rail Deliberation tab | folded open under the band | glass peek on the row |
| 18 | Routed proposal: steps, suggested persona / unrouted, Run it / Drop | `ConversationCards.tsx:334-403` | ProposalBand in thread | same | same |
| 19 | Queued prompts (queued / sending / routing / failed, Retry / Discard) | `QueuedPromptRow.tsx:37-74` | unchanged row (not in fixture) | same | same |
| 20 | Composer: per-team draft, @-mention + Tab, Enter / Shift+Enter, goal detection to Route + hint + plain override, @athena round-trip, never disabled | `ConversationComposer.tsx:50-207` | Composer (deck well, key printed once) | same | same |
| 21 | Reviews: team members' pending reviews, 30 s poll, ghosts, error + retry, empty, verdict with note, toast on failure | `ReviewsRail.tsx:28-151`, `QuickAnswerReviewCard` | NEEDS YOU rail: card head + dock (note = the deck's ReasonPrompt on R) | inline head + fixed dock | briefing head + dock |
| 22 | Reviews lamp + count (dark while unread or unreadable) | `ConversationRail.tsx:373-389` | tab lamp | strip lamp | briefing lamp |
| 23 | Quick: held questions + review stepper, team-scoped | `ConversationRail.tsx:435`, `QuickAnswerBody.tsx` | merged into NEEDS YOU (digits answer) | inline under the asker's line, digits in the dock | briefing queue |
| 24 | Persona scope: chat, reports (ReportDetailModal), review cards with suggested actions + Open in Reviews, system lines, working row, plain composer | `PersonaConversation.tsx`, `PersonaConversationCards.tsx:222-355` | same, its review cards take the deck head + dock | same | same |
| 25 | Rail scoped to the persona when one is open | `ConversationBriefing.tsx:98-110` | NEEDS YOU scoped | dock scoped | briefing scoped |

Items 7, 8, 9, 12, 19 and the persona scope (24) have no new drawing in Phase A; they keep today's behaviour and
take the variant's grammar in Phase B. A suggested action on a review (today a button beside Reject/Approve) is a
deck `Branch` with a digit in all three (shown on "Merge PR #482": "Merge after one more CI run").

## House parts reused (no new visual vocabulary)

- Stewards row grammar: `entry-e/mandate/StewardRow.tsx:73-94` (one line, right-aligned figure, lamp), `.ae-plan`
  `entryE.css:394`; the bay's colour edge `entry-e/Bay.tsx:115` and share strip `Bay.tsx:48-50` / `entryE.css:222`.
- Annunciator atoms: `entry-e/parts.tsx` `Lamp` :8-19, `Segments` :25-49, `Engraved` :56-58; plates `.ae-plate`
  `entryE.css:30`, windows `.ae-win` :109, meter `.ae-bar` :405.
- Deck anatomy: `deck/DeckDock.tsx` `Verdict` :105-131, `Branch` :133-152, `Later` :155-161 (imported, not copied);
  the outcome pair markup of `deck/CardHeader.tsx:29-37` with `.au-yes` / `.au-no` `aurora.css:378,383`; the
  eyebrow + tier lamp of `CardHeader.tsx:56-66` with `deck/parts.tsx` `Lamp` :15-17, `Keycap` :11-13 and
  `deckMeta.ts` `tierLabel` :120-124; the dock's foot `.au-rail-foot` :415; the well `.au-well` :405.
- Lane peek rows: `hub/visual/PeekRow.tsx:61-107` (`.au-row` + `.au-stripe` `aurora.css:238,245`), as AskRow.
- Shared: `PersonaStack` (`teamStudio/boardShared.tsx:104`), `SegmentedTabs`, `Button`, `Tooltip`, `RelativeTime`,
  `Numeric`, `MarkdownRenderer`, `PersonaIcon`. Strings reuse `t.monitor.*` where a key exists (`dc_deck_if_you`,
  `conv_drive`, `delib_*`, `conv_proposal_*`, `presence_*`); the rest are listed in `COPY`
  (`conversationVariantsData.ts`) as proposed `monitor.cv_*` keys for Phase B.

## The variants (what the shots show)

**V1 - three plates, re-anatomised.** Today's geometry: projects | thread | right rail. The rail becomes NEEDS YOU:
reviews and held questions are one queue (today two tabs, Reviews and Quick), the ask in hand drawn as the deck's
card head with the outcome pair stacked, the rest as lane peek rows, and the deck's verdict dock fixed at the
rail's foot. Drive turns the rail to the Deliberation tab, whose controls are deck `Branch` rows with digits.
Seen: at 1920 it reads closest to the deck itself; at 1280 the thread is ~520 px wide and the queue under the head
falls below the fold, so the rail scrolls to show what else waits. The run waiting on the operator says so in its
eyebrow, but its decision is in another plate.

**V2 - thread + inline decision strip, no right rail.** Every ask hangs under the line that raised it (the publish
gate inside its run band, the merge under PR Reviewer's line, the triage close under the settled run, the question
under Blog Drafter's line). The ask in hand opens to the deck's card head with the outcome pair side by side; the
others stay peek rows. The **fixed verdict dock** sits above the composer: NEEDS YOU 4, the title, the verdict pair
with A / R inside, the branch, Later, 1 of 4 and J / K. Drive folds the controls open under the deliberation
band. Seen: the widest thread at both sizes, and the decision reads in its context; the queue is a count plus a
walk, not a list, so "what else waits" is only visible by scrolling.

**V3 - briefing first.** Top band: NEEDS YOU (card head, dock, and the other asks as one-line stripe chips) beside
WHAT HAPPENED (one row per run and deliberation, outcome first, Drive on the deliberation row). The thread below is
talk only, with one-line marks where a run or deliberation happened. Drive opens the controls as a glass peek on its
row, the way a lane button opens its peek. Seen: "what needs you / what happened" is answered before reading
anything, but at 1280x800 the thread (the only place the operator writes) is left ~150 px, and the peek, capped at
55vh, still meets the frame's bottom edge.

## Findings on the way

- **Today's tab splits one run into two bands** when a line lands between two of its steps (`before-*`: "Ship the
  1.1 release notes" appears twice, because Blog Drafter's line sits between step 1 and step 2). The clustering in
  `conversationModel.ts` `buildConversation` is by consecutive items. All three variants draw one band per run; the
  Phase B port needs the clustering to key on the assignment, not on adjacency.
- Today's composer placeholder carries an em dash on screen (`monitor.conv_composer_placeholder`, "Message {team} -
  or describe work..." with an em dash); the variants use "Message {team}, or describe work to route it".
- Today's Reject / Approve on the rail and on persona review cards are raw coloured buttons (`Button variant="danger"`
  / `"primary"`, `PersonaConversationCards.tsx:306-327`); all variants replace them with the deck's `Verdict` pair.

## Recommendation: V2, fused with V3's chip row

**Base on V2**, and give its fixed dock **V3's one-line chips of the other asks** (stripe + title, J / K reaches
them), so the queue is visible without a rail. Keep V1's merge of Reviews and Quick into one NEEDS YOU queue.

Why: Conversations is the Monitor's only place to write, so the thread must keep its height at 1280x800, which V3
cannot and V1 does only at ~520 px. V2 is the only variant where a decision is read **in the context that raised
it** (the publish gate inside its run, the merge under the PR line) and decided with the deck's own fixed dock and
keys, which is exactly the owner's "decided inline in the deck anatomy". Its one gap - you cannot see what else
waits without scrolling - is what V3's chip row closes in one 32 px line. Deliberation controls fold under their
band in V2, so nothing layers over the thread (V3's peek clips at 1280; V1's tab hides the asks while you drive).

If the owner prefers a rail (the deck's own geometry, the queue always listed), V1 is the fallback; its cost is the
thread width at 1280.
