# WP11 phase A: persona cards in the bays, three variants

Owner decision (binding): **calm + richer**. State is a lamp plus a tone edge in the plate language, never a
saturated fill; each card gains one activity line (now, else last run, plus the next schedule). This folder is
the variant round. Nothing in `src/**` changed; phase B ports the pick into `entry-e/PersonaLine.tsx`.

## How the shots were made

- Harness: `scripts/style/page-harness/personaCardVariants.tsx` (modules `monitor/persona-cards` and
  `monitor/persona-cards/peer`, `--query variant=before|v1|v2|v3`), cards in `personaCardVariantsCards.tsx`,
  facts in `personaCardVariantsFacts.tsx`, tape `personaCardVariantsTape.mjs`.
- The board is the REAL `PersonaMonitor` (rail with Sessions / Stewards / Usage plates, CommandBar with the lane
  chips, the dock, every bay and the tray). A variant leaves `PersonaLine` mounted (tooltip, click, context menu,
  keys, testids, selection outline all real) and portals the variant card into each `fleet-grid-square`, reading
  the props the line was rendered with off its fiber; a scoped stylesheet hides the line's own face and fill.
  `before` is today's `PersonaLine`, untouched, on the same tape.
- Tape: WP10's mandate roof, rebalanced so every state is on screen at once (on the roof tape 22 of 30 personas
  carried unread reports, so the board was one state). 8 needs-you (unread), a warning review, a critical review
  (DNS Auditor), a failed last run (Invoice Reconciler), three live runs plus one queued, five off, eight cron
  schedules, one persona that never ran. Runs are kept under 25 min: `reapStaleRunning` reaps anything older
  (the engine caps a run at 20 min), which is why the WP10 tape's 38-minute run never drew as working.
- Command: `node scripts/style/page-harness/personaCardVariantsTape.mjs <tape>` then
  `node scripts/style/shoot.mjs --module monitor/persona-cards --tape <tape> --query variant=v2 --reduced-motion --settle 5000`.

## Data scout: what fills the activity line

| Field | Source on the board today | Status |
|---|---|---|
| state, need reason, count | `PersonaCardModel` (`pileKey`, `needReason`, `actionBadges`), the board's own model | on the board |
| running for | `card.runningSince` from the `PROCESS_ACTIVITY` "started" event (`overviewStore.activeProcesses`) | on the board |
| queued behind it | `card.queued` from the `QUEUE_STATUS` "queued" event (same store) | on the board |
| last run outcome | `card.recentStatuses[0]` from `get_persona_summaries.health` (`agentStore.personaHealthMap`) | on the board |
| last run age | `agentStore.personaLastRun` from `get_persona_summaries.lastRunAt` (same read) | in the store, unused by the card today |
| runs today, last 6 outcomes | `card.runsToday`, `card.recentStatuses` (same read) | on the board |
| run time cap (V3 bar) | `persona.timeout_ms` from `list_personas` (`agentStore.personas`) | in the store |
| next schedule | `overviewStore.cronAgents[].next_trigger_at` from `list_cron_agents` | **NOT read while the Monitor is open**: only the Schedules overlay calls `fetchCronAgents`. Phase B adds this one read (mount + the board's 30 s cadence). The title-bar tray reads the same slice but never fetches it. |
| peer agent | `DeviceAgent.running / enabled / projectEnabled` from the device snapshot | on the board; no last run, no schedule, no run counts exist for a peer, so they are absent |
| **run title** | the execution's `PROCESS_ACTIVITY` label is the persona's own name (`src-tauri/src/engine/runner/mod.rs` "started" emit) | **dropped**: nothing fills it. Cheapest real source is the execution row (`get_execution` -> use case), one read per live run; not proposed for phase B without an owner call |
| live tool calls, live cost | `ActiveProcess.toolCallCount / costUsd` | **dropped**: `enrichProcess` has no caller, both stay 0 |

Strings: no new keys. The variants reuse `monitor.schedule_next`, `schedule_last_run`, `board_no_runs`,
`caption_queued_many`, `board_runs_today`, `board_reason_*`, `board_pile_*`, `grid_state_running`.

## The three variants

Rows per bay are counted in the Personas Desktop bay at 1280x800, whose roster is capped at `max-h-[24rem]`
(384 px) by `Bay.tsx`.

### V1 Tail: one 36 px row (10 rows per bay; today: 9)
Structure: the bay nameplate's grammar applied to a persona. Flat hairline row (`.ae-line`), framed face, bold
name, then the activity as caption tokens (outcome glyph + age, then `CalendarClock` + next start), and at the
right edge the need glyph + count (or the run's elapsed time) and the lamp, exactly where a bay's nameplate puts
its count and lamp. Needs-you and critical light the row's tone edge and its soft wash.
What I saw: the calmest board and the densest; it reads as part of the plates. But the tail is starved: at a
250 to 320 px column the name eats the row, so the activity collapses to "2h" and the next start is clipped
("Wed 2", "Wed 1:"). The reason in words is not shown at all (the glyph carries it). Richer only on wide screens.
Reuses: `Lamp` (`entry-e/parts.tsx:8`), `.ae-line` / `.is-lit` / `.is-off` (`entryE.css:209-217`), `.ae-sep`
(`entryE.css:301`), `NeedGlyph` (`grid/skin/NeedGlyph.tsx:21`), the framed face as `PersonaLine.tsx:132`,
`compactAge` (`entry-e/tone.ts:84`).

### V2 Gutter: two lines in a 50 px window (7 rows per bay)
Structure: the session card's anatomy (`SESSION_LINE_H = 50`, `SessionLine.tsx:33`) for personas, so persona and
session cards in one bay share one rhythm. A glass window (`.ae-win`) with a lamp gutter at the left (the plate
row grammar of the Schedules and Stewards plates), face, then row 1 name + figure (need glyph and count, or
elapsed), row 2 the activity sentence in words ("Review waiting", "Running · 1 queued", "Last run 2h",
"No recent runs", "Off") with the next start right-aligned. Needs-you takes `.ae-win.is-lit` (3 px tone edge,
gradient falling to 3 %); critical adds a 70 % tone border; working keeps only the edge.
What I saw: the most legible activity line of the three, in both themes; the reason is finally a word you read,
not a colour you decode. The bays look like the session cards beside them, which is the "same hand" test. On
light the needs-you wash reads warm and calm, critical clearly red. Cost: 7 rows per bay instead of 9, so the
Personas Desktop bay scrolls sooner, and long names truncate ("Release No...", "Invoice Reconci...") beside a
figure at 1920 where six bay columns are narrow.
Reuses: `Lamp`, `.ae-win` / `.is-lit` / `.is-off` (`entryE.css:109-131`), `NeedGlyph`, the framed face,
`DeviceGlyph` + `PeerAgentToggle` (`entry-e/devices/`) on peer cards, `shortElapsed` (`prototype/shared.tsx:169`).

### V3 Instrument: a 69 px figure row with a foot (5 rows per bay)
Structure: lamp + small face + name + figure, then three aligned figure columns (activity, runs today, next
start), then a 3 px foot: while a run is live, the run against the persona's time cap (`timeout_ms`, the only
honest progress figure the board has), otherwise the last six outcomes as segments (`.ae-segs`, green / red /
grey, oldest first).
What I saw: the richest and the one that best answers "is this persona healthy" at a glance: a red segment
reads before the name. But it is the tallest card by far, the masonry loses whole bays below the fold at
1280x800, and the outcome strip under every card adds a second colour signal that competes with the lamps
(annunciator: a light should mean "works or needs you", and the green strip is lit at rest). Runs today is a
figure the brief did not ask for.
Reuses: `Lamp`, `.ae-line`, `.ae-segs is-thin` (`entryE.css:152-158`), `.ae-bar` (`entryE.css:226`),
`runAgeFraction` (`grid/skin/tileState.ts:27`) as the fallback scale, `NeedGlyph`.

### Peer bay (all variants)
`peer-bay-*.png`. The bay already says "On Studio Desktop", so the activity line is the state word only; a peer
has no last run, schedule or run counts, and they are absent (V3 leaves its runs-today column empty rather than
printing 0). The device glyph and the real on/off switch stay at the right edge in every variant.

### Every state is present
needs you (Release Noter, Incident Scribe, Review Collector ...), critical (Invoice Reconciler: last run failed;
DNS Auditor: critical review), working with progress (Escalation Router 6m with 1 queued, Payroll Checker 13m,
Pulse Reader 2m), idle with last run and next start (Leave Planner, Log Sifter, Ledger Closer), off (Tax Digest,
Budget Watcher, Payment Chaser, Receipt Matcher, Cohort Slicer), never ran (Vendor Onboarder), peer bay.

## Recommendation: V2, fused with one part of V3

**Port V2, and give it V3's run bar on working cards only.** V2 is the one that passes "same hand": it is the
session card's own height and two-row anatomy with the plate's lamp gutter, so a bay of personas and sessions
reads as one list instead of two languages; its activity line is a sentence, so the "richer" half of the
decision actually lands; and its lit window keeps critical unmissable (red edge, red border, red word) while
needs-you stays warm, not loud. The fusion: while a run is live, draw V3's 3 px run-against-cap bar along the
window's foot, exactly where a session card draws its age bar today (`fb-age`), so a working persona and a
working session show progress the same way. Leave V3's outcome strip and runs-today out (a second lit signal at
rest breaks the annunciator rule) and leave V1's single row as the density fallback should the owner find 7 rows
per bay too few.

Phase B costs, named: one `list_cron_agents` read while the Monitor is open; the run title stays absent unless the
owner wants the per-run `get_execution` read. Note also that the Queue view does not render `PersonaLine` (it
lists sessions only), so phase B's consumers are `ClassicPanel` and `devices/PeerBay`.

## Files

- `sheet-<size>-<theme>.png`: all four side by side (before, V1, V2, V3), the whole board.
- `bay-closeup-1280x800-<theme>.png`: the Personas Desktop bay and its neighbour column, four ways.
- `peer-bay-1280x800-<theme>.png`: the Studio Desktop peer bay, four ways.
- `<before|v1|v2|v3>-<1280x800|1920x1080>-<dark-midnight|light>.png`, `peer-<variant>-1280x800-<theme>.png`: the raw shots.
