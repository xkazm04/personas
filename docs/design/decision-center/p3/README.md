# P3 — The Desk (wildcard)

Code: `src/features/decision-center/prototype/directions/p3/`. Lab kit: `?kit=p3:<entry>`.

## The idea

The peek never disappears: it **docks**. Pressing Enter on a peek row flies those same rows (shared
`layoutId`) to the left edge of a desk, where they stay as the live queue while the item is decided
beside them, so you always see what is next and how much is left. Long reports turn the same desk into
a **reading room**: it grows to the whole window, the queue narrows to a lamp column, contents and
reading progress sit on the right, and the decision footer stays pinned while you read.

## The 5-second first-sight test

| Level | What a stranger reads in 5 s |
|---|---|
| **Strip** | *How many:* the Triage button prints the total (16) and every chip prints its count. *What kind:* seven chips in a fixed order, each with an icon, a count and a severity lamp along its floor. From 1300 px of strip width up, every chip also carries its label. *Most urgent:* the chip holding the head of the roster gets a red ring and a dot, and at wide widths the strip also prints the item in words: **First · Lead Researcher: credential expired**. A failed source shows a dashed red chip with a warning glyph instead of a count, and its lamp is striped. A zero is grey but keeps its place. |
| **Peek** | *Do first:* row 1 is tagged **Do first**, and the tier bar on the left of each row shows red for blocking, amber for decide and cyan for read. *What it costs:* the right column says what deciding the row takes: `1 key`, `1 key · 2 options`, `2 answers`, `1 min read`, `Reply`, `Effort 3/10`. The focused row adds its keys (`A R ↵`, or `D ↵` for reads). |
| **Modal** | *What is asked:* the header title, under a kind and tier line. *What yes does:* the first block of every type says it, e.g. **If you approve**: "Approving resumes step 4 of the Growth pipeline, paused for 26h" (the item's alert promoted, or its kind's consequence). Backlog shows **If you accept**, and the reading room shows **Your call**. *The key:* every verdict button prints its key, and the footer carries the key legend. |

## Key map

| Where | Keys |
|---|---|
| Strip | click a chip, the Triage button or the "First" line (Tab + Enter works on all three) |
| Peek | ↑/↓ move · **A** accept (Ready: dispatch) · **R** arm reject, then ↵ confirms · **D** done (reports/chat) · ↵ open the desk · ←/→ switch to the neighbouring chip's peek · Esc / outside click close |
| Desk | ←/→ or J/K walk · ↑/↓ scroll · **A** accept · **R** arm reject → ↵ confirm → reason prompt (1-9 pick, 0 skip, type + ↵) · **S** skip · **D** done/read · **Space** focus the chat composer (↵ sends, ⇧↵ newline) · **1-9** branches · ⇧1-5 rate a report · Esc steps back |
| Council | **A** arms Approve, ↵ confirms · **R** → ↵ opens Send back, which needs a reason of 12+ characters (a counter shows progress) |

The Esc ladder runs armed verdict or reason prompt → desk → the peek it came from → strip. It lives in
one place: BaseModal's `onClose` is the desk's step-back. The desk's own key handler (priority
`OVERLAY_DISMISS_PRIORITY + 5`) only blurs a focused field. Letter keys never fire while you type
(guarded by `isTypingTarget`).

## Motion

- **Peek:** drops out of its chip (scaleY from the top edge, 150 ms), and the open chip joins the
  drawer visually. Rows stagger in at 30 ms.
- **Origin morph:** peek rows and desk-rail rows share `layoutId`s, so Enter docks the list into the
  desk instead of swapping one surface for another. Esc sends it back the same way.
- **Walking:** direction-aware. → enters from the right and leaves left, ← does the reverse
  (`AnimatePresence` `popLayout`, 250 ms, expo-out).
- **Verdict leave:** an accepted item rises away up-right, a rejected one sinks down-left with a 2°
  tilt, and a read item lifts off. A stamp names the verdict for 650 ms (APPROVE / REJECT / READ /
  SENT), the rail row folds out, and the green progress bar in the rail fills.
- **Posture morph:** in Triage all, walking from an approval into a report grows the same desk into the
  reading room (a `layout` animation on the panel). It is never a second modal.
- **Reduced motion** (OS or in-app): every transform becomes a 150 ms cross-fade, the `layoutId`s are
  dropped and the armed pulse is `motion-safe` only. I verified it by running the whole keyboard walk
  under `reducedMotion: 'reduce'`, with no errors.

## Screenshots

`<entry>-<W>x<H>-<theme>.png` covers 11 entries × 1280x800 and 1920x1080 × dark-midnight and light.

- The Lab's entries: `strip`, `peek-gates`, `peek-ready`, `modal-approval`, `modal-backlog`,
  `modal-report`, `modal-chat`.
- P3-only kits, read by the hub itself (the Lab falls back to `strip` for an entry it does not know):
  - `report-html`: the reading room on the HTML report (`report:rep2`). In the app, walk → from
    `modal:report`.
  - `council`: Approve / Send back.
  - `triage-all`: the desk walking the whole roster.
  - `strip-states`: the council source FAILED and Chat at ZERO, side by side with live chips.

Ages read "now" in every shot because the harness pins its clock to the tape's `recordedAt`
(2026-09-22), which is earlier than the fixtures' timestamps (2026-10-06).

## What I would change with one more day

1. **The 1280 strip has no words.** With the 440 px tally beside it, the strip gets about 490 px at a
   1280 window (the app shell's sidebar takes about 330 px), so chips compact to icon + count and the
   head line folds into the Triage button. I would try a single morphing label: the chip under the
   pointer or keyboard focus widens to show its label while the others stay compact.
2. **Peek → desk morph timing.** BaseModal's panel scale and 120 ms delay run underneath the
   `layoutId` flight. A `transformOrigin` taken from the peek's rect would make the whole desk grow out
   of the drawer instead of only its rows.
3. **Undo.** A 5 s "undo" on the stamp, through the same seam, before the verdict commits.
4. **The reading room's contents list** depends on markdown headings. An HTML report gets no outline
   until HtmlDocumentFrame exposes one.
5. **The desk's Esc ladder outside the app:** the page harness mounts no `AppKeyboardProvider`, so
   there handlers do not rank. In the app they do. The ladder was built to survive both (see Key map).
