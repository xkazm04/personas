---
slug: the-gate-ate-the-bootstrap
type: perfect/direction
context: "[[fleet-session-grid]]"
lens: robustness
status: shipped
size: S
proposed: 2026-08-07
accepted: 2026-08-07
shipped: 2026-08-07
commit: 61eda2fd0, 5dc126447
---
## What & why

A component was created to fix a startup regression. Someone later wrapped its mount in a DEV
gate — correctly, for its *visual* half. The gate also removed its *bootstrap* half, silently
reintroducing the exact regression the component exists to prevent, in shipped builds only.

Found while scouting `studio`. It is the more valuable half of that scout.

## Evidence

`src/App.tsx:375`:
```tsx
{import.meta.env.DEV && <FleetGridLayer />}
```

`src/features/plugins/fleet/FleetGridLayer.tsx` does two unrelated things:
- `:53` — `if (!gridOpen) return null;` — the visual overlay. **Genuinely dev tooling.** Gating
  this is right.
- `:37-43` — an app-wide **bootstrap side effect**: `startSessionListeners()` + `refresh()`.

The component's own comment (`:32-36`) states why the bootstrap is there:

> *"Before this, the session list only became live when someone opened the Fleet page — which
> left the footer status cluster blank until then. It also lands the persisted auto-hibernate /
> live-slot / cutoff policy on the Rust ticker at startup instead of on first Fleet visit."*

**Fleet is not dev-only.** `registry.ts:85` gates it `minTier: TIERS.TEAM` — a paid tier, not a
build flag. And the surface the bootstrap feeds, `FleetActivityStrip`, **ships** (`App.tsx:329`).

**Verified DCE:** in the committed production bundle
(`dist/assets/index-dcaNX32X.js`) the lazy defs for `StudioAttention` and `FleetGridLayer`
appear *without* a `var … =` binding, while every neighbouring overlay has one. The identifiers
are referenced nowhere, so the render branches — and the bootstrap inside them — are eliminated.

**Consequence in a shipped build (inferred from the above, high confidence, not runtime-verified):**
the fleet footer status cluster stays blank, and the persisted auto-hibernate / live-slot /
cutoff policy is not pushed to the Rust ticker, until the user first navigates to Fleet.

## The distinction that matters

Studio's DEV gate is **redundant** — `registry.ts:88` already makes the whole section
`devOnly: true`, so nothing there is reachable regardless.

Fleet's DEV gate is **load-bearing in the wrong direction** — it gates a dev overlay and an app
lifecycle hook with one flag, and only one of the two should be gated.

## Acceptance criteria

- [ ] The bootstrap (`startSessionListeners`, `refresh`, the policy push) runs in production.
- [ ] The visual grid overlay stays dev-only.
- [ ] Separated so a future reader cannot re-fuse them — the two concerns should not share a
      mount, and the reason should be stated where the gate is.
- [ ] A test pinning that the bootstrap is not conditional on `import.meta.env.DEV`.
- [ ] Check the same shape elsewhere: any other `import.meta.env.DEV &&` mount in `App.tsx`
      whose component has a side effect beyond rendering. Report what you find even if clean.

## Risks / non-goals

Do not un-gate the grid overlay itself — it is dev tooling and `gridOpen` already guards it.

Do not touch `StudioAttention`'s gate. It is redundant today, and un-gating it would be
meaningless while `registry.ts:88` stands. **Record the coupling instead:** if Studio is ever
un-gated, there is provably no second notification path for a waiting Studio decision — no OS
notification, no notification centre, no tray badge, no title-bar dock entry. The pill is the
only signal, and its absence would become a real gap the moment the section ships.

## Build record

**Shipped** `61eda2fd0` (fleet bootstrap) · `5dc126447` (triggers dead state).
Director verdict: **merge**. The DCE claim was confirmed exactly; **my claim about which
surface suffered was wrong twice**, and the direction survived on better evidence the builder
found.

### What I got wrong

- **`FleetActivityStrip` does not consume the bootstrap.** It reads
  `useOverviewStore.activeProcesses`, fed by execution events with its own initialisation.
- **The "footer status cluster" in `FleetGridLayer`'s own comment is `FleetFooterIcon`**, which
  is *itself* DEV-gated (`DesktopFooter.tsx:538`). The specific regression the comment
  describes is dev-only and could not recur in production.

So the component's own justification comment pointed at a consequence that no longer applies.

### The real shipping consumers

1. **`PluginsSidebarNav.tsx:76-77`** derives `fleetWaitingCount` from `fleetSessions` and
   renders the awaiting-input pulse badge on the Dev Tools row (`:157`) and the Fleet sub-tab
   (`:207`). Neither declares `devOnly` — it ships at TEAM tier. **The badge never lit.**
2. **`ingestOutboxForCwd`** (`fleetSlice.ts:280`) — the memory-outbox → ledger sweep, delta
   context scan, Obsidian vault projection and auto deep-scan dispatch. Reachable **only** from
   the session-exited listener.
3. `removed` registry events never pruned a stale session row.

### The subtlety that made it survive a near-miss

`useFleetCompanionBridge` is mounted unconditionally (`PersonasPage.tsx:89`) and calls
`fleetRefresh()` on mount, so **the Rust policy push already happened in production** — one
third of the acceptance criteria was already satisfied, and a less careful builder could have
concluded the whole direction was moot.

It is not a substitute: on a `FLEET_SESSION_STATE` it can resolve, the bridge records an Athena
episode and returns **without refreshing** (`:73-93`), and Rust emits `FLEET_SESSION_STATE`
alone with no paired `FLEET_REGISTRY_CHANGED` (`pty.rs:854-878`). So `fleetSessions[].state`
went stale.

### The testing insight — worth more than the fix

**A runtime assertion cannot catch this class of defect.** Vitest runs with
`import.meta.env.DEV === true`, so a DEV-gated branch resolves *the safe way* in exactly the
configuration that ships broken. The gate is instead pinned by reading `App.tsx` source
(precedent: `src/__tests__/structural/*`): one mount, not on an `import.meta.env.DEV` line, plus
the inverse assertion that `FleetGridLayer` stays gated and no longer calls the startup actions.

### Job 2 — removed, not surfaced

The health signal **already ships at higher fidelity one level down**: `TriggerList.tsx:46`
fetches the identical `getTriggerHealthMap()` and renders a per-trigger `HealthDot` (`:181`).
`TriggersPage`'s copy was a duplicate IPC call reduced to one word and discarded. Rendering it
would have meant a second, coarser indicator plus 14 locale strings for something already
visible. Deleted; a comment records why the health call is absent so it is not re-added.

### DEV-mount sweep of `App.tsx` — Fleet was the only fused case

`DevInspector` (real dev tooling, depends on a dev-only Babel plugin) · `StudioAttention` (pure
render, zero effects — gate is safe and redundant) · mobile-preview badge (plain div) ·
`DevMobilePreviewShortcut` (mounted unconditionally with the DEV check *inside the handler* —
the right shape).
