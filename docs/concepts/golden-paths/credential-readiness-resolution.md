# Golden path — Credential-readiness resolution

> Situation node: `integrations-security/credential-lifecycle/credential-readiness-resolution` ·
> [situation spine](../situation-spine.md)
> `sides: both` · recurrence **31** · dimensions: **function · resilience · security · ui · code-quality**.
> Composed 2026-08-15 against `master` @ `145dbc908`. Ground-truth sweep: the whole readiness
> module (`commands/design/connector_readiness.rs`, 1,922 lines, read end to end), the healthcheck
> engine (`engine/healthcheck.rs` + `core/healthcheck_ledger.rs` + `core/models/credential_ledger.rs`),
> the OAuth lifecycle (`engine/oauth_refresh.rs`, `engine/connector_strategy.rs`,
> `engine/runner/credentials.rs`, `commands/credentials/{crud,rotation,oauth,cli_capture,resources}.rs`),
> the run gate (`commands/execution/executions.rs`), both write paths that produce a verdict
> (`commands/design/{build_sessions,template_adopt}.rs`), the scope layer
> (`engine/scope_enforcement.rs`, `engine/credential_broker.rs`), and the frontend half
> (`api/design/connectorReadiness.ts`, `useConnectorReadiness.ts`, `connectorRunnability.ts`,
> `connectorMatching.ts`, `vaultAdoptionMatcher.ts`, `credentialCoverage.ts`, `SetupStatusBadge.tsx`,
> `teamStudioShared.tsx`, `errorRegistry.ts`, `useTranslatedError.ts`).
> **Programmatic measurements**: 564 `.rs` files under `src-tauri/src` and 4,829 `.ts`/`.tsx` files
> under `src/` walked; 161 `#[tauri::command]` definitions in `commands/credentials/**` parsed (not
> grepped). Every count below was produced by **two independent implementations** where the number
> is load-bearing. **No `cargo` command was run.** `src-tauri/target/**` and `.claude/worktrees/**`
> excluded from every scan. Convergence checked against `../brainiac`, `../personas-cloud`,
> `../personas-web`.
> **No secret value appears in this document** — shapes, locations and counts only.
> The **Deviations** section is a fix backlog.

**Adjacent leaves — do not absorb them here.** Whether the *identity* session behind
`#[requires(cloud)]` is alive is [`cloud-auth-degraded-mode`](./cloud-auth-degraded-mode.md); how a
secret is stored, shown or moved is [`secret-display-and-transfer`](./secret-display-and-transfer.md)
and [`app-settings-store`](./app-settings-store.md); which typed error a command returns is
[`typed-error-contract`](./typed-error-contract.md); which tier a command sits in is
[`ipc-command-authorization`](./ipc-command-authorization.md). **This path owns exactly one
question: before a persona, connector or tool runs, how does the app decide it has the credentials
it needs — and what does it tell the user when it doesn't.**

---

## ⚠ Four corrections to the brief that commissioned this path

1. **"`needs_credentials` is advisory rather than blocking" is half the truth, and the half it
   misses is the defect.** There are **two** answers in the tree and they are both correct about
   different objects. The *live recompute* (`persona_live_blockers`) is a **hard block** at the one
   run gate (`executions.rs:222-250`). The *persisted column* `personas.setup_status` is **advisory**
   at three Rust sites that say so in prose and admit `ready | needs_credentials` alike
   (`teams/assignments.rs:44-48`, `engine/team_assignment_orchestrator.rs:1096-1103`,
   `engine/goal_advance.rs:87-99`). So far, coherent. The break is on the frontend:
   `teamStudioShared.tsx:128` filters `p.setup_status === 'ready'` and justifies it in a comment —
   *"the orchestrator rejects any member whose setup_status != 'ready'"* — which is **factually false
   today** and was removed deliberately, with a written autopsy, at
   `team_assignment_orchestrator.rs:1097-1101`. The picker that chooses team members hides exactly
   the personas the orchestrator would accept.
2. **CONFIRMED and extended: `require_valid_id` still has ZERO callers, and credential ids are in
   that population.** Defined at `core/src/validation/mod.rs:36`; one occurrence repo-wide (the
   definition). Parsed, not grepped: **161** `#[tauri::command]` definitions across 27 files in
   `commands/credentials/**`; **54** take a parameter literally named `credential_id` / `cred_id` /
   `id` (my own parse — a broader id-shaped count that also admits `kb_id`,
   `gateway_credential_id`, `proposal_id`, `key_id`, … reaches **83**, and both figures exclude
   `Vec<String>` id params such as `credential_ids` in `rotation.rs:83`); **2** validate it
   (`credentials/api_proxy.rs:96,:140`) and both go through a *local* helper
   (`api_proxy.rs:17`) that exists as path-traversal defence because those two build a filename from
   the id — not as id policy. `execute_api_request` (same file, same parameter) does not call it, and
   neither does `healthcheck_credential`, `update_credential_field`, `delete_credential`,
   `patch_credential_metadata`, nor any of the 13 commands in `rotation.rs`.
   **2/54 ≈ 3.7% on the narrow count, 2/83 ≈ 2.4% on the broad one, and 0 through the sanctioned
   helper either way.** The module carries `#![allow(dead_code)]` at `validation/mod.rs:1`, which is
   why nothing ever flagged it.
3. **CONFIRMED, third independent sighting in one repo: presence stands in for validity.**
   `cloud-auth-degraded-mode` found `require_cloud_auth` testing `access_token.is_none()` and
   `personas-cloud` reinventing it as `hasSubscription: oauth.hasTokens()`. This leaf's resolver
   commits the same defect against a *different* credential family:
   `credential_is_usable` (`connector_readiness.rs:1004-1074`) reads a field count, the last
   healthcheck boolean, and a timestamp ordering — and **never reads
   `ledger.oauth_token_expires_at` (0 of its 28 occurrences in the tree are in this module) nor
   `ledger.needs_reauth`**. Both fields sit on the same `CredentialLedger` struct it already parses
   at `:1041`.
4. **Two corrections to the *shape* of the question.** (a) The app has **no notion of provider-granted
   OAuth scope at all** — scopes are captured at `credentials/oauth.rs:1604-1612` and never read
   back by anything; `scope` in this codebase means a locally-declared *resource allowlist*
   (`engine/scope_enforcement.rs`), which readiness never consults and which defaults to `Warn`
   (log-and-proceed, `scope_enforcement.rs:41-67`). (b) A **403 is indistinguishable from a 401** at
   every layer — `healthcheck.rs:1133-1143` (one branch for all non-2xx),
   `core/healthcheck_ledger.rs:39` (`401 | 403 => Self::Permanent`),
   `engine/tool_runner.rs:1120` — and the user-facing consequence is worse than "indistinguishable":
   `engine/build_session/tool_tests.rs:1194-1198` tells the user *"authentication failed — try
   refreshing credentials in Keys"*, advice that can never fix a scope failure.

---

## 1. Trigger

- "Does this persona have what it needs to run?" / "Why does the badge say Setup required when I
  just added the key?"
- "Show a green tick when the connector is configured" / "grey the button out until they connect X"
- "Add a `ready` / `configured` / `hasCredential` flag to this card"
- "The card said Ready and then the run failed" / "It ran and produced text instead of calling the API"
- "We should check the credential before we spend a run on it"
- "Which personas break if I delete this credential?"

If you are about to type `credentials.length > 0`, `!!cred`, `cred.healthcheck_last_success === true`,
`credentials.find(c => c.service_type === name)`, `type in credentialLinks`,
`get_by_service_type(...).is_empty()`, `setup_status === 'ready'`, or
`UPDATE personas SET setup_status` — you are in this situation, and in every one of those cases you
are about to write the wrong thing.

---

## 2. The one way

**Ask the resolver. Never re-derive the answer, on either side of the IPC boundary.**
`commands::design::connector_readiness` is the single authority: `connector_readiness(conn, name)`
for one connector, `connector_readiness_entries` / the `connector_readiness_batch` command for a
screenful, `persona_live_blockers` for a run gate, `recompute_persona_setup` when a credential
mutates. It returns a **type, not a boolean** — `Readiness::{Ready, NeedsSetup { connector, kind }}`
— and the `SetupKind` arm is the whole point: it routes the user to the *right* remediation, which is
not always the Vault (it may be `vercel login`, a Dev Tools project, an Obsidian vault, a Twin
profile). Compute readiness **live at the decision** and treat the persisted `personas.setup_status`
column as a *display cache* that is allowed to be stale; if you must write that column, write it
through `recompute_persona_setup` so `setup_status` and `setup_detail` can never disagree — they are
one verdict and one account of it, and they must move in one statement. Because the three legs of the
question — the key **exists**, the key **authenticates**, the key has the right **scopes** — are three
different facts, say which one you checked: this repo checks existence properly, checks authentication
only as "the last probe did not return a failure", and does not check scope at all. And when the
answer is "not ready", **return the typed refusal and let the UI render the `SetupKind`** — never
format an English sentence into `AppError::Validation`, because that variant is claimed by the
registry's generic validation rule and the user is then told to *"Review the highlighted fields"* for
a failure that has no fields (§7 E1).

---

## 3. Mandated primitives

**The resolver — `src-tauri/src/commands/design/connector_readiness.rs`**

- **`connector_readiness(conn, name) -> Readiness` (`:520`).** Dispatches on `ConnectorClass`
  (`core/models/connector.rs`): `ZeroConfig` → always ready; `Credential` → must be *uniquely*
  bindable to one *usable* vault credential, else fall back to a provider-CLI probe for the
  `CLI_PROBE_CONNECTORS` set; `GlobalProbe` → a connector-specific probe against a local entity.
  Fails closed on a blank name (`:538-546`) and on an unwired probe connector (`:613`).
- **`Readiness` (`:142`) and `SetupKind` (`:65`).** Six arms — `VaultCredential`, `CliLogin`,
  `DevProject`, `ObsidianVault`, `TwinProfile`, `Misconfigured` — each with a machine token
  (`as_str()`, `:90`) and a remediation line (`remediation()`, `:102`). `remediation_for(kind,
  connector)` (`:127`) specialises `CliLogin` with the connector's actual `login_cmd`.
  **This is the only readiness verdict in the app that carries its own fix, and — measured against
  three sibling repos — the only one in any of them (§Convergence).**
- **`SetupBlocker` (`:159`) + `PersonaSetup` (`:189`).** The structured account written to
  `personas.setup_detail`: typed blockers, the wired trigger types, and a plain-language `preview`.
  `SetupBlocker::from_readiness` (`:171`) is the only correct way to build one.
- **`persona_live_blockers(conn, persona)` (`:758`).** The run gate's input. Recomputes from current
  vault/probe state and explicitly does not trust the column. **Gate on this, never on
  `setup_status`.**
- **`recompute_persona_setup(pool, persona_id)` (`:778`).** The only writer that persists
  `setup_status` and `setup_detail` in one statement (`:806-814`). **The only sanctioned writer of
  the column.**
- **`recompute_setup_for_credential_dependents(pool, credential_id)` (`:837`) +
  `credential_dependent_persona_ids` (`:855`).** The invalidation hook. The dependent set is the
  union of the audit-log dependents scan and personas whose `design_context.credentialLinks`
  reference the id.
- **`resolve_one_credential` (`:923`) / `resolve_ready_credential` (`:976`) /
  `credential_is_usable` (`:1004`).** The binding rule: exact `service_type` match, else category
  match after `normalize_connector_role`; **`None` when there are 0 *or* 2+ candidates** — ambiguity
  is a user choice, never a guess. `credential_is_usable` adds the liveness test.
- **`cached_cli_probe` (`:466`) / `evict_cli_probe_cache` (`:502`).** A process-wide TTL cache
  (`CLI_PROBE_TTL = 300s`, `:319`) in front of a bounded (`CLI_PROBE_TIMEOUT = 4s`, `:314`) probe
  that can never hang the UI. Readiness is recomputed on every adopt/promote/mutation, so the cache
  is load-bearing, not an optimisation.

**The frontend — one funnel, three hops**

- **`src/api/design/connectorReadiness.ts:23` — `connectorReadinessBatch(connectors)`.** The **only**
  invoke site of `connector_readiness_batch` (verified: 1 occurrence outside
  `commandNames.generated.ts`).
- **`src/features/templates/sub_generated/shared/useConnectorReadiness.ts:82` —
  `useConnectorReadiness(names)`.** **Copy this hook.** One IPC call per connector *vocabulary*,
  a monotonic `seqRef` stale-response guard (`:102,:113`), previous verdicts kept across a refetch
  (loading law 1), and — the part everyone else gets wrong — **`'unknown'` as a first-class state**
  (`:13`, and the comment at `:8-12`: *"the alternative — guessing 'ready' — is exactly the bug this
  replaced"*).
- **`.../shared/ConnectorReadiness.tsx` + `src/features/vault/components/SetupStatusBadge.tsx:42`.**
  The `SetupKind` → localized remediation switch, over `t.vault.setup_kind.*`
  (`locales/en.json`, 7 keys).

**The liveness ledger — `src-tauri/core/src/models/credential_ledger.rs`**

- **`CredentialLedger` (`:69`)** — the typed replacement for opaque metadata. Fields this leaf cares
  about: `healthcheck_last_success` (`:74`), `healthcheck_last_success_at` (`:76`),
  `oauth_token_expires_at` (`:86`), `needs_reauth` (`:98`), `needs_reauth_at` (`:100`), plus
  `token_expires_at()` (`:216`) and `mark_needs_reauth()` (`:256`).
- **`HealthProbeState` (`engine/healthcheck.rs:33`)** — `Verified | Unverifiable | Failed`, with
  stable wire tokens (`:43`). Note `HealthcheckResult::unverifiable` sets `success: true` (`:79`):
  "we could not probe" is deliberately **not** "it is broken", and readiness relies on that.
- **`append_healthcheck_metadata` (`db/src/repos/resources/credentials.rs:821`)** — the canonical
  ledger writer for a probe outcome.

---

## 4. Steps

1. **Name which of the three facts you actually need.** *Exists* (a row with at least one non-empty
   field), *authenticates* (a round-trip that came back 2xx), *is scoped* (the grant covers the
   resource you will touch). They are not the same question and this repo answers them with
   different confidence: fact 1 is solid, fact 2 is "the last probe did not fail — and there may
   never have been a probe", fact 3 is unanswered. Write down which one your feature is entitled to
   assume.
2. **Call the resolver.** Backend: `connector_readiness(&conn, name)` or `missing_connectors`.
   Frontend: `useConnectorReadiness(names)` — one call for the whole screen, never per card.
   **Do not write a binding rule.** There are already five in this repo and they disagree (§7 A).
3. **Branch on the `SetupKind`, not on a boolean.** The user who needs `vercel login` and the user
   who needs a Notion API key are in different situations; collapsing them to "not ready" is why
   people abandon a connector rather than configure it.
4. **Gate a real run on `persona_live_blockers`, never on the column.** `executions.rs:222-250` is
   the shape. A cached `ready` with a since-deleted credential must be blocked; a cached
   `needs_credentials` whose connectors are now fine must be allowed.
5. **After any credential mutation, call `recompute_setup_for_credential_dependents`.** Create,
   update, delete, rotate, re-auth, revoke, healthcheck-result — all of them. Three call sites exist
   today and all three are in `commands/credentials/crud.rs` (§7 C).
6. **If you persist a verdict, persist the account with it in the same statement.** One `UPDATE`
   carrying both `setup_status` and `setup_detail`, i.e. go through `recompute_persona_setup`. A bare
   token gives the UI a badge with nothing behind the tooltip, and the next recompute silently
   overwrites whatever you meant by it.
7. **Refuse with a type.** If a command must refuse for readiness, the refusal is *about system
   state*, not about the caller's input — so it must not be `AppError::Validation`. Until a
   `NotReady { blockers }` variant exists (§8.4), the honest interim is to return the blockers as
   data in the success payload and let the caller render them, exactly as `instant_adopt_template`
   already does (`template_adopt.rs:767-776`).
8. **Stop.** No new `hasCredential` flag. No `installed && has_credential`. No client-side
   `service_type` matching. No TTL cache of your own. No second column.

### Can the primitive make the wrong call impossible? — answered

The contract asks this before §9. Two of the three answers are yes, and the third is the one place a
required prop would *not* help — which is worth stating because the corpus has earned that
distinction.

- **Make "usable" unable to ignore liveness. YES, and it is the highest-value change here.**
  `credential_is_usable` (`:1004`) opens `CredentialLedger` and consults exactly one of its liveness
  fields. Replace its `-> bool` with a three-arm type and the omission stops being expressible:
  ```rust
  pub enum CredentialLiveness { Usable, Expired { at: DateTime<Utc> }, NeedsReauth, Unusable(UnusableReason) }
  fn credential_liveness(conn: &Connection, id: &str) -> CredentialLiveness
  ```
  The compiler then enumerates every consumer, and `NeedsReauth` — which today is written by
  `mark_needs_reauth` (`oauth_refresh.rs:951`) and read by **nothing** in readiness — becomes a case
  someone has to handle. It also gives `SetupKind` the arm it is missing (`Reauth`), which is the
  difference between telling the user "add a credential" and "reconnect the one you have".
  This is the `Credential<'a> { Live, Expired, Absent }` shape `cloud-auth-degraded-mode` §4
  prescribed for the *identity* token, applied to the *connector* token. Same defect, same fix,
  different family — which is why it belongs in both documents rather than being cross-referenced
  away.
- **Make "we could not ask" unrepresentable as "there is nothing". YES, already done, keep it.**
  `ConnectorHealth = 'ready' | 'missing' | 'unknown'` (`useConnectorReadiness.ts:13`) is the
  frontend's version and it is correct. The gap is that only one screen uses it.
- **Would a *required prop* fix the 58 client-side re-derivations? NO — and this is the distinction
  worth carrying.** The corpus learned that **a required prop only carries the property it actually
  encodes**. Making `ConnectorReadinessMap` a required prop on every card that renders a readiness
  badge would guarantee *a map was passed*; it would not guarantee the map came from the resolver
  rather than from `connectorRunnability.ts`, because both produce a structurally identical value.
  Requiredness and closedness are orthogonal: what is needed here is a **closed** producer (one
  exported factory, the hook, with the raw entry type not exported for hand-construction), not a
  required consumer parameter. Ship the closedness; a required prop on top of it is then cheap and
  meaningful, and on its own it is theatre.

---

## 5. Anti-patterns

- **Deriving the verdict client-side.** Five independent binding rules exist for the one question
  `resolve_one_credential` answers, and they disagree in ways that produce exactly the bug the
  resolver was built to kill — see §7 A. The doc comment on
  `src/api/design/connectorReadiness.ts:8-14` forbids this in writing.
- **Treating presence as validity.** `capability_contract.rs:276-280` returns `Ok(())` for
  `Requirement::Credential` when `!creds.is_empty()` — no field check, no health check, no
  uniqueness check. `credentialCoverage.ts:50` returns covered when `type in links`, which is true
  for a link pointing at a deleted credential. Both are "did we ever have one", which is not the
  question.
- **Treating "the last probe failed" as the whole of validity — and the ledger's *other* liveness
  fields as decoration.** `needs_reauth` is written on revocation, raises an OS notification, opens a
  healing issue and renders a `ReauthBanner`, and the readiness resolver does not read it. A credential
  the app has already told the user is dead still resolves `Ready` (§7 B1).
- **Letting a provider outage demote a credential.** `healthcheck.rs:1133-1143` maps *every* non-2xx
  and every transport error to `probed(false, …)`; `credential_is_usable:1042` blocks on
  `Some(false)`; nothing ever re-probes on a schedule tied to that failure. A 503 during a sweep
  therefore converts "their API was down for a minute" into "your persona cannot run", and only a
  manual Test-connection clears it.
- **Collapsing 401 and 403.** They are the two facts this leaf exists to separate — "the key is
  wrong" versus "the key is right and lacks the grant" — and four layers fold them
  (`healthcheck.rs:1133`, `healthcheck_ledger.rs:39`, `tool_runner.rs:1120`, `tool_tests.rs:1194`).
  The last one turns the collapse into active harm by prescribing a fix (re-auth) that cannot work.
- **Writing `setup_status` by hand.** Three sites do (`build_sessions.rs:1011,:2949`,
  `template_adopt.rs:936`), each encoding a *different* meaning into one two-valued column
  ("verification run failed", "promote found a missing connector", "adopt found a missing
  connector"), none of them derived from the resolver, and each of them silently reverted by the next
  `recompute_persona_setup`, which only knows about connectors.
- **Mutating a credential without recomputing its dependents.** Measured: **3** recompute call sites,
  all in `commands/credentials/crud.rs`, against ~22 code paths that write credential fields or
  liveness metadata. The starkest is `route_revocation_to_healing` (`oauth_refresh.rs:862`), which
  calls `credential_dependent_persona_ids` at `:870` — the *exact* helper
  `recompute_setup_for_credential_dependents` uses — to open healing issues, and then does not
  recompute that same set.
- **Caching a verdict with nothing to invalidate it.** `useConnectorReadiness` is keyed on the
  connector *vocabulary* (`:88-95`), so adding the missing credential does not change the key and the
  badge stays red until remount. There is no `credential-created` / `-updated` / `-deleted` event in
  `src/lib/eventRegistry.ts` for it to listen to — the only credential events are
  `CREDENTIAL_REAUTH_REQUIRED` / `_RESOLVED` (`:257,:259`), consumed by one component.
- **Refusing with `AppError::Validation` for a state failure.** It is claimed by
  `errorRegistry.ts:451` (`match: 'Validation'`) and `useTranslatedError.ts:104`, so a carefully
  written refusal about connectors renders as *"Some input values are invalid. / Review the
  highlighted fields and correct any errors."* (§7 E1).
- **Justifying a frontend gate with a comment about backend behaviour.** `teamStudioShared.tsx:124-126`
  does, and the behaviour it cites was deliberately removed. A comment cannot drift-check itself —
  the same anti-pattern `cloud-auth-degraded-mode` §5 recorded for `CLOUD_COMMANDS`.
- **Reporting an install as a health check.** `try_desktop_healthcheck` (`healthcheck.rs:334-359`)
  returns `probed(true, "<app> is installed")` on binary presence alone, which then lands in the
  same `Some(true)` bucket as a real authenticated round-trip.

---

## 6. Evidence

**The resolver itself is exemplary and should not be disturbed.** Its module header
(`connector_readiness.rs:1-43`) states the consolidation it performed — two byte-identical builtin
allowlists and two divergent readiness functions that "used to disagree, so a persona could pass
adoption and then fail promote". Everything in §7 is downstream of that consolidation being
incomplete, not of it being wrong.

- **`connector_readiness.rs:1485-1521` — `batch_entries_fix_both_directions_of_the_retired_heuristic`.
  Read this test first.** It pins, in one pass, the two directions the retired
  `installed && has_credential` heuristic got wrong: zero-config/native/aggregate connectors read
  not-ready (the gallery hid working templates), and a credential *row* with no usable field read
  ready (the card said Ready and the run gate then blocked). It is the specification for this leaf.
- **`connector_readiness.rs:1894-1920` — `every_global_probe_connector_has_a_probe_arm`.** A test
  that asserts *its own instrument* before its result: it walks `GLOBAL_PROBE_CONNECTORS` against an
  empty DB and fails if any entry reaches the `_ => Misconfigured` fallthrough, turning a hand-synced
  const-array/match-arm desync into a test failure rather than a silently-broken persona. Copy this
  pattern for any hand-synced table.
- **`connector_readiness.rs:1023-1032` — the three-valued gating comment.** Nine lines that explain
  why `Unverifiable` must be allowed and only an explicit failure may demote. This is the reasoning
  a reviewer needs and it is written down at the site.
- **`connector_readiness.rs:929-966` — ambiguity returns `None`.** Two candidates for role `ai` is a
  question for the user, not a coin flip. Compare `runner/credentials.rs:494-496`, which takes
  `creds.first()`.
- **`connector_readiness.rs:466-486,:490-498,:502-512` — the probe cache.** TTL + peek + explicit
  eviction, with a 4-second hard kill and `stdin` closed so an interactive CLI fails fast
  (`:394-399`). The `connector_readiness_with_probe` injection point (`:529`) keeps the whole suite
  off the developer's real `vercel`/`gh` binaries.
- **`executions.rs:207-250` — gating live, not on the column.** The comment (`:214-218`) states the
  principle exactly: *"any writer that leaves the column stale … would otherwise let a blind run
  through, or block a persona whose connectors are now fine. The column stays for UI/team surfaces;
  the run gate is honest."*
- **`useConnectorReadiness.ts:8-12,:82-126` — the frontend exemplar.** `unknown` as a state, a
  monotonic stale-response guard, and refetch-without-blanking. **The one site to copy.**
- **`runner/credentials.rs:812-818` — a documented ordering invariant.** The runtime refresh writes
  the field first and stamps `healthcheck_last_success_at` second, *specifically* so the staleness
  rule at `connector_readiness.rs:1051-1071` cannot falsely demote a freshly-refreshed credential.
  Someone reasoned about the interaction between two modules and wrote it down.
- **`template_adopt.rs:854-869` — escape hatches documented at the boundary.** The two rules that
  cannot live in the resolver (template-declared `category` is a native capability; template declares
  a credential-free `auth_type`) are named, justified, and confined to the adopt path.

---

## 7. Deviations found

**Six categories, 24 individually-addressable items.** All ship green under `npm run check`
(incl. `census:check`, `tsc --noEmit`, `eslint src/`) and under the resolver's own 24-test suite.

### A. Five binding rules answer one question, and they disagree — 5

`resolve_one_credential` (`connector_readiness.rs:923`) is the authority. Four client-side rules
re-derive it, each with different semantics:

| # | Site | Rule | How it diverges from the authority |
|---|---|---|---|
| A1 | `src/features/shared/components/display/connectorRunnability.ts:118` | exact `service_type` via `.find`, else category after `ROLE_SYNONYMS` | Self-describes as *"Frontend mirror of the Rust adoption pre-flight"* (`:1-3`) and has already drifted: its `ROLE_SYNONYMS` still maps **`codebase → source_control`** (`:31-32`), the exact mapping Rust deleted with a comment saying why (`connector_readiness.rs:229-231` — `codebase` is a `GlobalProbe` resolved against a Dev Tools project). So a persona declaring `codebase` reads **satisfied** here whenever any GitHub credential exists, while the resolver returns `NeedsSetup { DevProject }`. It also takes the first match on ambiguity (`.find`, `:145`) where Rust returns `None`, and never checks `credential_is_usable`, so an empty-field credential reads satisfied. |
| A2 | `src/features/templates/sub_n8n/edit/connectorMatching.ts:25` | exact, else **prefix match either direction**, else **credential-name substring** (`MIN_FUZZY_LENGTH = 4`) | Two matching rules the backend has never had. A credential named "Notion (personal)" satisfies a connector called `notion` here and nowhere else. |
| A3 | `src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts:56` | alias expansion + `connectorCategoryTags` | A third alias vocabulary, maintained separately from Rust's `normalize_connector_role`. |
| A4 | `src/lib/validation/credentialCoverage.ts:32` | `covered = !(type in links)` for every `requires_credential_type` | Presence of a *key*, not of a credential. A `credentialLinks` entry pointing at a deleted id counts as covered. **Zero production call sites** — kept alive by 12 assertions across two test files, which is worse than deleting it: the next person finds a tested helper and uses it. |
| A5 | `src/features/templates/sub_n8n/edit/connectorHealth.ts:34` | `connector.has_credential \|\| !!linkedCredentialId \|\| !!matchedCredential` → `health: 'ready' \| 'missing'` (`:38`) | A **literal survivor of the retired heuristic**. `has_credential` is an LLM-authored boolean from the build IR (`build_sessions.rs:1955`), OR-ed with a fuzzy match from A2. |

Surveyed total across `src/`: **58 independent readiness computations in 34 files**, against
**one** call site of the authoritative resolver (`useGalleryActions.ts:61` — verified independently:
`connector_readiness_batch` has exactly 1 invoke site, `useConnectorReadiness` exactly 1 caller).
Everything outside the template gallery runs on local heuristics.

### B. The resolver is blind to two liveness facts it already has in hand — 3

**B1 — a revoked credential resolves `Ready`.** `mark_needs_reauth` (`oauth_refresh.rs:951-957` →
`credential_ledger.rs:256-259`) sets `needs_reauth` and `needs_reauth_at` **and nothing else** — it
does not touch `healthcheck_last_success`. `credential_is_usable` reads only
`healthcheck_last_success` (`connector_readiness.rs:1042`). So on the revocation path
(`oauth_refresh.rs:119-128`, both the startup sweep and the periodic tick) the app: types the error
as `AppError::OAuthRevoked`, persists `needs_reauth`, opens a healing issue, emits
`CREDENTIAL_REAUTH_REQUIRED`, sends an **OS notification** saying *"access was revoked"* — and the
readiness resolver still says `Ready`, so `persona_live_blockers` is empty and the run gate lets the
persona execute. **The app tells the user the credential is dead and does not tell itself.**

**B2 — an expired OAuth token resolves `Ready`.** `oauth_token_expires_at` occurs 28 times in the
tree (`connector_strategy.rs:596-601`, `oauth_refresh.rs:33-35`, `rotation.rs:1204`,
`runner/credentials.rs:841`, …). **Zero of them are in `connector_readiness.rs`.** In practice the
runtime papers over it — `inject_credential` refreshes unconditionally whenever a `refresh_token`
field exists (`runner/credentials.rs:753`) — but for a credential whose refresh token is gone or
whose provider is down, readiness is answering from a token it knows is expired.

**B3 — a provider outage is recorded as a credential failure and never expires.**
`append_healthcheck_metadata` (`db/src/repos/resources/credentials.rs:856-858`) writes
`healthcheck_last_success = Some(false)` for a 503 exactly as for a 401, and
`healthcheck_last_success_at` is a high-water mark that is *never cleared on failure*. Combined with
`credential_is_usable:1042` this is a durable block created by someone else's downtime.

### C. Invalidation covers 3 of ~22 mutation paths — 6

Every `recompute_*` call site in the tree: `crud.rs:199` (`update_credential`, and only when
`has_data_change`), `crud.rs:276` (`delete_credential`), `crud.rs:524` (`update_credential_field`).
Not called by, among others:

| # | Path | Site | Consequence |
|---|---|---|---|
| C1 | **revocation** | `oauth_refresh.rs:126,:235` → `:862` | Computes the dependent set at `:870` for healing and does not recompute readiness for it. One line. |
| C2 | `create_credential` + its post-create probe | `crud.rs:35,:94-119` | Adding the missing credential leaves every dependent persona's badge at `needs_credentials` until something else recomputes. This is the *most common user action on this leaf* and it produces no update. |
| C3 | `healthcheck_credential` / the daily sweep | `crud.rs:329-369`, `healthcheck.rs:699-741` | A probe that fails demotes `credential_is_usable` — so the live run gate flips — while the column, the team filters, `goal_advance` and `deliberation` all keep the old answer. |
| C4 | manual rotation / CLI refresh / OAuth refresh commands | `credentials/rotation.rs:135-198` (3 commands) | The secret is *replaced* and nothing recomputes. |
| C5 | `connector_strategy.rs:132,:144,:412,:423` (`save_fields`) | | Rewrites credential fields, bumping `MAX(credential_fields.updated_at)` — which is exactly the input to the staleness rule at `connector_readiness.rs:1051-1071` — **without** the compensating success stamp that `runner/credentials.rs:812-818` documents as required. This path can silently make a credential *un*ready by refreshing it. |
| C6 | `patch_credential_metadata` | `crud.rs:219-230` | Takes an arbitrary JSON object and forwards it to `patch_metadata_atomic` with **no key allowlist**, so a privileged IPC caller can set `healthcheck_last_success: true` directly. Readiness is writable from the webview without a probe ever running. |

`evict_cli_probe_cache` has the mirror problem: its only non-test callers are inside the manual
`connector_cli_probe_refresh` command (`connector_readiness.rs:1180,:1184`). No credential mutation
evicts it, and the two probe commands have **zero frontend consumers** (present only in
`commandNames.generated.ts:299-300`) — so the "you ran `vercel login`, click refresh" affordance the
cache was designed around does not exist in the UI.

### D. Three answers to "is this persona usable", and the frontend contradicts the backend — 4

| # | Site | Input | Verdict |
|---|---|---|---|
| D1 | `executions.rs:222-250` | live recompute | **hard block** |
| D2 | `assignments.rs:46`, `team_assignment_orchestrator.rs:1102`, `goal_advance.rs:96` | cached column | `ready` **and** `needs_credentials` admitted — advisory, with a written rationale |
| D3 | `teamStudioShared.tsx:128` | cached column | `ready` **only** — and its comment (`:124-126`) cites D2's *removed* behaviour as the reason |
| D4 | `deliberation.rs:1293` | cached column | participates with **zero capabilities** stripped, plus a one-time transcript note |

D3 is the defect: the member picker that feeds the orchestrator hides the personas the orchestrator
accepts. D4 is defensible but note it strips capabilities off a *stale* column — a persona whose
credential was fixed an hour ago still deliberates with nothing.

Also here: **`executions.rs:233`'s fallback contradicts its own comment.** The comment (`:220-221`)
says *"Pool failure falls back to the cached column (fail-safe: never run blind because the DB was
momentarily unavailable)"*. The code has two arms: `Err(_) if setup_status == "needs_credentials"` →
synthetic blocker, and `Err(_) => Vec::new()` → **run ungated**. A pool failure on a persona whose
column says `ready` runs blind, which is the exact outcome the comment claims to prevent.

And `run_execution` (`engine/runner/mod.rs:68`) — reachable without `execute_persona_inner` from
`daemon/runtime.rs:202` and `engine/mod.rs:368` — has **no readiness gate at all**; its
capability-contract pre-check is explicitly log-only (`runner/mod.rs:380-389`, no `return`).

### E. What the user is told — 4

**E1 — the run-gate refusal renders as "Review the highlighted fields."** Traced end to end:
`executions.rs:242` builds `AppError::Validation(…)`; `core/src/error.rs:21` renders it
`"Validation error: {0}"`; the serialized `error` string therefore contains the substring
`Validation`; `resolveError` (`errorRegistry.ts:637-654`) walks 62 rules in order and the first
match is `match: 'Validation'` at `:451` → **"Some input values are invalid." / "Review the
highlighted fields and correct any errors."** `useTranslatedError.ts:104` does the same, earlier in
its ordering. The carefully-written sentence naming the Connections section, the Dev Tools project
and the simulation escape hatch is discarded, and the user is told to fix fields on a screen that has
none. **This is precisely the class `error-message-resolution.md` identified, and credential
readiness lands in it.**
*(Upstream note, not this leaf's to fix: the two registries are ordered differently — `'Validation'`
sits at position 104 of `ERROR_KEY_MAP` but position 451 of `ERROR_RULES`, so the build-pipeline
validators at `ERROR_KEY_MAP:123-129` are unreachable in the translated path.)*

**E2 — the badge tooltip is half-English in a 14-locale app.** `setupTooltip`
(`SetupStatusBadge.tsx:63-72`) emits `setup.preview` — a sentence assembled in Rust
(`connector_readiness.rs:635-661`, e.g. *"Needs setup before it can deliver value: … Runs
automatically on its schedule trigger."*) — followed by localized per-blocker lines. The mixture is
deliberate (`:33-41` explains the kind token is what can be localized) but the result is one
un-translatable paragraph on top of translated bullets.

**E3 — the connector-specific login command is computed and then thrown away.**
`remediation_for(CliLogin, connector)` (`connector_readiness.rs:127-138`) substitutes the real
command (`vercel login`, `gh auth login`) and a test pins it
(`:1793-1806`, `cli_login_blocker_names_the_actual_login_command`). The UI renders
`t.vault.setup_kind.cli_login`, whose English is the generic *"…run its login command in a terminal
(for example `vercel login` or `gh auth login`)"*. The one thing that makes `CliLogin` worth having
as a distinct kind — a single copy-pasteable command — reaches the user only inside E2's untranslated
`preview`.

**E4 — readiness copy bypasses the error registry entirely, and ~16 strings are hardcoded English.**
No readiness remediation string routes through `resolveError`. Concrete hardcoded sites:
`SetupStatusBadge.tsx:88` (`Ready`), `:103`/`:114`/`:117` (three `debtText(…)` placeholders,
including the `aria-label` of the only warning badge on the leaf), `personaStats.ts:199`
(`'Setup required'`), `adoptionReadiness.ts:75-77` (`'Ready'`/`'Partial'`/`'Setup needed'`),
`connectorRunnability.ts:126,:134,:142,:151,:167,:174`, `useLifecycle.ts:288-302` (the promote
notification: *"Connect N services before it can run: …"* / *"Agent Promoted — needs setup"*),
`credentialHealthScore.ts:101-106,:141-156`, `credentialListTypes.ts:42-59`.
Also dead UI: `SetupStatusBadge.tsx:110-121` and `PersonaEditorHeader.tsx:176` render a
`'misconfigured'` persona status that **no Rust writer ever produces** — `setup_status` takes only
`"ready"` and `"needs_credentials"` (verified across all 4 writers). `SetupKind::Misconfigured`
exists at the *connector* level; the persona-level state does not.

### F. Scope is neither checked nor checkable — 2

**F1 — provider-granted scopes are write-only.** `credentials/oauth.rs:1604-1612` stores the granted
scope string into two credential fields. Repo-wide, the only other Rust occurrence of `oauth_scope`
is an explanatory comment (`healthcheck.rs:824`). Nothing compares granted against required, so
"the key has the right permissions" is never an input to readiness, and the 403 that results is
mis-advised at `tool_tests.rs:1194-1198`.

**F2 — the locally-declared resource scope is not part of readiness and defaults to warn.**
`scope_enforcement::evaluate` (`engine/scope_enforcement.rs:92`) is real, fails closed on a corrupt
picks blob (`:104-110`) and on a malformed connector spec, and is called from exactly one place:
`api_proxy.rs:731-771`. `EnforcementMode::from_metadata` defaults to `Warn` (`:52-53`) — log and
proceed. Its own header (`:16-18`) records that MCP and desktop-bridge calls bypass it. The resolver
never reads `scoped_resources`, so a persona whose use case targets a repo outside its credential's
scope resolves `Ready` and discovers the limit at request time, in warn mode, in a log line.

---

## 8. Gaps in the primitive

1. **`SetupKind` has no `Reauth` arm.** The six arms cover "you never set this up". The most common
   real failure — "you set it up, the provider revoked it" — has no arm, so B1 cannot be expressed
   even after the resolver learns to read `needs_reauth`. Adding it is a one-line enum change plus
   one i18n key, and it makes the `ReauthBanner` deep link reachable from the persona surface.
2. **The resolver is per-connector; readiness questions are per-*use case*.** `connector_readiness`
   takes a name and resolves against global state. It cannot answer "is this credential scoped to the
   repository this capability names", because it never sees the capability. F2 is downstream of this
   shape, not of an oversight.
3. **There is no credential-mutation event.** `src/lib/eventRegistry.ts` has no
   `credential-created` / `-updated` / `-deleted`. A frontend readiness cache has nothing to
   subscribe to, which is why `useConnectorReadiness`'s only invalidation is a change in the
   connector vocabulary. Every refresh in the app today is a manual `onCredentialAdded` callback
   threaded by hand through ~9 call sites.
4. **`AppError` has no "not ready" variant.** `Validation` is claimed by the registry's generic rule
   (E1), `NotFound` is wrong, `Forbidden` means authorization. The nearest correct shape is
   `AuthorizationRequired { authorize_url }` (`core/src/error.rs:76-80`), which is scoped to MCP
   tools. Until a `NotReady { blockers: Vec<SetupBlocker> }` exists, a readiness refusal cannot cross
   the IPC boundary as data.
5. **The healthcheck cannot distinguish "authenticated" from "reachable".** `is_success()` on the
   status is the whole test (`healthcheck.rs:1120`); the body is never inspected. Providers that
   answer HTTP 200 with an error envelope (Slack's `{"ok":false}`, GraphQL `errors[]` — and the
   Linear healthcheck at `:973-978` POSTs a real GraphQL query and still only reads the status) pass.
6. **"No healthcheck configured" is indistinguishable from "verified" at every gate.**
   `resolve_connector_healthcheck` manufactures a skip config when nothing is defined
   (`healthcheck.rs:851-856`) and `HealthcheckResult::unverifiable` sets `success: true` (`:79`).
   The type is three-valued; every consumer of the gate reads the boolean. This is deliberate and
   correct for gating (a stored-only SSH key must not be blocked) but it means the app cannot answer
   "how many of my credentials have ever been proven to work".
7. **The census runner cannot express "must be zero".** The sharpest assertion in this leaf — *no
   consumer of a credential's liveness may read `healthcheck_last_success` without also considering
   `needs_reauth` and expiry* — is a must-never-happen with 0 legitimate instances, and a rule
   baselined at 0 is a gate that can never fail (`engine.mjs:264-273` refuses it by design). §9
   item 2 specifies a Rust test instead.
8. **Nothing can enumerate what a credential's death breaks.** `credential_dependent_persona_ids`
   exists and is called from three places for three different purposes (recompute, healing, blast
   radius). There is no single answer to "what stops working if this key is revoked" that all three
   share.

---

## 9. The missing gate

Every deviation above ships green. Four items, cheapest first — one census rule, one Rust test for
the must-be-zero condition, one Vitest case for the cross-language contract, and one **refusal with
its measurement**.

### 1. Census rule — `detached-readiness-verdict`

**The condition (stack-free):** *a readiness verdict is persisted as a bare status token by a writer
that did not compute it through the one resolver, with no accompanying account of what is blocking —
so the UI can render a badge it cannot explain, and the next honest recompute silently overwrites a
meaning the column was never able to hold.*

**The proxy in this repo:** an `UPDATE` over `personas` that assigns `setup_status` and whose whole
SQL statement never mentions `setup_detail`. The resolver's own write is the only one that pairs
them (`connector_readiness.rs:806-814`), so the pairing is a faithful stand-in for "went through the
resolver".

**PRECONDITION, and an adopting repo must re-derive its own.** This keys on (a) SQL written as a Rust
string literal and (b) *this* schema's two-column split of verdict and account. A repo that persists
readiness through an ORM, or in one JSON column, or not at all, scores **zero** here while the
condition is present at full scale. What travels is the condition; the proxy does not.

**Checked against the existing registry first.** `scripts/census/rules.json` holds **81** rules.
The named-adjacent ones do not overlap: `settings-key-holding-secret` matches
`pub const …_TOKEN: &str = "` in `src-tauri/db/src`; `secret-as-bare-string-field` matches a `pub`
struct field with a secret-noun name typed `String`; `undiscriminated-credential-rejection`
(this leaf's sibling, from `cloud-auth-degraded-mode`) anchors on `.bearer_auth(` /
`Authorization`-header attachment; `process-global-caches-a-failure` matches
`static X: OnceLock<Result<…>>`; `hand-rolled-emptiness-refusal` matches `is_empty()` →
`AppError::Validation(`. None shares a token, a root+extension pair, or a construct with this one.

```json
{
  "rules": [
    {
      "id": "detached-readiness-verdict",
      "goldenPath": "docs/concepts/golden-paths/credential-readiness-resolution.md",
      "title": "A persona's readiness verdict is persisted by a statement that never mentions the structured account of what is blocking — a bare token written by something other than the resolver",
      "roots": ["src-tauri/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "UPDATE\\s+personas\\s+SET\\s+(?:(?!setup_detail)[^\"]){0,240}?setup_status\\s*=(?:(?!setup_detail)[^\"]){0,240}?WHERE",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "An UPDATE statement over `personas` that assigns setup_status and whose whole SQL string never mentions setup_detail. The tempered class [^\"] cannot leave the SQL string literal the match started in, so a match is always exactly one statement and can never run into a neighbouring one. PROXY FOR the stack-free condition: a readiness verdict is persisted as a bare status token by a writer that did not compute it through the one resolver, with no accompanying account of what is blocking - so the UI renders a badge it cannot explain and the next honest recompute silently overwrites a meaning the column was never able to hold. LEGAL DESTINATION: connector_readiness::recompute_persona_setup (src-tauri/src/commands/design/connector_readiness.rs:778), whose single UPDATE at :806-814 writes setup_status AND setup_detail together and derives both from the resolver. MEASURED 2026-08-15 at 145dbc908: 3 matches across 2 files - build_sessions.rs:1011 (verification-run failure downgrade), build_sessions.rs:2949 (promote-time missing connector; it does write setup_detail, but 35 lines later in a SEPARATE statement on a SEPARATE pool connection, and the status write is conditional while the detail write is not, so the pair can disagree), template_adopt.rs:936 (adopt-time missing connector; writes no detail at all). Each encodes a DIFFERENT meaning into one two-valued column and none is derived from the resolver, so each is silently reverted by the next recompute_persona_setup. SHAPE DISCRIMINATION PROVEN ON THE REAL TREE: all four sites share the anchor `UPDATE personas SET setup_status = ?1,` and the resolver's own compliant statement scores 0 here while scoring 1 under the positive control - the rule keys on the ABSENCE of setup_detail, not on the token setup_status. FORWARD GUARANTEE VERIFIED, not asserted: applying the section-4 fix to template_adopt.rs:936 in memory drops that file 1 -> 0. PRECONDITION AND ADOPTION NOTE: this keys on SQL-in-a-Rust-string-literal plus this schema's verdict/account column split; a repo using an ORM, a single JSON column, or no persisted verdict scores ZERO while the condition is present - re-derive the proxy against the local persistence layer."
      },
      "baseline": { "files": 2, "matches": 3 },
      "floor": 400
    }
  ]
}
```

**Counts verified through two independent implementations, and they agreed exactly.** The census
regex reports **3 matches / 2 files**. A separately written *string-literal extractor* — walk the
character stream, track quote state, escape handling and multi-line continuation, collect every
double-quoted literal, keep those matching `UPDATE personas SET … setup_status =`, and partition on
whether the same literal mentions `setup_detail` — reports **3 violations in 2 files at the same
three line numbers** (`build_sessions.rs:1011`, `build_sessions.rs:2949`, `template_adopt.rs:936`)
and **1 compliant** (`connector_readiness.rs:807`). Two matchers built on different principles
(tempered-greedy regex vs. a quote-state machine) landing on the same three sites and the same
partition is what makes the baseline trustworthy.

**Precision, measured against the real tree.** 3 matching sites, 3 genuine defects, **zero
false-positive files**. `build_sessions.rs:2949` is the one worth defending explicitly, because it
*does* eventually write `setup_detail` (at `:2984`): it is still flagged, deliberately, because the
two writes are separate statements on separate pool connections with separate `updated_at` values and
**asymmetric conditions** — the status write is inside `if !runtime_missing.is_empty()` (`:2946`)
while the detail write is unconditional (`:2965`) — so a re-promote that clears the last blocker
refreshes the account to "no blockers" and leaves the token at `needs_credentials` forever.

**No `exclude` entries.** The only candidate exemption would be a whole-file exclusion of
`connector_readiness.rs`, which the rule does not need — it discriminates on shape, and a whole-file
allowlist is how an allowlist becomes a hiding place.

**Fault injection against the real tree** (`node scripts/census/run-census.mjs --check --rules <file>`),
from a scratchpad file named `census-credready-9f42.json` unique to this composition:

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `OK detached-readiness-verdict 2 2 3 3 564 400` — surviving counts printed, 277 ms |
| matcher matches nothing (`no_such_column_zzq`) | **1** | `[structural] matched zero files anywhere…` + `[drift] files dropped 2 → 0` + `matches dropped 3 → 0` |
| floor above walk (`floor: 9000`) | **1** | `[structural] walked 564 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` → `…/commands/design`) | **1** | `[structural] walked 25 files but floor is 400` |
| count rises (baseline lowered to 1/1) | **1** | `[drift] matches rose 1 → 3 (+2)` |
| renamed root (`src-tauri/srcc`) | **1** | `walked 0 files but floor is 400` + `matched zero files anywhere` + both drops |
| count drops (baseline raised to 5/9) | **1** | `[drift] matches dropped 9 → 3 (-6) without the baseline moving` |
| stale `exclude` | **1** | `[structural] exclude "…/gone_forever.rs" matched no file. The exemption is stale…` |
| `exclude` with an 8-char `reason` | **1** | schema refusal *before any scan*: `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |

All nine behave as the contract requires. Full run: **0.28 s** over 564 files. The pattern is
forward-anchored with two tempered-greedy bodies and contains **no lookbehind**; the `[^"]` fill
class bounds every match inside one string literal.

#### Positive control — `credential-readiness-resolution-positive-control`

Published **without a `baseline` and with a `positive-control` id suffix so the registry merge skips
it. Do not merge this into `rules.json`.** It gates nothing. It is the same anchor pointed at the
**compliant** shape, so a validation run proves the gate discriminates on the presence of
`setup_detail` rather than on the token `setup_status`, and proves the walker reaches the resolver
module at all — which every other assertion here silently depends on.

```json
{
  "rules": [
    {
      "id": "credential-readiness-resolution-positive-control",
      "goldenPath": "docs/concepts/golden-paths/credential-readiness-resolution.md",
      "title": "POSITIVE CONTROL — not a gate. The COMPLIANT form of the same statement: an UPDATE of personas.setup_status that DOES carry setup_detail.",
      "roots": ["src-tauri/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "UPDATE\\s+personas\\s+SET\\s+setup_status\\s*=(?:[^\"]){0,240}?setup_detail\\s*=",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "The mirror image of detached-readiness-verdict: the same anchor (UPDATE personas SET setup_status =) pointed at the COMPLIANT shape, requiring setup_detail in the same statement. Expected: exactly 1 match, recompute_persona_setup at connector_readiness.rs:807. If this control ever reports 0 the walker is not reaching the resolver module and the sibling rule's clean run means nothing."
      },
      "floor": 400
    }
  ]
}
```

Validated standalone: `OK credential-readiness-resolution-positive-control 1 — 1 — 564 400`, exit 0,
matching `src-tauri/src/commands/design/connector_readiness.rs:807` and nothing else.

### 2. Rust test — the must-be-zero condition the census cannot express

Add to `connector_readiness.rs`'s test module. It asserts its own instrument first (the ledger
carries the fields at all), then the behaviour:

```rust
#[test]
fn a_revoked_or_expired_credential_is_not_usable() {
    let conn = test_db();
    def(&conn, "notion", r#"{"auth_type":"api_key"}"#);
    cred(&conn, "c1", "notion");
    field(&conn, "c1", "value");
    assert_eq!(connector_readiness(&conn, "notion"), Readiness::Ready, "instrument check");

    // needs_reauth is written by engine::oauth_refresh::mark_needs_reauth on a
    // typed AppError::OAuthRevoked — the app already knows this credential is dead.
    set_metadata(&conn, "c1", r#"{"needs_reauth":true}"#);
    assert!(!connector_readiness(&conn, "notion").is_ready(),
        "a credential the app has flagged needs_reauth must not resolve Ready");

    set_metadata(&conn, "c1", r#"{"oauth_token_expires_at":"2020-01-01T00:00:00Z"}"#);
    assert!(!connector_readiness(&conn, "notion").is_ready(),
        "an expired OAuth token must not resolve Ready");
}
```

It fails today on both assertions. Ship it **red** alongside the §4 `CredentialLiveness` change, not
before — a red test with no fix is a broken build, and a green one written after a partial fix pins
the partial fix.

### 3. Vitest — the cross-language contract the frontend keeps breaking

Two assertions, both cheap, both currently failing:

```ts
// 1. The run-gate refusal must not resolve to the generic validation rule.
expect(resolveError("Validation error: Persona 'X' is not ready to run — one or more of its connectors still need setup.").suggestion)
  .not.toBe('Review the highlighted fields and correct any errors.');

// 2. Every SetupKind the Rust enum can produce must have a localized remediation.
//    Guards against a new arm (e.g. Reauth) shipping with an English fallback.
for (const kind of SETUP_KINDS) expect(remediationFor(en, kind)).not.toBe(en.vault.setup_kind.generic);
```

`SETUP_KINDS` should be derived from the generated binding `src/lib/bindings/SetupKind.ts`, not
hand-listed — otherwise the test drifts with the enum it exists to guard.

### 4. Refusing to gate the biggest condition — with the measurement

**The largest deviation in this leaf — 58 client-side readiness computations against one resolver
call — gets no census rule, and the refusal is evidence-based rather than a shrug.**

The obvious proxy is a literal comparison of `healthcheck_last_success`, the backend's raw liveness
boolean, anywhere in `src/`. Measured with two implementations (a regex over whole file content, and
a line-oriented scanner skipping comment-only lines, over all 4,829 `.ts`/`.tsx` files): **20 raw
matches / 12 files**, reconciling to **18 / 12** once the 2 matches inside doc comments in
`useCockpitSummary.ts:17,:41` are excluded — the entire delta, which is exactly the comment-filter
behaviour `engine.mjs`'s `ignoreCommentLines` provides.

Classifying all 18 by hand: **~8 are genuine gates** (`useHealthyConnectors.ts:47`,
`useCockpitSummary.ts:89`, `ucPicker.tsx:86`, `useUcPickerState.ts:102`,
`useDynamicQuestionOptions.ts:95,:143,:196`, `useCreativeConnectors.ts:31`) and **~9 are legitimate
display** of a credential's own health on its own card (`AgentCredentialDemands.tsx:178,:181`,
`ConnectedServicesWidget.tsx:110,:112`, `ConnectorsSection.tsx:123,:124`,
`credentialListTypes.ts:34,:178`, `CredentialPlaygroundModal.tsx:65`). **A gate here would fire on
correct content roughly half the time, and the contract is explicit that such a gate is worse than
none.** Narrowing the anchor to `.filter(`/`.find(` recovers precision but drops the `continue`-guard
form, which is where three of the eight live — recall collapses to under half.

The structural fix is not a counter. It is **closing the producer**: export exactly one factory for
`ConnectorReadinessMap` (the hook), stop exporting the raw entry shape for hand-construction, and
delete `credentialCoverage.ts` (A4, zero production callers), `connectorRunnability.ts` (A1, already
drifted from the Rust rule it mirrors) and `connectorHealth.ts`'s verdict (A5) in favour of it. That
is the `createLazySection` result the contract cites — 22/22 factory sites correct vs 2/31
hand-rolled — applied to readiness. **When it lands, this refusal can be revisited: with one producer
the honest signal becomes "a `service_type` comparison outside the producer", which today would be
noise and then would be precise.**

---

## Convergence — checked, and it contradicts this document twice

Three sibling repos, read directly: `../brainiac` (Rust + Postgres + Next.js), `../personas-cloud`
(TypeScript orchestrator), `../personas-web` (Next.js).

**The brief's claim about `brainiac` is half true, and I was asked to re-verify rather than trust it
— so: it is true at exactly one site out of three in the same crate.** `mcp.rs:85-95` defines a
**three**-arm `ToolError { InvalidParams, Rejected, Internal }` whose two `From` impls (`:97-101`,
`:103-107`) both land on the operator arm `Internal`, so `?`-propagation is operator-by-default and
surfacing anything to a user requires the named constructors `invalid()` / `rejected()` (`:138-144`).
That is exactly the claimed property. But the same binary contains **`HttpError` (`http.rs:1909`), a
struct with no arms whose only `From` forces the author to name a status** — the opposite default —
and **`PreflightError` (`guard.rs:146`), which has the clean two-arm split and zero `From` impls**, so
the mechanism is absent. Three error types, three conventions, one crate. The property is real and
worth copying; "brainiac made it a type" is not a repo-wide fact.

**What replicates (physics):**

1. **Presence is the default readiness test; validity is the exception. 3/3.** brainiac 10
   presence-only vs 4 authenticating; personas-cloud 10 vs 1; personas-web 7 vs 1. The expression
   form is nearly identical across three languages — `Option::filter(|s| !s.is_empty())`,
   `x !== null`, `!!(a && b)`. Personas' `capability_contract.rs:276` (`!creds.is_empty()`) is the
   same instinct. §5's first two anti-patterns are doctrine.
2. **Two resolvers for the same credential, one weaker, both live in production. 3/3 — the strongest
   structural convergence in the sweep.** brainiac: `AuthContext::allows` (`auth.rs:131`) and
   `McpState::allows` (`mcp.rs:317`), hand-mirrored, plus a third hand-maintained table
   (`tool_scope`, `mcp.rs:232`) whose own comment says it *"MUST agree with the REST endpoint the
   tool shadows, or the same token would be allowed on one surface and refused on the other"*.
   personas-cloud: `tokenManager.hasToken()` (presence) vs `oauth.getValidAccessToken()`
   (expiry-aware) — and `/api/status` reports the **weak** one (`httpApi.ts:1608`) while dispatch
   uses the strong one, so the status endpoint can say connected while the next dispatch fails.
   personas-web: `hasSupabaseEnv()` returns a boolean while `getSupabase()` throws for the identical
   condition, and four route files each re-wrap it privately. **This is exactly §7 A and §7 D. It is
   not a Personas defect; it is the physics of this leaf.**
3. **The UI collapses distinctions the server took trouble to make. 3/3.** brainiac emits 401
   *"unknown token"* vs 403 *"token lacks the `{scope}` scope"* with machine-readable codes, and
   `console/src/lib/demo-fallback.ts:26-41` funnels 401, 403, 500, timeout and connection-refused
   into one amber *"the brainiac server is unreachable"* banner — with the loss **documented in the
   source** at `:33-38`. personas-cloud's `'No Claude token available (OAuth expired or not
   configured)'` names two mutually exclusive causes because the code cannot tell them apart.
   personas-web's `DashboardErrorBanner` renders a generic prefix plus the raw string. **§7 E1 is the
   same failure, reinvented a fourth time.**
4. **Expiry is a timestamp compared to `now`, never a state machine. 3/3.** Which is why §4's
   `CredentialLiveness` enum is the unclaimed structural answer rather than the obvious one.
5. **Config-absent means "feature off, degrade quietly", never "error". 3/3.**

**What does NOT replicate — and this contradicts two clauses I would otherwise have written as
doctrine:**

- **"Verify with a dedicated probe" is a Personas house convention, not physics. 0/3.** No sibling
  has a "test this credential" endpoint, button or CLI verb. In all three, round-trip verification is
  a *side effect of the first real call*. Personas is the outlier: `healthcheck_credential`, a
  three-valued `HealthProbeState`, a daily sweep and a Test-connection button are things none of the
  siblings invented. So §7 B3 (an outage demoting a credential) is a **cost Personas pays for a
  capability nobody else has**, not a defect the siblings avoided — and the fix is to make the probe
  outcome three-valued at the *gate*, not to remove the probe.
- **"The verdict should carry its own remediation" is also local. 0/3 carry structured remediation.**
  The closest sibling is `personas-web`'s `OrchestratorConfigError` (`orchestrator-config.ts:1-10`),
  which bakes the fix into a message *string*. Personas' `SetupKind` + `remediation_for()` +
  `SetupBlocker` is, measured against three repos, **the best readiness verdict in the family** — and
  §7 E3/E4 is the finding that the UI throws most of it away. That reframes this leaf's backlog:
  Personas does not need to build the thing; it needs to stop discarding it.
- **Scope as a checked dimension: 1/3 (brainiac only).** personas-cloud *captures and displays*
  scopes and never reads them (`oauth.ts:9,:142` → `httpApi.ts:1522`); personas-web has no scope
  dimension at all; Personas stores the granted scope string and never reads it (F1). So the third
  leg of "present, valid, scoped" is the **least converged of the three by a wide margin**, and this
  document treats it as a Gap (§8.2) rather than a prescription. Claiming otherwise would be
  aspiration dressed as doctrine.

**The controlled experiment inside one repo — the strongest form, and it is decisive here.**
`personas-cloud` runs **two credential classes in one process**:

| | Claude/Anthropic OAuth token | Connector credentials (Slack/Teams/Twilio/…) |
|---|---|---|
| Type | `OAuthTokens { accessToken, refreshToken, expiresAt, scopes }` (`oauth.ts:11-16`) | `PersonaCredential` (`shared/src/types.ts:77-91`) — encrypted blob + `lastUsedAt`, no status field |
| Distinguishable states | 3 (absent / expired / live) | 0 |
| Refresh | yes, mutex-guarded against single-use rotation (`oauth.ts:238-248`) | n/a |
| Gate before running | yes (`dispatcher.ts:1271`) | **none** — decrypt failure is `logger.error(…)` and the loop **continues** (`dispatcher.ts:722-724`), while `credentialHints` was already pushed at `:696` telling the agent the credential is available |
| Failure surfaced to the user | yes | no |

**The class whose credential got a type with an expiry field got a gate, a refresh and user-facing
copy. The class whose credential is an opaque blob got none of the four — in the same file, by the
same authors, at the same time.** `personas-web` shows the same experiment in miniature: five call
sites of one `hasSupabaseEnv()`, of which the **one** that returns a typed
`RoadmapResponseSource = "supabase" | "none" | "error"` (`api/roadmap/types.ts:3`) lets the caller see
which branch was taken, and the **four** that return a boolean silently fabricate data from the
filesystem. **1 typed vs 4 boolean, same repo, same underlying check.** That is the evidence for §4:
the type is what produces the gate, not the other way round.
