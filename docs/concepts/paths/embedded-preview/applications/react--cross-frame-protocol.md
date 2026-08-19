---
layer: application
subject: embedded-preview
technique: cross-frame-protocol
stack: react
---

# The Studio ↔ preview-agent bridge — half a protocol, measured

The Athena Studio preview hosts a generated Next.js project in a
cross-origin `<iframe>` (the dev server on its own port) and talks to it
over `postMessage`. Both ends are in this repo: the guest half is the
agent component baked into the project by
`src-tauri/src/webbuild/preview_agent.rs` (`AGENT_TSX`, `:13-108`); the
host half is `src/features/studio/StudioPage.tsx` (`:114-162`).

## What the technique prescribes and what exists

| technique element | host side (`StudioPage.tsx`) | guest side (`AGENT_TSX`) |
|---|---|---|
| protocol marker | `source: 'athena'` on sends, `source === 'athena-agent'` filter on receive (`:126`, `:156`) | mirror: filters `d.source !== "athena"` (`:53`), replies `source: "athena-agent"` (`:62`) |
| kind vocabulary | string literals `'locate'` / `'located'` / `'route'`, typed inline as `type?: string` (`:117-125`) | same literals, typed inline (`:50-52`) — **two hand-typed copies, no shared definition** |
| correlation id | sends `reqId: \`${activeId}\`` (`:156`) — the *project id*, not a per-request id | echoes `reqId` back (`:62`) |
| pending table | **none** — the `located` handler sets `pointerRect` from any reply, and never reads `reqId` (`:127-128`) | n/a |
| timeout | **none** — a retry loop instead: 8 sends at 700 ms, then stop (`:153-160`); silence after 8 tries is indistinguishable from "element not found" (both leave `pointerRect === null`) | n/a |
| handshake / ready | **none** — the retry loop *is* the readiness strategy ("the agent's message listener might not be ready on the first ping", `:145-147`) | agent posts `route` on mount (`:95`), which the host could read as a ready signal but does not |
| unsolicited events | `route` events attributed to their tab by matching `e.source` against every mounted `iframe[data-tab].contentWindow` (`:131-137`) | `route` on History-API hook + `popstate` (`:79-95`) |
| drain on frame lifecycle | pending state is only `pointerRect`; reset when the decision clears (`:149`) | agent's effect cleanup restores `pushState`/`replaceState` and removes the ring (`:98-104`) |

## What holds

- **The envelope has a marker and a per-message shape**, and both sides
  ignore anything not wearing the marker — the routing half of the
  technique is present.
- **`e.source` matching for unsolicited events** (`:133-136`) is the
  correct way to attribute an event to one of several warm frames — this
  is real identity discipline, applied where the surface has more than
  one guest mounted at once (warm tabs, `:227-244`).
- **Agent cleanup is total** (`:98-104`): listeners removed, monkey-patched
  History methods restored, overlay ring cleared — the guest side of
  creation-names-reaper is honored.

## Deviations (reported, standard kept)

- **`reqId` is not a request id.** It carries the *project id*
  (`:156`), so every `locate` for one project shares one id and the
  reply handler cannot tell a fresh reply from a stale one — and it does
  not try (`:127-128` never reads `reqId`). Today this is benign because
  only one selector is in flight per decision; the day two decisions
  overlap or a slow reply lands after the selector changed, the orb rings
  the wrong element. The technique's misattribution/staleness seam,
  exactly.
- **Silence is spelled like "not found".** The 8×700 ms retry loop is a
  timeout without a verdict: after it stops, nothing declares "agent
  absent"; the surface simply falls back to the coarse region pointer
  (`:319-336`) with no indication whether the element was missing or the
  agent was. That fallback is the *right* behavior (see the
  instrumentation application) — but it should be reached through a
  declared timeout outcome, not through the absence of a reply.
- **Two hand-typed vocabularies.** `source`/`type` literals and payload
  shapes are typed independently on each side (`StudioPage.tsx:117-125`
  vs `AGENT_TSX:50-52`). The guest half is a string constant embedded in
  a Rust file, so sharing a definition is genuinely awkward here — but
  the awkwardness is why a rename will land on one side only.
- **`locate` sends target `'iframe[title="preview"]'`** (`:154`) — the
  *active* tab's frame by title, while `route` events are attributed by
  `data-tab`. Two addressing schemes for one set of frames; the second is
  the robust one.

The bridge works as shipped because its load is one verb, one guest at a
time, one host. Each of the four deviations is a rung the technique
climbs *before* that load grows.
