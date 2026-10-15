# Process

**Process is the strategic layer over the fleet's development sessions.** One surface, one job:
which phases of the work the sessions reach, and where they fail. It lives under Companions >
Curator > Process.

Its first form was the winner of the `process-strategic` design contest (2026-09-23, "The
Spine"): the standard path read top to bottom, one station per phase. The `process-landing`
contest (2026-10-14) replaced it with two figures the owner kept side by side, switched in the
header: **Dial** and **Watershed**. The Spine view was removed; its engine (`engine/spine.ts`)
still derives the path both figures draw. Findings and human decisions are a separate surface
still to come.

## What it reads

The registry owns the extraction: `scripts/process-sessions.mjs` in the ai-registry checkout
summarises every fleet checkout's Claude Code transcripts into structure-only process instances
(`process-sessions/1`). **No prompt text, command text, file path or tool output is kept** - a
shell call becomes the word `verify` or `commit`, a prompt becomes a length class. A gitignored
device cache keeps every session ever summarised, so the history outlives the transcript store's
30-day roll-off, and a warm run only stats files.

Personas runs it through Curator's instrument door (`curator_process_read`,
`src-tauri/src/commands/curator/process.rs`), with a 60-day horizon and a one-minute cache, and
the page derives everything else.

## What it shows

- **Mode.** Interactive sessions (a person steering) and headless sessions (launched by a tool)
  are different processes and are never pooled; a segmented switch picks one.
- **Repository.** A searchable dropdown filters to one repository. The repository is measured on
  its mode's path, so stations stay comparable, and every coverage bar carries a tick at the
  all-repositories share.
- **The path.** The standard path is derived, never declared: the most-travelled chain of phases
  (Brief, Explore, Edit, Verify, Ship), braided only where the data genuinely forks. Each station
  shows coverage (`n of N`, how many skipped it) and failures: sessions that **ended there with
  errors or interrupted**, and sessions that **hit a tool error or interrupt there**. The three
  worst stations are ranked. A median and p75 wait use active time (any gap over ten minutes
  counts as ten minutes).
- **How the sessions ended.** Committed, interrupted, no commit with errors, no commit and clean.
  A clean ending without a commit is not a failure: much headless work is read-only.

## The two views

- **Dial** (`views/dial/`, the default). One tick ring per phase, outermost first; every tick is
  1/120 of the sessions. The lit arc is who reached the phase, cut into went on, ended clean and
  ended failing; a bezel wraps every repository around it, and clicking one filters the page.
  A ring opens into a ruler with its step kinds and failing repositories, and below it the
  sessions, each with its step strip and a detail sheet. Drawn on two canvases.
- **Watershed** (`views/watershed/`). The path as a river from spring to sea: its width is the
  sessions still flowing; at each settlement the ones that stopped leave it, failing into a red
  marsh or clean into a lake, and the ones that walked the whole path reach a delta with one
  mouth per outcome. A settlement opens a survey sheet; a session opens its voyage log. The map
  is one SVG built per mode and repository; the moving specks are a canvas loop that rests when
  idle.

Both views load lazily, render nothing per session as a React element, and honour reduced
motion.

## Honesty rules

- A share of nobody renders as a dash, never `0%`.
- An error is filed on the phase it happened in, not on the last station the session reached.

## Not yet

- **Findings and human decisions.** The analytical skill designed beside this page (working name
  `pathfinder`) will emit findings with evidence and a question for a person; where they land is
  a separate surface, deliberately not a rail on this one.
- **Headless paths are short.** Most headless sessions are read-only, so their derived path is
  often Brief then Explore only.

## Files

- `src/features/companions/curator/process/` - the page, the engine (`engine/spine.ts`, shared
  verbatim with the KP journey cohort layer) and the dev adapter (`engine/devAdapter.ts`).
- `src/features/companions/curator/process/__shots__/` - the screenshot harness; it takes a
  reading URL so real sessions never enter the tree.
- `src/api/companions/curator.ts` - `readCuratorProcess()`.
