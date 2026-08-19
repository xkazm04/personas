---
layer: technique
subject: file-browsing
technique: thumbnails-and-previews
status: forged
laws: [derivation-names-recomputation, creation-names-reaper]
shared_with: []
---

# Thumbnails and previews

A preview shows the user what a file *is* without opening it — the single
biggest usability multiplier a browser has, and its single biggest stability
risk. Every preview is a renderer executing against content the application
did not write: possibly corrupt, possibly hostile, possibly gigabytes. The
technique is one rule with consequences: **a preview is a guest — it may
fail, it may be evicted, and it may never take the house down.**

## The escalation ladder

Preview cost is a ladder, and each rung is opt-in later than the one below:

1. **Kind icon** — free, always available, the floor every item stands on.
2. **Thumbnail** — a small derived image, generated lazily, cached.
3. **Inline preview** — a richer rendering in a panel or hover context.
4. **Full viewer** — a modal or dedicated surface with a heavyweight
   renderer: video playback, dimensional model orbit, document paging.

An item renders the highest rung it has *ready*, never blocks on a higher
rung, and downgrades gracefully — a failed thumbnail leaves a kind icon, not
a hole. The ladder also orders the engineering: a browser that ships rung 4
before rung 2 is a demo, not a tool.

## Thumbnails are derived data

A thumbnail is a cached derivation of file content, and it inherits every
obligation cached derivations carry:

- **Generate lazily, near the viewport.** Only visible and near-visible
  items deserve decode work; a thousand-item folder must not trigger a
  thousand decodes on entry. Generation is concurrency-capped and
  cancellable on scroll-away — work for tiles the user has already left is
  work stolen from tiles they are looking at.
- **The cache key names the recomputation.** Key thumbnails by identity
  *plus content version* (modification time, size, or content hash). Keyed
  by name alone, the cache serves yesterday's pixels for today's file —
  the stale-thumbnail bug users describe as "the browser shows the wrong
  photo", which is precisely a stored derivation that lost track of how it
  is recomputed. When the version changes, the old entry is invalid by
  construction; no manual "clear cache" folklore required.
- **The cache names its reaper.** Disk- or memory-resident thumbnail caches
  grow monotonically under a browser that only adds. Set a budget and an
  eviction order at creation time; a cache without a reaper is a slow leak
  wearing a performance-optimization costume.
- **Failure is cached too**, with a shorter life. A corrupt file that fails
  decode must not be retried on every scroll pass — remember the failure,
  render the fallback, retry only when the content version changes.

## Isolation: the boundary around every renderer

Decoders and viewers fail in proportion to the wildness of their input, and
browser input is maximally wild. Boundaries, from inside out:

- **Per-tile**: a thumbnail that fails to decode costs one tile — fallback
  icon, optional "preview unavailable" affordance. Never an error banner
  across the surface, never an exception that unwinds the list.
- **Per-viewer**: heavyweight renderers (video, dimensional models, large
  documents) live behind their own failure boundary and their own lazy
  load. Their code loads when first needed, not at browser start; their
  crash renders an in-place "could not preview this file" with the file
  still selectable, renamable, deletable. The user's recourse to a broken
  preview is to *act on the file* — the mutation surface must survive the
  preview's death.
- **Resource discipline**: one heavyweight viewer active at a time as the
  default; a grid of simultaneously playing videos or spinning models is a
  resource exhaustion with good production values. Offscreen viewers pause
  or tear down — and name what tears them down.

## Previews and staleness

The preview panel shows content read at open time; the file can change or
vanish while it is showing. On the browser's own refresh cycle, a preview of
a vanished file closes with a reason rather than freezing its last frame;
a changed content version invalidates the open preview the same way it
invalidates the thumbnail. The preview is a cache too — it just has a
shorter name.
