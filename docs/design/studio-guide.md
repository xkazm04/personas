# Studio Guide: migrating the prototype into Personas

Status: phase 1 in progress (2026-09-23). Owner decision: the **Guide** prototype won the Studio
next-gen round ("I see the vision in 'Guide'"). It ships behind a **Current / Guide** layout switch
inside Studio until it reaches parity and polish; then the current layout is descoped.

Source of the design: `.contest/prototype/studio-nextgen/v1/` (gitignored, static HTML) and its
`NOTES.md`; the fused brief with the owner's review is `.contest/prototype/studio-nextgen/BRIEF.md`.
The contest that produced it: `.contest/arena/studio-nextgen/`.

## What Guide is

Athena does not wait for prompts. She proposes the next moves as cards with honest time estimates,
runs the one you accept, and her orb follows the work into the app. The owner's fused skeleton:

- **Layout (from contest A/1):** thin top bar with project tabs, a left timeline of goals that the
  user can extend, the app being built in a full-focus main frame.
- **Idea to plan (from A/3):** until the plan is approved the main frame is a blueprint sheet: the
  plan drawn region by region with Athena's notes pinned to it, then handed over to the live app.
  In plain words: no file paths, commands or commit ids outside the log.
- **The question card (from A/3):** large, explains every option, points at its element.
- **Palette (from B/1):** Personas teal, subtle gradients, gradient hairline borders.
- **The dock:** today's Personas Studio dock, unchanged (`StudioChatInput`).

## Phase 1: the Guide layout on real data (frontend only)

Everything here runs on the real build protocol (BUILD_PLAN, NEEDS_INPUT, git snapshots) with no
Rust change.

| Piece | How it is real |
|---|---|
| Layout switch | `StudioPage` renders Current or Guide; choice kept per machine. Carries a dated `TODO(prototype)`. |
| Shared preview | The warm iframes, route sync and orb pointer move out of `StudioPage` into one hook + component both layouts use. |
| Goals timeline | `rt.phases` as goals (title, note, status); time spent per goal measured from turns. **Add a goal** sends a turn asking Athena to slot it into BUILD_PLAN. |
| Blueprint stage | Shown from scaffold until the first plan is approved (or the first build turn lands): grid sheet, one region per phase drawn in order, notes pinned (phase notes + her reply beats), plain "now" line. Hands over to the live preview. |
| Activity "now" line | The CLI stream already carries tool calls; the store starts keeping them as plain-language activity (searching, reading, building a part, checking for mistakes, checking in a browser) with the raw detail for the log. |
| Question card | Large card from `question` / `options` / `selector`, keys 1 to 4, reason line from her last beat, target ring via the existing preview agent. |
| Recommendation deck | After a finished turn with no question: 2 to 3 cards derived from the plan and her tools (build the next goal, refine the current one, check on devices, research). Estimates from this project's measured turn lengths. Accept = a real turn. Decline = hidden until the plan changes. |
| Tool arc | The orb opens her tools; each is a real turn with a purpose-built prompt: Research, Try three looks (the doctrine's direction step), Check on phone/tablet/desktop (enables the Browser connector for that turn), Walk me through it (a narrated reply), Connect real data (a turn that asks what data and where). Tweak this element is shown as coming in phase 2. |
| Queued notes | While a turn runs, a typed note is queued and prepended to the next turn instead of being refused. |

## Phase 1.5: no dead waiting (shipped 2026-09-24)

A new project was three waits in a row (scaffold up to 10 min with no progress, dev-server boot,
then a ~15 min seed turn whose plan and one question arrived on its last line) and nothing
overlapped. Athena's own answer to dead time is side lanes on cheaper tiers, a queue that sends
itself, and questions gathered while work continues; Studio now uses the same pieces.

| Piece | What it does |
|---|---|
| Sketch lane (`webbuild_sketch`, `webbuild::sketch`) | On submit, a stateless MICRO-tier call (`athena_reaction::cli_text_tracked`, trigger `studio_sketch`) returns pages + regions with purposes, draft goals and up to 3 owner-only questions in seconds, **in parallel with the scaffold**. No project, directory or server needed. |
| Draft stage | `studioStore.draft` exists from submit until the scaffold returns, so the screen moves on at once: the plan sheet draws the sketch's pages region by region (GuideSketchSheet), the rail shows draft goals, and the setup timeline shows what is really running. |
| Questions during setup | Sketch questions are answered on the card while setup runs (inline answer, counter). Answers before the seed ride in the seed; answers after it arrive as notes. |
| Early seed | The seed turn starts right after the scaffold, **overlapping the dev-server boot** (planning and research need the folder, not the preview). It carries the sketch, the answers, and the open questions marked "do not ask again, assume a default" (`studioSeed.buildSeed`). |
| Queue pump | Notes that waited out a turn are sent as the next turn automatically (one per finished turn), as Athena's chat queue does. |
| Mid-turn intent | A dock message during a turn is queued; a clear redirect (`classifyMidTurnIntent`) also stops the running step. The dock is open from project creation, not only once the preview is live. |

Next in this line (not built): **read-only side lanes during a build turn** (research, device
checks, walk-throughs on a `webbuild:<id>:side` key with no git snapshot, a separate Stop path and
stream routing), and **batched decisions** (collect every NEEDS_INPUT, a decision queue with
Later/Skip, the model deciding defaults and continuing).

## Phase 2: protocol and preview-agent work (Rust + frontend)

- **Element picking** in the preview agent (`preview_agent.rs`: hover outline + click reports a
  selector) -> the **tweak lens**: per-element knobs sent as scoped turns.
- **TOUR marker** (`build_turn.rs` prompt + `plan.rs` parse): `[{selector, caption}]` -> the
  guided **walk-through** overlay with the orb travelling stop to stop.
- **RECOMMEND marker**: Athena's own next-move cards with a reason, replacing the derived deck.
- **Richer plan notes**: BUILD_PLAN phases gain an optional `detail` (what the region will hold) and
  a `region` hint, so the blueprint draws the real solution notes, not only 40-character notes.
- **Restore as a new snapshot** with a preview before restoring (nothing newer is lost).
- **Reference image with typed words**; **settings kept per project**.
- **Device trio**: the Browser connector's screenshots at 360 / 768 / 1280 shown as three frames.
- **Read aloud** through the companion TTS engines.

## Phase 3: concept features from the prototype

Connect real data with a file watch, try it on your phone (serve over the local network + QR),
research findings as a card that becomes a goal, try three looks as three live branches, time per
goal on the timeline, cold restart on a free port from a plain-words error card.

## Descoping the current layout

When Guide covers every journey the current layout covers (vision, import, resume, versions,
settings, autonomous, stop, multi-project) and the owner has lived with it: delete the switch, the
current layout's orphaned components (`StudioPlanDrawer`, `StudioChecklistStepper`, `PlanGlyph`,
`StudioQuickActions` if unused), their i18n keys and tests, in one change.
