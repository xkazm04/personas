---
layer: application
subject: embedded-preview
technique: injected-instrumentation-with-fallback
stack: rust
---

# `preview_agent.rs` — the dev-gated agent and its coarse fallback

`src-tauri/src/webbuild/preview_agent.rs` is the technique's canonical
manifestation in this repo: a small React component (`AGENT_TSX`,
`:13-108`) written verbatim into the generated Next.js project and
mounted in its root layout, on every dev-server start
(`commands/infrastructure/webbuild.rs:87-89`).

## Injection: source-level, gated, idempotent, best-effort

- **Source-level.** `ensure()` (`:112-140`) writes
  `app/_athena-preview-agent.tsx` (private-folder prefix, so route
  discovery skips it — see `routes.rs:34`) and patches `layout.tsx` to
  import it and render it inside `<body>` (`patch_layout`, `:144-166`).
  This is the technique's preferred injection point, chosen for exactly
  the stated reason (module comment `:1-7`: cross-origin frame, host
  cannot read element positions).
- **Gated twice.** The mount is wrapped
  `{process.env.NODE_ENV === "development" && <AthenaPreviewAgent />}`
  (`:146-147`) and the component's effect early-returns on the same check
  (`:23`) — the build-system gate the technique requires, so production
  bundles tree-shake it out (`:11-12`).
- **Idempotent with refresh.** The file is rewritten when absent *or
  stale* (`existing != AGENT_TSX`, `:123-129`), so agent upgrades reach
  existing projects on the next start; the layout patch is skipped when
  `AthenaPreviewAgent` already appears (`:133-135`). This is the
  "regeneration is idempotent, re-adds if a mutation dropped it" rule.
- **Best-effort by contract.** `ensure()` "never errors out the dev-server
  start" (`:111`): unknown layout shape → `patch_layout` returns `None`
  and the file is left alone (`:143`, `:158`); write failures are
  discarded (`:128`, `:137`). The technique wants this *and* wants the
  degradation announced — see deviations.

## Charter: small, data-only

Two verbs, both returning data: `locate` (selector → bounding rect +
transient highlight ring, `:49-75`) and unsolicited `route` reports via
a History-API hook (`:79-95`). No evaluation verb, no handles, no state
dump. The technique's "an evaluate-anything verb is the root exploit
waiting for its user" is honored by omission.

`querySelector` on a host-supplied selector is wrapped in `try/catch`
(`:55-59`) — a malformed selector answers `found:false` rather than
throwing inside the guest.

## Residue is reaped

The effect cleanup (`:98-104`) removes the message listener, removes the
`popstate` listener, restores the original `pushState`/`replaceState`,
and clears the ring. The ring itself is auto-cleared after 2.6 s
(`:47`). Creation-names-reaper holds on the guest side.

## The fallback ladder, as shipped

| capability | with agent | without agent — what Studio actually does |
|---|---|---|
| element targeting | `locate` → precise ring at the element (`StudioPage.tsx:301-318`) | coarse top/middle/bottom region pointer from the model's `decisionArea` (`:319-336`) — **a real rung**, designed in |
| "where am I" | `route` events → live address bar (`:129-137`, `:205`) | falls back to the last path the host pushed (`previewRoutes`, `:205`) |
| navigation | (agent has no navigate verb) | always the coarse rung: set frame `src` = full load (`:206-211`, `:236`) |
| readiness | (no ready verb) | registry health probe + poll (`studioStore.ts:278-300`) |

The coarse rungs exist and the preview is fully usable on them — the
technique's central demand ("the agent upgrades the experience; its
absence must never blank the frame") is met.

## Deviations (reported, standard kept)

- **Presence is retried, not probed.** There is no ready announcement
  the host consumes and no ping; the host fires `locate` 8 times at
  700 ms and stops (`StudioPage.tsx:148-162`). Silence and "not found"
  converge on the same null (`:128`) — the technique's
  failure-not-empty-success rule on the guest-detection side.
- **Degradation is silent.** When `patch_layout` finds no anchors, or
  the write fails, nothing is logged or surfaced; when the agent never
  answers, the surface shows the coarse pointer with no "instrumentation
  unavailable" cue. A user (or the model steering the build) cannot tell
  a coarse-mode preview from a precise-mode preview whose element was
  simply missing.
- **The layout patch is anchor-fragile by design** — it needs
  `"./globals.css";` or a leading `export`, and a `<body` tag
  (`:151-164`). Fine for the scaffold this tool emits; a
  register-existing project (`webbuild.rs:40-68`) with a different
  layout shape silently gets no agent. Detection of *that* case is the
  same missing announcement as above.
- **The agent's `route` on mount (`:95`) is a de-facto ready signal the
  host does not use** — cheapest possible fix for the first deviation.
