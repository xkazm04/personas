# Monitor Consolidation — folding Teams' six panes into the TitleBar Monitor

**Status:** design v2 (Fable functional+visual review pass), not started
**Authors:** design session 2026-07-13 (opus-4-8[1m]); review pass (fable-5)
**Scope:** `src/features/fleet/monitor/**`, `src/features/teams/**`, `src/stores/slices/pipeline/**`, `src-tauri/src/commands/teams/team_channel.rs`

---

## 1. Why

Two feature sets manage AI personas in nearly the same way, and they have drifted into
parallel implementations of the same ideas:

| Concern | Monitor (TitleBar) | Teams (Studio) |
| --- | --- | --- |
| Online overview | `grid/FleetGridView` | — |
| Log history | `channels/VirtualStream` | `sub_redRoom/RedRoomTranscript` |
| Conversation | `channels/MonitorChannelGrid` → `CollabLiveCorrespondence` | `sub_collab/CollabPane` → **the same component** |
| Orchestration | — | `teamStudio/OrchestrationConsole` ("Assign") |
| Goal / mission mgmt | — | `TeamAssignmentBoardFlightDeck` |
| Improvement dialog | — | `sub_deliberations/DeliberationsPane` |
| Team memory | — | `sub_teamMemory/**` |

The target is **one advanced experience in the TitleBar Monitor**, with Teams reduced to team
*configuration*. This document is the plan.

---

## 2. The structural finding

**This is ~80% a UI consolidation, not a backend migration — and mostly a deletion.**

`list_team_channel` (`src-tauri/src/commands/teams/team_channel.rs:61-248`) is already a
server-side union read-model over exactly the four tables the six Teams panes read from:

```
team_assignment_events   → kind: 'step'      (id prefix tae-)
persona_events           → kind: 'event'     (id prefix pe-, AES-decrypts payload)
team_memories            → kind: 'memory'    (label = category)
team_channel_messages    → kind: author_kind ('directive' | 'persona' | 'athena' | 'director')
                                              ↑ deliberation turns live HERE, with deliberation_id set
```

…sorted, keyset-paginated (`before` cursor), projected into one `TeamChannelItem`.

So Collab, Red Room, Deliberations, Team Memory and the Monitor's Channels stream are **five UIs
over one substrate**. We do not need a new data model. We need one client of the one we have.

### 2.1 What is actually hard

Five things hide under the UI work. These, not the component moves, are the engineering.

**(a) The stream cannot scale past 600 rows.**
`MAX_MERGED_ROWS = 600` (`channels/types.ts:32`) is a hard slice in `mergedFeed.tsx:62`. Each team
only ever loads its 60-item head page (`useTeamChannel.ts:18`), and `MergedChannels` **never calls
`loadOlder`**. `VirtualStream` itself is fine — TanStack virtualizer, fixed 30px rows, custom range
extractor. The ceiling is in the *feed*, not the view. Conversely `CollabLiveCorrespondence` is
unbounded infinite-scroll with **no** virtualization (`:522`), so it is the surface that will
actually degrade first.

**(b) Channel polling is triplicated.**
The monitor grid mounts one `useTeamChannel` per selected team; `MergedChannels` mounts another set
for the timeline; `LiveChannelOverlay` mounts a third set app-wide at App root. Each has its own 15s
poll and its own `TEAM_ASSIGNMENT_PROGRESS` listener. **Adding surfaces currently multiplies polls.**

**(c) `list_team_channel` starves lenses.**
Each of the four sub-queries pulls `LIMIT n`, then the union is sorted and truncated to `n` **total**
(`team_channel.rs:245-246`). A team with chatty step events starves memories out of the window. This
is tolerable for one blended feed; it is **fatal for a lens-based UI** — filter to the "memory" lens
and you see nothing, because memories never made it into the page. *The kind filter must be pushed
down into the query.* This is the single most important backend change in the plan.

**(d) The keyset cursor is timestamp-only at second resolution.**
`at` is `strftime('…%H:%M:%SZ')` and the cursor is `at < ?2` (exclusive). A burst of step events
sharing one second that straddles a page boundary is **dropped or duplicated**. The cursor must
become composite `(at, id)`: `WHERE (at, id) < (?cursor_at, ?cursor_id)` semantics, matching the
existing sort tiebreak `b.at.cmp(&a.at).then(b.id.cmp(&a.id))`. Without this, the lens UI (which
pages far more aggressively than today's 60-row head) will visibly lose rows.

**(e) Red Room is fragile.**
No table, no Tauri command, no ts-rs bindings. It is a client-side fusion of four `list*` calls on a
10s timer pulling **500 unscoped `persona_events`** and filtering them in the browser
(`useRedRoomFeed.ts:158-193`). It is the piece most likely to be silently wrong today.

### 2.2 The bug we inherit

`list_team_channel`'s channel-messages query (`team_channel.rs:208-217`) has **no
`deliberation_id IS NULL` filter**, and `TeamChannelItem` does not expose the column — so
deliberation turns already leak into the Collab conversation as ordinary `persona`/`athena` rows,
and the frontend cannot filter them out. Fixing this is a prerequisite for treating deliberations as
a lens.

### 2.3 The one genuinely lossy migration

**Goal-less assignments have zero representation in `sub_goals`.** And goal-less is exactly what the
Assign surface creates today (`goalId: null`, `teamStudioShared.tsx:324`). If the Assignment Board is
deleted without a home for these, ad-hoc missions become invisible. See §7.

---

## 3. Decisions (settled)

With user (2026-07-13):

| # | Decision |
| --- | --- |
| D1 | **Deliberations render inline** as collapsible cards in the conversation timeline; focusing one puts agenda / advance / run-to-budget / split-merge / escalation / proposal controls in the right rail. Capability work and improvement dialog interleave in one stream. |
| D2 | **Memory's power views survive** as sub-modes of the memory lens: when memory is the only active kind, the stream offers list / timeline / run-diff presentations over the same filtered data. |
| D3 | **Goals grows a "Missions" tab** — the FlightDeck's phase-grouped rail over *all* assignments, goal-linked or not; unlinked ones get a "link to goal" action. The goal detail drawer embeds the same `StepRelay`. |
| D4 | **Teams becomes configuration-only** — roster, tiers, trust, use-case toggles, workspace instructions, disband. Everything about *watching or driving* a team moves to the Monitor. Clear split: **Teams = who, Monitor = what's happening.** |

From the review pass (design-level, revisit only if a prototype round contradicts them):

| # | Decision |
| --- | --- |
| D5 | **Stream is a read-only observatory; Conversations owns the composer.** `ChannelTimelineWorkspace`'s composer and Quick Answer/Goals right rail do not survive in Stream — Quick Answer relocates to the Conversations right rail; the Goals tab becomes a deep-link to Goals ▸ Missions. One place to write, two places to watch. |
| D6 | **Unread is client-side**: `channelSlice` keeps `lastSeenAt` per team (persisted `personas.channel.lastSeen.<teamId>`), derives per-team unread counts for the sidebar and the dock badge. No new backend read-marker table in this project. |
| D7 | **Clustering rule**: in Conversations, consecutive `step` items sharing an `assignmentId` collapse into ONE live assignment card (anchored at the cluster's newest timestamp); messages sharing a `deliberationId` collapse into one deliberation card. Stream never clusters — it is the flat log. |
| D8 | **Memory sub-modes (timeline/diff) require a single-team scope** — run-diff compares runs of one team. With multiple teams selected, the memory lens offers list mode only. |
| D9 | **`eventFamily` / `memberColor` / `parsePayload` / `toEpochUtc` move to `src/lib/channel/`** before `sub_redRoom` is deleted (Collab imports them from `useRedRoomFeed` today). |

---

## 4. Target architecture

### 4.0 Monitor information architecture

```
TitleBar ▸ Monitor (headerOverlay === 'monitor')
header pills:  [ Fleet ]  [ Activity ]  [ Stream ]  [ Conversations ]      ( Live 🔔 toggle )
│
├── Fleet          ← MonitorProjectColumns (triage; default, unchanged)
├── Activity       ← FleetGridView (online overview, unchanged in kind)
├── Stream         ← VirtualStream + lenses (log history; absorbs Red Room + Team Memory) — read-only
├── Conversations  ← messenger layout (absorbs Collab + Deliberations + Assign) — owns the composer
└── MonitorDrawer  ← per-persona output (reviews / messages / activity / capabilities),
                     layered over Fleet + Activity as today; NOT a pill

Goals page  └── Missions tab   ← absorbs TeamAssignmentBoardFlightDeck
Teams page  └── configuration only (roster, trust, use-cases, workspace settings)
```

- Widen `monitorInitialView` in `uiSlice.ts:176` from `'fleet' | 'channels' | null` to the full
  four-value union so every mode is deep-linkable (`LiveChannelOverlay` deep-links into
  Conversations with the team preselected).
- The persona search stays in the header for Fleet/Activity; Stream and Conversations have their own
  scoped search (lens / conversation).
- The 1s `now` tick (`PersonaMonitor.tsx:90-102`) stays gated off for Stream **and** Conversations.
- `LiveChannelOverlay` (pop-ups, requirement A3) survives unchanged in presentation but reads
  `channelSlice` instead of mounting its own `useTeamChannel` set; clicking a pop-up deep-links to
  the team's conversation.

### 4.1 Pillar 0 — one channel store *(the enabling refactor; must land first)*

New `src/stores/slices/pipeline/channelSlice.ts`:

- per-team cache: `items`, `cursor` (composite, per kind-set), `exhausted`, `presence`, `lastError`
- **refcounted subscription** (`subscribeChannel(teamId)` / release) so N surfaces watching the same
  team share one fetch; presence (today a separate 30s poll in `useTeamPresence`) folds in
- **one** poll loop and **one** `TEAM_ASSIGNMENT_PROGRESS` listener process-wide
- `loadOlder(teamId, kinds)` for the stream's merge cursor
- `lastSeenAt` per team + derived `unreadCount` (D6); marking-seen happens when a conversation is
  focused and scrolled to latest

Every surface (Stream, Conversations, `LiveChannelOverlay`) reads from this slice. `useTeamChannel`
becomes a thin selector over it. Without this, each module added multiplies polling; with it, the
polling *count drops* even as surfaces grow.

### 4.2 Pillar 1 — extend the read-model, don't reimplement it

`list_team_channel` changes (Rust + ts-rs regen), all backward-compatible (`kinds: None` = today's
behaviour):

1. **Push the kind filter down.** New `kinds: Option<Vec<String>>` param. Only the requested
   sub-queries run, and `limit` applies to the requested set. Fixes §2.1(c) starvation.
2. **Composite keyset cursor** `(at, id)` replacing the timestamp-only `before`. Fixes §2.1(d).
3. **Expose `deliberation_id`** on `TeamChannelItem`; default the plain-conversation read to
   `AND deliberation_id IS NULL`, with an opt-in to include them (the deliberation-card renderer
   asks for them explicitly). Fixes §2.2.
4. **Carry memory `importance` + `category`** as first-class fields (today only `label`/`extra`
   survive), so the memory lens can filter/sort by importance and render the dot editor.
5. **Carry event `event_type`, derived `family`, and subscription-derived `consumers[]`.** This is
   the change that turns Red Room from a separate feature with its own fragile fetch layer into a
   *lens configuration*, and makes "Heard by" a server-side join instead of an N-per-member
   subscription fan-out.

Regenerate bindings: `cargo test --manifest-path src-tauri/Cargo.toml export_bindings`, commit
`src/lib/bindings/TeamChannelItem.ts`.

**As-built (P1).** The read-model body was extracted into `read_channel(&Connection, …)` so the
cursor and lens behaviour could be tested against a real SQLite schema; the `#[tauri::command]` is
now auth + delegate. Two deviations from the sketch above, both deliberate:

- The **family lens stays a client-side derivation** over an event row's `label` (which *is* the raw
  `event_type`), in `src/lib/channel/eventModel.ts`. Pushing the 8-family regex into SQL buys nothing
  until a family-only view can starve, and a second copy of the vocabulary in Rust is exactly the
  drift the D9 extraction exists to prevent.
- Truncate-after-union **stays**, and is now correct: with the composite cursor the next page resumes
  at precisely `(at, id)` of the last row served, so rows trimmed by the truncate come back on the
  following page instead of being skipped. The old timestamp-only cursor is what made truncation
  lossy.

### 4.3 Pillar 2 — Stream: one virtualized list, many dimensions (read-only)

Keep `VirtualStream` (TanStack) as the renderer. Replace the feed. No composer (D5).

**Dimensions (lenses), composable AND:**

| Lens | Values | Source |
| --- | --- | --- |
| Kind | step · event · memory · message · deliberation | new `kinds` param (server-side) |
| Family | handoff · pr · qa · release · failure · build · note · other | Red Room's `eventFamily`, moved to `src/lib/channel/` and mirrored server-side |
| Author / callsign | per-persona, ranked by traffic volume | `personaId`, persona universal colour |
| Team | multi-select chips | existing team chips |
| Search | body + label + author | client-side over the loaded window |

**Density toggle:** `radio` (Red Room's 30px mono `hh:mm:ss · CALLSIGN · event_type · summary` rows)
vs `comfortable` (44px, wrapped body line). Same data, same virtualizer, different row component +
`itemSize`.

**Cross-team paging (the real work).** Replace the 600-row slice with a k-way merge cursor:
`MergedCursor = { [teamId]: (at, id) }`. On end-reached, page the *shallowest* team (the one whose
oldest loaded item is newest) until enough rows exist below the current oldest merged timestamp.
Merge comparator must be byte-identical to the server's (`at` desc, then `id` desc). Retain a bounded
in-memory window (target ~5k rows) with tail eviction; dedupe by item id on head-refresh overlap.

**Memory sub-modes (D2, D8):** when kind === ['memory'] and one team is scoped, the stream header
offers list / timeline / diff — reusing `sub_teamMemory/components/timeline/**` and `diff/**` as
alternate renderers over the lens-filtered set.

**Detail:** merge `RedRoomDetailModal` (raw payload pretty-print + copy, "Heard by" consumer chips,
artifact link, error banner) into the existing `ChannelDetailModal`. Red Room's modal is the richer
of the two — it wins.

### 4.4 Pillar 3 — Conversations: messenger, not grid

Layout (single project, sidebar of projects-as-conversations):

```
┌────────────┬──────────────────────────────────┬──────────────┐
│ Projects   │  The conversation (virtualized)  │ Context rail │
│ 280px      │  · directives / persona posts    │ 320px        │
│ · crest    │  · assignment CARDS (D7)         │ · Focused    │
│ · last msg │  · deliberation CARDS (D1/D7)    │   delib ctrl │
│ · unread   │  · review interventions          │ · Missions   │
│ · presence │  · day separators                │ · Reviews    │
│ · delib ◉  │  ────────────────────────────    │ · Quick      │
│            │  composer (@mention, /assign)    │   Answer     │
└────────────┴──────────────────────────────────┴──────────────┘
```

- **Sidebar**: one row per team — crest (icon+colour from `usePipelineStore`), name, one-line last
  message preview, `RelativeTime`, unread badge (D6), presence dots (working count), and a small
  pulsing ◉ when a deliberation is active (the DB enforces ≤1 active per team via the partial
  unique index). Text filter on team names. Selecting a row = the whole "project switch".
- **Virtualize the message list.** Same `GroupedVirtualList` machinery as Stream, with
  `measureElement` (bubbles and cards vary in height, unlike Stream's fixed rows). Non-negotiable —
  this is the surface that degrades today.
- **Assignments as cards (D7).** A step cluster renders one live card: title, `StepProgressStrip`,
  persona stack, rework-round badge, expandable per-step markdown output, pause / resume / replay.
  Reuse `boardShared.tsx` primitives verbatim.
- **Deliberations as cards (D1/D7).** Collapsed: topic · status pill · round counter · cost meter.
  Expand → turns inline (fetched with the `deliberation_id` opt-in). Focus → right rail shows
  agenda, advance, run-to-budget, split/merge tracks, gated action approve/skip, escalation,
  proposal→assignment.
- **Assign dissolves into the composer.** A goal-shaped directive (or explicit `/assign`) calls
  `decompose_team_assignment_goal` → posts a **proposal card** with routed steps + suggested
  personas → Confirm fires `create_team_assignment` + `start_team_assignment`. This path already
  exists: `companion_assign_team` does decompose+create+start in one call and Athena uses it today
  (`docs/features/companion/athena-team-orchestration.md`). The current OrchestrationConsole's only
  extra affordance is preview-before-commit, which the proposal card reproduces.
- **Right rail** (tabs): focused-deliberation controls (when one is focused) · Missions summary
  (active assignments, deep-link to Goals ▸ Missions) · `PendingReviewTray` · Quick Answer (D5).
- Preserve wholesale from `CollabLiveCorrespondence`: per-team persisted filters + drafts, @-mention
  autocomplete (Tab), click-avatar-to-address, reply threading with parent quote, delivery receipts,
  pin-to-memory, inline `ReviewInterventionCard`, jump-to-latest with unseen count, `@athena`
  companion round-trip, designed empty state.

### 4.5 Pillar 4 — Goals: the Missions tab (D3)

A 4th tab beside Board / Timeline / Progress, scoped by the existing project/scope switch:

- Phase-grouped rail: Active · Needs review · Paused · Queued · Landed · Stopped, with counts
- `StepProgressStrip` per row, `PersonaStack`, `RelativeTime`, LIVE pulse, 5s step polling
- Pause / Resume / Replay; `StepRelay` detail with rework badges and expandable output
- **Goal-linked rows show `GoalChip`; unlinked rows show "Unlinked" + a link-to-goal action**
- `GoalDetailDrawer` embeds the same `StepRelay` for its own missions

---

## 5. Visual & interaction language

The consolidated surfaces must read as ONE system. Canonical tokens live in `.claude/Design.md`;
this section pins the choices that keep five merged features from looking like five features.

### 5.1 Row taxonomy — three tiers, everywhere

| Tier | Where | Height | Look |
| --- | --- | --- | --- |
| **Radio row** | Stream (radio density) | 30px fixed | mono `hh:mm:ss` · CALLSIGN in persona colour · `event_type` mono · summary, 2px team-colour inset rail (amber rail for alerts) |
| **Talk bubble** | Conversations; Stream (comfortable) | measured | tinted bubble, author chip, `RelativeTime`; step/event kinds render as compact one-line strips, not bubbles (as `CollabLiveCorrespondence` does today) |
| **Card** | Conversations only | measured | `rounded-card` + `shadow-elevation-2`, 2px team-colour left border; assignment / deliberation / proposal all share one card chrome with a kind icon + status pill header |

### 5.2 Colour — three systems, three jobs, never mixed

- **Team colour** → left inset rail on rows/cards, sidebar crest. Identity of the *channel*.
- **Family colour** (Red Room's 8) → text accent on the `event_type` token and the detail modal
  header only. Identity of the *event class*. Never used as a background.
- **Persona universal colour** (`memberColor`) → callsigns, avatar rings, presence dots. Identity of
  the *speaker*.
- Status semantics stay with the existing status tokens (`tokenLabel`) and `StepStatusBadge` /
  `STEP_STATUS_META` — do not invent new status colours.
- No raw `text-white/*` / `bg-white/*`; verify every new surface under `[data-theme^="light"]`.

### 5.3 Typography & spacing

`typo-*` tokens throughout; mono (existing mono stack) reserved for timestamps, callsigns and
machine tokens. Layout uses the JS spacing tokens (`CARD_PADDING`, `SECTION_GAP`). Sidebar 280px,
right rail 320px, both resizable with the `ChannelTimelineWorkspace` ref-mutation pattern
(direct DOM width + `localStorage`, zero re-render) — keep its keys' naming scheme.

### 5.4 Motion

- Entrance animation only for items younger than 8s and unseen (the `seenRef` pattern from
  `VirtualStream:86-91`); never animate history pages in.
- Card expand/collapse: spring scale+height; deliberation cost meter animates width on round
  advance.
- Jump-to-latest pill: shared implementation between Stream and Conversations (today two copies).
- Respect `prefers-reduced-motion`; the Live pop-ups keep their existing TTL/hover-pause behaviour.

### 5.5 Shared components (mandatory, per CLAUDE.md catalog)

`display/Tooltip`, `display/RelativeTime`, `display/Numeric`, `forms/Listbox` (author/lens
dropdowns), `layout/SegmentedTabs` (density toggle, memory sub-modes, right-rail tabs),
`modals/BaseModal` (merged detail modal), `feedback/EmptyState` + the existing designed radial
empty-channel state, `buttons/CopyButton` (payload inspector). No hand-rolled equivalents.

### 5.6 Empty & loading states

Each lens gets a specific empty line ("No memories match this lens" ≠ "No transmissions yet");
conversation empty state keeps Collab's radial-glow directive/@athena hints; loading is skeleton
rows at the active density height, not spinners, for list surfaces.

---

## 6. Phased plan

Each phase is independently shippable and independently revertable.

| Phase | Work | Gate |
| --- | --- | --- |
| **P0** ✅ | `channelSlice` + refcounted subscription + unread model (D6); collapse the three `useTeamChannel` mount sites and `useTeamPresence` onto it; rewire `LiveChannelOverlay`. No visible change. **LANDED `e9174f7d9`.** | Poll count drops from 3N to 1N; existing surfaces unchanged; vitest green |
| **P1** ✅ | `list_team_channel`: `kinds` push-down, composite `(at,id)` cursor, `deliberation_id`, memory `importance`, event `consumers`. Regen bindings. Fix the deliberation leak. Move `eventFamily`/`memberColor`/`parsePayload`/`toEpochUtc` to `src/lib/channel/` (D9). | `cargo test` incl. a same-second-burst pagination test; `export_bindings`; binding-drift CI job |
| **P2** ✅ | `/prototype` → **Console** (facet rail) won; density toggle CUT (dense-only). Stream UI (`398877cb9`, `f6e8c8f72`) + plumbing (`8ced9f973`): lens rail w/ SERVER-side kind counts, StreamRow (family rail · callsign · Heard-by · importance dots), LensStream, (team,kinds) cache, k-way merge paging w/ horizon, memory timeline/run-diff wired, `sub_redRoom/**` DELETED, RedRoom detail merged into ChannelDetailModal, MAX_MERGED_ROWS retired. | Stream history unbounded; Red Room's 8 families + callsign lens + "Heard by" all reachable; live-verified via :17320 |
| **P3** ✅ | `/prototype` → **Briefing** (work IN the stream as bands) won over Dossier; the GRID baseline deleted too. Shipped (`674efa27e`, `c57a0b7f5`): projects sidebar (consumes the D6 unread model), measureElement-virtualized conversation w/ chat scroll semantics, D7 clustering, assignment + deliberation bands, DeliberationRail + ReviewsRail (the machinery, out of the cards), composer-driven assign via proposal card. **Deleted** CollabLiveCorrespondence, CollabPane, DeliberationsPane, the grid, and 2 Team Studio tabs (−2188 LOC). | Every §7.3 affordance preserved; conversation virtualized; live-verified via :17320 |
| **P4** ✅ | Goals grows a **Missions** view (`b9d1d3bbb`) — phase grouping, StepProgressStrip, live step polling, StepRelay w/ rework badges, pause/resume, replay, inline review intervention. PROJECT-scoped (the board was single-team) and goal-less missions are first-class + adoptable into a goal (`set_team_assignment_goal` existed; nothing could reach it). **Deleted** TeamAssignmentBoardFlightDeck + TeamAssignmentBoard + the Studio Board tab; `boardShared` primitives survive. | No assignment unreachable; pause/resume/replay work from the new tab |
| **P5** | Teams → configuration-only. Gut `TeamStudioSplitVariant`'s mode rail down to roster + workspace settings + member adjust. Grep `team-mode-*` testids + deep-link helpers first. | Teams route builds; no dead imports; test-automation flows updated |
| **P6** | i18n sweep — all new strings via the translate-extract/merge pipeline (`triageModel.COPY` and `CollabLiveCorrespondence`'s eslint-disabled literals are hardcoded English today); docs sync (`docs/features/overview/`, `docs/features/personas/`, marketing modules per feature-doc-map); update onboarding tour flows touching Teams. | All gates in CLAUDE.md § "PR self-review"; `check:i18n:strict` clean |

**Prototype note.** P2 and P3 are the two pillar surfaces. `/prototype` requires variants to render
in the live dev app on `:1420`, which means **the main checkout, not a worktree** (a second app
instance is impossible — data-dir/keyring singletons). P0/P1/P4/P5 each get their own worktree per
CLAUDE.md's parallel-safety primitives; P2/P3 run on master with atomic commits and explicit
per-file staging (`git commit --only`, add untracked files first).

**Verification.** Every phase that changes user-visible behaviour is live-verified through the
test-automation harness on :17320 before it is claimed done (standing feedback rule).

---

## 7. Feature-gap ledger — what must not be lost

### 7.1 Assignment Board → Goals Missions

| Affordance | Exists in GoalsPage? | Action |
| --- | --- | --- |
| Phase grouping (6 groups + counts) | ✗ | **Migrate** |
| `StepProgressStrip` dot-per-step | ✗ | **Migrate** |
| Pause / Resume | ✗ (drawer has only Advance/Abort) | **Migrate** |
| Replay of terminal assignments | ✗ | **Migrate** (`AssignmentReplay.tsx`) |
| Live 5s step polling + LIVE pulse | ✗ (fetch-on-open) | **Migrate** |
| Expandable per-step markdown output | ✗ | **Migrate** (`StepRelay`) |
| Rework-round badge (`retryCount`) | ✗ | **Migrate** |
| Persona stack per assignment | ✗ | **Migrate** |
| **Goal-less assignments visible at all** | ✗ | **Migrate — the big one (D3)** |
| Skip/Abort on `awaiting_review` steps | ✓ (`GoalTaskTable`) | Already there |

### 7.2 Red Room → Stream

| Affordance | Action |
| --- | --- |
| 8-family event lens with rail colours | **Migrate** — `eventFamily` moves to `src/lib/channel/` + server-side (Pillar 1) |
| Callsign lens (speakers ranked by traffic, persona colour, uppercase callsigns) | **Migrate** — author lens |
| "Heard by" consumer chips (from `persona_event_subscriptions`) | **Migrate** — server-side join, not client fan-out |
| Raw-payload inspector (pretty-print + copy) | **Migrate** — merged `ChannelDetailModal` |
| Payload summary + artifact-link extraction | **Migrate** — `payloadView.ts` already shared |
| Dense mono radio rows | **Migrate** — density toggle |
| 500-row unscoped `list_events` poll | **Delete** — replaced by the paged channel read-model |

### 7.3 Collab / Deliberations → Conversations

Preserve: per-team persisted filters + drafts (`localStorage`), `@`-mention autocomplete (Tab to
complete), click-avatar-to-address, reply threading with parent quote, delivery receipts ("seen by"
chips / "delivered at next step boundary"), pin-to-memory, inline `ReviewInterventionCard`,
`PendingReviewTray`, jump-to-latest with unseen count, `@athena` → companion posts back into the
channel, day separators, designed empty state.

Preserve from Deliberations: cost budget + round meter, agenda-as-termination, parallel track
split/merge, gated capability approve/skip, escalation decision, proposal → assignment spawn.

### 7.4 Team memory → memory lens

Preserve: category chips (observation/decision/context/learning), debounced search, run filter,
5-dot importance editor (1-10 backing scale) with optimistic write, revision-history expander,
auto/manual badge, add-memory form, stats footer, **run-grouped timeline**, **run-to-run diff**
(D2, single-team only per D8).

---

## 8. Payoff

Deleted or absorbed once P0-P5 land:

```
sub_redRoom/          RedRoomPane 49 + RedRoomTranscript 238 + useRedRoomFeed 301   = 588 LOC
sub_collab/           CollabPane 32                                                 =  32 LOC
sub_deliberations/    DeliberationsPane 617 (→ cards + right rail)                  = 617 LOC
teamStudio/           OrchestrationConsole (assign half) + FlightDeck 234 + alias 17
sub_teamMemory/       TeamMemoryPane host (panel components survive as lens modes)
channels/             mergedFeed's 600-row cap; MonitorChannelGrid's grid mode
```

Plus: one poll loop instead of three per team; one detail modal instead of two; one row resolver
instead of two (`MergedRow.resolveCompact` and `CollabLiveCorrespondence.resolveRow` currently
resolve the same `TeamChannelItem` and have already diverged); one filter vocabulary instead of two
(`feedFilter.ts`'s signal/alerts vs Collab's talk/activity); one jump-to-latest pill instead of two.

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| The Rust `kinds`/cursor push-down touches the app's busiest read path | P1 ships alone; existing callers pass `kinds: None` + legacy cursor accepted during a deprecation window |
| Same-second bursts break paging | Composite `(at,id)` cursor + a dedicated unit test inserting N rows in one second and paging through them |
| k-way merge paging is subtle (per-team cursors, dedupe, retention) | The cursor is pure — unit-test it in isolation before wiring the UI |
| `measureElement` virtualization of a chat with cards is fiddlier than fixed rows | Prototype round P3 must include a 2k-message synthetic conversation; fall back to windowed batches only if 60fps fails |
| `/prototype` rounds on master collide with parallel sessions | Declare `sub_collab/`, `fleet/monitor/channels/` in `.claude/active-runs.md`; `git commit --only <paths>`, never `git add -A` |
| Deliberation cards inherit a leak we're fixing in the same project | P1 (leak fix) strictly precedes P3 (cards) |
| Teams Studio gutting breaks deep-links / test-automation flows | Grep `team-mode-*` testids and goal-board deep-link helpers before P5; update harness flows in the same commit |
| Unread model drifts from reality (client-side lastSeen) | Acceptable for v1 (single desktop, local-first); note as a follow-up if fleet/mobile companion needs server truth |
```
