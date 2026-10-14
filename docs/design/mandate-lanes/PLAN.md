# Mandate Lanes: project plan

> Spec and order for bringing the contest finalist "Mandate Lanes" (contest `human-loop`, round 3 entry B/1)
> into the Fleet monitor. Written 2026-10-14 by `/spark mandate-lanes` after four scouts and three design waves.
> The design record (every question, the chosen and the rejected options) is the vault note
> `Spark/ideas/mandate-lanes.md`. This file is the buildable contract.

## 1. Summary

The monitor stops asking the operator to patrol seven chips. Each project's App Master charter, the
**mandate** that already exists in the engine, gains an envelope: which kinds of decision its steward may
take alone, a merge policy, a spend cap. Inside the envelope the steward decides and every decision lands in
an act log the operator can audit and revert. Only crossings reach the operator, in four lanes (Breach, Sign,
Accept, Talk) plus an Orphans count, and they decide them in the existing decision deck, which grows the
prototype's card anatomy.

What the owner said, verbatim, that this plan answers:

- Round 1: "Hard defining time or number of decisions does not seem to be a good choice, as some days can be
  stale, some very fruitful and I'm fine to spend more time if there is huge productivity in the background."
- Round 3: "B/1 should dive deeper to perfect design of each inner component - modals, popus for the decision
  making ... Currently there is brillian main layout of the variant, the deeper I click the careless design was made"
- This plan: "current design much better handles decision modals like src/features/decision-center/deck/DeckTray.tsx
  which we should take and expand rather. On the other hand polished B/1 will unlock promoting surroundings like
  .../entry-e/LanesPanel.tsx, .../channels/ConversationBriefing.tsx which are both under the same 'roof'. Part of the
  UI consolidation would be also replacing background - current image background can bother glassy components"

## 2. Design decisions (from the waves)

| Fork | Chosen | Rejected |
|---|---|---|
| Where the mandate lives | **Extend the App Master charter** (`persona_responsibilities`, engine `Mandate` at `src-tauri/engine/src/app_master.rs:159`). One mandate per project; goals become its intents with a "met when". | Per-goal mandate rows (two mandate concepts, new schema). UI-first with no backend (stewards would decide nothing new). |
| The word "lanes" | **Decision lanes own it.** The session layout switch reads **Bays / Queue**; `LanesPanel` is promoted as the Queue view. | A new word for decision lanes. Dropping the layout switch. |
| Autopilot | **A Stewards plate replaces `AutopilotPlate`**: the attention-loop switch on top, one row per charter (rung, `autopilot_mode`, budget, open asks), and Athena's CLI answerer as its own row with its own grant. | Keeping both plates. One per-project dial (changes the behaviour of the 9 projects on `full`). |
| Who decides inside the envelope | **Hybrid.** A deterministic router at arrival does the filing (report to evidence, info review approved, out of scope to a lane) and records it as a grant act. Judgment calls (accept an idea, answer a question) wait for the App Master's tick. | Rules only. App Master LLM decides everything (nothing happens while the loop is off). |
| Act log | **New append-only `charter_acts` table** with a real reader. | Extending `fleet_decisions` (terminal-shaped columns). Recording on source rows (no single log to read, revert or mirror). |
| Multi-device | **Home decides, peers mirror.** The home device owns charters and stewards; acts and envelope changes are mirrored read-only to owned peers through a new `remote_jobs` kind; verdicts taken on a peer route home. Spend caps stay per device. | Device-local only. Per-device stewards (needs a shared spend ledger that does not exist). |
| Schedules | **Outputs route, runs stay free.** Triggers run exactly as today; what they produce enters the lanes like any item. `SchedulePlate` stays. | Counting runs against the envelope. Schedules as an envelope scope. |
| Background surface | **Static gallery first, then port.** One HTML gallery of 6-8 patterns over B/1's layout, dark and light; the winner is ported. | In-app page-harness variants first. A contest round. |
| Cutover | **Dev switch, then delete.** Lanes ship behind a `Chips / Lanes` setting; after the owner approves, the chips are deleted in one commit. | Hard cutover. Lanes as a fourth monitor tab. |
| Phases kept | All eight offered: surface, deck fusion, lanes, steward backend, re-read + widen, orphans drafted by Athena, surroundings, dock act stream. | none |

Director decisions (no question needed, convention or evidence decided them):

- **Valves are never delegated and never batched.** Outbound messages and deletions always reach the operator,
  one item at a time, armed twice (B/1's rule plus the A/3 lesson "irreversible is never batched", which the
  owner accepted in the `/perfect` gate). Merge and spend can be delegated only through the merge policy and the cap.
- **Merge policy defaults to `never`.** `gate-green + council-ready` exists as an option, but the council skill
  says nothing it produces admits work; until that doctrine says a signed mandate is the operator's prior
  admission, a council-ready merge still reaches Accept. Recorded as an open risk, not built around.
- **The spend cap is the existing `budget_monthly_usd`**, shown as used / cap and enforced on every dispatch path
  (today only `overnight.rs` reads it). No new daily window.
- **"Met when" reuses `dev_goals` status `awaiting_acceptance`** (`src-tauri/db/src/repos/dev/goals.rs:615`) as the
  claim that feeds the Accept lane.
- **The `ready` chip** (accepted ideas awaiting dispatch, `hub/ready/*`, also used by `RunDeskControls`) moves to the
  Queue view's header as a "ready to dispatch" plate; dispatching is a steward scope (`dispatch`).
- **Routing ships on the payload.** The router is one Rust function; the frontend never re-implements it
  (repo law: a client copy of a backend rule must be tethered; better to ship the effective value).
- **The UI word is "mandate", the code word stays "charter"** where it already is. The App Master already calls it a mandate.

## 3. What must survive (the preservation matrix)

| Existing capability | Where it lives today | What happens to it |
|---|---|---|
| Athena CLI-prompt answerer | `companion_autonomous_mode`, `approval_autopilot.rs:68`, `fleet_decisions` | Untouched. Shown as its own row in Stewards with its own grant. `fleet_decisions` keeps its dedupe role. |
| Attention loop (dispatches App Masters) | `autonomous_attention_loop`, `attention.rs`, `fleet_autopilot_status` | Its switch moves to the top of the Stewards plate; testid `fleet-autopilot` / `fleet-autopilot-toggle` kept for tour anchors. Judgment items join its decision prompt. |
| Per-project `autopilot_mode` (9 on `full`) | `engine/src/autopilot.rs:45-118` | Unchanged; shown per charter row. |
| App Master rungs, forbidden classes, approval gates, probation, kp reporter | `persona_responsibilities`, `autonomy.rs` `mandate_permits_for` | Extended, not renamed. New columns are additive with defaults that reproduce today's behaviour. |
| App Master asks (`persona_manual_reviews`, `source=app_master_ask`) | `attention_decide.rs:218` | Become Breach cards on their charter. Still desk-only from a phone. |
| Schedules / triggers | `scheduler.rs`, `persona_triggers`, `SchedulePlate` | Unchanged. Outputs route into lanes. |
| Device mesh (DeviceStrip, MeshBoard, Move to..., remote jobs) | `entry-e/devices/`, `p2p/`, `remote_jobs` | Unchanged; gains one job kind for the mirror (phase 9). |
| Decision deck consumers | `DecisionDeckHost`, `DecisionHub`, Home `DecisionsPanelWidget`, Athena `useDecisionQueue`, title-bar badge, `CouncilGateBay`, overview deck doors | All keep working under both settings. Counts follow the `Chips / Lanes` setting. |
| Council gate | `CouncilGateBay.tsx`, `dev_tools_council_decide` | Unchanged. A council verdict is evidence on the mandate; deciding it stays the operator's. |
| Tour anchors and page harness | `tourAnchorManifest.json`, `scripts/style/page-harness/monitorActivitySurfaces.tsx` | Every renamed or moved testid is re-generated in the same commit; harness ids `monitor/lanes*` become `monitor/queue*`. |

## 4. Data and API

Migration `e67_mandate_envelope` (re-check the highest e-number on local master **and** `origin/master` before landing):

- `persona_responsibilities` gains:
  - `decide_scopes TEXT NOT NULL DEFAULT '[]'`: the kinds the steward may decide alone. Values, verbatim from the
    prototype: `idea.accept`, `idea.reject`, `review.info`, `incident.triage`, `question.answer`, `dispatch`,
    `report.read`, `council.attach`. Default empty, so nothing changes until a mandate is signed or widened.
  - `merge_policy TEXT NOT NULL DEFAULT 'never' CHECK(merge_policy IN ('never','gate-green','gate-green+council-ready'))`.
  - `envelope_version INTEGER NOT NULL DEFAULT 0` (0 = draft, bumped on every sign, widen, narrow or amend).
  - `kept_at_acts INTEGER` (the re-read trigger's "you kept it at N acts" marker; NULL when never re-read).
  - `source` CHECK widened to add `'athena'` (orphan drafts).
- `dev_goals` gains `met_when TEXT` (JSON: `{ uat, kpiId, council: 'full'|'lite'|null }`, NULL = none) and
  `charter_id TEXT` (the mandate this goal is an intent of; NULL = the project's active charter).
- New table `charter_acts` (append-only, never updated except `reverted_at` / `revert_act_id`):
  `id, charter_id, envelope_version, item_kind, item_id, verdict, actor ('router'|'steward'|'operator'), scope,
  reversible INTEGER, cost_usd REAL, shown_json` (what was shown at decision time, per the decision-records
  standard), `env_change_json` (for widen / narrow / amend acts), `reverted_at, revert_act_id, origin_device, created_at`.
  Indexes on `(charter_id, created_at)` and `(item_kind, item_id)`.
- **Absent values:** a field that does not apply is `NULL`, never `0` or `''`; arrays default to `'[]'`.

Commands (all through `invokeWithTimeout`; ts-rs types exported and committed under `src/lib/bindings/`):

| Command | Producer | First consumer |
|---|---|---|
| `mandate_list` returns charters with envelope, load (spend used, acts, open asks) and the re-read reason | WP3 | Stewards plate (WP4) |
| `mandate_get(id)` | WP3 | Mandate page (WP4) |
| `mandate_sign(id, envelope)`, `mandate_amend(id, change)`, `mandate_suspend(id)`, `mandate_resume(id)` | WP3 | Sign and Breach cards (WP5), mandate page (WP4) |
| `charter_acts_list(filter)`, `charter_act_revert(id)` | WP3 | Act log (WP4), dock stream (WP7) |
| `decision_lanes_snapshot()` returns every pending item's `{lane, clause, charterId, coalesceKey, irreversible}` | WP3 (the router) | Lane projection (WP4) |
| `orphan_clusters()`, `orphan_adopt(project, charterId)`, `orphan_archive(project)` | WP6 | Orphanage page (WP6) |

Events: `charter-act-recorded` (push on insert) feeds the dock stream and lane refresh.

## 5. Work packages

Each package is one builder session unless marked. Gates per `.claude/spark/config.md` `## Gates` (`npm run check`,
sharded vitest, i18n strict, clippy + `test:rust` when Rust changes, bindings regen).

### WP0: Surface gallery (static, no app code)

- One HTML gallery at `docs/design/mandate-lanes/surfaces/index.html` rendering B/1's polished layout over 6-8
  surface candidates (subtle noise, fine dot grid, soft tonal gradient field, quiet contour lines, woven hairline,
  a calm version of today's network art, a flat token surface as the control), each in **dark and light**, with
  the glass plates (`.ae-plate` blur 6px) on top so the interaction with glass is what is judged.
- Uses only the app's tokens (`tokens.css` / theme variables); every pattern is CSS or inline SVG, no raster.
- Acceptance: opens from disk; switch candidate and theme by key; screenshots at 1280x800 and 1920x1080 per
  candidate; the owner picks one (or a fusion) before WP8.

### WP1: Deck fusion, anatomy (frontend)

Keep `DeckModal`, `DeckSession`, `DeckTray`, `DeckCard`, `DeckDock`, `LedgerRail`; grow them:

- `CardHeader`: kind eyebrow, the ask as title, and the **"If you yes / If you no" outcome pair** (copy per kind
  from `decisionCopy`).
- `DeckDock` becomes **fixed**: it never moves while the body scrolls; keys sit inside the buttons.
- **Foldable body sections** with a counted one-line summary ("Behind it · 2 items · 1 red gate"); the default
  state lets the operator decide at 1280x800 without scrolling.
- **Arm-twice** for any item whose `irreversible` is set (new optional `DecisionItem.irreversible`:
  `'merge'|'spend'|'outbound-message'|'deletion'`, populated by the adapters that know it, `undefined` elsewhere).
  The armed box lists exactly what leaves.
- **After a verdict**: stamp, a receipt line, the next card; an empty lane offers the lanes still holding cards.
- First tests for `DeckTray`, `DeckDock` and `ReasonPrompt` (none exist today).
- Acceptance: all four existing shapes (backlog, approval, report, chat) use the anatomy; integrated page-harness
  screenshots dark + light at both sizes; no census rises.

### WP2: Mandate envelope backend (Rust, 1-2 sessions)

- Migration `e67`, repos for `charter_acts`, the commands in section 4, bindings regen.
- `mandate_permits_for` learns per-kind scopes; existing rung checks unchanged.
- The merge policy feeds `worktree_merge_rule` (`src-tauri/engine/src/unattended.rs:202`): `never` means a rung-3
  worker opens the branch and asks instead of merging.
- `budget_monthly_usd` is checked on the attention-loop dispatch path too, not only `overnight.rs`.
- Acceptance: a charter with default columns behaves exactly as today (regression test); every envelope change
  writes an act; `charter_act_revert` refuses an irreversible act with a typed error.

### WP3: The router (Rust)

- One pure function `route(item, charter) -> Route { lane, clause, act? }`, the prototype's law: no charter means
  orphan; draft or suspended means held; report and council become evidence when `report.read` / `council.attach`
  are held; a tier-1 or high incident is a stop breach; a high review is a risk breach; outbound and deletion are
  valves; merge and spend follow the merge policy and the cap; otherwise the steward acts if the scope is held.
- A **steward sweep** runs on the existing reconcile tick over pending items not yet routed: deterministic filing
  happens at once through the same doors the UI uses (`apply_idea_verdict_cas`, review approve, `mark_report_read`)
  and is recorded as a `router` act attributed to the charter version (unattended-mode standard: the grant answers
  AT the gate). Judgment kinds are added to the App Master's decision prompt as "in your envelope, awaiting you".
- `decision_lanes_snapshot` ships the routing on the payload.
- Coalescing key: `charterId + lane + clause` (talk items never coalesce).
- Acceptance: table-driven tests over every branch of the law; a sweep with the loop off still files deterministic
  items; nothing irreversible is ever acted by the router.

### WP4: Lanes, Stewards and the mandate page (frontend, 1-2 sessions)

- Setting `decisionSurface: 'chips' | 'lanes'` (default `chips` until the owner approves).
- CommandBar: four lane buttons with keys `1-4` plus Orphans (`O`), counts from `decision_lanes_snapshot`; a
  failed read shows failed, never 0 (triage-queues standard). The layout switch reads **Bays / Queue**.
- The deck opens with `scope: lane`; peeks list cards ordered stop-the-line, then what each unblocks, then age.
- **Stewards plate** replaces `AutopilotPlate` in `SupplyDeck`.
- **Bay nameplate**: a second lamp, lit only when that project's mandate holds a card for the operator.
- **Register (`M`) to mandate page to act log (`L`)** in `MonitorDrawerShell`: act log first with counted filters
  (all / by steward / by you / revertible / reverted), envelope in the rail, Suspend (`S`), revert (`V`), narrow (`N`).
- Title-bar badge, Home widget and Athena's queue read lane counts when the setting is `lanes`.
- Acceptance: both settings work side by side; harness screenshots; tour anchors regenerated.

### WP5: New card shapes in the deck (frontend)

On WP1's anatomy:

- **Breach**: the steward's ask, the clause diff (what would change if amended), the items behind it (folded), plus
  amend (`1`, armed for spend and merge), deny with a reason (`2`), and suspend (`3`). Stop breaches show an incident
  sheet with a fix plan.
- **Valve walk**: one irreversible item per step, `3 of 48`, each armed twice.
- **Sign**: the envelope document, editable before signing (`E`), forecast of what signing releases, sign (`A`),
  drop with a reason (`X`).
- **Accept (claim)**: the met-when checklist (UAT, KPI, council), a random audit sample of acts, accept (`A`),
  send back with a reason (`R`), and revert or narrow from the sample.
- Talk keeps the chat thread shape with quick replies.
- Acceptance: each shape decidable without scrolling at 1280x800; keys printed; reason prompts reuse `ReasonPrompt`.

### WP6: Re-read, widen, orphans (Rust + frontend)

- **Re-read** derived from use, never a calendar: near cap while quiet, asks often for its size, many merges since
  last read, one out-of-scope kind dominating the asks. It arrives as a Sign card titled with the reason; Keep closes it.
- **Scopes section** on the mandate page: per scope, acts and agreement (labelled design until agreement is
  measured); per missing scope, how many of the asks it would have absorbed; widen (`W`), narrow (`N`); widening
  anything touching merge or spend is armed twice and lists what will no longer reach the operator.
- **Orphans**: clusters per project with no active charter; when a cluster is large or growing relative to the
  fleet's flow, Athena drafts a charter (`source='athena'`, `status='draft'`) that arrives as a Sign card;
  the orphanage page offers draft / adopt into an existing mandate / archive (armed twice, archived, not deleted).
- Reference: the `/perfect` lot B engine (`rereadInfo`, `widenPlan`, `scopeRows`, `orphanClusters`,
  `draftFromCluster`) in the prototype copy. It is coherent but was never wired, and its re-read cards render
  broken. Port the law, not the code.

### WP7: Steward acts in the dock (frontend)

- `QuickDispatchDock` keeps its composer and gains a one-line ticker of `charter-act-recorded` events ("App Master ·
  Personas filed 3 reports as evidence"); click opens the act log at that act.
- Acceptance: no extra poll (push only); quiet when nothing happens.

### WP8: One roof (frontend)

- Port the WP0 surface: retire `/illustrations/monitor-network-dark.webp` (`PersonaMonitor.tsx:592`) and the
  `.hud-atmosphere` grid (`globals.css:2197`) for the winning pattern, **with a light-theme version** (today
  there is none).
- Queue view (`entry-e/LanesPanel.tsx`) and the Conversations tab (`channels/ConversationBriefing.tsx`) adopt the
  same plate, lamp and card anatomy as Activity; dead props removed (`layoutControl`).
- Acceptance: the three tabs read as one surface in screenshots, dark and light.

### WP9: Mesh mirror (Rust)

- New `remote_jobs` kind `charter_mirror` carrying acts and envelope changes from the home device to owned peers
  (durable outbox, offline-safe, existing pairing gate). Peers render lanes from the mirror read-only; a verdict on
  a peer is sent home as a job and applied there. Spend caps stay per device.
- Acceptance: one-box smoke with two isolated instances (the `/mesh-onboard` recipe); stated plainly that two
  physical machines are still unverified.

### WP10: Cutover (after the owner approves Lanes in daily use)

- Delete the chip strip, `chipMeta`, the chip lists in `decisionModel` and `deckMeta`, and the setting. Docs
  (`docs/features/monitor.md`, decision-center docs), onboarding anchors and the page harness updated in the same commit.

**Order and parallelism.** WP0, WP1 and WP2 have disjoint files and can run in parallel. WP3 needs WP2. WP4
needs WP3's snapshot, so the Director commits the binding types and command stubs first. WP5 needs WP1 and WP4.
WP6 needs WP3, WP4 and WP5. WP7 needs WP2. WP8 needs WP0's verdict. WP9 needs WP2. WP10 is last.

## 6. UX and UI rules for every package

- Reuse before building: `src/features/shared/components` (`CATALOG.md`), `BaseModal`, `Tooltip` (no `title=`),
  the shared `Button` (no styled raw `<button>`), loading pattern v2 (ghost under chrome; a spinner only on a
  pressed control).
- Type: body at `typo-body` (0.875rem) or larger; nothing the operator must read below 12px; no em dashes in
  on-screen text; dates and percents through `useTranslation().language`.
- Keyboard first with keys printed where they act; one Escape ladder (armed, then reader, then card, then lane,
  then strip, then monitor).
- Annunciator grammar: a lamp lights only when something works or needs the operator; calm is the default.
- Components under 200 LOC.

## 7. Strings

New sections under `monitor` (`ml_*`) and `decision_center`. Every key translated into all 13 other locales in
the same commit, through the translation ritual in `.claude/spark/config.md`.

## 8. Out of scope

- Per-goal mandates; per-device stewards; a shared spend ledger across devices.
- Changing the council doctrine (council-ready merges stay an Accept card).
- A/3's concepts (bay-anchored slates, the constitutional mirror and its graduation statistics). Only its
  "irreversible is never batched" and "plain words first, statistics one level down" lessons are carried.
- Measuring agent agreement: agreement figures stay labelled as design until a shadow-verdict recorder exists.

## 9. Risks

- **Behaviour change on merges.** None for an unsigned charter. The merge policy, like the decide scopes, binds
  only a SIGNED envelope (`envelope_version > 0`): unsigned charters, which is every live one and every new
  adoption, merge exactly as their rung says, and their `merge_policy='never'` column default is inert
  (`ship_rung_for_envelope`, the one rule every dispatcher uses; an unreadable envelope reads as `never`). There
  is no backfill: the first cut backfilled rung-3 rows to `gate-green` while the DEFAULT kept minting `never`, so
  a charter adopted at rung 3 afterwards silently stopped merging, against the owner's decision of 2026-09-09.
  Signing an envelope is the moment the operator chooses a merge policy, so the Sign card (WP5) must show it.
- **The attention loop is off on the main machine.** Judgment items wait until it runs; the router still files the
  deterministic share. The Stewards plate makes "loop off" visible.
- **Mesh is unverified on two machines**: zero `owned_devices` rows live. WP9 is a one-box smoke only.
- **Name churn** across tour anchors and harness ids: regenerate in the same commit as each rename.
- **`useUnifiedTriage` still owns 6 of 11 kinds** (the "retiring" deck). Lanes sit on top of it; retiring it is
  not part of this plan.

## 10. References

- Prototype as the owner judged it: `.contest/arena/human-loop-r2-r3/judging/entries/B/variant-1/` (local, git-ignored;
  needs `../data/`). A tracked copy without the 16 MB dataset is in `docs/design/mandate-lanes/prototype/`.
- `/perfect` lot B partial edits: `.contest/arena/human-loop-r2-r3/perfect/B-1/variant-1/` (`model.js`, `parts.js`,
  `cards.css`), also copied there as `prototype-perfect/`.
- Contest record: `.contest/Backend/contests/human-loop*.md`; pattern `inner-surfaces-carry-the-decision`.
- Standards read: `hitl-approval` (unattended-mode, fixed-policy-amendable-plan, consent-gates, decision-records),
  `triage-queues`.
