---
layer: application
subject: file-browsing
technique: thumbnails-and-previews
stack: react
---

# Thumbnails and previews — the Artist gallery

The Artist plugin's gallery (`src/features/plugins/artist/sub_gallery/`)
implements the escalation ladder across three files: tile thumbnails in
`AssetCard.tsx`, the surface's loading choreography in `GalleryPage.tsx`,
and a heavyweight 3D viewer in `ThreeViewer.tsx`.

## Tiles: lazy decode, kind-icon floor

`AssetCard.tsx` renders the thumbnail area (lines 176–194) as a three-way
branch that is the ladder in miniature:

- an image asset with a loaded `dataUrl` renders
  `<img loading="lazy" decoding="async" width={400} height={400}>` — the
  browser defers offscreen decode work, and the fixed intrinsic size keeps
  the grid geometry still when pixels arrive;
- an image still loading shows a small in-tile placeholder;
- a non-image asset renders the kind-icon floor: a box glyph plus the
  extension token, uppercase mono — rung 1 of the ladder, always available.

## The surface never yields to its own refresh

`GalleryPage.tsx` gates its ghost grid on
`const showGhost = loading && filteredAssets.length === 0` (line 56), with
the comment naming the law: assets already on screen "are never hidden by a
background reload". `GalleryGhostGrid` (lines 293–318) mirrors the real
tile geometry (aspect-square + two label bars) inside the same grid
template, staggers entrance with `animation-delay` starting at 120ms with
`fill-mode: both` so a fast fetch never paints a single ghost, and is
`aria-hidden`. Error-with-nothing-to-show is a distinct branch (lines
196–211) with a retry button — error ≠ empty, per the parent subject's
state model.

## The heavy viewer is a guest with its own boundary

`ThreeViewer.tsx` is rung 4 — a 3D model renderer — and it demonstrates
per-viewer isolation:

- **Its own error boundary.** `ViewerErrorBoundary` (lines 104–116) catches
  the loader's render-time throw and swaps in `ErrorFallback` — an
  in-place "could not load model" panel with the raw message. The comment
  states the blast-radius rule: the boundary exists "to keep the whole
  Gallery3D modal from tearing". The file stays selectable, renamable,
  deletable in the gallery behind it.
- **Lazy, suspense-driven load** with an out-of-canvas probe:
  `InvisibleProbe` (lines 186–189) participates in an outer Suspense so
  the loading affordance renders outside the GL canvas, while the scene
  itself suspends inside.
- **Cached derivations handled consciously.** The loader caches models
  across mounts, so the component clones the scene per viewer (line 61,
  "so multiple viewers don't share mutable material state") and re-applies
  the wireframe flag against cached clones (`useWireframe`, lines 33–46) —
  a cache-aware discipline the technique demands of every derived
  rendering. `CameraResetOnChange` (lines 172–179) resets orbit distance
  when the model changes, so state from a previous file never leaks into
  the next preview.

## Gap worth naming

Thumbnail *failure* is not cached: a corrupt image that fails decode is not
remembered as failed, so the fallback treatment relies on the browser's own
retry behavior rather than the technique's cache-the-failure rule. The
kind-icon floor still holds the tile; the missing piece is only the
negative cache.
