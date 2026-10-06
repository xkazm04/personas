# P1 — Conventional, perfected

Code: `src/features/decision-center/prototype/directions/p1/` · Lab: `?kit=p1:<entry>`

## The idea

`ModalShell`'s lineage taken to Linear/Raycast restraint: no new metaphor, just the three levels done exactly. The strip is a row of labelled chips whose glyph carries a severity lamp; the peek is a tidy anchored list that says what to do first and what it costs; the modal is ONE centered sheet (chrome bar, the ask, one scroll region, a decision footer) shared by all four types. Quality comes from type, spacing and rhythm, and from motion that is short and always means something (where it came from, which way you walked, what your verdict did).

## The 5-second first-sight test

| Level | Question | Where the answer is |
|---|---|---|
| Strip | How many need me? | The filled **Triage all · 16** button is the first thing in the row — the total, and the one action. |
| Strip | Of what kind? | Each chip is glyph + count, with the word at wide widths (1920). At 1280 inside the app shell the strip has ~470 px, so words fold into tooltips — **except the chip holding the next item, which keeps its word**. |
| Strip | Which is most urgent? | The chip holding `items[0]` wears a standing hairline and its word ("Gates"); at wide widths a **Next ·** line names the item itself. Severity reads separately from the lamp on each glyph (red = critical incident). |
| Peek | Which first? | Row 1 is marked **Next**, already focused, with its keys printed on it (`A Approve · R Reject`). A colour bar on each row is its urgency. |
| Peek | What does it cost? | Each row's meta line ends with the cost: `one key`, `2 answers`, `3 min read`, `reply`, `effort 3/10`. |
| Modal | What is asked? | The title, in `typo-heading-lg`, pinned above the scroll region — it never scrolls away. |
| Modal | What happens if I say yes? | The **IF YOU APPROVE / ACCEPT / RESOLVE…** callout right under it: the item's alert when it has one (tinted by its tone), else the kind's plain consequence. Reports: **WHEN YOU MARK IT DONE**. |
| Modal | Which key? | Every verdict button wears its key (`Approve A`, `Reject R`, `Later S`, `Build now 1`, `Done D`); the footer legend lists the rest. |

## States shown

- Zero: chip stays in place, dimmed (`strip-states-*`: Chat 0).
- Failed: dashed error rule around the chip and a warning glyph instead of a count — never a 0 (`strip-states-*`: Council). The Lab's "council source failed" toggle drives the same state.
- Armed verdict: the footer swaps to a one-line confirmation (`Reject this?` / `Approve this verdict?`, Enter confirms, Esc cancels).

## Key map

| Key | Strip | Peek | Modal |
|---|---|---|---|
| ↑ / ↓ | — | move focus | scroll the body / reader |
| Enter | — | open the focused row (confirms an armed reject) | confirm an armed verdict; in a reason prompt, decide without a reason |
| A | — | accept the focused row (questions and council open the modal instead) | accept (council: arm, Enter confirms; chat: focus the composer) |
| R | — | arm reject on the row, Enter confirms | arm reject; Enter confirms or opens the reason prompt (1-9 picks, free text optional); council: send-back prompt needing ≥12 chars |
| D | — | done (reports, chat) | done / mark read (reports, chat) |
| S | — | — | later (skip; advances, wraps) |
| ← → / K J | — | — | walk the queue (the opened chip's items; Triage all = the whole roster) |
| 1-9 | — | — | branches (`Remove the discount…`, `Build now`, `Follow up in chat`); reason options while the prompt is open |
| ⇧1-5 | — | — | rate a report (digits alone stay branches) |
| Space | — | — | focus the chat composer (Enter sends, ⇧Enter new line) |
| Esc | — | close the peek | one step back: leave the field → disarm → close the sheet (back to the peek) |

Ranks: the peek and the sheet both register at `OVERLAY_DISMISS_PRIORITY` (never at the same time). The sheet does not handle Esc itself: BaseModal owns it and calls the sheet's close request, which steps back one level. The peek's dismissal (outside press + Esc) is the shared `useClickOutside` with the strip counted as inside. Letter keys never fire while a field has focus.

## Motion notes

- **Origin morph:** the sheet grows out of the chip / peek row / Triage-all button it was opened from (origin-aware transform: translate from the origin's centre at scale 0.5, ease-out-expo, 280 ms after BaseModal's backdrop), and on close returns to the peek row of the item it ends on, or its chip.
- **Walking:** content enters from the side you walked toward (←/→, 56 px), header chrome stays put.
- **Leave on verdict:** accept/reply lifts the item up and away, reject drops it down, done settles it in place, skip slides it out sideways; a small verdict pill ("Approved · Send the ACME…") confirms for 1.2 s. The next item is chosen before the Lab removes the decided one, so the hand-off is seamless.
- **Peek:** anchored drop from the chip (180 ms) with a 25 ms row stagger; decided rows slide out and the list re-flows (`layout`).
- **Counts:** chip counts and the Triage-all total roll (`AnimatedCounter mode="roll"`).
- **Reduced motion** (`useReducedMotion`, OS or in-app): every one of the above becomes a ≤120 ms fade.

## Reproducing the shots

```
node scripts/style/shoot.mjs --module decision-center/prototype --tape docs/design/decision-center/p1/tape.json --port 1441 --kit p1:<entry> --out docs/design/decision-center/p1 --label <entry-with-dashes> --sizes 1280x800,1920x1080 --themes dark-midnight,light
```

Entries: `strip`, `peek:gates`, `peek:ready`, `modal:approval`, `modal:backlog`, `modal:report`, `modal:chat`, plus two P1-only kits the Hub reads itself: `strip-states` (failed + zero chips) and `modal:report-html` (the HTML report; also reachable by → twice from the council verdict in the `modal:report` walk). The tape is the synthetic one with the clock frozen at the fixtures' own "now" (2026-10-06 14:00Z); with `--tape synthetic` the clock sits two weeks earlier and every age reads "now".

**`modal:report-html` exits 1 with one console error per shot:** `Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.` That script is the harness's own (Playwright's `page.clock` / `addInitScript` inject into every frame, including the sandboxed srcdoc frame), not the page's; the frame is doing exactly its job. Fixing it belongs to `shoot.mjs` (skip init scripts for sandboxed frames, or filter that one message), outside this package. The PNGs are written and correct.

## With one more day

- Measure the real CommandBar instead of the 440 px stand-in and show chip words at 1280 if the tally can give up ~120 px (or collapse the tally to lamps-only while a peek is open).
- Pin the Next item into the strip as a real control (press it = open that item), not just text.
- A visible "jump to the question" affordance in long chat threads, and per-message "reply to this" in the composer.
- Peek row actions that do not shift the title on focus (reserve the hint column).
- Answering question fields by keyboard (Tab into the first field, digits pick choice pills).
- Undo for the last verdict (`Z` within the flash's 1.2 s).
