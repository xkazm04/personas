---
subject: embedded-preview
evidence:
  - src-tauri/src/webbuild/devserver.rs               # canonical registry: one server per project, pid+port recorded at spawn, real HTTP readiness probe (not TCP), taskkill /T tree teardown, stop_all wired to RunEvent::Exit, stale next-lock recovery guarded by pid_is_node
  - src-tauri/src/webbuild/preview_agent.rs           # dev-gated agent injected at source level into the generated project (NODE_ENV gate on mount AND in effect), idempotent+refresh-on-stale write, two data-only verbs, total cleanup; layout patch is best-effort by contract
  - src-tauri/src/webbuild/routes.rs                  # convention discovery: scans app/ | src/app/ for page.* files, strips (groups), skips _private, keeps [dynamic] for the surface to decide
  - src-tauri/src/webbuild/versions.rs                # per-turn git snapshot minted from the turn's reply, forward non-destructive restore (mechanics owned by undo-history; cited here for turn alignment)
  - src/features/studio/StudioPage.tsx                # host half of the bridge: single message listener, e.source-matched attribution of route events across warm frames, coarse region-pointer fallback designed in beside the precise ring
counter_evidence:
  - src/features/studio/StudioPage.tsx                # the same file, on origin: never reads e.origin, every postMessage targets '*'; reqId carries the project id not a request id and is never read on reply; presence is 8x700ms retry not a probe, so silence and not-found converge on the same null
deviations:
  - w12-embedded-preview   # anchor in docs/concepts/golden-path-deferred-fixes.md                                        # reported in the composer report, not yet registered — see FINAL REPORT (no deferred-fixes edits by brief)
---

# Embedded Preview - evidence

How this codebase measures against the [`embedded-preview`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
