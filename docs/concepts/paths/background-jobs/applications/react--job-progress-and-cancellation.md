---
layer: application
subject: background-jobs
technique: job-progress-and-cancellation
stack: react
---

# Job progress and cancellation on the client

Two hooks realize the job contract from the viewer's side, and between them
they cover every clause — including the one most implementations skip
(re-attachment).

## Identity: minted once, filtered everywhere

`useMediaExport`
(`src/features/plugins/artist/sub_media_studio/hooks/useMediaExport.ts`)
mints the job id at the requester (`crypto.randomUUID()`, `:59`) and hands it
to the backend with the start call (`:131`). Every event handler then filters
on it — `if (e.payload.job_id !== jobId) return;` at `:79`, `:97`, `:113` —
because the progress/status/complete channels carry all export jobs, and an
unfiltered listener would cross-wire a stale job's events into a fresh job's
UI. The hook also tears down the *previous* job's listeners before starting a
new one (`:50-57`), with a comment recording the defect that motivated it:
re-entrant starts left the prior listener set "unreferenced and forever fed
events for a job nobody is watching."

## Honest progress and ETA

- `normalizeProgress` (`:27-31`) pins the progress unit to a 0–1 fraction at
  the boundary, clamped defensively "in case the source ever drifts" —
  progress-unit normalization as a named, unit-tested function.
- The ETA is withheld until the sample is meaningful: `:83-87` computes a
  linear ETA only once `progress > 0.01`, with the comment stating the
  honesty rule — "an early tick gives 100× overestimates" — and clears it at
  completion (`etaMs: null`).

## Terminal states as discrete events, distinct from the stream

The backend emits three separate channels: `MEDIA_EXPORT_PROGRESS` (lossy,
throttled stream), `MEDIA_EXPORT_STATUS` (error terminal, `:93-108`), and
`MEDIA_EXPORT_COMPLETE` (success terminal, `:110-125`). The terminal handlers
unsubscribe the listener set — the stream just stops, the ending arrives on
its own event. `useRevitalizeJob` follows the same split
(`OBSIDIAN_REVITALIZE_OUTPUT` vs `OBSIDIAN_REVITALIZE_STATUS`), and fetches
the completion *summary* from the snapshot rather than trusting the event to
carry it (`:78-83`), keeping the reliable channel small.

**Deviation worth naming:** `useMediaExport.cancelExport` (`:144-153`) sets
`status: 'cancelled'` locally the moment the cancel IPC returns, and tears
down the listeners — collapsing the standard's two-step
*cancelling → cancelled* acknowledgment. If the backend job takes time to
unwind (or the cancel fails server-side), the UI reports a terminal state the
runner has not reached. The standard stands: flip to *cancelling* on request,
let the runner's terminal event confirm.

## Re-attachment: the snapshot API, used correctly

`useRevitalizeJob`
(`src/features/plugins/obsidian-brain/sub_revitalize/useRevitalizeJob.ts`)
is the compliant exemplar for the clause demos never exercise:

- **Attach = snapshot + subscribe.** On mount (`:38-63`) it resolves the
  active job (store first, then `obsidianRevitalizeActive()` — the job
  outlives any panel), pulls `obsidianRevitalizeSnapshot(id)`, and seeds
  lines, summary, and error state from it; only then does the event
  subscription layer deltas on top (`:66-89`). A panel opened mid-job paints
  the job's real state, not a blank.
- **Global liveness vs panel-local stream.** The doc comment (`:18-25`)
  draws the split: run/complete flags live in a store fed by a global
  listener "so sidebar dots survive navigation"; the hook owns only the
  panel-local stream. The observer is not the owner, in code.
- **Bounded log ring, both sides.** `MAX_VISIBLE_LINES = 200` client-side
  with the comment noting "the backend caps stored lines at 500 anyway"
  (`:15-16`); appends slice the tail (`:72`), so neither the snapshot nor
  the live stream can grow without bound.
- **Cancel targets the id** (`:103-107`), read fresh from the store at call
  time — not a captured stale closure value.
