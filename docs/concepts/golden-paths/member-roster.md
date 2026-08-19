# Golden path — Member roster

> Situation node: `product-surfaces/lists-and-tables/member-roster` (recurrence 6, risk medium) ·
> [situation spine](../situation-spine.md)
> **Short form** per the [runbook](../golden-path-runbook.md) §"Mode 2" tiering (medium risk,
> recurrence < 9): spine header, §0 headline, §2 the-one-way, §7 deviations, §9 rule-or-decline,
> §12 corrections. The quality core — two implementations of every count, positive control,
> private-registry validation, hand-verified precision — is tier-independent and unchanged.
> Composed 2026-08-17 at `de274d14d`. Sweep: fourteen roster surfaces read in full; the
> `persona_team_members` and `team_assignment_steps` schemas and every Rust read of both;
> a census-runner validation of one candidate rule; and **both databases queried** — the
> **2026-08-17 purge backup** for the pre-purge population and a read-only copy of the live file
> (deleted immediately after) for what the purge left behind.
> Dimensions: **ui · function · code-quality**.
> **Settles:** how a container's members are listed — what identifies a row, what a row shows
> when its member's identity is gone, what a per-member control addresses, and what an empty
> roster looks like.

---

## §0 — The headline

**The 2026-08-17 purge ran this leaf's worst case for real, and it produced two different
failures on two different surfaces — because the two tables that hold "who is on this team" have
opposite foreign keys.**

Measured against a read-only copy of the live database (copied, queried, deleted; and against
the purge backup for the before-picture):

| table | FK on the persona pointer | before (backup) | after (live) |
|---|---|---:|---:|
| `persona_team_members` | `persona_id … REFERENCES personas(id) **ON DELETE CASCADE**` (`schema.rs:473`) | **64** rows across 8 teams | **0** |
| `persona_team_connections` | via member id, cascade | 70 | **0** |
| `team_assignment_steps` | `assigned_persona_id … REFERENCES personas(id) **ON DELETE SET NULL**` (`incremental.rs:5971`) | **1,488** rows, 1,477 with a persona | **1,488** rows, **1,488 NULL** |
| `persona_teams` | — | 8 | **8** |
| `personas` | — | 78 | 1 |

So: **all 8 teams still exist and every one of them now has zero members**, and the 1,488
assignment steps still exist with every actor pointer nulled. Two surfaces, two failure modes:

- **The roster path hits the empty state.** Which matters because **5 of 14 roster surfaces have
  no empty state at all** — they call `.map` unconditionally over a zero-length array and render
  a heading whose counter reads `(0/0)` above nothing (`PresetPreviewModal.tsx:124,133`;
  `TeamStudioSplitVariant.tsx:186`; `BlueprintPreview.tsx:44`; `PresetProcessBlueprint.tsx:53`;
  `PresetQuestionnaireForm.tsx:134`). Three more are *gated out entirely* — the whole block is
  wrapped in `members.length > 0` with nothing on the other branch
  (`JudgePanel.tsx:94`, `ConversationSidebar.tsx:136`, `TeamList.tsx:443`) — so the UI simply
  loses a section with no explanation.
- **The step-relay path hits the missing-member fallback, and there isn't one.**
  `boardShared.tsx:88-89` — `export function PersonaChip({ persona }) { if (!persona) return null; }`.
  A step whose actor is gone renders **nothing where the actor was**: not a placeholder, not a
  tombstone, not a dash. 1,488 rows of it.

**And the repo contains exactly one honest answer to "the member is gone", in Rust, on the
server:** `team_synthesis.rs:918-920`,
`.map(|p| p.name).unwrap_or_else(|_| "(persona removed)".to_string())`. It is the only
`(persona removed)`-class fallback in the tree — and it is a hardcoded English literal minted
behind an IPC boundary, so it is also the one place the 14-locale i18n system cannot reach.

The prescription that follows is not "handle nulls". It is: **a roster row's identity is the
membership record, not the entity behind it.** The membership row already carries everything a
roster needs to stay legible without its persona — an id, a role, a join time — and the surfaces
that read it as *a pointer to a persona* rather than *a record about a persona* are the ones
that render blank.

**One more measurement, because it reframes what a roster row is even showing.** The schema
allows four roles — `CHECK(role IN ('orchestrator', 'worker', 'reviewer', 'router'))`
(`schema.rs:474-475`). Across all 64 pre-purge membership rows in 8 teams:
**`worker: 64`. Every row. The other three values have never been written.** Nine roster
surfaces render `{m.role}` as a per-row chip. It is a column of identical text.

---

## §2 — The one way

**Render the membership record, and treat the linked entity as decoration that may be absent.**
Concretely: key every row by the **membership id** (`m.id` / `m.memberId`), never by the persona
id and never by array position — a container can hold two memberships for the same entity
(`persona_team_members` has no `UNIQUE(team_id, persona_id)`, and `teams.rs:381-382` says so in a
comment), so the entity id is not a key. Address every per-member control by that **same** id
you keyed with; where a control genuinely acts on the entity (open the persona editor, toggle a
capability) pass the entity id explicitly and name the variable so the two cannot be confused —
never pass an array index. Resolve the entity through a memoized `Map` built once per render
tree (`usePersonaIndex`, `boardShared.tsx:82-85`), not with `.find()` per row. **Give every field
that comes from the entity a fallback that is a sentence, not an identifier** — "(persona
removed)", not a UUID, and never `null`; a row that vanishes is worse than a row that says why.
Render the role only if the role is real: check whether the column has ever held more than one
value before spending a chip on it. And always ship the settled empty state — a roster's zero
case is not exotic, it is the state every container starts in and, as of 2026-08-17, the state
every team in this database is in.

---

## §7 — Deviations

Fourteen roster surfaces enumerated (a list of a container's members where a row shows a role or
carries a per-member action). Counts hand-checked at each cited line.

### A — Identity: what the row is keyed by vs. what its controls address

| surface | row key | control addresses | verdict |
|---|---|---|---|
| `vault/…/gateway/GatewayMembersModal.tsx:240` | `m.id` | `m.memberCredentialId` (`:267`, `:276`), and the pending-flag lookup too (`:237`) | **mismatch** — keyed by one id, operated by another; a `memberCredentialId` collision across two membership rows makes both rows show the same pending spinner |
| `teams/…/teamStudio/TeamStudioSplitVariant.tsx:188` | `m.memberId` | `m.memberId` (`:192`) | correct |
| `teams/sub_teamWorkspace/TeamList.tsx:452` | `m.id` | read-only | correct |
| `plugins/dev-tools/sub_projects/ProjectTeamPreviewModal.tsx:208` | `m.id` | `m.id` for expand (`:211`), `persona.id` for "open in editor" (`:315`) | correct, and correctly distinguished |
| `teams/sub_teamWorkspace/BlueprintPreview.tsx:46` | `` `${member.persona_id}-${i}` `` | **`i`** (`:60` `onRoleChange(i, …)`, `:75` `onRemoveMember(i)`), and the store handler is index-based too (`useAutoTeam.ts:260`) | **position-addressed** — see §7-B |
| `templates/sub_presets/PresetPreviewModal.tsx:141` | `row.role` | `row.role` (`:143`) | consistent, but the key **is** the role string (see §7-D) |
| `teams/…/presetStudio/PresetProcessBlueprint.tsx:60` | `row.role` | `row.role` (`:62`) | same |
| `templates/sub_presets/PresetQuestionnaireForm.tsx:136` | `member.role` | `member.role` (`:138-140`) | same |
| `overview/sub_director/…/PersonaCoachingTable.tsx:134` | `r.personaId` | `r.personaId` (`:235`) | correct for this surface (a starred-persona list, not a membership list) |
| `teams/…/foundry/CrewFoundryPanel.tsx:157` | `p.personaId` | read-only | correct |
| `overview/sub_certification/…/JudgePanel.tsx:97` | **`p.personaId ?? p.role ?? Math.random()`** | none | **see §7-C** |
| `fleet/monitor/channels/ConversationSidebar.tsx:143` | `m.memberId` | none | correct |
| `fleet/monitor/channels/map/ChannelMap.tsx:109-119` | node id `n.personaId` | `personaId` | correct |
| `plugins/dev-tools/sub_workspaces/centerShared.tsx:262,281` | `p.id` | `p.id` (`:266`, `:285`) | correct |

**11 of 14 key by an id and address by the same id.** The three exceptions are each a different
kind of failure, below.

### B — `BlueprintPreview`: a roster whose identity is its position, through three layers

`BlueprintPreview.tsx:46` keys `` `${member.persona_id}-${i}` `` — the index is *in the key* —
and both mutations take the index: `onChange={(e) => onRoleChange(i, e.target.value)}` (`:60`)
and `onClick={() => onRemoveMember(i)}` (`:75`). The store agrees:
`useAutoTeam.ts:260`, `bp.members.map((m, idx) => (idx === index ? { ...m, role } : m))`.

The observable consequence is not "the wrong member gets removed" — the array and the render
stay consistent. It is that **removing member 0 changes the key of every member below it**, so
React unmounts and remounts each of those rows. The role `<input>` at `:57` is inside them.
Focus, selection, IME composition state and the hover-revealed remove button (`:78`,
`opacity-0 group-hover:opacity-100`) are all discarded on a neighbour's removal.

This is the doctrine's **Q6** case verbatim (`KanbanBoard.onItemMove(itemId, …)` → 1/1 correct;
`ReferenceBoard.onReorder(toIndex: number)` → 0/1 correct): the dangerous freedom to withhold is
*the absolute index*, and `BlueprintMember` already carries `persona_id`. Making `onRemoveMember`
required changes nothing — it already is.

### C — `JudgePanel.tsx:97`: `Math.random()` in a React key

```tsx
{judge.personas.map((p) => (
  <PersonaRow key={p.personaId ?? p.role ?? Math.random()} persona={p} />
))}
```

`JudgePersona` declares `personaId: string | null` and `role: string | null`
(`lib/bindings/JudgePersona.ts:7`), so both fallbacks are reachable. When both are null the key
is **different on every render**: the row unmounts and remounts on each parent render, restarting
every animation and dropping any focus inside it. It is the **only** `Math.random()` React key in
2,083 `.tsx` files — two implementations agree, and the site was opened by hand.

The honest fix is not a better fallback, it is that a judge verdict with neither a persona id nor
a role has nothing to identify it and should be **rendered as one aggregate row**, not as N
indistinguishable ones.

### D — Three preset rosters key by `role`, and `role` is also the selection identity

`PresetPreviewModal.tsx:141`, `PresetProcessBlueprint.tsx:60`, `PresetQuestionnaireForm.tsx:136`
all use `key={row.role}` with selection membership `a.selectedRoles.has(row.role)`. That is
internally consistent and it is the right call *if* role is unique within a preset. Nothing
enforces that: `TeamPresetMember.role` is a plain `string` from the binding, no preset validator
checks uniqueness, and the DB's own role column is a 4-value `CHECK` (§0) — so two members with
the same role collapse into one React key **and** into one selection entry. Filed as a shape to
close with a type (a `Record<Role, Member>` in the preset schema) rather than a rule.

### E — The fallback surface: what a row shows when its member is gone

| surface | entity name | role | icon |
|---|---|---|---|
| `ProjectTeamPreviewModal.tsx:224-228` | `t.plugins.dev_projects.team_preview_unknown_persona` — **the only i18n'd fallback in the tree** | guarded (`:230`) | `?? null` |
| `TeamList.tsx:454` | `?? m.persona_id` — **falls back to a raw UUID** | `{m.role}`, **no fallback** (`:455`) | `?? null` |
| `TeamStudioSplitVariant.tsx:273` | `?? m.persona_id` via the hook (`useTeamStudioData.ts:123`) — same UUID | derived | `?? null` |
| `ChannelMap.tsx:115-116` | `?? m.persona_id` | `m.role`, **no fallback** (`:114`) | fallback colour |
| `GatewayMembersModal.tsx:246,248,252` | **none** — `displayName`, `memberLabel`, `memberServiceType` render bare; `aria-label={`Remove ${m.memberLabel}`}` (`:278`) would announce *"Remove undefined"*, and is hardcoded English besides | n/a | n/a |
| `BlueprintPreview.tsx:54,69` | **none** | **none** | n/a |
| `CrewFoundryPanel.tsx:158-159` | none in the UI — the server supplies `"(persona removed)"` (`team_synthesis.rs:918-920`) | none | n/a |
| `PersonaCoachingTable.tsx:149` | **none** on `name` — everything else on the row is guarded (`—` for score `:153`, trend `:192`, flags `:207`; `t.director.roster_never` for last review `:224`) | n/a | passed through |
| `TeamGraphPreview.tsx:97,105` | `?? ''` — **renders blank** | n/a | `?? teamColor` |
| `boardShared.tsx:89` (`PersonaChip`, the step relay) | **`return null`** — the whole chip disappears | n/a | n/a |

**One surface has a real localized fallback. Two fall back to a UUID. Two render blank. One
returns `null`.** And the single genuinely good message in the codebase is a hardcoded English
string produced in Rust.

The pattern in `PersonaCoachingTable` is worth naming because it is so close: every derived
metric on the row has a considered empty rendering, and the **name** — the one field a human
needs to identify the row at all — does not. Guarding the cheap fields and not the identifying
one is the shape to look for.

### F — `role` is a column with one value

`CHECK(role IN ('orchestrator', 'worker', 'reviewer', 'router'))` (`schema.rs:474-475`) against
**64/64 rows = `'worker'`** in the purge backup, across all 8 teams. Nine surfaces render it as a
per-row chip or a monospace pill (`TeamList.tsx:455`, `ProjectTeamPreviewModal.tsx:230`,
`ChannelMap.tsx:114`, `CrewFoundryPanel.tsx:159`, the three preset views, `PersonaCoachingTable`'s
header, `TeamStudioSplitVariant`'s tier chip). Either the write path that produces the other
three roles is dead, or the roles are conceptual and the column is vestigial. Both are worth
knowing before another surface spends a column on it. **This is a historical measurement as of
2026-08-17 and is unreproducible against the live file, which holds 0 membership rows.**

### G — Roster reads have no `id` tiebreaker, and an optimistic row mints its own clock

`teams.rs:347` — `"SELECT * FROM persona_team_members WHERE team_id = ?1 ORDER BY created_at ASC"`
— orders on a clock column with no unique second key, and
`stores/slices/pipeline/teamSlice.ts:186` mints that column for an optimistic row with
`created_at: new Date().toISOString()`. So an optimistic member's position in the roster is
decided by the renderer's clock, and its final position by a non-total sort. Owned jointly by
[`chronological-feed.md`](./chronological-feed.md) §9 (which gates the client half and lists
`teamSlice.ts:186` in its baseline) and by
`clock-ordered-history-read-without-tiebreak` in [`audit-trail-view.md`](./audit-trail-view.md)
(which gates the SQL half). Recorded here, gated there — not re-gated.

### H — No `UNIQUE(team_id, persona_id)`

`teams.rs:381-382` carries the comment *"UNIQUE(team_id, persona_id) constraint to catch the
loser"* beside a hand-rolled `SELECT EXISTS(...)` duplicate guard at `:384`. The constraint is
described and not declared, so the guard is a read-then-write race. Measured: **0 duplicate
(team_id, persona_id) pairs** in 64 rows — the guard has been winning. It is also why §2 says to
key by membership id: the invariant that would make the persona id safe as a key does not exist.

---

## §9 — The missing gate: declined, with numbers

**Candidate: `roster-member-mutated-by-position`** — a per-member handler invoked with an array
index.

```
on(?:Remove|Delete|Drop|Role|Rank|Promote|Demote|Assign|Unassign|Toggle|Update|Change|Rename)[A-Za-z]{0,20}\s*(?:=\s*\{|\()\s*\(?[^)]{0,60}\)?\s*=>\s*[A-Za-z_$][\w$.?]{0,40}\(\s*(?:i|idx|index|position|pos)\s*[,)]
```

Validated with the real runner in a private scratch registry over 2,083 `.tsx`:
**36 matches in 15 files.**

**Declined, on two independent grounds, and the second one is fatal:**

1. **Precision for this leaf is ~0.** The fifteen files are
   `CustomSourceView.tsx` (5), `ByomRoutingRules.tsx` (4), `TriageRulesPanel.tsx` (3),
   `SchemaFieldBuilder.tsx` (3), `ByomApiKeyManager.tsx` (3), `ModelRoutingSection.tsx` (3),
   `ChannelList.tsx` (2), `EventRenameModal.tsx` (2), `ByomComplianceRules.tsx` (2) and six more.
   **None of them is a member roster.** They are rule builders, field builders and routing
   tables — ordered configuration lists where the index genuinely *is* the identity, because the
   rows have no id and their order is the semantics. The rule would fire on 36 correct
   constructs to catch a condition none of them has.
2. **Recall on the one true site is zero.** `BlueprintPreview.tsx` — the *only* position-mutated
   roster in the tree, the site the rule was written for — does not match. Its handlers are named
   `onRoleChange` and `onRemoveMember`, but the **JSX attributes** they are bound to are
   `onChange` (`:60`) and `onClick` (`:75`). The vocabulary I used lives on the *prop the parent
   declares*, not on the attribute the child renders, and a text matcher standing in the child
   only ever sees the latter.

Ground 2 is the more useful result and it generalizes: **a handler's meaning is in the name the
parent gave it and its call is at the name the DOM gave it, and those are different strings in
different files.** A vocabulary-based signal aimed at the intent will systematically miss the
call site, which is the doctrine's "recall is bounded by the author's word list" arriving from a
new direction — here the word list was fine and the *layer* was wrong.

**No narrower variant was found that separates.** The distinguishing feature of a roster is
semantic (the rows denote *entities that exist independently of this list*), and neither the
handler name, the collection name (`members` / `rows` / `roster` / `crew` / `participants` /
`personas`), nor the JSX shape carries it. A rule keyed on `members` alone matches every
`.map` over a variable someone called members, including four that are `DevProject[]`.

**Overlap check, run against final patterns at site level.** `unfocusable-click-target`,
`unbounded-shared-table-render` and `stateless-disclosure-control` share **zero** sites with the
candidate; `feed-item-ordered-by-the-renderers-clock` (this batch,
[`chronological-feed.md`](./chronological-feed.md)) already owns `teamSlice.ts:186,252`, which is
this leaf's §7-G, and it is correctly filed there rather than duplicated here.

### What to do instead — a type, and an inventory

**T1 — make the missing member unrepresentable at the row's type.** The leaf's real defect
(§7-E) is that a roster row's props accept `persona: Persona | undefined` and each of ten
surfaces independently decides what `undefined` renders as — producing one good answer, two
UUIDs, two blanks and a `null`. Held against the doctrine's qualifications: **Q1** passes (the
field added *is* the missing information); **Q3** passes (fourteen construction sites, not one);
**Q5/Q6** point at the right thing — **withhold the raw `Persona | undefined`** and hand the row
a `RosterIdentity = { name: string; icon: string | null; color: string | null; present: boolean }`
resolved once, so a row physically cannot render a blank name because there is no absent value to
render. `FacetedDecisionTable`'s required `labels.emptyTitle` (`:34`) is the precedent the
contract already cites — 3/3 real copy where its optional-prop siblings fall through.

**Where the type does not reach:** the server-side `"(persona removed)"` at
`team_synthesis.rs:918-920`. It crosses IPC as a plain display `String`, so no frontend type
governs it and no i18n key can — the doctrine's "far side of a serialization boundary". That
string is a **structural** i18n hole, not an oversight, and it needs a token
(`status_tokens.member.removed`) resolved client-side, which is the repo's own documented pattern
for exactly this.

**T2 — the instrument this leaf needs is an inventory, not a matcher.** "Does every roster have
an empty state" is an **absence**, which the census cannot express by construction. What answers
it is a rendering test over a registry of roster surfaces, asserting for each that (a) with zero
members it renders a non-empty accessible message rather than an empty container, and (b) with a
member whose linked entity is absent it renders a non-empty accessible name. **It must exit
non-zero if the registry is empty or if a registered surface renders zero rows for the non-empty
fixture** — otherwise a broken selector reads as a clean pass, which is the failure mode the
runner's `floor` exists to prevent and which a bespoke test has to re-derive for itself.

---

## §11 — The convergence oracle

Swept read-only across `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`, with lineage checked before counting.

**Result: a 4-of-5 silence, and the one repo that has a roster reinvented this leaf's headline
defect by a different route.**

- **`personas-web` — none.** No members/participants/roster UI. The only "member" strings are
  marketing copy (`src/lib/mockData.ts:396,693`, "8 team members").
- **`brainiac` — none.** Fourteen console modules, no org/team roster. The DB has a
  `team_members` table, referenced exactly once, in a SQL string inside **pitch copy**
  (`console/src/pitch/pitch-data.ts:144`). The nearest structural analogue is an API-token
  table (`Keys.tsx:70-88`) which renders *scopes*, not roles.
- **`personas-cloud` — none.** No UI layer of any kind.
- **`vibeman` — none.** Zero files match member/roster/participant/invite/seat/collaborator; the
  single `members` hit is a code comment about identity-based membership.
- **`ascent` — yes**, and it is a real one: `src/components/org/members/MembersPanel.tsx:146-229`.

**A silence is the doctrine's strong signal, and it is the right one here.** Recurrence 6 is the
lowest in this subdomain and four of five sibling codebases by the same author never needed the
component. That is evidence the situation is genuinely uncommon — not that it is easy.

**And `ascent`'s single roster independently reproduces §7-C's defect class.**

`MembersPanel.tsx:147` keys rows `key={m.login}`. `src/lib/db/members.ts:277` sets
`login: r.user.githubLogin ?? "(unknown)"`. So the **fallback string is also the React key**:
two members with a null GitHub login collapse into one duplicate React key and render as
`@(unknown)` (`:149`). Personas hit the same wall in `JudgePanel.tsx:97` —
`key={p.personaId ?? p.role ?? Math.random()}` — and chose the opposite wrong answer: a key
guaranteed *unique* and guaranteed *unstable*, where `ascent` chose one guaranteed *stable* and
not unique. **Two codebases, two authors' worth of independent thought, one shared premise: that
the display fallback and the row key can be the same expression.** They cannot, and neither repo
has a surrogate id in the row even though both databases have one — Personas'
`persona_team_members.id`, `ascent`'s `OrgMember` row id. That is §2's first clause,
independently earned twice.

Three more clauses tested against `ascent`, the only witness available:

| clause | `ascent` | verdict |
|---|---|---|
| per-member actions addressed by **id**, never by index | `changeRole(m.login, role)` (`:52,55`), `remove(m.login)` (`:82,204`), `DELETE …?login=${encodeURIComponent(login)}` (`:96`). The one index use is a **rollback re-insert position** — `findIndex` (`:89`) then `splice(Math.min(idx, next.length), 0, removed)` (`:108`) | **upheld**, and the exception is instructive: an index is legitimate for *restoring* a position, never for *identifying* a row |
| a settled empty state for a zero-member roster | **none.** No `members.length === 0` branch; the `<table>` renders header-only over an empty `<tbody>`. `SectionEmpty` at `page.tsx:15,20` covers *DB-not-configured* and *not-an-owner* — not zero members. Its sibling `MemberInvites.tsx:129` hides the whole list instead (`{invites.length > 0 && (`) | **0 of 2 repos with a roster ship one.** Converged on the disease; §7's 5-of-14 gap is not a local lapse |
| the role column carries more than one value | `role: isOrgRole(r.role) ? r.role : "member"` (`members.ts:279`) — a real 3-value control rendered as a `<select>` (`:156-169`) with `aria-label={`Role for ${m.login}`}` | **`ascent` is ahead**; Personas' four-value `CHECK` has one value in 64 rows (§7-F). Stated as self-comparison in the other direction |

`ascent`'s roster also does two things §2 asks for that Personas does none of: it names its role
control for screen readers per row, and it carries an explicit `aria-busy={busy === m.login}` on
the row being mutated (`:147`) — a per-row busy state keyed by the same id it keys the row by.
`MemberInvites.tsx:141` even ships a fallback *sentence* for an absent invite token
(`"link shared at creation"`) — the shape §7-E found exactly once in this repo, and there only
on the server.

---

## §12 — Corrections owed

**To this document's brief, and it is the substantive one.** The brief said:

> *"`team_assignment_steps` kept 1,488 rows through the 2026-08-17 purge with their persona
> pointer `SET NULL`, and every persona row is gone. **A roster is now a list of nulls** —
> measure what the surface does with that."*

**Both halves of the premise are right and the conclusion is wrong, because the roster is not
that table.** Measured on a read-only copy of the live file: `team_assignment_steps` does hold
1,488 rows with 1,488 NULL `assigned_persona_id` — but the roster table is
`persona_team_members`, whose persona FK is **`ON DELETE CASCADE`**, not `SET NULL`
(`schema.rs:473`). It went **64 rows → 0**, and `persona_team_connections` went 70 → 0 with it.
`persona_teams` is untouched at 8.

So **a roster is now EMPTY, in all eight teams — not a list of nulls.** The nulls are in the
assignment **step relay**, a different surface with a different component
(`boardShared.tsx:206` `StepRelay`) and a different failure (`PersonaChip` returns `null`, so the
actor silently disappears) — and, unlike the roster, it has no empty-state path to fall into
because the rows are still there. The distinction is load-bearing for the prescription: the
roster's fix is an empty state (5 of 14 surfaces lack one), the relay's fix is a present-but-
unresolvable fallback (1 of 10 surfaces has a good one). A composer that accepted the brief's
framing would have written one prescription for two problems and covered neither.

Also from the brief: *"and remember the trap: the purge is not a fix."* Upheld and extended —
**the purge is not a fix, and it is also not only a loss: it is the leaf's own worst case,
executed.** Every roster in the app is now in the state 5 of 14 surfaces cannot render. That
makes the empty-state deviation immediately observable rather than hypothetical, which is the
opposite of the trap the brief warned about and is worth saying because the same purge makes
most other leaves' evidence *less* observable, not more.

**To the doctrine, offered upward** — a fourth reading of the "purge" caveat. The doctrine warns
that *"a composer that copies the live database, finds zero rows, and reports a defect as fixed
is wrong."* This leaf produces the complementary case: **zero rows was itself the measurement**,
and it was only interpretable because the *before* picture was available in the backup and the
*mechanism* was available in the schema. The generalization: when a table reads zero, the
question to ask is not "is this fixed" but **"which FK removed it, and what does the surface that
reads it do now"** — a cascade and a `SET NULL` on the same purge produce two different UI
states, and the schema is where the difference lives. Reading the FK before reading the count is
one command and it turns an empty table from a dead end into a controlled experiment.

**To no published path.** Nothing measured here contradicts a primed claim. `expandable-row.md`'s
key-by-identity prescription is upheld by an independent population (11 of 14 roster surfaces
key by a membership id), and the two exceptions found here — `Math.random()` and
`` `${id}-${i}` `` — are shapes its own 43-file sweep did not contain, so they extend rather than
correct it.
