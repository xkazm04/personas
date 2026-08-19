---
layer: application
subject: triage-queues
technique: source-normalization
stack: react
---

# Source normalization — the React implementations in this repo

Three independent triage surfaces in this codebase implement the technique,
at three scales. Together they are also the map of where the boundary holds
and where it strains.

## The unified triage deck (seven sources)

`src/features/agents/quick-answer/triage/useUnifiedTriage.ts` fuses seven
heterogeneous "a human must decide" sources — persona manual reviews, build
question groups, backlog ideas, workspace practices, policy proposals,
evolution promotions, and goals awaiting acceptance — into one
`TriageItem[]`.

- **The item contract** is `TriageItem` (`triageTypes.ts`), and the adapters
  live in `triageAdapters.ts`, whose header states the technique's hard part
  exactly: *"A persona review, a backlog idea and a harvested practice have
  no shared scale, so `weight` is an explicit editorial judgement,
  documented per adapter"* — the severity exchange rate applied at the
  adapter, in one reviewable place, rather than emerging from per-source
  sort orders.
- **Per-source metadata survives in a compartment**: `TriageItem.payload`
  carries source-specific fields (e.g. `executionId` for the deep link at
  `useUnifiedTriage.ts` `openLink`) that ordering and projection never read.
- **Source-count honesty is implemented twice over.** The
  `failures: TriageSourceFailure[]` ledger (fed by `noteFailure` per source)
  exists because — per the comment at the `failures` field — every source
  used to end in a swallowed catch, so *"a total outage settled
  `loading:false` with an empty array and rendered 'Deck cleared — nothing
  is waiting on you'"*. And `TriageBacklog.capped` (fed by `noteCapped`)
  records fixed-limit reads that came back full: *"A query that asks for 50
  and gets 50 has told you nothing about what is behind it."* Only the one
  source that reports its own total (`triageIdeas` returns keyset `counts`)
  contributes a printable `remaining` number.
- **Fan-in tolerates latency skew**: each source has its own effect and its
  own generation counter (`ideaFetch.gen`, `proposalGen`, `goalGen`)
  precisely so *"one unavailable source must not take the other's queue out
  of the deck with it"* — no `Promise.all` over unrelated subsystems.

## The companion inbox (four sources)

`src/features/plugins/companion/inbox/hooks/useUnifiedInbox.ts` merges
pending approvals, unread messages (partitioned into message vs output by
`isMessageOutput`), and open healing issues through four adapters in
`hooks/adapters/` (`adaptApproval`, `adaptMessage`, `adaptOutput`,
`adaptHealing`) into `UnifiedInboxItem[]`, newest-first, capped at
`MAX_ITEMS = 50` — explicitly a quick-scan surface, with deeper triage
delegated elsewhere. Persona identity resolution happens once
(`resolvePersonaFromIndex`) and is injected into every adapter call, keeping
the adapters pure.

## The incidents inbox (nine source tables)

`src/features/overview/sub_incidents/libs/incidentTaxonomy.ts` is the
normalization layer for nine backend audit/event tables
(`IncidentSourceTable`), mapping each onto one row shape with a shared
severity rank (`severityRank`), per-source icon/label
(`INCIDENT_SOURCE_ICONS`, `sourceTableLabel`), a colour-independent severity
shape for accessibility (`severityShapeStatus`), and per-source operator
guidance (`incidentGuidance`) — the "what to do next" context that lets the
item be judged in place.

## Where the technique's roster warning bites

The golden path's registry lesson is measured in this repo:
`pending_counts` (`src-tauri/db/src/repos/dev_tools.rs`) hand-enumerates six
human-decision queues while thirteen exist; the 2026-08-17 replay in
`docs/concepts/golden-paths/findings-triage-queue.md` §0 found 314 of 370
waiting items (84.9%) in queues the badge cannot see — including
`persona_healing_issues` (179 items, oldest 82 days) and `audit_incidents`
(99 items) — and that the only queues ever drained to zero are the ones on
the roster. Visibility and drain are the same variable, counted.
