---
layer: application
subject: embedded-preview
technique: convention-discovery
stack: rust
---

# `routes.rs` — app-router pages discovered by scanning `app/`

`src-tauri/src/webbuild/routes.rs` (89 lines) derives the previewed
project's route list from the Next.js app-router convention, for the
Studio address bar's autocomplete list.

## The scanner, against the technique's rules

- **Scoped by convention root:** walks `app/` or `src/app/` only
  (`:12-18`), whichever exists — the two app-router layouts the scaffold
  can emit; nothing outside the routing tree is read.
- **Minimal grammar:** a directory containing `page.{tsx,ts,jsx,js}` is
  a route (`:39`); its path is the directory chain from the root
  (`:48-64`); route groups `(x)` are stripped (`:53-56`); private
  `_folders` and `node_modules` are skipped (`:33-36`). No layouts,
  templates, loading/error files, or route handlers — the "route picker
  needs paths, not the router's semantics" subset. Tested end-to-end
  against a synthetic tree (`:71-88`).
- **Dynamic segments are kept, and the surface decides:** `[param]`
  directories are returned as-is (`/shop/[slug]`, `:86`), and the host
  filters them out of autocomplete (`StudioPage.tsx:199`,
  `!r.includes('[')`) rather than offering dead literal links. That is
  one of the technique's allowed choices (de-emphasize) — made
  explicitly, though at the cost that parameterized detail pages are
  invisible in the picker.
- **Detection, not configuration:** the two roots are probed by
  existence; a project matching neither returns an empty `Vec`
  (`:19-21`).

## When it rescans

The host re-runs `webbuild_list_routes` when the active tab becomes
`live` and after every reload nonce bump (`StudioPage.tsx:101-112`,
deps `[activeId, active?.phase, activeNonce]`); a version restore
triggers `reloadActive` (`:297`), so restore → rescan holds via the
nonce. Turn completion is **not** a trigger on its own — see deviations.

## Deviations (reported, standard kept)

- **No rescan on turn completion.** A build turn that adds a page
  updates the tree, and the dev server hot-reloads it, but the route
  list is only re-derived on the next reload nonce or tab re-activation.
  The mutating actor (`run_build_turn`) knows exactly when the tree
  changed; the store's turn-complete path is where the technique says
  the rescan belongs.
- **Empty is spelled like unreadable.** A project with no `app/`
  directory and a project whose `app/` is unreadable both return `[]`
  (`:14-18`, `:25-28` swallow `read_dir` errors), and the host renders
  either as "no autocomplete" with no cue. Two states one signal — the
  scanner-that-cannot-read-must-not-report-empty rule.
- **Single-convention support.** Only the app router; a `pages/`
  project registered via `webbuild_register_existing` gets an empty list
  and no "no routes discovered — navigate by URL" message. The address
  bar still works (full-load navigation), so the fallback is real; only
  the announcement is missing.
