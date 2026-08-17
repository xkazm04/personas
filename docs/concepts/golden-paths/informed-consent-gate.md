# Golden path — the informed-consent gate

> Situation node: `ai-agents/agent-ux/informed-consent-gate` · [situation spine](../situation-spine.md)
> recurrence **8** · risk **HIGH** · sides **client** · `twoSided: true` · convergence **mixed**
> dimensions: **security · ui · function · cost**
> merged from *Impact-disclosure gate*, *Informed-consent gate*.
> Composed 2026-08-16 against `master` @ `4f5621830`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` files under `src/` and the **2,088** `.tsx` files under
> `src/features/` that the census engine walks for §9. Every one of the **1,585** generated Tauri
> command names parsed and filtered for irreversible verbs (**64**). Read in full:
> `shared/components/feedback/ConfirmDialog.tsx`, `shared/components/overlays/ConfirmDestructiveModal.tsx`,
> `shared/components/overlays/FirstUseConsentModal.tsx`, `overview/components/BlastRadiusPanel.tsx`,
> `settings/shared/useConfirmClick.ts`, `plugins/companion/ApprovalCard.tsx`,
> `shared/dispatch/DispatchChooser.tsx`, `vault/sub_catalog/components/desktop/CapabilityApprovalCard.tsx`,
> `agents/sub_executions/components/runner/ExecutionPreviewPanel.tsx`,
> `src-tauri/engine/src/desktop_security.rs`, `commands/credentials/desktop.rs`,
> `commands/companion/approvals/approval_lifecycle.rs`, `…/approval_autopilot.rs`,
> `…/approval_exec_devices.rs`, `commands/fleet/external.rs`, `cloud/remote_commands.rs`,
> `companion/connectors.rs`, `companion/dispatcher.rs`.
>
> **Measured by executing, not by reading.**
> 1. **Read-only copies of both live SQLite databases** (`personas.db` 347 MB / 244 tables,
>    `personas_data.db` 17.5 MB / 71 tables, copied 2026-08-16 14:13 with their `-wal`/`-shm`,
>    opened `readOnly: true`, live files never opened for write) queried for consent that was
>    actually granted, refused, or never answered: **120 `companion_approval`** rows
>    (83 approved / 17 rejected / 12 approved-failed / **8 pending**), **194
>    `persona_manual_reviews`**, **0 `desktop_connector_approvals`**, **0 `pending_trigger_fires`**,
>    **0 `trusted_peers`**, **0 `tool_execution_audit_log`**, **78 personas**, **2,188 executions**,
>    **33 `app_settings`**. Approval resolve latency computed per row.
> 2. The §9 rule was built, run in a **private scratch registry with a filename unique to this
>    composer**, counted a second time by an independent brace-matching scanner, hand-verified at
>    **12/12**, positive-controlled so the control **partitions the anchor exactly**, fault-injected
>    **six** ways (floor / zero-match / rise / silent-drop / control-carrying-a-baseline /
>    stale-exclude — all six fire), then re-extracted from this document and re-run. **The full
>    registry was NOT run**, per the doctrine.
> 3. **Nothing was approved or dispatched in the running app.** No approval card was clicked, no
>    `/eval` was sent, no consent row was written. No secret value appears below.
>
> ### Sibling boundaries, settled in prose
>
> [**modals**](./modals.md) owns *the overlay mechanism* — backdrop, focus trap, Escape, z-order.
> This path owns *what the overlay says and what happens if you never answer it*. A perfectly
> portaled, focus-trapped, `titleId`-correct dialog that asks "Are you sure?" about an action whose
> consequence it never names is 100% compliant with that path and 0% with this one.
>
> [**autonomy-gating**](./autonomy-gating.md) owns *may this act unattended*. This path owns *what
> the human was told before they granted that*. Its §7.E (11 assignments parked 59–68 days) is the
> hold; §0 here is the disclosure. Where the two meet — the auto-approval of a queue a human was
> supposed to answer — that path counts the verdicts and this one asks whether the switch that
> produced them said so.
>
> [**human-review-queue**](./human-review-queue.md) owns the presentation and resolution of one
> review. [**delete-semantics**](./delete-semantics.md) owns what a delete does to the rows.
> [**spend-ceilings**](./spend-ceilings.md) owns whether a ceiling refuses; this path owns whether
> the number was ever shown to the person authorising the spend (§0, §7.D).
> [**untrusted-definition-validation**](./untrusted-definition-validation.md) §7.D links here by
> name for `BundleImportDialog`'s `dangerConfirmed` invalidation — that is this path's §6 pattern
> working while its own does not.
>
> The **Deviations** section is a fix backlog.

---

## 0. The headline, before anything else

**This app switches off the agent runtime's own permission prompt at 13 spawn sites and thereby
becomes the only consent gate its user has. Then it ships a switch that turns that gate off for
all 53 gated actions at once, and the switch is an unlabelled infinity icon in a chat header.**

```
src-tauri/engine/src/prompt/cli_args.rs:107   "--dangerously-skip-permissions".to_string(),
src-tauri/engine/src/prompt/cli_args.rs:296   "--dangerously-skip-permissions".to_string(),   (resume)
src-tauri/src/commands/fleet/pty.rs:324,:364   c.arg("--dangerously-skip-permissions");
src-tauri/src/commands/fleet/headless.rs:132   .arg("--dangerously-skip-permissions")
src-tauri/src/companion/session.rs:2174        "--dangerously-skip-permissions".into(),
src-tauri/src/companion/brain/oneshot.rs:185   … and 7 more
```

> **Corrected 2026-08-16 by [agent-dispatch](./agent-dispatch.md): the count is 12, not 13**, by a
> stated method — 25 raw occurrences, 1 in `#[cfg(test)]`, 12 in comments, **12 live** (11 hardcoded
> + 1 parameterised). More usefully, that composer found the count is the wrong instrument
> altogether: one of the 12 sits inside `build_cli_args`, which is referenced at **75** sites. A
> census of the literal measures how many authors typed it, not how many runs carry it.

**13 production spawn sites. Exactly one makes it a parameter** — `fleet_spawn_external_console`
(`commands/fleet/external.rs:118-141`), which takes `skip_permissions: Option<bool>`,
`unwrap_or(false)`s it, and writes the reasoning down at `:109-115`: *"a Fleet session runs
unattended, so permission prompts would just freeze it, whereas an external console has the
operator sitting in front of it AND is outside the app's kill switch."* That is the correct
decision, made once, in the one place the flag was not a constant.

Everything the suppressed prompt would have asked now has to be asked by this app. Its answer is
`companion_approval` + `ALLOWED_ACTIONS` (53 entries, `companion/dispatcher.rs:239-429`) — a
genuinely good design: a closed grammar, one executor table shared by the manual and automatic
paths so *"autonomous mode changes whether a human clicks, never what an action does"*
(`approval_lifecycle.rs:130-134`), and a per-capability classification where **10 of 25**
connector capabilities are marked `requires_approval: true` because they write to an
externally-visible surface (`companion/connectors.rs:60-79`).

And then:

| | |
|---|---|
| the switch | `AthenaChatHeader.tsx:111-118` — `<IconToggle icon={InfinityIcon} … onClick={() => setAutonomousMode(!autonomousMode)}>`. No dialog, no summary, no confirmation. Its only copy is a tooltip that says "autonomous on / off". |
| what it grants | `approval_autopilot.rs:11-51`: **`AUTOAPPROVE_ALLOWLIST` was deleted on 2026-08-10.** *"autonomous mode IS the standing consent … under autonomous mode EVERY proposed action now fires."* |
| what the module itself says that means | *"`backlog_apply_triage` can now apply up to 30 backlog verdicts … without a click, and `use_connector` write capabilities (send an email, post a message) become externally-visible actions with no human in between. Both were previously held back on purpose."* |
| live value | `companion_autonomous_mode = 'true'` in `app_settings` |
| live consequence | **62 of the 83 approved `companion_approval` rows resolved in under 3 seconds; the minimum is 0.** |

The 53-action grammar and the 10/25 capability classification are the gate. The infinity icon is
the gate's off switch, and it discloses less about what it authorises than the average cookie
banner.

### The second headline: the two best mechanisms in this leaf have never done anything

**This app has a consent-freshness rule most products do not have, and it has never expired a
row. It has an impact-and-cost disclosure panel better than any sibling's, and it has never been
rendered.**

- `load_pending` (`approval_lifecycle.rs:292-326`) refuses to execute an approval created more
  than **24 hours** ago — `APPROVAL_FRESHNESS_WINDOW = "-24 hours"` (`approvals/mod.rs:43`) — with
  the reason stated: *"refuse to act on a stale approval whose target may no longer exist. The
  user must re-issue the request."* `companion_list_pending_approvals` applies the same window to
  the list (`:20-25`). **But nothing writes the row.** The live database holds **8 approvals at
  `status='pending'`, aged 5.8 days**, all `backlog_apply_triage`. They are invisible in the UI,
  refused by the executor, un-rejectable (`companion_reject_action` goes through the same
  `load_pending`, `:277`), and untouched by the only sweep that exists — `gc_stale_fleet_approvals`
  (`fleet_bridge.rs:1689-1760`) `continue`s on any action that does not start with `fleet_`.
  **Expired consent is enforced at the read and never at the row.**
- `ExecutionPreviewPanel.tsx` is the only surface in 4,829 files that names, before a run, the
  dollar estimate, the input/output token counts, the memory count, the tool count, the model, the
  month-to-date spend and the percentage of budget it will consume. **It has zero render call
  sites** — `grep -rn "ExecutionPreviewPanel" src/` returns the file and nothing else. And it could
  not have warned anyway: `budgetPct` is `preview.budget_limit > 0 ? … : 0` (`:72-76`), and **78 of
  78 personas in the live database have `max_budget_usd IS NULL`**, so the `overBudget ||
  nearBudget` branch that renders `"{percent}% of budget"` is unreachable on this install.

### And the shape all of §7 reduces to

**Every disclosure prop on the destructive primitive is optional, and the disclosure is therefore
the thing that gets dropped.** `ConfirmDestructiveConfig` (`ConfirmDestructiveModal.tsx:11-34`)
requires `title`, `message`, `onConfirm`, `onCancel` — the *verb* — and makes `details`,
`warningMessage`, `blastRadius` and `requireTypedConfirmation` — the *consequence* — every one of
them optional. The result, counted:

| | count |
|---|---|
| `ConfirmDestructiveConfig` construction sites (across 4 files; 2 further `<ConfirmDestructiveModal` hits are doc comments) | **7** |
| …of which pass `blastRadius` | **2** |
| …of which pass any impact at all (`details` or `blastRadius`) | **3** |
| …of which pass nothing but a title and a message | **4** |
| …of which use `requireTypedConfirmation` | **1** |
| `useBlastRadius` / `BlastRadiusPanelLazy` consumers in the whole tree | **3** |
| `<ConfirmDialog` render sites | **21** |
| …whose title/body interpolate anything at all (name the subject) | **15** |
| …that are a fixed string (name only the verb) | **6** |
| `useConfirmClick` (arm, 3 s auto-revert, commit) call sites | **3**, all in Settings |
| native `confirm()` / `window.confirm()` survivors | **5** |
| feature components importing an irreversible `@/api` door with **no consent step in the file** | **12** (§9) |

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its warrant, so an adopting repo can tell physics from local calibration. No
file path, primitive name or count appears below this line until the head ends.

> **P1 — physics, and the whole subject.** *Consent is about a consequence, not about an action
> name.* "Delete this?" is not a question; "delete this credential, which 3 running automations and
> 11 scheduled triggers depend on" is. If the gate cannot state what will be read, written, sent,
> spent or destroyed — in the units the person cares about — it is not a consent gate, it is a
> speed bump, and it trains the habit of clicking through.
>
> **P2 — physics, and the clause most often skipped.** *The disclosure must not be authored by the
> party asking for permission.* When the thing requesting the action also writes the sentence
> explaining it, the user is reviewing a summary produced by the subject of the review. The
> machine-readable parameters are the only ground truth; if you show a prose rationale, show it
> **beside** the parameters, not instead of them, and do not collapse the parameters by default.
>
> **P3 — physics.** *Consent is evaluated when the action fires, not when it was requested.* Between
> the ask and the click the world moves: a target disappears, a mode is switched off, a budget is
> exceeded, a session dies. Re-read the policy from its durable home at fire time. A gate that
> trusts a boolean captured at proposal time can be satisfied by a state that no longer exists.
>
> **P4 — physics.** *Standing consent is legitimate and must be scoped, named at the moment it is
> granted, and revocable in one place.* A blanket "act without asking me" is often the right
> product decision — but the grant surface must enumerate what it now covers, and the enumeration
> must live next to the switch, not in a source comment. The strongest tell that a standing consent
> is under-specified: the code that implements it contains a paragraph explaining what it really
> authorises, and the UI contains a tooltip.
>
> **P5 — physics, and the one that changes severity.** *Count the non-human callers of your approve
> function.* A consent gate with two doors is a gate with none. Every automatic path, test harness,
> API route or background sweep that can reach the same executor is a way to satisfy the gate
> without the human, and each of them is invisible from inside the dialog's own file.
>
> **P6 — physics.** *A hold that expires at the READ has not expired.* Filtering stale items out of
> a list, or refusing them at the executor, leaves them alive: `pending` to every query, absent from
> every screen, unanswerable by anyone. Expiry must be a **write** — a status transition, with a
> reason, by a sweep — or the queue silently accumulates work that is neither done nor refused.
>
> **P7 — physics.** *Granting and withdrawing are two features; shipping one is shipping neither.*
> A permission that can be given and not taken back is not a permission, it is a one-way latch.
> Count the grant paths and the revoke paths and put the numbers next to each other; the asymmetry
> is always larger than anyone expects, because withdrawal has no user pushing for it.
>
> **P8 — ergonomics, and the cheapest to get right.** *The reversible option is the default, the
> emphasis and the dismissal.* Escape, backdrop-click and the close button must all mean **no**.
> The visually primary button must be the safe one unless the whole dialog exists to confirm the
> dangerous one. And a first-run consent with exactly one button is an acknowledgement, not a
> consent — if there is no way to decline, do not call it a choice.
>
> **P9 — ergonomics, cost.** *If the consequence is money, the number belongs on the gate.* An
> estimate with an honest error bar beats no estimate. And an unconfigured ceiling must render as
> **"no limit"**, never as a percentage — a gauge that computes `spend / 0` and prints `0%` tells
> the user they are safe at exactly the moment nothing is protecting them.
>
> **P10 — security.** *A consent gate underneath a disabled runtime gate is the only gate.* The
> moment you pass the flag that suppresses your platform's own permission prompts, you have
> inherited responsibility for every question it would have asked. That inheritance is never
> written down anywhere, because the flag is added for an unrelated reason (a prompt was freezing an
> unattended job) by someone who was not designing a consent model.
>
> **Scale condition.** P1, P8 and P9 are correctness on the first dialog. P2 arrives with the first
> model-proposed action. P3 and P6 bite the first time a queue outlives a session. P5 and P7 bite
> the second door and the first support ticket respectively. P4 and P10 are the two that arrive
> silently and are discovered years later, by reading a comment.

### Warrant evidence — the five siblings, censused independently

`personas-web` (Next.js), `brainiac` (Rust workspace + Next.js console), `personas-cloud` (TS
orchestrator/worker + Python facade), `vibeman` (Next.js + Tauri), `ascent` (Next.js). All five
reachable. Three have a confirmation UI at all; the other two are counted where the clause applies
to a server.

- **P1 has exactly ONE external warrant, and it is better than this repo's — which is the single
  most important result here.** `ascent/src/components/ConfirmAction.tsx` treats impact disclosure
  as an **enforced invariant**, not an option. Its config comment at `:31` reads *"What will happen
  and how many things it affects — never 'Are you sure?'"*; **all 6 call sites** name a computed
  consequence, and the copy builders are unit-tested for it — `ConfirmAction.test.tsx:15`
  (*"states scope, not 'Are you sure?'"*), `:27-28` (plural correctness: `1 repo tag`, not
  `1 repo tags`), `:72` (the over-cap case), `:89` (the metered cost is named). `segmentDeleteConfirm`
  threads a real `tagCount`; `batchPrConfirm` (`:163-176`) says *"Open 25 draft PRs across 25 acme
  repos"* **and** discloses truncation — *"Only the first 25 of 40 selected open this run"*. The
  copy lives in one file by written policy (`:12-13`: *"ALL copy builders live HERE… do not scatter
  the wording into the call sites"*). **A single repo reinventing this is not physics — but it is a
  working existence proof at a standard Personas does not reach, in a repo with fewer engineers.**
  The middle of the distribution is `vibeman`: **1 of 15** confirmations names a number, 8 name a
  consequence, 6 are generic — and `GroupDetailView.tsx:56` computes `totalFiles` across the group
  **fourteen lines below the confirm at `:41` and never shows it**, which is the exact shape of this
  repo's `ExecutionPreviewPanel` (computed, never mounted). `personas-web` is 1/1 (a selection count
  plus the undo window). `brainiac` and `personas-cloud` are **silent**.
- **P2 is convergent as a failure, and `personas-cloud` states it in a type.**
  `packages/shared/src/types.ts:234-235` — `/** The payload from the manual_review persona protocol
  event. */ payload: unknown` — and the schema of that payload is authored **by the LLM persona**
  (`packages/shared/src/prompt.ts:199`), never computed. Nothing in that repo fetches a blast
  radius, a row count or a cost for a review. That is `ApprovalCard`'s `rationale` with the types
  removed.
- **P3 has NO external warrant and must be reported as silence.** No sibling re-reads the consent
  policy at fire time; where an approval is resolved, the decision is applied immediately from
  whatever state the request carried (`personas-cloud/packages/orchestrator/src/dispatcher.ts:1599`
  injects the answer straight into the paused CLI's stdin). `gate_remote_instruct` is this repo's
  own invention. An adopting repo should treat it as strongly-reasoned and externally untested.
- **P4 is convergent as a failure, and the sibling case is worse than this repo's.**
  `personas-cloud` makes standing consent the **default by absence**: `buildPermissionArgs`
  (`prompt.ts:725-742`) returns `['--dangerously-skip-permissions']` when there is no policy
  (`:727-729`), when `skipAllPermissions` is set, **and** — the quiet one — when a policy exists but
  lists no tools (`:740-742`, commented *"most restrictive: no tool access"*). Persona creation sets
  `permissionPolicy: null` (`httpApi.ts:2008`), documented at `types.ts:22-23` as *"When null,
  defaults to skip-all (legacy)"*. Personas' infinity toggle at least requires a human to press
  something.
- **P5 is physics — 5 of 5. Every repo has a machine path around its own gate.**
  `personas-web`'s SLA sweep auto-approves (`reviewStore.ts:376-379`; default `info: 480 min →
  auto_approve`, `:89`). `brainiac`'s pipeline returns `PolicyDecision::AutoApproved` above a
  confidence threshold (`policy.rs:49-52,:61-64`). `vibeman` hardcodes `--dangerously-skip-permissions`
  into **every** headless spawn (`claude_cmds.rs:525`, `process_cmds.rs:60`) and exposes a bulk
  approve of up to **200** ids on an ungated route (`app/api/ideas/approve/route.ts:26-35`).
  `ascent`'s six dialogs are **decorative from the server's perspective** — `app/api/org/playbooks/[id]/apply/route.ts:27`
  opens real PRs into customer repos behind authz alone, and the file says so at `:36-39`.
  **`brainiac` is the only repo with an inviolable human tier**, and it is worth copying:
  `policy.rs:30-32` — `to == Canonical` ⇒ always `NeedsReview`, rule name
  `"canonical_requires_maintainer"` — plus an audit that encodes humanness structurally
  (`governance.rs:300-304`: `applied_by.is_some()` ⇒ `"approved"`, `None` ⇒ `"auto_approved"`).
  Personas has neither an un-auto-approvable action class nor a human/machine distinction in the
  approval row.
- **P6 is convergent as a failure — 4 of 4 applicable repos.** `personas-cloud` is the purest form
  of this repo's own defect: `status: 'pending' | 'approved' | 'rejected' | 'timed_out'`
  (`types.ts:237`) with `resolvedAt` documented for the timeout case (`:240-241`), and
  **nothing in the repo ever writes `'timed_out'`** — `respondToReview` accepts only
  `'approved' | 'rejected'`. The pending list is an in-memory array (`dispatcher.ts:922-923`), lost
  on restart, and the only real expiry kills the whole execution. `brainiac` has two queues with
  **explicitly different** policies: raw memories get a genuine TTL sweep that writes
  (`memories.rs:97-121`, `raw → rejected` with a `policy_rule='raw_ttl_sweep'` audit row, reasoned
  at `:90-94` — *"the honest reading of 'nobody has looked at this in a month' is not 'pending', it
  is 'declined by neglect'"*) but it is **seeded disabled** (`migrations/0024:18`); the
  needs-review queue gets a 48-hour SLO **alert and no expiry at all** (`alerts.rs:77-87`) — though
  it does something no other repo does: a stalled review queue **pauses publishing**
  (`health.rs:126,155`) and stamps rendered pages stale (`publish/render.rs:50`). `personas-web`'s
  sweep is client-side and **skipped when the tab is hidden** (`reviewStore.ts:355`), so with no
  browser open nothing expires. **Everyone models expiry; nobody applies one policy to the human
  queue.**
- **P7 is convergent (4 of 5 have some revoke path) with the discriminator being WHAT is revoked.**
  Only `personas-web` revokes a *consent* — `reopenCookieConsent()` (`CookieConsent.tsx:18-27`),
  with a GDPR rationale in the docblock, a dedicated button component, and cross-tab sync (`:60-70`).
  The others revoke *credentials*: `brainiac` 1:1 (`tokens.rs:155`), `ascent` **≈5 revoke : ≈3
  grant** — the only repo in the set where withdrawal outnumbers granting, and its live-share check
  fails **closed** (`live/shared/[token]/page.tsx:44`). `personas-cloud` is **1 grant : 0 revoke**
  and the decision is terminal by construction (injected into stdin). Personas' desktop-capability
  revoke has the Rust half and no door.
- **P8 splits, and no repo makes dismissal PROCEED — but two make it non-neutral.**
  `personas-web`'s cookie banner has a `✕` labelled `aria-label="Close"` that calls
  `accept("essential")` (`CookieConsent.tsx:97-103`) — **dismissal silently writes a consent
  decision**. `vibeman`'s shared `confirm()` resolves its promise only from the two button handlers
  (`useGlobalModal.tsx:35-51,68-76`) while `ModalContext.tsx:51-65` wires `onClose` to a state
  teardown that never calls `onCancel` — so Escape/backdrop/`✕` leaves `await confirm(...)`
  **suspended forever**, e.g. an un-closable editor at `CodePreviewModal.tsx:154`. Only `ascent`
  wires every dismissal route to cancel and tests it (`ConfirmAction.tsx:121`,
  `Modal.tsx:62,96,128`), and it adds `locked={busy}` so *"a half-finished write is read not
  dismissed"* (`:15-17`). **This is the one clause where Personas is ahead of the field: 0 of its
  sites make dismissal do anything but cancel (§7.J).**
- **P8's second half — the emphasis — is convergent as a failure, 2 of 3.** `personas-web` puts
  `initialFocusRef` on the **red destructive button** (`ConfirmDialog.tsx:30,:87-93`), so Enter on
  open fires it. `vibeman` is ~12/12 destructive-as-the-only-filled-control and 0/12 focus Cancel.
  `ascent` is the sole counterexample and **had to fight its own Modal to get there** — Cancel is
  first in DOM, carries `autoFocus` (`:86`), *and* a parent effect re-lands focus on it after the
  Modal's own panel-focus effect (`:114-118`), with the reason at `:18-20`: *"a stray Enter dismisses
  instead of fires."* Even there, the destructive button remains the color-primary one, 6/6.
- **P9 has ONE external warrant.** `ascent`'s `retestConfirm` (`ConfirmAction.tsx:182-190`) names a
  metered cost in the dialog — *"spends one slot from your weekly scan quota… a moved repo runs —
  and bills — a full re-score"* — and it is asserted in a test (`ConfirmAction.test.tsx:89`).
  Nobody else in five repos puts a price on a gate. Personas, whose gated actions cost real API
  dollars, is at zero (§7.D).
- **P10 is convergent as a failure — 3 of 5, and nobody discloses it.** `personas-cloud` (default,
  `prompt.ts:727,742`), `vibeman` (`claude_cmds.rs:525`, `process_cmds.rs:60`, every headless spawn;
  `claude_cmds.rs:681` notes interactive mode is the only exception) and this repo (13 sites).
  In all three, the flag is set for an operational reason and the responsibility it transfers is
  never stated on any user-facing surface.
- **C4's sub-result, which changes the severity of §7.A: where a consent banner exists, the
  error-telemetry SDK boots before it — 0 of 2.** `personas-web/sentry.client.config.ts:3` →
  `src/lib/sentry.ts:18` calls `Sentry.init({...})` unconditionally at module scope. **Corrected
  2026-08-17 by [usage-analytics](./usage-analytics.md): `main.tsx:304` here is NOT the same shape —
  it is `if (isTelemetryEnabled()) initSentry(…)`, a real gate, with the actual `Sentry.init` at
  `sentry.ts:200` inside it.** The conclusion survives on a sharper mechanism, and the mechanism
  changes the fix: `isTelemetryEnabled()` is `!== "false"`, so on a fresh install (key absent) the
  gate **defaults open** — telemetry is on not because the init is ungated but because the gate's
  default is the wrong way round. Don't move the init; flip the default. Only the bespoke
  `Sentry.metrics.count` helper is *additionally* consent-gated. So
  §7.A is **not a Personas mistake — it is the shape the mistake takes in every repo that ships a
  consent banner over a client SDK**, and the fix is the same in both. `brainiac` is the honest
  third answer: it declines to have a banner *by argued decision*, choosing cookieless analytics
  precisely so that *"no consent banner is required"* (`console/src/analytics/config.ts:1-13`), with
  a docblock warning that swapping the tool invalidates the position.

**Silence, reported as silence.** **Type-to-confirm does not exist in any of the five repos — 0/5.**
Not for `vibeman`'s "permanently drop tables" (`MigrationTimeline.tsx:261`), not for its project
delete, and not for `ascent`'s 25-repo PR fan-out. `requireTypedConfirmation` is therefore a
**house convention of this repo, not doctrine**, and §2 recommends it on internal reasoning alone.
An adopting repo should feel free to omit it and should not read its absence as a gap.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "add an *Are you sure?* before this deletes"
- "we should ask the user first" / "put a confirm on it"
- "first-run consent screen" / "telemetry opt-in" / "accept the terms"
- "the agent should ask before it sends the email / pushes the commit / spends the money"
- "add an approval card for this" / "let them approve it from their phone"
- "turn on autonomous mode" / "let it just do it" / "auto-approve the low-risk ones"
- **The "about to write X" test:** you are about to type `window.confirm(`, `if (!confirm(`,
  `<ConfirmDialog title={…} body={t.some.static_key}`, `confirm({ title, message, onConfirm })`
  with no `details`/`blastRadius`, `--dangerously-skip-permissions`, `requires_approval: false`,
  a `status = 'pending'` column with no `expires_at` beside it, or an `approve_*` function you are
  about to call from a background task.

You are **not** in this situation when the user is pressing the button that *is* the action (a
manual "Run now" — `system_ops.rs:135-136` says a human pressing it *is* the approval), when the
question is which overlay primitive to compose ([modals](./modals.md)), or when the question is
whether an unattended lane was allowed to start at all ([autonomy-gating](./autonomy-gating.md)).
**The discriminator is that a human is being asked to authorise something they cannot undo or
would not expect** — so the whole subject is what they are told before they answer, and what
happens if they do not.

---

## 2. The one way

**Show the consequence, not the verb, and make the primitive demand it.** Reach for
`overlays/ConfirmDestructiveModal` through `useConfirmDestructive()` and fill in the fields that
name what will actually happen — `details` (the rows), `blastRadius` (what depends on it, fetched
live through `BlastRadiusPanelLazy`), `warningMessage`, and — a **house convention**, reinvented in
none of the five sibling repos, so weigh it yourself — `requireTypedConfirmation` for anything whose
loss is unrecoverable; today all four are optional and **4 of 7 configs pass none of them**,
which is why §9 gates the outer condition and §8 asks for the type change. For a plain
yes/no use `feedback/ConfirmDialog`, whose `onConfirm` may return a promise and which disables both
buttons and blocks Escape and backdrop while it is pending (`ConfirmDialog.tsx:39-55`) — never
`window.confirm()`, which is unstyled, untranslatable and blocks the WebView. **Interpolate the
subject into the copy**: `tx(t.x.confirm_body, { name })`, never a fixed key; the reference is
`SurfaceRenderer.tsx:142-151`, which shows the model's label *and the first 400 characters of the
prompt it is about to run*. **If the action costs money, put the number in the dialog** — the
estimate exists (`preview_execution`, `executions.rs:852`) and the panel that renders it exists;
mount it. **If the disclosure is written by the thing asking, show the parameters too and do not
collapse them** (`ApprovalCard.tsx:88-101` collapses them). **Escape, backdrop and close must all
cancel**, the safe button carries the emphasis, and a first-run consent that cannot be declined
must not be called consent. **Re-read the policy at fire time, from its durable home** — copy
`gate_remote_instruct` (`approval_exec_devices.rs:56-78`): a pure total function over `(standing
consent, target)` that the automatic path and the manual click both call, so *"a card created while
the mode was on and clicked after it was turned off is refused at the moment it fires"*
(`:31-35`). **Give every pending hold an expiry that WRITES** — a status transition with a reason,
in the same `CREATE TABLE` that creates the hold; a freshness window applied only at the read
leaves rows that no human and no machine can resolve (§0). **Ship revoke with grant, in the same
change**, and give it a UI; a capability you can only add is a latch. And **when you suppress the
platform's own permission prompt, say so on the surface that dispatches the work** — `skipPermissions`
is passed silently through `DispatchChooserModal` (`DispatchChooser.tsx:115`) and hardcoded `true`
at `skillsWorkbenchData.ts:255`, and neither tells the operator.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
| --- | --- |
| **`src/features/shared/components/feedback/ConfirmDialog.tsx`** | The themed yes/no. **Its `onConfirm` may return a promise, and while it is pending both buttons are disabled, `aria-busy` is set, and backdrop/Escape dismissal is ignored** (`:39-55`) — the double-submit guard the destructive sibling does not have. Cancel is first in the DOM and unstyled; confirm is the coloured one. `danger` swaps sky for rose. 21 call sites. |
| **`src/features/shared/components/overlays/ConfirmDestructiveModal.tsx` + `useConfirmDestructive()`** | The disclosure-capable confirm: `details` rows, `warningMessage`, `requireTypedConfirmation` (typed value must match exactly before the button enables, `:57`), and a domain-free `blastRadius: ReactNode` slot so the primitive stays free of feature imports. The hook owns open/config state so call sites never do. **Every disclosure prop is optional — see §8.1.** |
| **`src/features/overview/components/BlastRadiusPanel.tsx` — `BlastRadiusPanel` · `useBlastRadius` · `BlastRadiusPanelLazy`** | **The impact answer, and the thing this leaf is named for.** Fetches `BlastRadiusItem[]` on mount, renders one amber row per dependent object with a category icon (automation, trigger, subscription, execution, chain, rotation, memory, credential), and — importantly — renders an explicit *"safe to delete"* line when the list is empty rather than nothing. `BlastRadiusPanelLazy` exists precisely for the imperative `confirm({…})` config that has to build a `ReactNode` at click time. **3 consumers.** |
| **`src/features/shared/components/surface/SurfaceRenderer.tsx:142-151`** | **The reference call site.** The consent gate over a model-composed run button: `body={tx(t.shared.surface.confirm_run_body, { label, prompt: prompt.length > 400 ? … })}` — it shows the user *the actual prompt that will be sent*, truncated, not a description of it. Its comment at `:138` names the invariant: *"Consent surfaces — the ONLY paths from a rendered button to work."* |
| **`src/features/shared/dispatch/DispatchChooser.tsx`** | Consent as an **editable** artefact: the prompt is `useState(request.prompt)` bound to a textarea, so the user amends what they are authorising rather than accepting or refusing it whole. Four transports, one busy lock, `toastCatch` on failure. |
| **`src/features/settings/shared/useConfirmClick.ts`** | The in-place confirm for a row action: first click arms, second commits, auto-reverts after 3 s, timer ref-tracked and cleared on unmount so a row that disappears mid-window never sets state on an unmounted component. Correct for low-stakes row actions where a modal is disproportionate. 3 call sites. |
| **`src/features/vault/…/desktop/CapabilityApprovalCard.tsx`** | **The best disclosure surface in the frontend.** For each capability the connector requests it renders the human-readable label, the description, and a low/medium/high risk dot **and** badge, plus the allow-listed binaries. Backed by `CAPABILITY_INFO` (`api/system/desktop.ts:14-57`) and mirrored in Rust by `DesktopCapability::description()` / `::risk_level()` (`desktop_security.rs:42-63`). **1 render site** (`DiscoveryAppList.tsx:87`). |
| **`src-tauri/src/commands/companion/approvals/approval_exec_devices.rs:56-78` — `gate_remote_instruct`** | **The consent rule as a pure total function over a closed product type**, `(autonomous: bool, target.is_home: bool)` → `Autofire | NeedsApproval | Refused(reason)`, unit-tested in all four combinations (`:309`). Both the automatic path and the manual click call it, so consent is re-evaluated **at fire time**; the module header states the property (`:31-35`). The refusal string tells the operator exactly which two settings would change the answer. |
| **`…/approvals/approval_lifecycle.rs:292-326` — `load_pending`** | The claim + freshness gate in one: refuses a non-`pending` row, refuses a row older than `APPROVAL_FRESHNESS_WINDOW`, then does an atomic `pending → running` CAS and checks `changed == 0`. **The only consent-expiry rule in the tree.** Its defect is that it is the only place expiry happens (§0, §7.C). |
| **`…/approval_lifecycle.rs:137` — `execute_approval_action`** | One executor table for both consent paths, with the reason at `:130-134`: *"autonomous mode changes whether a human clicks, never what an action does, so neither path can drift into a different capability set."* Copy this discipline for any auto-approve you add. |
| **`src-tauri/src/companion/connectors.rs:48-60` — `ConnectorCapability.requires_approval`** | **The capability-level classification: 10 of 25 capabilities require a card**, chosen by the rule *"any capability that writes to a user-visible external surface"*. Worth reading for the provenance note at `:57-59` — the classification was proposed by the model being gated, during a 2026-05-27 audit. |
| **`src-tauri/src/commands/fleet/external.rs:118-141` — `fleet_spawn_external_console`** | The one escalation in the tree expressed as a **parameter with a safe default** (`skip_permissions.unwrap_or(false)`) and a written justification for why the default differs from the Fleet lane's. |
| **`src/features/shared/components/overlays/FirstUseConsentModal.tsx`** | The first-run disclosure: nine accordion sections (AI, storage, third-party services, monitoring, P2P, foraging, process spawning, telemetry, deploy), a plain-language reassurance block placed **above** the admin-grade detail, four hard warnings above the accordions, a version literal (`CONSENT_VERSION = '3'`) that re-prompts on a bump with the changed sections force-opened, and `onClose={noop}` so it cannot be dismissed. **Its defects are §7.A.** |

**Do not exist — this path names them:**

- **Any revoke UI for a granted desktop capability.** `revoke_desktop_approvals` is a registered
  Tauri command (`lib.rs:2372`) with **no wrapper in `src/api/` and no call site in `src/`**. The
  only occurrences outside Rust are `commandNames.generated.ts:1344` and the `ipc_auth` allowlist.
- **Any sweep that expires a non-`fleet_` `companion_approval` row.** §0.
- **Any consent record for the desktop-capability grant that a user can inspect.**
  `desktop_connector_approvals` holds `(connector_id, capability, approved_at)` and has **0 rows**;
  nothing lists it.
- **Any type distinguishing "the user authorised this" from "a background task authorised this."**
  Both reach `execute_approval_action` with identical arguments.
- **Any cost figure on any confirmation.** `ExecutionPreviewPanel` is unmounted (§0); no other
  dialog in 4,829 files renders a dollar amount before the action.

---

## 4. Steps

1. **Write down the consequence in one sentence before you write the dialog**, in the user's
   units: how many rows, whose data, which external surface, how much money, and whether it comes
   back. If you cannot write that sentence, you do not yet know what you are asking permission for,
   and the dialog will say "Are you sure?".
2. **Decide reversible or not.** Reversible with an undo → do not gate at all; ship the undo.
   Irreversible and cheap → `ConfirmDialog` with the subject interpolated. Irreversible and
   expensive/destructive → `ConfirmDestructiveModal` with `details` **and** `blastRadius`.
   Unrecoverable → add `requireTypedConfirmation`.
3. **Fetch the impact before you render the dialog, not after.** `useBlastRadius(fetcher, enabled)`
   inside the host, or `<BlastRadiusPanelLazy fetcher={…} />` inside an imperative `confirm({…})`
   config. The panel renders its own loading and its own explicit "safe to delete" — an empty
   impact list is information, not an empty state.
4. **Interpolate the subject.** `tx(t.section.confirm_body, { name: row.name, count: n })`. A fixed
   key is the tell that the dialog was written before anyone knew what it would delete.
5. **If it spends money, put the number in the dialog** — `previewExecution(personaId, input,
   useCaseId)` returns `estimated_total_cost`, `estimated_input_tokens`, `estimated_output_tokens`,
   `monthly_spend`, `budget_limit`, `model`, `memory_count`, `tool_count`. Render "no limit", not a
   percentage, when `budget_limit` is 0 — the current expression yields `0%` (§7.D).
6. **Wire dismissal to cancel, explicitly.** `onCancel`/`onClose` must be the refusal. Never pass
   the action as `onClose`; never leave `onClose` empty on a dialog that has a pending state.
7. **Put the emphasis on the safe option** unless the dialog's entire reason for existing is the
   dangerous one — and then still put the safe option first in the DOM, so Tab lands on it.
   `ApprovalCard` puts Approve first and `variant="primary"` (`:118-127`); that is a deliberate
   product choice for a proposal card, and it is the exception, not the pattern.
8. **Ask the type question now, before §9.** Can the primitive's signature make an undisclosed
   confirmation impossible? For this leaf the answer is yes and it is one prop — see below.
9. **On the backend, write the rule as a pure total function over the states that matter** and call
   it from *both* the automatic path and the manual click. `gate_remote_instruct` is the shape.
   Never capture the policy into the row at proposal time.
10. **Give the hold an expiry that writes a row**, in the same `CREATE TABLE`. Decide what expiry
    means (refuse / approve / escalate) and make it the same answer as every other hold in the app
    — this repo currently has **five** different answers (§7.C).
11. **Ship revoke in the same change as grant, with a UI**, and record the grant somewhere the user
    can read it back.
12. **Then count the other doors.** Grep every caller of the executor your dialog fronts. Background
    subscriptions, autopilots, test harnesses, cloud routes. Each one is a way to satisfy your gate
    without a human, and each is invisible from the dialog's file.
13. **And then stop.** Overlay mechanics are [modals](./modals.md); whether the unattended lane was
    allowed to run is [autonomy-gating](./autonomy-gating.md); what the delete does to the rows is
    [delete-semantics](./delete-semantics.md).

### Can the type make the wrong call impossible? — asked before §9

**Partly, and the interesting part is which half.**

The proposed edit is one line in `ConfirmDestructiveModal.tsx:11-34`: make the impact
**required** rather than optional, as a closed union —

```ts
type Impact =
  | { kind: 'rows'; details: { label: string; value: string }[] }
  | { kind: 'blastRadius'; node: ReactNode }
  | { kind: 'none'; because: string };   // and you must say why
export interface ConfirmDestructiveConfig {
  title: string; message: string; impact: Impact;   // <- no longer optional
  …
}
```

Held against the doctrine's seven qualifications:

- **Q1 — a required prop carries only what it encodes.** `impact` encodes "the author considered
  the consequence", not "the consequence is correct". A caller can pass `{kind:'none', because:'x'}`
  and be as uninformative as today. What it *does* buy is that the omission becomes a written,
  reviewable claim instead of a missing line — which is exactly the `FacetedDecisionTable`
  `emptyTitle` result the contract cites (3/3 real copy vs 5-of-20 fallthrough).
- **Q2 — requiredness ≠ closedness.** Both are needed here and they are different edits. Required
  `details?: {label,value}[]` would still admit `[]`. The union is what closes it.
- **Q3 — a type nobody constructs constrains nothing.** `ConfirmDestructiveConfig` has **7**
  construction sites across 4 files (`PersonaOverviewActions.tsx:47,:112,:130`,
  `DeadLetterTab.tsx:336,:389`, `AdoptionWizardModal.tsx:128`, `CredentialDeleteDialog.tsx:41`).
  Small, enumerable, real — and
  small enough that the type is cheap to land and **too small to be the whole answer**, which is
  why §9 gates the outer condition instead.
- **Q4 — a type anyone can construct authenticates nothing.** `{kind:'none'}` is trivially
  constructible. This type raises the cost of silence; it does not forbid it. Honest limit.
- **Q5 — withholding beats requiring.** The applicable qualification, and it points somewhere
  else entirely: the strongest edit in this leaf is not on the dialog, it is on
  `--dangerously-skip-permissions`. Twelve of the 13 sites *hold the flag as a constant*; the one
  that *withholds it behind a parameter defaulting to false* is the one whose author had to think
  about it. Convert the other twelve to a `PermissionMode` parameter and the reasoning becomes
  mandatory at each site.
- **Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is "render a
  destructive confirmation that names nothing", not "render a destructive confirmation". Taking
  away the modal would just push callers to `window.confirm` — which is what the 5 survivors
  already did.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.**
  Applies to the copy: a caller passing a static `t.x.y` as `body` is choosing to be vague. No
  signature reaches inside an i18n key. That half is ungateable by type and is the §9 residue.

**Where the type does not reach**, three places, all measured:

1. **Into the i18n key.** `body={t.x.confirm}` and `body={tx(t.x.confirm,{name})}` have the same
   type. 6 of 21 `ConfirmDialog` sites are the first form.
2. **Across the `useState` boundary in a hand-rolled confirm.** The 12 §9 files have no
   confirmation object at all — there is no signature to require anything of.
3. **Into `companion_approval.payload`.** The approval's disclosure is a `TEXT` column holding
   model-authored JSON. No Rust or TS type reaches inside it, which is why P2's fix is a *layout*
   decision (do not collapse the params) rather than a type.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`window.confirm(...)` / bare `confirm(...)`** | Unstyled, unthemed, blocks the WebView, ignores the modal stack, and cannot render an impact list. **5 survivors**: `ReferenceBoard.tsx:104` (clears the whole board), `ToneAtelier.tsx:115`, `ToneBaseline.tsx:75`, `ToneConsole.tsx:78`, `GoalDetailDrawer.tsx:281`. |
| **A confirmation whose copy is a fixed string** | It names the verb and not the subject, so the user answers from memory of what they clicked. **6 of 21** `ConfirmDialog` sites. |
| **A destructive confirm with no impact** | The user authorises a deletion whose dependents they cannot see. `blastRadius` reaches **2 of 7** `ConfirmDestructiveConfig` constructions and **4 of 7 pass no impact of any kind**; `useBlastRadius` has **3** consumers in the whole tree. |
| **An `onConfirm` typed `() => void`** | No promise, so no busy state, so no `aria-busy`, no disabled buttons, and failure has nowhere to surface. `ConfirmDestructiveConfig.onConfirm: () => void` (`:32`) while its sibling `ConfirmDialog` types the same field `() => void | Promise<void>` and implements the whole guard. **Two confirm primitives in one folder, opposite decisions.** |
| **A first-run consent with one button** | `FirstUseConsentModal` has Accept and nothing else; `onClose={noop}`. There is no decline, so the checkbox is an acknowledgement, not a choice — and calling it consent overstates what was obtained. |
| **A telemetry checkbox that defaults to checked** | `useState(true)` (`:142`) plus `isTelemetryEnabled()` returning `true` when the key is **absent** (`telemetryPreference.ts:17`) means the opt-out is the default in both directions. |
| **Initialising the thing you are asking permission for before you ask** | `main.tsx:304` runs `if (isTelemetryEnabled()) initSentry(…)` at module scope; the consent modal renders from `App.tsx:334`, inside a tree that has already wired the store bus, the event bridge, execution middleware, auth, and (behind idle) session bootstrap and template seeding. **On a fresh install the key is absent, so telemetry is on before the modal exists.** |
| **Consent stored in `localStorage`** | `CONSENT_KEY`/`TELEMETRY_KEY` are WebView-local strings. Clearing site data silently revokes consent *and* re-enables telemetry (absent → true), and nothing server- or DB-side records that a human ever accepted. |
| **A standing-consent switch with no disclosure** | An `IconToggle` whose tooltip is "autonomous on/off" grants all 53 actions including outbound email and message posting (§0). The paragraph explaining that lives in `approval_autopilot.rs:11-51`. |
| **Approving on behalf of the user in a flow labelled "Approve"** | `useOnboardingState.ts:162-164` — `getDesktopConnectorManifest(name)` then `approveDesktopCapabilities(name, manifest.capabilities)`: **every capability the manifest asks for, granted, none displayed.** The good card exists (`CapabilityApprovalCard`) and onboarding does not use it (§7.B). |
| **A prose rationale written by the requester, with the parameters collapsed** | `ApprovalCard.tsx:84-101`: `approval.rationale` (Athena's own sentence) is the visible copy; the params JSON is inside a `<details>` that starts closed. The only ground truth is the part behind a disclosure triangle. |
| **A freshness window applied at the read** | §0. 8 rows `pending` at 5.8 days: not listed, not executable, not rejectable, not swept. |
| **Grant without revoke** | `approve_desktop_capabilities` has an API wrapper and 2 UI call sites; `revoke_desktop_approvals` has **zero** of either. |
| **Passing a permission-escalation flag through a UI that does not mention it** | `DispatchChooser.tsx:115` forwards `consoleSkipPermissions` and the modal renders nothing about it; `skillsWorkbenchData.ts:255` hardcodes `skipPermissions: true` with the justification in a code comment. |
| **Reading the row's status, checking it in the host language, then writing without the filter** | Fixed on 2026-08-16 (`1ad67db14`) but worth keeping: `remote_command_approve` PATCHed `pending_commands?id=eq.{id}` with no `status` term, so **two approvals of one request ran the agent twice, two bills**. The exclusivity has to live in the WHERE clause (`remote_commands.rs:280-300`). Its sibling `remote_command_reject` had neither the device nor the status term until the same day (`:361-379`). |

---

## 6. Evidence

### The one site to copy: `src/features/shared/components/surface/SurfaceRenderer.tsx:138-151`

```tsx
{/* Consent surfaces — the ONLY paths from a rendered button to work. */}
{pendingRun && (
  <ConfirmDialog
    title={t.shared.surface.confirm_run_title}
    body={tx(t.shared.surface.confirm_run_body, {
      label: pendingRun.label,
      prompt: pendingRun.prompt.length > 400
        ? `${pendingRun.prompt.slice(0, 400)}…`
        : pendingRun.prompt,
    })}
    confirmLabel={t.shared.surface.confirm_run_action}
    onConfirm={() => confirmRun(pendingRun)}
    onCancel={() => setPendingRun(null)}
  />
)}
```

Four properties make it the reference, and none of them is the primitive:

1. **It shows the artefact, not a description of it.** The user reads the literal prompt that will
   be sent — the strongest possible answer to P1 for a model-composed action.
2. **It bounds the disclosure** (400 chars) rather than either dumping or omitting it.
3. **Its comment states the invariant it is defending** — that this dialog is the *only* path from
   a rendered button to work — which is what makes the file auditable.
4. **`onCancel` is a pure state reset.** Dismissal is refusal, unambiguously.

### The backend one to copy: `approval_exec_devices.rs:56-78` — `gate_remote_instruct`

```rust
pub(crate) fn gate_remote_instruct(autonomous: bool, target: &OwnedDevice) -> RemoteInstructGate {
    match (autonomous, target.is_home) {
        (true, _)      => RemoteInstructGate::Autofire,        // standing consent
        (false, true)  => RemoteInstructGate::NeedsApproval,   // file a card
        (false, false) => RemoteInstructGate::Refused(format!( // refuse, and say why
            "With autonomous mode off I only send work to your home device. \"{}\" is paired \
             but is not the home device. Set it as home under Settings > Devices, or turn \
             autonomous mode on, if you meant it.", target.display_name)),
    }
}
```

Total over a closed product type, pure, tested in all four combinations, and called by **both**
paths — `execute_remote_instruct:166` (the click) and `auto_resolve_remote_instruct:200` (the
autofire). The module header states the resulting property outright: *"A card created while the
mode was on and clicked after it was turned off is refused at the moment it fires, not at the
moment it was proposed. The gate reads the persisted autonomous-mode row rather than trusting a
flag passed down the call chain, so there is no caller that can assert its way past it."* That is
P3 implemented, and it is the only implementation of P3 in the tree.

Also exemplary:

- **`CapabilityApprovalCard.tsx:39-72`** — per-capability label, description and a risk badge from
  a shared `CAPABILITY_INFO` map, plus the allow-listed binaries. The risk vocabulary exists in
  both languages from one source of intent (`desktop_security.rs:42-63` ↔ `api/system/desktop.ts:14`).
- **`BlastRadiusPanel.tsx:40-45`** — the empty case renders *"safe to delete"* rather than nothing.
  An absent impact list and a *verified-empty* impact list are different facts and the panel says
  so.
- **`ConfirmDialog.tsx:39-55`** — `handleConfirm` guards on `busy`, awaits the promise, and
  re-enables in `finally` with the reasoning in the comment (*"If it stayed open (e.g. the action
  threw), re-enabling lets the user retry"*).
- **`DispatchChooser.tsx:88-93`** — consent you can edit: the prompt is bound to state, so the user
  amends the thing they are authorising.
- **`useConfirmClick.ts:22-27`** — the timer is ref-tracked and cleared on unmount, with the reason
  (a row that disappears mid-window).
- **`companion/connectors.rs:48-59`** — the rule for *which* capabilities need a card, stated as a
  rule rather than as a list: *"any capability that writes to a user-visible external surface"*.
- **`untrusted-definition-validation.md` §7.D** → `BundleImportDialog.tsx:59,:90-92`, which
  invalidates a `dangerConfirmed` consent whenever `bundle_hash` / `signer_trusted` /
  `signature_valid` changes. **Consent invalidated by a change in what was consented to** — the
  frontend does this and the backend does not.

### What the live databases hold

Read-only copies, 2026-08-16 14:13:

- **`companion_approval`: 120 rows** — `approved` 83, `rejected` 17, `approved_failed` 12,
  `pending` 8. All `kind = 'op_execute'`. Resolve latency, computed per row:
  **62 of 83 approvals in under 3 seconds, minimum 0 s**, mean 3,189 s (a long tail of genuinely
  human clicks, max 35.6 h). Rejections tell the opposite story: **minimum 38 s**, mean 4.7 days,
  max 12.3 days — *a rejection has never been faster than 38 seconds, and an approval's median is
  machine speed.* The 8 pending are all `backlog_apply_triage`, all created 2026-08-10 17:42, all
  **5.8 days old** and past the 24-hour freshness window in both directions.
- **`desktop_connector_approvals`: 0 rows.** The capability-consent table has never held a grant on
  this install — and there is no UI to revoke one if it had.
- **`persona_manual_reviews`: 194 rows, 0 pending** — 174 `approved`, 20 `resolved`.
- **`pending_trigger_fires`: 0 rows** — the per-trigger `approval` hold has never held anything.
- **`trusted_peers`: 0**, **`team_member_trust`: 0**, **`policy_proposals`: 0**,
  **`twin_pending_memories`: 0**, **`tool_execution_audit_log`: 0.** Five consent/trust surfaces
  with a table and no traffic.
- **`personas`: 78 rows, `max_budget_usd IS NULL` on all 78**; **`persona_executions`: 2,188.**
  No execution has ever run under a dollar ceiling, so no confirmation could have quoted one.
- **`app_settings`: 33 rows.** `companion_autonomous_mode = 'true'`. **No consent key of any kind**
  — first-run acceptance and the telemetry preference both live only in the WebView's
  `localStorage`.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every item below is the same omission:
> **the app asks "do you want to do this?" and never answers "here is what that does".** Asked at
> the dialog it produces §7.A/B/D — a consent screen over a running app, a grant with nothing
> displayed, a price nobody sees. Asked at the queue it produces §7.C — a hold with an expiry rule
> that reads and never writes. Asked at the executor it produces §7.E — a gate with a second door.
> The app answers it well exactly three times: `SurfaceRenderer` shows the prompt,
> `CapabilityApprovalCard` shows the permissions, `BlastRadiusPanel` shows the dependents. Two of
> the three have one render site each.

### 7.A — P0: the first-run consent is a modal over an app that has already started, and the thing it asks about is already on

| Path | Fact |
|---|---|
| `src/main.tsx:298-320` | module-scope IIFE: `if (isTelemetryEnabled()) { initSentry(appVersion); … initAnalytics(useSystemStore.subscribe); }` |
| `src/lib/telemetryPreference.ts:15-20` | `isTelemetryEnabled()` = `localStorage.getItem(TELEMETRY_KEY) !== "false"` — **absent reads as enabled**, and the `catch` also returns `true` |
| `src/App.tsx:334` | `{!consented && <FirstUseConsentModal … />}` — rendered as a sibling of `<TitleBar/>`, `<FleetActivityStrip/>`, `<UpdateBanner/>` and the routed content, inside a tree whose `useEffect` has already run `initStoreBus`, `initAllListeners`, `registerAllMiddleware`, `useAuthStore.initialize()` and (behind `requestIdleCallback`) `bootstrapActiveBuildSessions` + `seedCatalogTemplatesOnce` |
| `FirstUseConsentModal.tsx:142` | `const [telemetryChecked, setTelemetryChecked] = useState(true)` |
| `FirstUseConsentModal.tsx:146-151` | `handleAccept` = `persistConsent(); setTelemetryEnabled(telemetryChecked); onAccept();` — the key is written **only on accept**, so before first accept the preference is "absent", i.e. on |

So on a fresh install the sequence is: Sentry initialises → analytics subscribes → the app boots →
the consent modal appears asking whether Sentry may initialise. The modal has one button and cannot
be dismissed (`onClose={noop}`), which makes the ordering invisible rather than harmless: there is
no path where the user's answer precedes the behaviour.

Three smaller defects in the same file:

1. **No decline.** Accept is the only action; `acknowledged` gates it. A consent with no refusal
   branch is an acknowledgement.
2. **Hardcoded English inside the consent modal.** `:171-175` — *"We've updated our disclosures.
   Please review the changes before continuing."* is a string literal in a 14-locale app, in the
   one surface where comprehension is the entire point. Every other string in the file is `c.*`.
3. **Turning telemetry off mid-session is partial and the code knows it.**
   `analytics/sink.ts:106-113`: *"Sentry error reporting and the navigation subscription are
   established once at startup … enabling telemetry that started OFF this session still needs a
   restart."* `AccountSettings.tsx:47-54` calls `applyTelemetrySink(next)` and shows a note. The
   *off* direction stops usage events but not error reporting.

**Fix:** move the `initSentry`/`initAnalytics` block behind an explicit
`storedConsentVersion() !== null && isTelemetryEnabled()`, so absence means *not yet asked* rather
than *yes*; default the checkbox to unchecked; add a Decline that quits or runs in a
no-telemetry mode; extract the version-bump string.

### 7.B — P0: onboarding's "Approve" grants every capability the manifest asks for and displays none of them

```ts
// src/features/onboarding/components/useOnboardingState.ts:159-176
const handleApproveApp = useCallback(async (connectorName: string) => {
  const manifest = await getDesktopConnectorManifest(connectorName);
  if (manifest) {
    await approveDesktopCapabilities(connectorName, manifest.capabilities);
  }
  …
```

`DesktopDiscoveryStep.tsx:118-170` renders a row per detected app with the app name, version, a
running dot, an "Approve" button — and a risk badge driven by
`const HIGH_RISK_APPS = new Set(['desktop_docker'])` (`:37`). Nothing else. Meanwhile the manifests
(`desktop_security.rs:437-583`) say:

| connector | capabilities granted by that one click | badged high-risk? |
|---|---|---|
| `desktop_terminal` | `ProcessSpawn` + `FileRead` + **`FileWrite`** + `EnvRead`, allow-listing `bash`, `sh`, `zsh`, `powershell.exe`, `pwsh.exe`, `cmd.exe` | **no** |
| `desktop_vscode` | `ProcessSpawn` + `FileRead` + `NetworkLocal` | no |
| `desktop_docker` | `ProcessSpawn` + `NetworkLocal`, ports 2375/2376 | yes |

The app that grants shell spawn **plus file write** is the one the badge does not mark. And the
correct surface already exists: `CapabilityApprovalCard` renders each capability with its
description and a per-capability risk badge, and the vault flow
(`DesktopDiscoveryPanel.tsx:73-98` → `DiscoveryAppList.tsx:87`) uses it. Onboarding — the first
run, the least-informed user — is the flow that does not.

`DesktopCapability::description()` and `::risk_level()` (`desktop_security.rs:42-63`) carry the doc
comment *"Human-readable description for the approval UI"* and *"Risk level for UI display"*, and
they are reachable from onboarding through the same `CAPABILITY_INFO` map already imported by the
vault card.

**Fix:** render `CapabilityApprovalCard` in the onboarding step before calling
`approveDesktopCapabilities`; derive the risk badge from `max(CAPABILITY_INFO[c].risk)` over the
manifest instead of a two-element hardcoded set.

### 7.C — P1: five different answers to "what if the human never answers", and the newest one cannot answer at all

| Hold | Policy | Live |
|---|---|---|
| `team_assignments.status='awaiting_review'` | **none** — no `expires_at`, no sweep | 11 rows, 59.6–68.3 days ([autonomy-gating](./autonomy-gating.md) §7.E) |
| `persona_manual_reviews` | auto-triage after 60 min (low/medium) **and** an unconditional 7-day GC at every launch | 194 rows, 0 pending; 148 auto-approved, 20 GC-resolved |
| `companion_approval`, `fleet_*` actions | `gc_stale_fleet_approvals` → `rejected` at 30 min, or immediately if the target session left the registry (`fleet_bridge.rs:1689-1760`) | works |
| `companion_approval`, everything else | **freshness enforced only at the read** (`APPROVAL_FRESHNESS_WINDOW`, 24 h) | **8 rows stuck at 5.8 days** |
| `pending_commands` (cloud) | poller marks `expired` with a device- and status-scoped PATCH (`remote_commands.rs:146-158`) | works |

The fourth row is the new one and the worst, because its mechanism is the *best*. `load_pending`
(`:292-326`) refuses a stale approval — correctly, with a reason. `companion_reject_action` calls
the same `load_pending` (`:277`), so **the reject path is refused by the same rule**. The result is
a terminal state that is not a status: rows that no user can see, no executor will run, and no
sweep will touch, forever.

**Fix:** one sweep, beside `gc_stale_fleet_approvals` and without its `fleet_` filter, that writes
`status='expired'` with a reason for any `pending` row older than the freshness window; and a
`companion_dismiss_approval` command that bypasses `load_pending`'s freshness check so the user can
clear one by hand. Then pick ONE expiry semantic for the app and give `team_assignments` the same
column.

### 7.D — P1: nothing in the app puts a price on a gate, and the one surface that could has no call site

- **`ExecutionPreviewPanel.tsx` has 0 render sites.** Verified by grep over 4,829 files: the only
  occurrences of the identifier are its own definition. `previewExecution` →
  `preview_execution` (`executions.rs:852`, registered `lib.rs:1959`) is a live command with no
  live consumer.
- **Its budget arithmetic cannot warn.** `:72-76`
  `budgetPct = preview.budget_limit > 0 ? ((monthly_spend + estimated_total_cost)/budget_limit)*100 : 0`,
  and the warning renders only `{(overBudget || nearBudget) && …}`. With **78 of 78 personas at
  `max_budget_usd IS NULL`**, `budget_limit` is 0, `budgetPct` is 0, and the branch is dead. The
  expanded view does the right thing (`fmtCost(budget_limit) : e.unlimited`, `:127`) — the compact
  row does not.
- **No other dialog in the tree renders a cost.** The confirmations that gate spend —
  `ApprovalCard` for `run_persona` / `run_arena` / `companion_breed_personas` /
  `companion_evolve_persona` / `evaluate_pattern`, and `DispatchChooserModal` for every Fleet and
  console dispatch — show an action label, a rationale and a prompt. None shows an estimate, a
  model, or a month-to-date figure, and `evaluate_pattern`'s own comment says it is
  *"Approval-gated because it spawns a reasoning session (cost)"* (`dispatcher.rs:424-428`).

**Fix:** mount `ExecutionPreviewPanel` beside the Run control and inside `DispatchChooserModal`;
change `budgetPct` to `null` when `budget_limit <= 0` and render `e.unlimited` in the compact row
too. The estimate exists; the panel exists; the gap is two imports and a ternary.

### 7.E — P1: the consent gate has a second door, and it is the one the live data went through

`companion_approve_action` (`approval_lifecycle.rs:75`) is the human door. `auto_resolve_if_allowed`
(`approval_autopilot.rs:69`) is the machine door into the **same** `execute_approval_action` table
— deliberately, and that part is right. What is not disclosed anywhere in the UI:

1. **The allowlist that used to bound the machine door is gone** (`:11-51`, 2026-08-10). Under
   autonomous mode the only remaining `Ok(false)` returns are the two fleet PTY actions below the
   boldness×class×confidence bar, and `remote_instruct` under its device rule. Everything else in
   the 53-action grammar fires.
2. **`use_connector` write capabilities are in that set.** 10 of 25 capabilities are
   `requires_approval: true` specifically because they *"write to a user-visible external
   surface"* — and under the mode they auto-fire. The module says so in as many words.
3. **`fleet_boldness`** (`chat.rs`) is a second, independent dial that decides which fleet actions
   auto-fire, read from settings at fire time (`approval_autopilot.rs:107`). Two dials, one
   consent model.
4. **A third door exists in test builds.** `src/test/automation/bridge.ts:1385-1391` exposes
   `deletePersona(personaId)` → `invoke('delete_persona')`, and `:890-902` `deleteAgent(nameOrId)`
   → `store.deletePersona(match.id)`. The bridge is loaded whenever `import.meta.env.DEV` **or**
   `window.__PERSONAS_TEST_MODE__` is set by Rust (`App.tsx:227-233`), and the HTTP server that
   drives it binds :17320 (`lib.rs:1551-1578`) — release builds without `--features test-automation`
   refuse it, which is the correct posture and worth keeping.

**Fix:** put the enumeration next to the switch. The `IconToggle` should open a one-time sheet
listing the action classes the mode covers — at minimum "sends messages/emails through your
connectors" and "applies backlog verdicts in batches of up to 30" — and Settings should show a
standing-consent summary with the same list. The paragraph is already written; it is in a Rust doc
comment.

### 7.F — P2: grant has a UI, revoke has neither a UI nor an API wrapper

| | grant | revoke |
|---|---|---|
| Tauri command | `approve_desktop_capabilities` (`desktop.rs:68`) | `revoke_desktop_approvals` (`desktop.rs:99`) |
| `src/api/` wrapper | `approveDesktopCapabilities` (`api/system/desktop.ts:73`) | **none** |
| UI call sites | 2 (`useOnboardingState.ts:164`, `DesktopDiscoveryPanel.tsx:91`) | **0** |
| store | `desktop_connector_approvals` (`connector_id, capability, approved_at`) | `DELETE … WHERE connector_id = ?1` (`desktop_security.rs:394-410`) |
| listing UI | none — nothing renders what has been granted | — |

The Rust half is complete and correct: `revoke` deletes the rows and evicts the in-memory
`RwLock<HashMap>`, and `check_permission` (`desktop_bridges.rs:37`) is a real enforcement point.
The user simply has no way to reach it. `is_desktop_connector_approved` is likewise wrapper-less
and call-site-less, so the app cannot even *show* that a grant exists.

**Fix:** three exports in `api/system/desktop.ts` and a section in the connector detail panel
listing granted capabilities with a per-connector Revoke. The backend is already done.

### 7.G — P2: what the escalation flag is doing is never on screen

`skipPermissions` reaches the UI in two places and is disclosed in neither:

- `DispatchChooser.tsx:110-117` — the console lane forwards `request.consoleSkipPermissions` into
  `spawnExternalConsole`. The modal renders the title, the method cards, the editable prompt and a
  dispatch button; the permission mode appears nowhere in the JSX.
- `skillsWorkbenchData.ts:244-256` — `runConsole` hardcodes `skipPermissions: true`, with the
  reasoning in a comment (*"a skill run walks the whole repo, and a prompt-per-file console is
  unusable"*). Sound reasoning; invisible to the operator, who sees a button labelled with a skill
  name.

This is the UI half of P10: the app suppressed the runtime's prompts, and the surface that
dispatches the work does not say so.

**Fix:** a single line in `DispatchChooserModal` under the console method card — the same shape as
`CapabilityApprovalCard`'s risk row — and the same on the workbench dispatch button.

### 7.H — P2: twelve feature components reach an irreversible IPC door with no consent step in the file

The §9 population, hand-verified 12/12. The sharpest:

| Site | What one click does |
|---|---|
| `plugins/dev-tools/sub_lifecycle/LifecyclePage.tsx:120` | `for (const tr of triggers) await deleteTrigger(tr.id, devClone.id);` — **every trigger on the project, in a loop** |
| `plugins/fleet/FleetPairDevice.tsx:72-79` | `revokeCompanionDevice(deviceId)` — un-pairs a phone; re-pairing needs the QR flow again |
| `settings/sub_byom/components/ByomApiKeyManager.tsx:175-186` | `deleteAppSetting(entry.def.settingsKey)` — deletes a stored provider key |
| `agents/sub_activity/ActivityModals.tsx:88-94` | `deleteMessage(selectedMessage.id)`; the child's Delete calls `onDelete()` directly (`MessageDetailModal.tsx:155`) |
| `vault/sub_credentials/…/gateway/GatewayMembersModal.tsx:176` | `removeMcpGatewayMember(credential.id, memberCredentialId)` |
| `vault/sub_credentials/…/features/RotationActivePolicy.tsx:96` | `deleteRotationPolicy(p.id)` |

Full list in §9's baseline. The remaining six are `PersonaIconPickerModal.tsx:133`,
`PersonaAssertionsSection.tsx:78`, `PatternGraphHost.tsx:509`,
`WebhookSubscriptionsPanel.tsx:126`, `N8nSessionList.tsx:139` and
`sub_lifecycle/LifecyclePage.tsx` (counted once).

### 7.I — P3: six confirmations name only the verb

`ConfirmDialog` sites whose title and body are both fixed keys:
`WidgetActionBar.tsx:132` · `PocketVoicePanel.tsx:192` · `WorkspacesAtlas.tsx:165` ·
`KpiDetailModal.tsx:95` · `TeamSlackBridgePanel.tsx:146` · `TeamStudioSplitVariant.tsx:222`.
Two of them (`WorkspacesAtlas`, `PocketVoicePanel`) already hold the entity in scope — the name is
one `tx()` away.

### 7.J — What this path CLEARED

Three things that looked like defects and are not:

1. **Dismissal never proceeds.** Every `ConfirmDialog` site passes an `onCancel` that is a pure
   state reset; `ConfirmDestructiveModal` routes `BaseModal.onClose` to `config.onCancel`
   (`:153-160`); `useConfirmClick`'s auto-revert disarms rather than commits. **0 sites where
   dismissing performs the action.**
2. **`ConfirmDialog`'s double-submit guard is real and complete** — busy blocks the confirm button,
   the cancel button, backdrop and Escape (`:39-55`), and the comment explains why it re-enables in
   `finally`.
3. **The remote-approval double-run is fixed and the fix is the right shape.** `remote_commands.rs:280-300`
   now claims with `status=eq.pending` inside the filter and reads the affected-row count through
   the new `patch_returning_count`; the reject path got the same treatment at `:361-379`. The
   comment at `:280-287` states the general rule — *"the check is necessary and NOT sufficient"*.

---

## 8. Gaps in the primitives

1. **`ConfirmDestructiveConfig` requires the verb and makes the consequence optional.**
   `title`/`message`/`onConfirm`/`onCancel` are required; `details`, `warningMessage`,
   `blastRadius`, `requireTypedConfirmation` are not. **4 of 7 configs pass no impact at all**, and only
   `PersonaOverviewActions.tsx:47-52` passes all three. This
   is the destination-defaults failure the contract's §9 note describes: routing a caller to the
   right primitive does not make the result informative.
2. **`ConfirmDestructiveConfig.onConfirm: () => void`** — no promise, therefore no busy state, no
   `aria-busy`, no place for a failure to surface, and the hook closes the modal synchronously
   before the action resolves (`:196-199`). Its sibling `ConfirmDialog` solved this in the same
   folder. The fix is to widen the type to `() => void | Promise<void>` and lift `ConfirmDialog`'s
   `busy` block into `ModalContent`.
3. **No shared "impact" type.** `BlastRadiusItem[]` exists and is good, but each host writes its own
   fetcher and each dialog decides whether to show it. There is no `useImpact(entityKind, id)` that
   a confirm can require.
4. **No cost slot on any confirmation.** Every ingredient exists — `preview_execution`,
   `ExecutionPreviewPanel`, `fmtCost` — and no primitive has a place to put them.
5. **No standing-consent registry.** `companion_autonomous_mode` is one boolean covering 53 actions
   and 10 write capabilities. There is no per-class opt-in, so the operator's only granularity is
   all-or-nothing, and the only description of "all" is a Rust doc comment.
6. **No consent ledger.** Grants are either a `localStorage` string (first-run, telemetry), a row
   in a table nothing renders (`desktop_connector_approvals`), or an `app_settings` boolean. There
   is no single surface answering "what have I authorised, and when?" — which is what would make
   §7.F's revoke discoverable.
7. **Expiry is per-queue.** Four queues, four policies, no shared TTL primitive. A
   `HoldPolicy { window, on_expiry: Refuse|Approve|Escalate }` used by all of them would collapse
   §7.C into one decision.
8. **No action class is un-auto-approvable, and no row records whether a human answered.** Both
   gaps have a sibling implementation worth copying wholesale: `brainiac/crates/brainiac-pipeline/src/policy.rs:30-32`
   makes one transition (`to == Canonical`) return `NeedsReview` **unconditionally**, under a named
   rule (`"canonical_requires_maintainer"`), so no confidence threshold and no flag can reach it;
   and `brainiac/crates/brainiac-store/src/governance.rs:300-304` writes `"approved"` when
   `applied_by.is_some()` and `"auto_approved"` when it is `None`, making humanness a **structural
   property of the audit row** rather than an inference from a note. Here, `companion_approval` has
   no `resolved_by` at all — §6's "62 of 83 in under 3 seconds" had to be reconstructed from
   timestamps because the row does not say who answered.

---

## 9. The missing gate

**The condition this signal is a proxy for:** *an irreversible operation is reachable from the UI
without the user being asked.* In this repo that condition wears a very specific costume — a `.tsx`
under `src/features/` that imports a `deleteX`/`removeX`/`revokeX`/`purgeX`/`wipeX`/`clearAllX`
binding from `@/api/` (the IPC boundary, so irreversibility is not a guess) while containing no
confirmation affordance anywhere in the file. **An adopting repo must re-derive its own proxy.**
Where the IPC layer is an HTTP client, the anchor is a `fetch(..., {method:'DELETE'})`; where
mutations are typed hooks it is `useDeleteXMutation`; where there is no api layer at all this
pattern scores zero while the condition is present at scale. The *portable* half is the head, the
anti-patterns and the intent — not this regex.

**Why this signal and not the obvious ones**, with the numbers that made me refuse them:

- **"An irreversible verb called straight from an `onClick`"** — the shape I expected to gate.
  Two implementations: a regex over whole-file content found **17 matches in 16 files**; a
  brace-matching handler scanner found **37 violating / 4 compliant**. Hand-reading the 17:
  `removeChip`, `removeRow`, `removeField` ×2, `removeCondition`, `removeTag`, `removeCustomValue`,
  `removePattern`, `removeLink`, `removeCapability` — **at most 3 of 17 are irreversible**;
  the rest edit an unsaved form. **~18% precision. Refused.** The verb vocabulary cannot separate
  "destroy a row" from "edit a draft", and the misses cluster exactly where the doctrine says they
  will.
- **"A confirmation whose copy names no subject"** — the leaf's own name, and the honest count is
  **6 of 21 (71% already compliant)**. Real (§7.I) but too small a base and too many legitimate
  subject-free confirms ("reset the board") to gate. **Refused; documented as a deviation instead.**
- **"`window.confirm`"** — **5 matches**, all true positives, but a 5-match rule buys almost
  nothing and the condition is nearly extinct. **Refused.**
- **Overlap check against the existing registry.** Ran the candidate against every rule whose
  anchor could collide: `verdict-write-outside-door` (`human-review-queue`, 6 files —
  review-verdict writes, disjoint), `ungatable-step-transition` (`multi-step-flow`, 5 files —
  `onClick` → `setStep`, different consequent), `stateless-disclosure-control` (`expandable-row`),
  `unwired-url-open-door` (`external-url-opening`), `autonomy-verdict-outside-the-front-door`
  (`autonomy-gating`, Rust only), `self-disabling-money-ceiling` (`spend-ceilings`, Rust only),
  `unverified-clipboard-write` (`copy-to-clipboard`). **Zero file overlap with any of them**;
  `delete-semantics.md` and `modals.md` have no census rule at all.

**Where it runs.** `lefthook.yml:74-75` — the `golden-path-census` **pre-push** job runs
`npm run census:check`, added 2026-08-16 with the note that the census had been *"enforced
NOWHERE"* before that. It is also inside `npm run check` (`package.json:52`). It is **not** in
`ci.yml`, which is the right call for a repo whose CI is currently red on unrelated Rust failures —
per this batch's calibration, a gate that only runs in CI effectively runs nowhere, and this one
runs on every push from the machine that made the change.

**Fail-loud, verified by injection** (six modes, all fire, exit 1 in every case):
floor raised to 99999 → *"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; pattern replaced with a
non-matching literal → *"matched zero files anywhere"* **and** a silent-drop drift error; baseline
5 → rise; baseline 40 → silent drop; a `baseline` added to the control → `validateRule` rejects it
before any file is walked; a stale `exclude` path → *"the exemption is stale"*.

**Correct end state is 0**, at which point **delete this rule** rather than baselining it at zero —
the runner treats a zero-match rule as broken, deliberately.

```json
{
  "id": "unconsented-irreversible-door",
  "goldenPath": "docs/concepts/golden-paths/informed-consent-gate.md",
  "title": "A feature component reaches an irreversible IPC door and the file contains no consent step at all",
  "roots": ["src/features"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "^(?![\\s\\S]*(?:ConfirmDialog|ConfirmDestructiveModal|useConfirmDestructive|useConfirmClick|UnsavedChangesModal|useUnsavedGuard|window\\.confirm|\\bconfirm\\s*\\(|confirm[A-Z]\\w*|Confirm[A-Z]\\w*|setConfirming|pendingDelete|requireTypedConfirmation))[\\s\\S]*?import\\s*\\{[^}]*?\\b(?:delete|remove|revoke|purge|wipe|clearAll)[A-Z][A-Za-z0-9_$]*[^}]*?\\}\\s*from\\s*['\"]@/api/",
    "flags": "g",
    "ignoreCommentLines": false,
    "description": "A rendering component under src/features imports an irreversible IPC door from @/api (deleteX / removeX / revokeX / purgeX / wipeX / clearAllX) and the whole file contains NO confirmation affordance of any kind. PROXY FOR the stack-free condition: an operation the user cannot undo is reachable from the UI without them being asked. Measured 2026-08-16 at 4f5621830: the anchor (an irreversible @/api import in a feature .tsx) matches 18 files; 12 have no consent step, 6 do — the positive control partitions the anchor exactly, 12 + 6 = 18. PRECISION 12/12 hand-read (each reaches a live delete_/revoke_ Tauri command from a click path with no dialog: LifecyclePage.tsx:120 deletes every trigger on a project in a loop; FleetPairDevice.tsx:75 un-pairs a device; ByomApiKeyManager.tsx:180 deletes a stored provider key). SCOPE is deliberately src/features/**.tsx: store slices, hooks and lib helpers legitimately carry no dialog, and including them took precision from 12/12 to 13/62. ignoreCommentLines is FALSE on purpose — the match is file-scoped and anchored at index 0, so the comment filter would look at line 1 and drop the count for any file that grows a JSDoc header. DO NOT key on the verb at the call site instead: an onClick-anchored variant of this rule scored ~3/17 because removeChip / removeRow / removeField edit unsaved form state. CORRECT END STATE is 0, at which point DELETE this rule rather than baselining it at zero. PRECONDITION (re-derive per repo, do NOT port): this repo spells irreversibility as a named import from a generated Tauri command wrapper. In a Next.js app it is fetch(..., {method:'DELETE'}) or a useDeleteMutation hook; in a Rust TUI it is a repo call; this pattern scores ZERO on all of them."
  },
  "baseline": { "files": 12, "matches": 12 },
  "floor": 1500
}
```

**The positive control** (merge with `baseline` omitted — a control that carries one is rejected by
`validateRule`, verified):

```json
{
  "id": "unconsented-irreversible-door-positive-control",
  "goldenPath": "docs/concepts/golden-paths/informed-consent-gate.md",
  "title": "CONTROL: the same anchor, pointed at the compliant form",
  "roots": ["src/features"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "^(?=[\\s\\S]*(?:ConfirmDialog|ConfirmDestructiveModal|useConfirmDestructive|useConfirmClick|UnsavedChangesModal|useUnsavedGuard|window\\.confirm|\\bconfirm\\s*\\(|confirm[A-Z]\\w*|Confirm[A-Z]\\w*|setConfirming|pendingDelete|requireTypedConfirmation))[\\s\\S]*?import\\s*\\{[^}]*?\\b(?:delete|remove|revoke|purge|wipe|clearAll)[A-Z][A-Za-z0-9_$]*[^}]*?\\}\\s*from\\s*['\"]@/api/",
    "flags": "g",
    "ignoreCommentLines": false,
    "description": "CONTROL for unconsented-irreversible-door. Same anchor, opposite verdict: the file imports an irreversible @/api door AND carries a consent step. Measured 6 files (ManualReviewList, MemoriesPageDense, MessageList, CompetitionCard, ApiKeysSettings, BrokerPanel), which together with the rule's 12 partitions the anchor's 18 raw matches exactly. A control near zero would mean the negative lookahead, not the anchor, is doing the discriminating."
  },
  "floor": 1500
}
```

**What the census cannot express here, and what to build instead.** Three of this document's five
largest findings are **absences**, and the runner ratchets presence:

- *"`ExecutionPreviewPanel` has zero render sites"* — an orphaned-component check. The general
  instrument is a script that lists exported React components under `src/features/` with no JSX
  usage anywhere; it would have caught this and is worth building once for the whole corpus.
- *"`revoke_desktop_approvals` has no `src/api` wrapper"* — a command-reachability check. The
  generated `commandNames.generated.ts` union is the perfect oracle: every registered command
  should either appear in an `invoke(...)` call in `src/` or be listed in an explicit
  backend-only allowlist with a reason. Same shape as `check-csp-hosts.mjs`, and the same reason
  it cannot be a census rule.
- *"8 approvals are pending past their own freshness window"* — a **runtime** invariant. Nothing
  static sees it. The right instrument is a startup assertion (or a health-panel row) that counts
  `companion_approval` rows older than `APPROVAL_FRESHNESS_WINDOW` and still `pending`; the number
  should be zero by construction once §7.C lands, and a non-zero value is the sweep having stopped.

---

## 12. Corrections to the brief

The brief was right about the shape and wrong or incomplete on five specifics. Recorded per the
doctrine, since the corrections are the deliverable.

1. **"`ConfirmDialog` and `BaseModal` are the mandated primitives; measure adoption against
   hand-rolled confirmations."** — The framing was wrong for this leaf, and following it would have
   produced a duplicate of [modals](./modals.md). Adoption of the *overlay* is fine; **it is the
   disclosure that is missing**, and the disclosure primitive is a third component the brief did
   not name (`BlastRadiusPanel`, 3 consumers). Measuring hand-rolled-vs-shared would have scored
   this repo well while every measured defect survived untouched. The leaf's own name —
   *"Naming exactly what a privileged action will read or write before it runs"* — is the better
   brief, and it is what §9 ended up keying on.

2. **"Three different answers to 'what if the human never answers'."** — There are **five**
   (§7.C), and the fifth is both the newest and the worst: `companion_approval`'s 24-hour freshness
   window is enforced at the *read* by `load_pending`, so a stale row is simultaneously invisible,
   un-approvable **and un-rejectable** — `companion_reject_action` calls the same helper. The brief
   counted the queues that had a policy; the interesting one is the queue whose policy has no
   write.

3. **"A remote-command approval is a consent gate; two of them ran the agent twice until
   yesterday."** — True, and **already fixed** at `1ad67db14` (2026-08-16), by the
   `job-claim-and-lease` composer. Re-verified: `remote_commands.rs:299` now filters
   `status=eq.pending` inside the PATCH and reads the affected-row count. Reporting it as live
   would have been wrong. What *is* still live and adjacent is that the same file's reject path was
   missing **both** the device and the status term until the same commit — i.e. the defect class was
   two-for-two in one file, which is the more useful fact.

4. **"Zero executions have ever run under a dollar ceiling, and a proxied budget read renders
   '0% of budget used'."** — Confirmed on the first half (78/78 personas `NULL`, 2,188 executions).
   The second half is *understated in one direction and overstated in the other*: the expression
   at `ExecutionPreviewPanel.tsx:72-76` does compute `0`, but the surface never renders `"0% of
   budget"` because the string is inside `{(overBudget || nearBudget) && …}` — it renders
   **nothing**, which is worse, because a visible `0%` is at least a testable claim. And it renders
   nothing anywhere regardless: **the component has no call sites at all.** A gauge that is wrong is
   a smaller problem than a gauge that was never mounted.

5. **"Does any consent decision get remembered, and can it be withdrawn?"** — The answer is sharper
   than "sometimes". **Four storage substrates, no ledger**: `localStorage` (first-run consent,
   telemetry), `app_settings` (autonomous mode), a DB table nothing renders
   (`desktop_connector_approvals`, 0 rows), and the approval rows themselves. Withdrawal exists in
   Rust for the one that matters and has **no `src/api` wrapper and no UI** (§7.F). The most
   interesting revocation semantic in the tree is not a revoke at all — it is
   `gate_remote_instruct` re-reading the persisted mode at fire time, so turning the switch off
   retroactively invalidates cards already filed under it (`approval_exec_devices.rs:31-35`). That
   is the pattern the rest of the app should copy, and no brief predicted it.

6. **The brief said `convergence: mixed`; the oracle says the mix is unusually informative and
   inverts two of my own draft clauses.** Two prescriptions I had written as doctrine are not:
   **type-to-confirm is 0 of 5** — reinvented nowhere, not even for `vibeman`'s "permanently drop
   tables" or `ascent`'s 25-repo PR fan-out — so it is now labelled a house convention in §2 and §5;
   and **re-evaluating consent at fire time (P3) has no external warrant at all**, so
   `gate_remote_instruct` is marked an untested invention rather than presented as the way. Going
   the other direction, one finding I had written as a Personas defect is **convergent physics-as-
   failure and should not be reported as local carelessness**: §7.A's "telemetry initialises before
   the consent modal renders" is byte-for-byte the shape of
   `personas-web/sentry.client.config.ts:3` → `lib/sentry.ts:18`. **0 of the 2 repos that ship a
   consent banner gate their error-SDK init on it.**

7. **The brief's implicit premise — that this repo would be measured against weaker siblings — is
   wrong on the central clause.** `ascent/src/components/ConfirmAction.tsx` does impact disclosure
   better than Personas does, and does it with *tests*: 6 of 6 confirmations name a computed
   consequence, one names a metered cost, one discloses batch truncation, and
   `ConfirmAction.test.tsx:15` asserts the copy *"states scope, not 'Are you sure?'"*. Personas has
   the better *primitive* (`BlastRadiusPanel` fetches live dependents; ascent's counts are passed
   in) and the worse *practice* (3 consumers; 4 of 7 destructive-confirm configs pass no impact). That
   inversion is the reason §9 gates the outer condition — the presence of a gate at all — rather
   than the quality of the copy: this repo's problem is not that its confirmations are badly
   written, it is that the good ones were built and then not used. `ascent` is also the only repo
   in the set where **revocation outnumbers granting** (≈5:3), which is the posture §7.F asks for.

**One further correction, to a neighbouring path.** [`modals.md`](./modals.md)'s Deviations section
lists `FirstUseConsentModal.tsx:154` under *"`containerClassName` override disables stack-aware
z-index"*. That is factually right and, for this one file, **correct as written**: the consent modal
must sit above every other overlay including any that mounted before it, and `z-[9999]` is how it
does that. It should be moved to that path's justified-exception list rather than its migration
backlog.
