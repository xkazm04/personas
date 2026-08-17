# Golden path — Credential rotation and revocation

> **Topic path:** `integrations-security` › `credential-capture` › `credential-rotation-and-revocation`
> [situation spine](../situation-spine.md) · recurrence 8 · risk **HIGH** · sides: **client**
> (spine label — **see §12.1, it does not hold**) · `twoSided: true` (**holds**) ·
> convergence: **converged** (**see §12.2 — it fails, in the tenth way**) ·
> dimensions: **security · ui · function**
> `mergedFrom`: *Credential rotation policy* + *Credential kill-switch*
> Composed 2026-08-17 against `master` @ `f432a4ef3`.
>
> **Subject — a credential's second half.** Replacing it, revoking it, and knowing when it must
> go. What a rotation does to stored ciphertext, in-flight executions and cached handles; whether
> revocation propagates anywhere; whether anything expires; and whether the app can tell a
> rotated credential from a broken one.
>
> **Sweep.** Read end to end: `src-tauri/src/engine/rotation.rs` (1,443 lines),
> `src-tauri/db/src/repos/resources/rotation.rs`, `engine/connector_strategy.rs`,
> `engine/oauth_refresh.rs`, `engine/management_api.rs`, `engine/runner/credentials.rs`,
> `commands/credentials/{rotation,crud,broker,external_api_keys}.rs`,
> `db/src/repos/resources/credentials.rs`, plus the client half:
> `vault/shared/utils/credentialHealthScore.ts`, `vault/sub_credentials/components/features/
> {CredentialRotationSection,RotationActivePolicy,RotationNewPolicy,RotationPolicyControls,
> RotationCountdownRing,AnomalyScorePanel}.tsx`, `card/banners/ReauthBanner.tsx`,
> `overview/sub_analytics/components/RotationOverviewPanel.tsx`, `stores/slices/vault/rotationSlice.ts`.
> Census walk: **564** `.rs` under `src-tauri/src` (the runner's own `walked`).
>
> **Measured by executing, not reading.** Every number below was **replayed** against a read-only
> **copy** of the operator's live 347 MB `personas.db`, copied 2026-08-17 00:19 UTC with the app
> running. The live file was never opened for write; the copies were deleted afterwards. Corpus:
> 25 credentials, 42 credential fields, 2 rotation policies, 2 rotation-history rows, 9,803 audit
> rows, 1,029 self-minted grants, 2,188 executions.
>
> Four things were executed rather than argued:
> 1. **`record_rotation` was replayed against the real table for every `rotation_type` the engine
>    can supply.** 11 values reachable; **6 rejected by the CHECK constraint** (§0.1).
> 2. **`evaluate_due_rotations`' success branch was replayed for a live `oauth_keepalive` policy**
>    — the history INSERT is rejected, and `mark_rotated` advances the clock anyway (§0.2).
> 3. **`credentialHealthScore.ts` was replayed for all 25 credentials**, with the counterfactual
>    that the two disabled policies were still enabled (§0.4).
> 4. **The audit ledger's retention was partitioned** by whether the credential still exists
>    (§0.5).
>
> **`cargo` was NOT run.** Every Rust claim is static or replayed in SQL/Python.
> **Nothing was rotated, revoked, deleted or re-encrypted.** No provider API was called. **No
> secret value, prefix, partial or length appears below** — shape, column, age and count only.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It **inverted the spine's `converged` label**
> and found **two of three apparent convergences are ports** (§6).
>
> **Settles:** what "rotate this credential" and "kill this credential" have to actually do.

---

## 0. The headline

**This app has a rotate verb that replaces nothing and no revoke verb at all. `rotate` runs a
healthcheck, and on success stamps `last_rotated_at = now`; the secret it was asked to rotate is
byte-identical afterwards. There is no way to revoke a credential the app *holds* — only to delete
it, which erases the ledger that proves it existed. Meanwhile the app can revoke every grant it
*issues*, six different ways.**

Six `revoke` commands exist: `revoke_broker_consumer` (`broker.rs:64`), `revoke_external_api_key`
(`external_api_keys.rs:70`), `revoke_pairing` (`:217`), `revoke_desktop_approvals`
(`desktop.rs:99`), `fleet_companion_revoke` (`fleet/pairing.rs:333`), `revoke_peer_trust`
(`network/identity.rs:113`). **Every one of them revokes something the app issued. Zero revoke
anything the app holds.** The asymmetry is the leaf.

### 0.1 — Six of the eleven rotation-history writes are rejected by the database, and all eleven discard the rejection

`credential_rotation_history.rotation_type` carries
`CHECK(rotation_type IN ('scheduled','manual','token_refresh','suspicious','anomaly'))` — verified
against the live DDL. `record_rotation` (`db/src/repos/resources/rotation.rs:386`) is called from
**11 sites**, all in `engine/rotation.rs`, and the values it can be handed come from three
sources. Replayed by INSERTing each one into a throwaway copy of the real table:

| `rotation_type` supplied | where it comes from | DB verdict |
|---|---|---|
| `scheduled` | `&policy.policy_type` (`:475`, `:512`, `:448`) | **accepted** |
| `manual` | `rotate_credential_now` (`commands/.../rotation.rs:140`) | **accepted** |
| `anomaly` | 6 literal sites (`:554`, `:576`, `:609`, `:692`, `:716`, `:789`) | **accepted** |
| `token_refresh` | *nothing supplies it* | accepted, unreachable |
| **`oauth_keepalive`** | `&policy.policy_type` — **the only policy type the app auto-provisions** (`:1327`, `:1393`) | **REJECTED** |
| **`on_suspicious`** | `&policy.policy_type` (a legal `policy_type`) | **REJECTED** |
| **`on_member_departure`** | `&policy.policy_type` (a legal `policy_type`) | **REJECTED** |
| **`anomaly_remediation`** | `rotate_now(…, "anomaly_remediation")` (`:824`) | **REJECTED** |
| **`event:cron_schedule`** | `format!("event:{}", …)` (`:1103`) | **REJECTED** |
| **`event:expiration_threshold`** | same | **REJECTED** |
| **`event:healthcheck_failure`** | same | **REJECTED** |

**Two closed vocabularies, one assignment, no type between them.** `credential_rotation_policies.
policy_type` is CHECK'd to `{scheduled, on_suspicious, on_member_departure, manual,
oauth_keepalive}`; `credential_rotation_history.rotation_type` is CHECK'd to a *different* five.
The intersection is two words. `rotation.rs:475` passes one straight into the other.

**All 11 call sites are `let _ = rotation_repo::record_rotation(…)`.** So the rejection is not
logged, not surfaced, not counted. It is a `Result` dropped on the floor at 11 of 11 sites — 100 %.

> **The one policy type the app creates for itself is one of the six the database refuses.** Both
> live policy rows are `oauth_keepalive`.

### 0.2 — And the clock advances anyway

`evaluate_due_rotations`' success branch, replayed verbatim against a copy of the real database
using the operator's own live `oauth_keepalive` policy:

```
policy oauth_keepalive, interval 1d
  before: last_rotated_at=None  next_rotation_at=2026-06-11T17:39:28+00:00
  history row: REJECTED (CHECK constraint failed: rotation_type IN (…))   ← discarded by `let _ =` at :475
  after : last_rotated_at=2026-08-16T22:38:21  next_rotation_at=2026-08-17T22:38:21
```

`mark_rotated` (`:482`) runs unconditionally on the line after the discarded write. The policy now
says the credential was rotated today and is next due tomorrow. **The history has no row. The
secret has not changed.** Three independent statements about the same event, and the only one that
persists is the false one.

### 0.3 — What `rotate` actually does

`strategy.rotate(pool, &credential)` is dispatched through the connector registry
(`rotation.rs:469-470`). There are **12 registered strategies plus a default**, and **four
`async fn rotate` bodies in one file — three distinct behaviours**, since Google (`:460`) and
Microsoft (`:493`) both delegate to the same helper:

| implementation | what it does | replaces the secret? |
|---|---|---|
| `ConnectorStrategy::rotate` default (`connector_strategy.rs:84-152`) | snapshot fields → `run_healthcheck` → on success return `"API key verified healthy: …"` | **no** |
| `DefaultStrategy::rotate` (`:376-432`) — the fallback for every unregistered `service_type` | OAuth → `refresh_single_credential`; **API key → `run_healthcheck`** | **only on the OAuth arm** |
| `rotate_via_refresh_and_healthcheck` (`:633-646`) — Google, Gmail, Microsoft | `refresh_single_credential` then verify | **yes — this is a token refresh** |

So of the two things a user could mean by *rotate*, the app implements the protocol-mandated OAuth
**refresh** and does not implement **replacement of a long-lived secret at all**. For an API key
the entire operation is a GET.

**And the only branch that rewrites stored ciphertext is the failure branch.** `:132` and `:144`
call `save_fields(pool, &credential.id, &original_fields)` to "restore" values nothing modified —
and `save_fields` (`credentials.rs:1211-1262`) `DELETE`s every row for the credential and
re-`INSERT`s each with a fresh IV, a fresh row id and a fresh `updated_at`. The repo already knows
this is wrong: `update_fields_targeted`'s doc comment (`credentials.rs:1264-1275`) records that
`save_fields` *"amplified a single-token rotation into a full rebuild of every field row, opened a
window where a crash between DELETE and INSERT lost the whole credential, and re-classified every
field on each refresh."* **The runtime refresh path was fixed. The rotation engine was not, and it
is the one whose name is rotation.**

### 0.4 — Disabling the policy *raises* the health score

`credentialHealthScore.ts:56-67`:

```ts
function rotationSubScore(status: RotationStatus | null): number {
  if (!status || !status.policy_enabled || !status.next_rotation_at) return 100;   // :57
  const msRemaining = new Date(status.next_rotation_at).getTime() - Date.now();
  if (msRemaining <= 0) return 0;                                                   // :60  expired
  …
}
```

Eight lines above it, `healthcheckScore` (`:37-49`) answers the identical question the opposite
way, with the incident written down: *"a connector with no live probe is UNVERIFIABLE — that is
neutral evidence, not health. Scoring it 100 made the composite dot claim 'healthy' for
credentials nothing ever checked."* **`rotationSubScore` returns the maximum for three distinct
absences** — no status, no policy, or a policy that was switched off.

`Remediation::Disable` (`rotation.rs:553`) calls `disable_policy`. `get_rotation_status`
(`:925-934`) then finds no `active_policy`, so `policy_enabled` is `false`, so `rotationSubScore`
returns **100**. Replayed against all 25 live credentials, with the counterfactual that the two
disabled policies were still enabled:

| | value |
|---|---:|
| `rotationSubScore` = **100** | **25 of 25** — 23 with no policy row, **2 whose policy was disabled** |
| the two disabled ones' shipped score / tier | **60 / `warning`** |
| the same two if the policy were still enabled (`next_rotation_at` is 67 days past) | **40 / `degraded`** |
| **points awarded for the policy having been turned off** | **+20 each** |
| reachable composite values on this install | **{60, 80, 100}** |
| tiers structurally unreachable | **2 of 4** (`degraded` ≤ 45, `critical` ≤ 20) |

**The remediation for a permanently-failing credential is scored as a recovery.** The two
credentials in question are the operator's `gmail` and `google_calendar`: OAuth grants that expired
**75** and **98** days ago, `needs_reauth: true` since 2026-06-09 and 2026-05-17, 49 and 21
consecutive refresh failures. The app has diagnosed them correctly at every layer and renders them
amber.

### 0.5 — Deleting a credential truncates the ledger that would have recorded it

`delete_credential` (`crud.rs:254-282`) calls `repo::delete` at `:269` and writes the audit row at
`:271` — *after*. And `repo::delete` (`credentials.rs:464-467`) contains:

```rust
tx.execute("DELETE FROM credential_audit_log WHERE credential_id = ?1", params![id])?;
```

`credential_audit_log` is the append-only ledger the product renders
(`AuditLogTable.tsx`, `CredentialIntelligence.tsx`) and which
[automated-credential-provisioning](./automated-credential-provisioning.md) §9 gates as *the*
destination for credential-lifecycle writes. Partitioned on the live corpus by whether the
credential still exists:

| | rows | credentials | rows each |
|---|---:|---:|---:|
| still live | **9,786** | 25 | **391.4** |
| deleted | **17** | 13 | **1.3** |

The 17 survivors are 10 `delete` rows (written after the truncation), 3 `oauth_initiated`, 3
`oauth_completed` and 1 `decrypt` — every one of them written by a path that ran *after* the
`DELETE`. **Four `GitHub PAT` credentials were deleted on 2026-07-23 within eight seconds of each
other; their entire decrypt history went with them.** The operation a user reaches for as a kill
switch is the one that destroys the evidence.

`credential_consumer_edges` — the only record of *observed* usage, UPSERTed by the proxy on every
call (`broker_edges.rs:40`) — has **no foreign key** to `persona_credentials`
(`incremental.rs:7241-7251`) and is **not** in `delete`'s explicit cleanup list, so its rows orphan
permanently. It is also **absent from `blast_radius`** (`credentials.rs:476-560`, which reads
events, policies, personas and automations), so the delete dialog's impact preview cannot name a
single external consumer. Live: 0 rows, so this is latent.

### 0.6 — Nothing expires, and nothing is watching

| | value |
|---|---:|
| `persona_credentials` columns carrying an expiry | **0** — `id, name, service_type, encrypted_data, iv, metadata, last_used_at, created_at, updated_at, scoped_resources` |
| credentials older than the app's own default rotation interval (90 d, `rotation.rs` repo `:120`) | **21 of 25** |
| credentials ever rotated (`last_rotated_at` non-null on any policy) | **0** |
| enabled rotation policies | **0 of 2** |
| `credential_events` rows (the `expiration_threshold` mechanism) | **0** |
| `external_api_keys` with `expires_at` | **0 of 1,029** |
| `data_stale`, recomputed live from each ring buffer | **true on 25 of 25** |
| …and `count_1h == 0` on **25 of 25**, so `rotation.rs:274` short-circuits to `Remediation::Healthy` | **25 of 25** |
| rotation-history rows in the whole database | **2**, both `anomaly`/`failed`, from April and May |
| `credential_audit_log` rows for `credential_rotated` / `credential_rotation_failed` | **0** — the manual **Rotate Now** button has never been pressed |
| last `oauth_token_refreshed` audit row | **2026-06-02** — 76 days ago |

**Every mechanism in this leaf is armed and has never fired**, except the one that turns itself off.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path,
primitive name or count. Each clause names its warrant, so an adopting repo can tell physics from
local calibration.

> **P1 — physics, and the whole subject. *A rotation that does not replace the secret is not a
> rotation; it is a healthcheck with a side effect on a clock.*** The dangerous form is not a
> rotation that fails — a failure is visible. It is a rotation that **succeeds at something else**
> and reports success: verify the credential, stamp `last_rotated_at`, schedule the next one. Every
> downstream consumer then believes the secret is fresh. The discriminator to write into the code
> is whether the stored ciphertext differs afterwards, and it must be checked, not assumed.
> *Warrant: measured here as three `rotate` implementations of which one replaces anything, with a
> `mark_rotated` on the line after; and externally as a fleet in which **no repo has a rotate verb
> at all** — the two that thought hardest about credentials both implement the lifecycle as
> mint-new-then-revoke-old.*
>
> **P2 — physics, 2 of 2 independent siblings. *Rotation is not an operation on a credential. It is
> the creation of a new one and the revocation of an old one.*** An in-place `UPDATE secret = ?`
> has no moment at which both values are valid, so it cannot be rolled back, cannot be verified
> before cutover, and cannot tell a consumer which one it holds. Mint, verify, switch, revoke —
> four steps, each observable. *Warrant: two codebases in different stacks independently built
> `create` / `list` / `revoke` / `resolve` with **no update verb**, and one of them wrote down that
> a leaked key must not be able to issue more keys. The repo that built a `rotate` verb instead is
> the one whose rotate replaces nothing.*
>
> **P3 — physics, converging as a unanimous absence. *A long-lived credential must carry an expiry
> and the expiry must be enforced where it is read, not where it is displayed.*** Every codebase
> that stores credentials enforces expiry rigorously on the *short-lived derived* tokens it mints —
> pairing codes, share links, installation tokens — and omits the column entirely on the long-lived
> keys those tokens protect. The technique is never missing. Its application to the thing that
> matters is. *Warrant: 0 of 4 repos-that-could expire a stored long-lived credential; 3 of 4
> enforce expiry at read time on a derived token in the same schema. Two arrived independently at
> `created_at / last_used_at / revoked_at` and independently omitted `expires_at`.*
>
> **P4 — physics, 0 of 4, and the one clause nobody in the fleet has any answer to. *Revocation
> must have a defined relationship to work already in flight, and "none" is a decision that has to
> be written down.*** A secret handed to a subprocess, a cached handle, a decrypted map on a
> running task's heap — none of these are reached by flipping a row. Either the revoke cancels the
> work, or the work re-resolves at a boundary, or the exposure lasts until the work ends. All three
> are defensible; not choosing is not. *Warrant: not one of four codebases kills in-flight work on
> revocation. The starkest case injects the plaintext into a spawned child's environment, owns a
> cancel primitive, and never calls it on revoke.*
>
> **P5 — physics, 1 of 4, and the minority is right. *A cached copy of a credential must have an
> invalidation hook and something must call it.*** The cache is the part of the system that
> continues to believe. A revocation that reaches the store and not the cache produces a window
> whose length is the TTL and whose existence is invisible. *Warrant: exactly one sibling
> invalidates a cached credential on a 401 and self-heals once, with tests. Every other codebase in
> the cohort — including this one, which declares the identical function and never calls it — has
> the hook or the cache but not the wire between them.*
>
> **P6 — physics, 0 of 4. *Local revocation is not revocation. Say so where the user can read
> it.*** Flipping a row stops your process from using a secret; it does not stop anyone else. If
> you cannot call the provider, the honest product statement is "removed from this device", not
> "revoked". *Warrant: no repo in the cohort tells the provider anything on revoke; one clears an
> in-memory field and returns `{status: 'disconnected'}`; the only one that behaves well says the
> limit out loud in its own UI copy.*
>
> **P7 — house-confirmed, and the fleet is BEHIND here. *Distinguish a credential that broke from
> one that was taken away — and carry the distinction all the way to the button.*** A transient
> 503 and a revoked grant produce the same failed probe and want opposite responses: retry, versus
> stop and ask the human. Classifying at the protocol layer is the easy half; the hard half is that
> the recovery UI must branch on **cause**, not on where the credential came from.
> *Warrant: this repo is the only one of six that names `invalid_grant` / `unauthorized_client` /
> `interaction_required` / `consent_required`, converts them to a distinct error variant, and
> persists a `needs_reauth` flag — and its own banner then branches on provenance instead, so the
> distinction dies one layer from the user.*
>
> **P8 — physics, independently reinvented in another language. *A lifecycle write whose failure is
> swallowed is worse than no lifecycle write.*** The record of a rotation, a revocation or a policy
> change is the only evidence the action occurred. Evaluate it for its side effect alone and a
> rejected write is indistinguishable from a performed one — and the belief it creates is
> specifically that a dangerous thing is now safe. *Warrant: another team, in another language, wrote
> the reason into their own source: "A swallowed revoke is dangerous: the operator believes a
> compromised key is dead when it is still active." Measured here: 22 of 29 lifecycle writes discard
> their result, and one of them is currently hiding a reproducible database rejection.*
>
> **P9 — ergonomics, security-load-bearing. *Removing the control must not improve the verdict.***
> Wherever a posture is scored, banded or badged, "not governed" must not outrank "well governed".
> If it does, every remediation that switches something off is rewarded, and the population that
> most needs attention becomes the population that scores best. *Warrant: measured here as +20
> points awarded at the exact moment the app gives up on a credential — and the identical question,
> answered correctly, sits eight lines above in the same file with the incident in its comment.*
>
> **P10 — ergonomics. *Delete is not revoke, and a product that offers only delete has no kill
> switch.*** Revoke keeps the record and removes the power; delete removes both. Offering only
> delete means the fastest response to a suspected compromise also destroys the evidence needed to
> assess it. *Warrant: measured here as a ledger retaining 391 rows per living credential and 1.3
> per deleted one; and as six revoke commands for grants the app issues against zero for
> credentials it holds.*
>
> **Scale condition.** P1, P2 and P8 are correctness on day one. P3 and P9 bite the first time
> anyone looks at a dashboard and believes it. P4, P5 and P6 bite on the first real incident, which
> is the worst possible time to discover them. P7 bites on the first expired grant. P10 bites once.

---

## 1. Trigger

- "add rotation for these credentials" / "rotate the key every 90 days"
- "show when this key expires" / "warn me before it expires"
- "give me a kill switch for this credential" / "revoke it everywhere"
- "the token got revoked — how do we notice?" / "why does it still say healthy?"
- "mark it rotated" / "reset the rotation clock"
- "just delete it and make a new one"

**If you are about to write** a `rotated_at` / `last_rotated_at` / `next_rotation_at` column, a
function called `rotate` that does not `UPDATE` a secret, a `revoked` boolean, an `expires_at` you
will only render, a `let _ =` / `.ok()` / `catch {}` on a write that records a rotation or a
revocation, a policy-`enabled` toggle, or a health score that reads a rotation field — **you are in
this situation.**

**You are especially in it when you are about to disable something as a remediation.** Turning a
control off is the moment its absence starts being scored, and absence is the default-best value
almost everywhere.

**Not this path:** obtaining a credential from a human is
[credential-capture-form](./credential-capture-form.md); obtaining one without a human is
[automated-credential-provisioning](./automated-credential-provisioning.md); the OAuth handshake
and its refresh cadence is [oauth-connect-flow](./oauth-connect-flow.md); what a child process
should hold is [credential-injection-into-child](./credential-injection-into-child.md); whether the
value leaks on the way out is [secret-and-pii-redaction](./secret-and-pii-redaction.md); the
encryption of the column is [column-encryption-at-rest](./column-encryption-at-rest.md); what a
number has to earn before it becomes a verdict is
[scoring-and-thresholds](./scoring-and-thresholds.md); what `DELETE` should mean is
[delete-semantics](./delete-semantics.md).

### The seam with `oauth-connect-flow`, which is the one people get wrong

> **Refresh is the protocol keeping a grant alive. Rotation is the operator deciding a secret has
> lived long enough.** They share a verb and share nothing else.

A refresh is initiated by the machine, on the provider's schedule, and its failure means *the grant
is gone*. A rotation is initiated by a policy or a human, on your schedule, and its failure means
*the old secret is still valid*. This repo routes both through `strategy.rotate` and therefore has
no way to say which happened — `rotation.rs:1327` auto-provisions a policy named `oauth_keepalive`
whose entire job is to force a refresh, and it lands in the same table, the same history and the
same countdown ring as a 90-day key rotation.

---

## 2. The one way

**Make rotation mean *mint a new secret, verify it, switch consumers, revoke the old one* — four
observable steps — and refuse to advance any clock unless the stored ciphertext actually changed.**
Concretely: (a) **give the rotate path a return type that names what happened** —
`Replaced { old_id, new_id } | Refreshed { expires_at } | Verified` — so "I ran a healthcheck"
cannot be reported as "I rotated", and make the clock-advancing call take only the `Replaced` arm.
(b) **Never derive one closed vocabulary from another without a type between them**: if a policy
kind and a history kind are different enumerations, they need a total mapping function, not an
assignment. (c) **Write the lifecycle row inside the same transaction as the state change, and
never discard its `Result`** — `if let Err(e) = … { tracing::warn!(…) }` costs three lines, keeps
the loop going, and is already present eight hundred lines below the sites that do not use it.
(d) **Add `expires_at` to the credential, enforce it where the credential is read, and let absence
be `NULL` meaning unknown rather than infinite** — an unknown expiry must not score as a good one.
(e) **Ship a `revoke` for the credential, separate from `delete`**: it flips a state, keeps every
row, writes a ledger entry, and blocks resolution at the read path. Delete stays for "I never want
to see this again", and it must not truncate the ledger. (f) **Decide, in writing, what revocation
does to work already running** — cancel it, let it finish, or re-resolve at the next boundary — and
put the sentence in the revoke function's doc comment. (g) **Give every cache keyed by credential
an invalidation call and wire it to the rotate and revoke paths**; a hook nobody calls is worse
than no hook, because the next author reads it as coverage. (h) **Branch recovery UI on the
classified cause, not on how the credential was captured** — you already know the difference
between `invalid_grant` and a 503; carry it. (i) **Never let the removal of a control raise a
score**: absence of a rotation policy is *unknown*, not *healthy*, and a disabled policy is
*worse* than an enabled one.

If you must get one right first: **(a)**. Every other clause is unreachable while the system cannot
distinguish a rotation that happened from one that did not — including (c), because there is no
point recording an event you have misnamed.

---

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
|---|---|
| `src-tauri/src/commands/credentials/broker.rs:59-83` `revoke_broker_consumer` | **The one correct kill switch in the repo, and the model for the missing one.** Its doc comment states the propagation contract explicitly — *"Takes effect on the consumer's very next request (`find_by_token` filters revoked keys), and the consumer's blast-radius edges drop out of the dependents graph immediately."* It uses `?` on the revoke, writes `settings_audit_log`, and logs. **Copy the doc comment as much as the code**: it is the only place in this territory that says *when* a revocation takes effect. |
| `db/src/repos/resources/credentials.rs:1264-1310` `update_fields_targeted` | **The write shape a real rotation needs**: upsert only the changed keys in one transaction, stable row ids, and it deletes the legacy camelCase alias in the same transaction *"so a stale duplicate can't shadow (or survive alongside) the row we just wrote"*. Its doc records exactly why `save_fields` is the wrong primitive here. |
| `src-tauri/src/engine/runner/credentials.rs:753-765` | **Resolve at use, not at start.** Takes a per-credential lock, then **re-reads the credential inside the lock** *"to pick up any token refreshed by a concurrent execution that held the lock before us"*. This is what makes in-flight propagation possible at all in this app, and it is why revocation is *one boundary* away from working rather than architecturally impossible. |
| `src-tauri/src/engine/connector_strategy.rs:504-527` `is_revocation_error` | **The revoked-vs-broken classifier, and this repo is the only one of six that has one.** Four standard OAuth error codes plus two Google-specific descriptions, each documented on its own line, converted to a distinct `AppError::OAuthRevoked` variant at `:553-558`. Two consumers. **The fleet has nothing comparable** (§6). |
| `src-tauri/src/engine/oauth_refresh.rs:949-960` `mark_needs_reauth` + `:606-607` the clear | The persisted "this needs a human" flag, set on classified revocation and **cleared in the same patch that succeeds** — both halves present, which is rarer than it sounds. |
| `src-tauri/src/engine/rotation.rs:42-77` the lock set | `ROTATION_EVAL_RUNNING` + a per-credential `HashSet`, with `is_credential_rotating` used at `:1087-1094` to **defer** a firing rather than drop it, and the reason in the comment: *"last_polled_at would still advance, losing a scheduled tick forever (the 2am-Saturday class of bug)"*. Concurrency here is genuinely well done. |
| `src-tauri/db/src/repos/resources/rotation.rs:137-155` | `transaction_with_behavior(Immediate)` around disable-then-insert, with the race it closes written out. The single-active-policy invariant is enforced correctly. |
| `src-tauri/src/engine/rotation.rs:1382-1389` | **The compliant form of the very thing 21 sites in the same file get wrong**: `if let Err(e) = rotation_repo::disable_policies_for_credential(…) { tracing::warn!(…) }`. Three lines. Same file. |
| `src-tauri/src/engine/credential_broker.rs:40-46,:130-183` `mint_derived_handle` | The narrow grant with a clamped TTL — *"'Short-lived' is a security property, not a suggestion"* — and an audit row at mint. Owned by [automated-credential-provisioning](./automated-credential-provisioning.md); named here because **it is the only expiring credential-shaped object in the product**, and it has 0 rows. |
| `src/features/vault/shared/utils/credentialHealthScore.ts:37-49` `healthcheckScore` | Neutral-not-flattering for an absent probe, with the incident in the comment. **The answer `rotationSubScore` needed and did not copy from eight lines above it.** |
| `src/features/vault/sub_credentials/components/features/RotationCountdownRing.tsx:8-73` | The one good piece of rotation UI: a 36 px arc whose fraction is `remaining / (intervalDays × 86400)`, with an i18n'd aria-label (`:31`). Nothing wrong with it except that it never renders (§7 D6). |
| `src/features/overview/sub_analytics/components/RotationOverviewPanel.tsx:66-83` | `parseServerMs` + structured `countdownParts` → `{isDue, days, hours}`, localized via `tx()` at `:210-213`. **The correct of the three countdown implementations** — the other two hardcode English and use bare `new Date()`. |

**Do not exist — this path names them:**

- **Any way to revoke a credential the app holds.** Six revokes for grants the app issues, zero for
  credentials it stores.
- **Any expiry on a stored credential.** No column, no check, no read-path filter.
- **Any rotation that replaces a long-lived secret.** Three `rotate` impls; one refreshes an OAuth
  token; none mints.
- **Any total mapping from `policy_type` to `rotation_type`.** Two CHECK'd vocabularies with a
  two-word intersection and a bare assignment between them.
- **Any consumer of `invalidate_tools_cache`** (`engine/mcp_tools.rs:212`) — declared, documented
  *"e.g. after server reconnect"*, **0 call sites**.
- **Any control to re-enable a disabled rotation policy.** The UI can create one, change its
  interval and delete it; `enabled: false` is written only by
  `src/lib/credentials/remediationExecutor.ts:45`, an automated path.
- **Any TS binding for `refresh_credential_oauth_now`, `get_oauth_token_metrics` or
  `get_oauth_token_lifetime_summary`** — three registered privileged commands with zero frontend
  callers, one of which is the OAuth twin of the CLI recapture the ReauthBanner does use.

---

## 4. Steps

1. **Write down what "rotated" means for this credential kind before writing the function.** For an
   OAuth grant it is *the provider issued a new access token*; for an API key it is *a new secret
   exists and the old one is dead*; for a CLI-sourced value it is *the CLI was re-read*. Three
   different postconditions. One verb is not enough.
2. **Give the rotate path a return type that names the postcondition** (below). Do not return
   `String`.
3. **Mint before you revoke, and verify between them.** The old secret stays valid until the new
   one has passed a probe. This is what makes rollback possible and it is what the two sibling
   codebases that got this right both do.
4. **Persist the new secret with a targeted upsert inside one transaction**, never delete-all +
   reinsert.
5. **Write the lifecycle row in that same transaction, and consume its `Result`.** If the row is
   rejected the state change must not commit. **And then stop** — do not add a `tracing::info!` and
   call it an audit trail.
6. **Advance the clock from the row, not beside it.** `last_rotated_at` should be derived from the
   committed history entry, so a rejected write cannot leave a stamped policy behind.
7. **Set `expires_at` when the provider tells you one, and `NULL` when it does not** — and make the
   read path treat `NULL` as *unknown*, never as *never*.
8. **Ship revoke and delete as different operations.** Revoke flips state, keeps rows, writes the
   ledger, and is checked at the resolve path. Delete keeps the ledger too.
9. **Decide the in-flight contract and write it in the doc comment.** `revoke_broker_consumer:59-61`
   is the sentence to copy.
10. **Invalidate every cache keyed by the credential in the same function**, and if there is no such
    cache, say so in the comment so the next author does not add one silently.
11. **Branch the recovery UI on the classified cause.** You already produce `AppError::OAuthRevoked`;
    carry the class over IPC and let the banner read it.
12. **Check every score, badge and filter that reads a lifecycle field for the absence answer.**
    Absent policy, absent expiry, disabled policy — none of them may be the best value.

### Can the type make the wrong call impossible? — asked before §9

**Yes for the leaf's central defect, decisively, and it is one enum plus one signature. No for the
ledger-write half, and Q7 says why — which is exactly what §9 gates.**

**T1 — make "I rotated it" unrepresentable when nothing was replaced.**

```rust
// today — connector_strategy.rs:84, :376, :460, :493
async fn rotate(&self, pool: &DbPool, cred: &PersonaCredential) -> Result<String, AppError>;
// callers: rotation.rs:475 record_rotation(Success, Some(&detail)); :482 mark_rotated(policy.id)

// the fix
pub enum RotationOutcome {
    /// A new secret exists and the old one is dead. Carries both ids so the
    /// switch is auditable and reversible.
    Replaced { previous_field_rev: i64, new_field_rev: i64 },
    /// A provider-issued short-lived token was renewed. NOT a rotation of the
    /// long-lived secret behind it.
    Refreshed { expires_at: DateTime<Utc> },
    /// The existing secret was confirmed to still work. Nothing changed.
    Verified,
}
async fn rotate(&self, …) -> Result<RotationOutcome, AppError>;

// and the clock-advancing call accepts only the arm that earned it:
fn mark_rotated(pool: &DbPool, policy_id: &str, _: &Replaced) -> Result<(), AppError>;
```

Held against the corpus's seven qualifications:

- **Q3 — count the construction sites.** **3** `rotate` implementations
  (`connector_strategy.rs:84`, `:376`, `:633` via `:460`/`:493`) and **2** call sites
  (`rotation.rs:470`, `:881`). `mark_rotated` has **2** call sites (`:482`, `:897`). Nine edits
  total, one crate, all enumerable. **Passes comfortably** — and note it passes *because* the
  surface is small, which is also why the defect survived: nobody was forced to look at it twice.
- **Q5 — withholding beats requiring.** This is the load-bearing half. Do not *require* the author
  to check whether the secret changed; **withhold `mark_rotated` from every path that cannot produce
  a `Replaced`.** The dangerous freedom is the ability to advance a lifecycle clock from a code path
  that ran a GET.
- **Q6 — withhold the dangerous freedom, not the answer.** The strategy keeps everything it
  legitimately knows: which provider, what message, whether the probe passed. What it loses is the
  ability to have that reported as a rotation. `Verified` is still a useful, recordable outcome —
  and today it is the *only* outcome, silently relabelled.
- **Q1 — a type carries only what it encodes.** `RotationOutcome` encodes *what happened to the
  secret*. It does **not** encode whether the history row was written, whether a consumer was
  switched over, or whether the old secret was revoked upstream. Pretending otherwise is the
  mistake this qualification exists to prevent, and §9 gates the write half separately for exactly
  that reason.
- **Q2 — requiredness is orthogonal to closedness.** Both edits are needed and they are different.
  Today's `String` is neither required-to-be-meaningful nor closed. Making the return type
  *non-optional* changes nothing (it already is); **closing** it is the entire win.
- **Q4 — a type anyone can construct authenticates nothing.** A strategy author can return
  `Replaced { … }` from a function that replaced nothing. That residue is real. It is much smaller
  than today's, because `Replaced` carries two field revisions that a reviewer can trace, and
  because the wrong arm is a line somebody wrote on purpose. **The honest limit, stated first.**
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.**
  This is the qualification that decides the second half of the leaf. `rotation.rs:475` passes
  `&policy.policy_type` into `rotation_type` **voluntarily**; nothing forces it. Widening
  `record_rotation`'s parameter type does nothing. **The fix there is withholding the
  *construction*: `record_rotation` should take a closed `RotationKind` enum, and the conversion
  from `PolicyType` should be a total function** — `impl From<PolicyType> for RotationKind` — which
  makes the six rejected values impossible to express and forces someone to decide what
  `OAuthKeepalive` maps to.

**T2 — the two vocabularies.** `policy_type` and `rotation_type` are both CHECK-constrained
`TEXT`, both crossing as `String`, both with a documented closed set, and **no Rust type
represents either**. Two `#[derive(Serialize, Deserialize)]` enums with `#[serde(rename_all)]`,
plus a `From` impl, make §0.1's entire table a compile error. This is the **only** edit in this
document that removes a *live, reproducible, currently-firing* defect.

**T3 — NO for the ledger-write half, and this is where the type ends.** No Rust type prevents
`let _ = f()` where `f() -> Result<T, E>`. `#[must_use]` does not: it fires on an *unused*
expression, and `let _ = …` is the sanctioned way to say "I meant to ignore this" — it is precisely
the escape hatch. `clippy::let_underscore_must_use` exists and is **allow-by-default and not
enabled here**; enabling it repo-wide would fire on hundreds of deliberate fire-and-forget
`app.emit` calls (`unverified-effect-dispatch` baselines 162 of those). **The residue is a
vocabulary-scoped count, and that is exactly what §9 ratchets.**

**Propose T2 first (one live rejection, ~30 lines), T1 second (nine edits, the leaf's central
lie), and §9's census rule as the ratchet that holds the write half until someone decides what
each of those 22 sites should do on failure.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A `rotate` that runs a healthcheck and returns success** | The one outcome the operator cares about — *is the secret different* — is the one not reported. **Measured: 3 rotate impls, 1 replaces anything; on the API-key path the whole operation is a GET** (`connector_strategy.rs:406-410`). §0.3. |
| **Advancing a lifecycle clock on the line after a discarded write** | `record_rotation` is rejected, `mark_rotated` stamps anyway. Replayed: the policy says *rotated today, next due tomorrow*; the history has no row and the secret is unchanged. §0.2. |
| **Passing one CHECK'd vocabulary into a different CHECK'd column** | **6 of 11 reachable values are rejected by the database**, including the only policy type the app auto-creates. Two closed sets, two words in common, one bare assignment. §0.1. |
| **`let _ =` on a lifecycle write** | The rejection above has been invisible since the constraint was written. **22 of 29 credential-lifecycle writes discard their `Result`; the compliant form is 3 lines and appears in the same file** (`rotation.rs:1382`). §9. |
| **A remediation that switches a control off, scored by a metric that rewards its absence** | `Remediation::Disable` → `disable_policy` → `policy_enabled: false` → `rotationSubScore` **100**. **+20 points at the moment the app gives up.** Replayed: 60/`warning` instead of 40/`degraded` on the operator's two dead OAuth grants. §0.4. |
| **`if (!x \|\| !x.enabled \|\| !x.deadline) return MAX`** | Three different absences collapsed into the best possible value, eight lines below a sub-score that was deliberately corrected the other way with the incident in its comment. `credentialHealthScore.ts:57`. §7 D3. |
| **Delete offered as the kill switch** | It removes the power *and* the evidence. **391.4 audit rows survive per living credential; 1.3 per deleted one**, because `delete` truncates `credential_audit_log` (`credentials.rs:464-467`) *before* the delete audit row is written (`crud.rs:271`). §0.5. |
| **An `expires_at` that is stored and never checked at read** | Here it is not even stored: `persona_credentials` has no expiry column at all, `credential_events` (the `expiration_threshold` mechanism) has **0 rows**, and `external_api_keys.expires_at` is NULL on **1,029 of 1,029**. §0.6. |
| **A cache-invalidation function with no callers** | `mcp_tools.rs:212 invalidate_tools_cache` — declared, doc-commented *"e.g. after server reconnect"*, **0 call sites**. The next author reads the hook as coverage. Convergent: a sibling's per-link revoke primitive is enforced on read and has no caller either. §7 D5. |
| **Branching recovery UI on where the credential came from instead of why it failed** | `ReauthBanner.tsx:139` switches on `entry.source === 'cli'`. The non-CLI arm asserts *"access was revoked"* for a network failure, an expired refresh token and a genuine revocation alike — while `AppError::OAuthRevoked` (`connector_strategy.rs:553`) already knows which. §7 D4. |
| **A `Record<string, …>` lookup over a serde-serialized enum** | `AnomalyScorePanel.tsx:6-11` keys on `healthy`/`disable`; `Remediation` serializes `"Healthy"`/`"Disable"`. Typed `Record<string, …>` instead of `Record<Remediation, …>`, so it compiles, and `?? REMEDIATION_LABELS.healthy!` at `:17` renders **an emerald "Healthy" chip for a `Disable`-level credential**. §7 D2. |
| **Auto-provisioning a policy whose type the history table rejects** | `oauth_keepalive` (`rotation.rs:1327`, `:1393`) — created at every startup for every OAuth credential, and every history row it produces is refused. Both live policy rows are this type. |
| **Three countdown implementations of one number** | `useRotationTicker.ts:22-31` (hardcoded `'Due now'`, bare `new Date`), `RotationOverviewPanel.tsx:72-83` (correct — `parseServerMs`, `tx()`), `credentialHealthScore.ts:149-157` (hardcoded `` `Key expires in ${days}d` ``). Two of the three are untranslated in a 14-locale app. §7 D6. |

---

## 6. Evidence

**The ONE site to copy: `src-tauri/src/commands/credentials/broker.rs:59-83`.**

```rust
/// Kill-switch: revoke a consumer key. Takes effect on the consumer's very
/// next request (`find_by_token` filters revoked keys), and the consumer's
/// blast-radius edges drop out of the dependents graph immediately.
#[tauri::command]
#[requires(privileged)]
pub fn revoke_broker_consumer(state: State<'_, Arc<AppState>>, consumer_key_id: String) -> Result<(), AppError> {
    api_key_repo::revoke(&state.db, &consumer_key_id)?;                    // ← `?`, not `let _ =`
    tracing::info!(consumer_key_id = %consumer_key_id, "broker consumer revoked (kill-switch)");
    if let Err(e) = settings_audit_log::insert(&state.db, "api_keys", &consumer_key_id,
                                               "broker_kill_switch", None, None, Some("ui")) {
        tracing::warn!(error = %e, "settings_audit_log insert failed for broker kill-switch");
    }
    Ok(())
}
```

Five things to copy: (1) **the doc comment states when the revocation takes effect** — "the very
next request" — which is the P4 contract written down, and it is the only place in this territory
that says it; (2) **it names the enforcement point** (`find_by_token` filters revoked keys), so a
reader can verify the claim; (3) the revoke uses `?` — a failed revoke fails the command; (4) the
best-effort ledger write uses `if let Err` **and logs**, so it is best-effort *and observable* —
the distinction 22 sites in `rotation.rs` collapse; (5) it is a **soft** revoke: the row survives
for the audit trail.

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `db/src/repos/resources/credentials.rs:1264-1275` | **A write-shape autopsy.** Why delete-all + reinsert is the wrong primitive for a rotation, in four named failure modes, at the site of the fix. |
| `engine/runner/credentials.rs:753-765` | **Re-read inside the lock.** The reason in-flight propagation is one boundary away rather than impossible. |
| `engine/rotation.rs:1080-1094` | **Defer, don't drop.** A firing that cannot run now must not advance `last_polled_at`, *"losing a scheduled tick forever (the 2am-Saturday class of bug)"*. |
| `engine/connector_strategy.rs:504-527` | **The revoked-vs-broken classifier**, one documented line per error code, converted to a distinct error variant. Nothing in the fleet matches it. |
| `db/src/repos/resources/rotation.rs:130-155` | `TransactionBehavior::Immediate` with the two-concurrent-enables race written out. |
| `overview/sub_analytics/components/RotationOverviewPanel.tsx:66-83` | `parseServerMs` + a **structured** countdown (`{isDue, days, hours}`) localized at the render site rather than a pre-formatted English string. |

### Convergence — 5 sibling repos, and the label fails

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.**

**Denominator discipline.** `personas-web` has **no credential store of any kind** — no route, no
table, no encryption. It is excluded from Q1–Q4 with the exclusion stated, leaving **4**.
`vibeman` is *retained* with a caveat: it stores provider keys in plaintext `localStorage`
(`src/lib/llm/llm-storage.ts:24-40`) — a real store, just an unmanaged one.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **Deliberate rotation of a long-lived user-owned secret exists** | **0 of 4** | `brainiac/crates/brainiac-store/src/tokens.rs` exposes `resolve`(:41) `create`(:96) `list`(:126) `revoke`(:155) — **no update, no rotate**. `ascent/src/lib/db/org-api-tokens.ts` exposes create(:60) list(:104) revoke(:116) verify(:133) — same four. `personas-cloud`'s credential CRUD is create/get/list/link/delete (`packages/orchestrator/src/db.ts:651-688`; routes `httpApi.ts:276-277`) — **no update verb at all**, so "rotating" means deleting and breaking every `persona_credential_links` row. `vibeman` overwrites a `localStorage` entry with no timestamp. |
| 2 | **…and the lifecycle is instead MINT-NEW-THEN-REVOKE-OLD** | **2 of 2 that thought about it — PHYSICS** | Two codebases, two stacks, no shared document, the same four verbs and the same missing fifth. `brainiac/crates/brainiac-server/src/provision.rs:82` writes the reason for the scope half inline: *"A leaked device key must not be able to issue more keys."* **This is the strongest positive result in the sweep and it is P2.** |
| 3 | **A rotation re-verifies and stamps without replacing** | **PERSONAS-ONLY (1 of 5)** | I looked specifically for the sham-rotation shape and **did not find it anywhere else**. The nearest thing is `brainiac`'s `resolve` (`tokens.rs:42-46`), which advances `last_used_at` and leaves the secret untouched — **but it never claims to be rotation**. This repo is the only one that built the verb, and the only one whose verb is hollow. |
| 4 | **A replaced secret resets its own verification state** | **`ascent` ALONE (1 of 4), and it is the better answer** | `ascent/src/lib/db/org-llm.ts:147-155`: `...(credentialsEncrypted ? { credentialsEncrypted, lastValidatedAt: null, lastValidationError: null } : {})` with the comment *"A new credential invalidates any prior validation result."* **Personas' rotate does the opposite**: it ends on a healthcheck *success*, having replaced nothing, so a "rotation" stamps freshness onto an unchanged secret. |
| 5 | **A revoke/kill-switch exists for a stored credential** | **2 of 4** | `brainiac` (`tokens.rs:155`, `http.rs:1662`) and `ascent` (five separate kill switches) yes; `personas-cloud` delete-only (`httpApi.ts:667-672`, three lines, no side effects); `vibeman` delete-only. **Personas: zero for held credentials, six for issued grants.** |
| 6 | **Revocation propagates to work already in flight** | **0 of 4 — PHYSICS, converging as a DEFECT** | Nobody kills running work. `personas-cloud` is the sharpest: the decrypted secret is injected into a spawned child's environment (`dispatcher.ts:691-726` → `worker/src/executor.ts:105-141`), a `cancelExecution` primitive exists (`dispatcher.ts:1460`), and deleting a credential **never calls it**. `ascent` refuses at the next boundary (`auth.ts:277-279`, `cron/rescan/route.ts:89-99`) — which is a decision, and it is written down. |
| 7 | **Cached copies are invalidated on revocation** | **1 of 4, and the minority is right** | `ascent/src/lib/github/app.ts:147-160` `invalidateInstallationToken`, wired to a tested 401 self-heal-once at `:254-287`, guarded against a `NaN` expiry being trusted as fresh (`:169`). `brainiac` has **no cache at all, deliberately** — `auth.rs` has zero `OnceLock`/`Lazy`/`RwLock`. `personas-cloud` freezes its API-key hash at startup (`auth.ts:112-113`) and has invalidation helpers for *subscriptions* and *triggers* and none for credentials. **Personas has the hook and not the wire** (`mcp_tools.rs:212`, 0 callers). |
| 8 | **The provider is told** | **0 of 4 — PHYSICS** | `personas-cloud`'s `clearTokens()` (`oauth.ts:276-280`) nulls a field and returns `{status:'disconnected'}`. The only repo that behaves well says the limit in its own UI copy — `ascent/src/app/connect/page.tsx:172`: *"Your session was refreshed, but other sessions can't be centrally revoked without a database."* |
| 9 | **A long-lived stored credential carries an enforced expiry** | **0 of 4 — PHYSICS, and the shape is the finding** | `brainiac`'s `api_tokens` (`migrations/0003_api_tokens.sql`) and `ascent`'s `OrgApiToken` (`prisma/schema.prisma:670-686`) **independently** arrived at `created_at / last_used_at / revoked_at` and **independently** omitted `expires_at`. Both enforce expiry rigorously on short-lived *derived* tokens in the same schema (`onboard.rs:83,100,149,190`; `live-share.ts:129` — *"exp enforced HERE, on every read"*). **The technique is understood everywhere and applied to the thing that matters nowhere.** |
| 10 | **Revoked is distinguished from broken** | **PERSONAS ALONE (1 of 6), and it is ahead** | `invalid_grant` / `unauthorized_client` / `needs_reauth`: **zero matches in all five siblings.** The best available elsewhere is `vibeman`'s string-sniffed terminal-vs-retryable split (`retryStrategy.ts:54-107`) and `ascent`'s status-typed 401 branch (`app.ts:284`). Neither separates *revoked upstream* from *never valid*; neither writes a health state back. **Personas has the classifier, the error variant and the persisted flag — and then branches its banner on provenance (§7 D4).** |
| 11 | **The encryption key can be rotated** | **0 of 2 that encrypt** | `personas-cloud` migrated a PBKDF2 iteration count with a legacy-decrypt constant (`packages/shared/src/crypto.ts:10-11`) — proving the team can reason about crypto migration — and has no re-encrypt pass; changing `MASTER_KEY` bricks the vault, symptom being one warning string (`httpApi.ts:2271`). `ascent` reserved `"v1:"` *explicitly for rotation* (`src/lib/crypto/secret-box.ts:4`) and its decryptor hard-rejects any other version (`:50`); there is no v2. **Personas is ahead: it has a bulk re-encryption loop** (`core/src/crypto.rs:1374-1458`) — which the `personas-cloud` port did not carry across. |
| 12 | **A dead safety primitive sits beside the live one** | **PHYSICS (2 of 2 repos with a kill switch)** | `ascent/src/lib/db/org-share.ts:38` `revokeLiveShareLink` is enforced on read and **has no caller** — the file admits it at `:15-17`. Personas' `invalidate_tools_cache` is the same shape. Two repos, same failure: the primitive is written, the wire is not, and the *presence* of the function is what stops anyone noticing. |

**Physics — keep as doctrine:** clauses 2, 6, 8, 9, 12 (and 7 as a right-minority).
**Personas is AHEAD of the whole fleet** on exactly two things, and both are real: the
**revoked-vs-broken classifier** (clause 10, 1 of 6) and a **working bulk re-encryption loop**
(clause 11, 1 of 2). It is **behind** on everything that follows a revocation.

### Lineage — two of three apparent convergences are ports

The doctrine's lineage check paid for itself immediately.

- **`personas-web`'s Rotation Overview is a port and says so.**
  `src/app/dashboard/settings/settings-sections/RotationOverviewCard.tsx:13-14` — *"The web
  counterpart to the desktop overview's Rotation Overview."* Its data is a five-row literal
  (`src/lib/mock-dashboard-data.ts:1709-1715`) and `:22` reads `if (!isDemo) return null;`. **It is
  this repo's own UI redrawn with fake rows and hidden from real users. Zero corroboration.**
- **`personas-cloud`'s credential store is a port.** Byte-identical column set on
  `persona_credentials` (`packages/orchestrator/src/db.ts:275-289` vs
  `src-tauri/db/src/migrations/schema.rs:160-170`), the same `persona_credential_links` table, the
  same `requires_credential_type` column, and the same `$CONNECTOR_NAME_UPPER_FIELD_UPPER` env
  convention (`dispatcher.ts:695,715` vs `n8n_transform/prompts.rs:277`). **One design wearing two
  coats.**
- **`brainiac` and `ascent` are genuinely independent** — different languages, different storage
  models (hash-only and `"v1:iv:ct:tag"` respectively vs this repo's `{encrypted, iv}` +
  PBKDF2), no shared prose, no shared constants. **Every "physics" verdict above rests on those
  two.**

### The composition defects with the neighbouring paths — offered upward

**(i) with [`scoring-and-thresholds`](./scoring-and-thresholds.md).** Its §0 measures
`rotationSubScore` returning 100 for 25 of 25 and attributes it to *"0 enabled rotation policies
exist"*. That is right and it is not the whole mechanism: **2 of the 25 have a policy that the app's
own remediation switched off**, and for those the 100 is not "no data" — it is *"the control was
removed"*, which is a strictly worse thing to reward. **The clause both paths need: an absence
policy must distinguish `never configured` from `configured and then disabled`, because only one of
them is an absence of evidence and the other is evidence.** Its §2 (b) drop-and-renormalize
prescription is right for the first and wrong for the second: dropping a *disabled* dimension
launders the disabling.

**(ii) with [`automated-credential-provisioning`](./automated-credential-provisioning.md).** Its §9
gates *"a provisioning write with no ledger write nearby"* and its legal destination is
`audit_log::insert`. **Following it here produces a `let _ = audit_log::insert(…)` that satisfies
the gate and records nothing when it fails** — which is this leaf's §9 condition exactly. The two
rules compose into a complete statement only when read together: **a write must reach the ledger
*and* the ledger write's failure must be observable.** Neither alone is sufficient, and they are
disjoint by construction (one asks whether the call exists, the other whether its `Result` is
consumed). §9 measures the match overlap at **0 of 22**.

**(iii) with [`delete-semantics`](./delete-semantics.md).** This leaf supplies it a case it will
want: a `DELETE` that cascades into the append-only audit ledger, executed *before* the audit row
for the deletion itself is written. **The general clause: a delete may cascade into data the entity
owns; it must never cascade into the record of what the entity did.**

**(iv) with [`secret-and-pii-redaction`](./secret-and-pii-redaction.md).** Its deferred backfill
covers **41 credential-shaped literals in `persona_executions.tool_steps`** (a JSON `TEXT` column,
not a table). Whatever the redaction fix, **those credentials need rotating**, and this leaf's
finding is that the app cannot act on that: there is no revoke, no rotate-for-real, and **no
reverse-lookup surface** — `credential_fields` stores `encrypted_value` + `iv` and no hash or
prefix, so a leaked literal cannot be mapped back to a credential id. `external_api_keys` has
`key_hash` and `key_prefix`; the vault has neither. **The app's own history is a rotation trigger it
is structurally unable to see.** (My independent scan of all 1,921 non-empty `tool_steps` columns
found **1** match under a stricter shape set than the original pass used; the 41/22/6 figures from
the wider pass stand as measured there. Either way the conclusion is the same and it is not a count
question.)

---

## 7. Deviations

Every entry is live on `master` @ `f432a4ef3`, verified by reading the file and — where a number is
quoted — by replay against a read-only copy of the operator's database. All shipped under a green
`npm run check` and a green census. **Per the campaign's no-destructive-applies rule, nothing here
was applied.**

> **Second pass — what is upstream of all of this.** Every entry reduces to one omission: **nothing
> in this system ever answers the question "did the secret change?"** Not the return type, not the
> history row, not the score, not the UI. Once that question has no answer, `mark_rotated` is
> arbitrary, the countdown is decorative, the health score is measuring policy configuration rather
> than credential hygiene, and "revoke" has nothing to be the opposite of. **D1 and D8 are the same
> edit** (T1 + T2), and it is the edit that makes every other entry addressable.

### P0 (A) — six of eleven rotation-history writes are rejected, and all eleven discard the rejection · **executed**

`db/src/repos/resources/rotation.rs:386` `record_rotation`, 11 call sites, all in
`engine/rotation.rs` (`:448`, `:475`, `:512`, `:554`, `:576`, `:609`, `:692`, `:716`, `:789`,
`:885`, `:902`), **all `let _ =`**. Full replay table in §0.1.

The three values with no defence:

- **`oauth_keepalive`** — `&policy.policy_type` at `:475`/`:512`/`:448`, and it is the **only**
  policy type `auto_provision_oauth_rotation_policies` (`:1327`) and `auto_provision_single`
  (`:1393`) ever create. Both live policy rows carry it.
- **`anomaly_remediation`** — `rotate_now(…, "anomaly_remediation")` at `:824`. And
  `detect_anomalies` at `:775-777` guards on
  `h.rotation_type == "anomaly" || h.rotation_type == "anomaly_remediation"` — **a value the table
  cannot hold.** The comment above it explains the guard exists *"so the rotation triggered below
  fires at most once per anomaly episode rather than on every scan tick"*. The `"anomaly"` half
  works; the half the comment is about is dead.
- **`event:{template}`** — `:1103`, three template ids, all rejected.

**Fix (note):** T2 — a `RotationKind` enum with a total `From<PolicyType>`, plus consuming the
`Result`. Until then, the *minimum* is widening the CHECK, but that treats the symptom: the two
vocabularies would still be two.

### P0 (B) — `rotate` replaces nothing and the clock advances anyway · **executed**

`connector_strategy.rs:376-432` (`DefaultStrategy`, the fallback for every unregistered
`service_type`) and `:84-152` (the trait default). For a non-OAuth credential:
`run_healthcheck` → `Ok("API key verified healthy: …")` → `rotation.rs:475` `record_rotation(…,
Success)` → `:482` `mark_rotated`. **`credential_fields` is untouched.** §0.2 has the replay.

And the only branch that *does* rewrite ciphertext is the failure branch: `:132`, `:144`, `:412`,
`:423` call `save_fields`, which `DELETE`s and re-`INSERT`s every field row with fresh IVs and row
ids (`credentials.rs:1224-1257`) — the exact primitive
`update_fields_targeted`'s doc comment (`:1264-1275`) names as the defect it replaced. **The
rotation engine kept the broken write shape and uses it only when nothing needed writing.**

**Fix (note):** T1 — `RotationOutcome`, and `mark_rotated` gated on `Replaced`.

### P0 (C) — there is no way to revoke a credential · **6 revokes for grants, 0 for credentials**

`revoke_broker_consumer`, `revoke_external_api_key`, `revoke_pairing`, `revoke_desktop_approvals`,
`fleet_companion_revoke`, `revoke_peer_trust` — all six revoke something the app **issued**. The
only operation available against a credential the app **holds** is `delete_credential`
(`crud.rs:254`), and:

- it **truncates `credential_audit_log`** for that credential (`credentials.rs:464-467`) *before*
  writing the delete row (`crud.rs:271`). Measured: **391.4 surviving audit rows per living
  credential, 1.3 per deleted one** across 25 live and 13 deleted (§0.5);
- it leaves `credential_consumer_edges` orphaned — no FK (`incremental.rs:7241-7251`), not in the
  explicit cleanup list, and **absent from `blast_radius`** (`credentials.rs:476-560`), so the
  confirm dialog cannot name an external consumer. Live: 0 rows, latent;
- it correctly recomputes dependent personas' `setup_status` (`crud.rs:275-279`) — **the one
  propagation this app does perform, and it is good**;
- it never tells the provider, so the secret remains valid everywhere else.

**Fix (note):** an `is_revoked` state on the credential + a `revoke_credential` command modelled on
`broker.rs:59-83` (soft, ledgered, checked at `get_decrypted_fields`), and remove
`credential_audit_log` from `delete`'s cascade.

### P1 (D) — the disabling of a control raises the score it is scored by · **executed, +20 on 2 of 25**

`credentialHealthScore.ts:56-67`. Three absences → 100: no status, no policy, **policy disabled**.
`Remediation::Disable` (`rotation.rs:553`) produces the third. Replayed in §0.4: the operator's
`gmail` and `google_calendar` render **60 / `warning`**; with their policies still enabled they
would render **40 / `degraded`**.

Two further defects in the same function:

- `:59` uses bare `new Date(status.next_rotation_at)` where `RotationOverviewPanel.tsx:66-70`
  uses `parseServerMs`. A SQLite-naive timestamp yields `NaN`; `NaN <= 0` is `false`, so it falls
  through every band to **`return 100`**. The failure mode of the parse is the best score.
- `rotationReason` (`:149-157`) returns the string `'No rotation policy'` for the same three
  absences, and `:124` picks `worstSignal` by minimum — so *"No rotation policy"* can never be
  selected as the reason while any other signal is below 100. **The credential with no governance
  cannot be reported as the credential with no governance.**

**Fix (note):** `rotationSubScore` returns `number | null`; `null` for "never configured" (dropped
and renormalized per [`scoring-and-thresholds`](./scoring-and-thresholds.md) §2(b)) and a **low**
value for "configured then disabled", which is evidence, not absence.

### P1 (E) — the anomaly panel cannot render any severity but "Healthy" · **third strike on one casing bug**

`AnomalyScorePanel.tsx:6-11` keys `REMEDIATION_LABELS` on `healthy` / `backoff_retry` /
`preemptive_rotation` / `rotate_then_alert` / `disable`. `Remediation` serializes **PascalCase**
(`src/lib/bindings/Remediation.ts:6` — `"Healthy" | "BackoffRetry" | "PreemptiveRotation" |
"RotateThenAlert" | "Disable"`, no `rename_all` on the Rust enum, `rotation.rs:155-168`). `:17`
falls back: `REMEDIATION_LABELS[score.remediation] ?? REMEDIATION_LABELS.healthy!`. **A
`Disable`-level credential renders an emerald "Healthy" chip.**

This is the **third** encounter with the same mismatch and the first that is still live:
`useRemediationEvaluator.ts:81-84` fixed it with the reason in the comment (*"The Rust `Remediation`
enum has no `rename_all`, so it serializes as PascalCase"*), `credentialHealthScore.ts:27-33` gets
it right, and [`scoring-and-thresholds`](./scoring-and-thresholds.md) §12.4 recorded it as a
*latent* hazard. **It is not latent.**

**Why the compiler could not help:** the map is typed `Record<string, …>`, not
`Record<Remediation, …>`. Widening the key type to `string` is what made the wrong keys legal.
Latent on this install only because `remediation` is `Healthy` for 25 of 25 — but the live history
contains two rows recording `remediation=disable`.

**Fix (note):** type it `Record<Remediation, …>` and delete the `??` fallback; the compiler then
enumerates the five arms.

### P1 (F) — the ReauthBanner branches on provenance, not on cause · **the classifier dies one layer from the user**

`ReauthBanner.tsx:139` — `entry.source === 'cli'`:

| branch | copy | action |
|---|---|---|
| `source === 'cli'` | *"CLI session expired. Sign in via your terminal, then retry."* | **Retry capture** → `refreshCredentialCliNow` (`:124`) — an in-place repair attempt |
| everything else | *"access was revoked. Please re-authorize to resume automations."* | **Reconnect** → `onNavigate(credentialId)` (`:172`), which only selects the row in the list |

So the OAuth arm **asserts revocation** for a network failure, an expired refresh token and a real
revocation alike — while `AppError::OAuthRevoked` (`connector_strategy.rs:553-558`) already
distinguishes them and `AnomalyScore.remediation` carries a five-way severity the banner never
reads. `needs_reauth_at` is persisted and has **zero readers**.

And the OAuth arm has no repair to offer because `refresh_credential_oauth_now`
(`commands/credentials/rotation.rs:180`) — the exact twin of the CLI recapture the other arm calls
— **has no TypeScript wrapper at all.** Two other privileged commands are equally orphaned:
`get_oauth_token_metrics` (`:206`) and `get_oauth_token_lifetime_summary` (`:216`).
`src/api/vault/rotation.ts:13` re-exports their *types* and defines no function.

**Fix (note):** carry the error class over IPC; branch on it; bind `refresh_credential_oauth_now`
so the OAuth arm can attempt a repair and thereby *distinguish* the two cases empirically.

### P1 (G) — `invalidate_tools_cache` has no callers · **0 call sites**

`engine/mcp_tools.rs:210-215`, doc-commented *"Invalidate the cache entry for a credential (e.g.
after server reconnect)"*. Grepped the whole tree: **the definition is the only occurrence.** The
cache it guards (`:166-208`) is keyed by `credential_id` with a 60 s TTL, so a rotated or deleted
credential's tool list survives up to a minute. Bounded, and that is the only reason it is P1.

Convergent with `ascent/src/lib/db/org-share.ts:38` `revokeLiveShareLink`, also enforced-on-read
and also caller-less, with the omission admitted in the file at `:15-17`. **Two repos, same shape:
the primitive exists, the wire does not, and the presence of the function is what stops anyone
noticing.**

### P2 (H) — a disabled policy cannot be re-enabled from the UI · **live on both of the operator's policies**

`RotationActivePolicy.tsx:44-53` renders the `rotation_paused` label when `policy_enabled` is
false, and offers **no control to flip it back**. The writes available are: create
(`RotationNewPolicy.tsx:71`), change interval (`RotationActivePolicy.tsx:147`, which always sends
`enabled: null`), and delete all policies (`:94-97`). `enabled: false` is written **only** by
`src/lib/credentials/remediationExecutor.ts:45`, an automated path.

**So a policy the anomaly scorer disabled can only be re-armed by deleting it and creating a new
one** — which, per D4, is also the operation that restores the score the disabling inflated. Both
of the operator's rotation policies are in this state, disabled 2026-06-10, `next_rotation_at`
2026-06-11, **67 days overdue and invisible** because `get_due_policies`
(`db/…/rotation.rs:96-102`) filters `enabled = 1`.

### P2 (I) — three countdown implementations, two of them untranslated

| site | parse | output | i18n |
|---|---|---|---|
| `useRotationTicker.ts:22-31` | bare `new Date` | `'Due now'` / `'Nd Nh'` | **hardcoded English** (`:26`) |
| `RotationOverviewPanel.tsx:72-83` | `parseServerMs` (`:66-70`) | `{isDue, days, hours}` | **correct**, `tx()` at `:210-213` |
| `credentialHealthScore.ts:149-157` | bare `new Date` | `` `Key expires in ${days}d` `` | **hardcoded English** |

Plus a name collision: `src/lib/utils/formatters.ts:253` exports a different `formatCountdown`
taking seconds.

**And ≥27 orphan rotation i18n keys**, each replicated across all 14 locale files: the whole of
`vault.features.rotation_policy.*` (18 keys — a verbatim pre-refactor duplicate of
`vault.rotation_section.*`), `vault.features.rotation_badge.*` (4, superseded by
`status_tokens.rotation.*`), `vault.rotation_insight.*` (3), `vault.playground.tab_rotation`,
`vault.card_details.tab_rotation`. The playground tab labels are hardcoded English at
`CredentialPlaygroundModal.tsx:22-29` while the key for one of them sits unused in every locale.

### P2 (J) — `isOAuth` is declared, threaded, and never passed

`CredentialRotationSection.tsx:37` declares `isOAuth?: boolean`. It is the sole discriminator for
the OAuth policy labels (`RotationActivePolicy.tsx:48-49`), the OAuth default interval
(`RotationPolicyControls.tsx:41`) and the OAuth interval presets (`RotationActivePolicy.tsx:118`,
`RotationNewPolicy.tsx:39`). **The only call site — `PlaygroundTabContent.tsx:93-101` — omits it.**
So every OAuth credential renders *"Auto-rotation active"* rather than *"OAuth refresh active"*,
defaults to a 90-day interval for a token that lives an hour, and offers `[30,60,90,180]` instead of
`[1,7,30,90]`.

`OverviewTab.tsx:26-28` accepts `rotationStatus` / `rotationCountdown` / `fetchRotationStatus` as
props and renders none of them.

### P2 (K) — the system key's revoke loop swallows both of its failure modes · **1,028 revocations**

`engine/management_api.rs:580-585`:

```rust
if let Ok(existing) = api_key_repo::list(pool) {
    for key in existing.iter().filter(|k| k.name == "system" && k.enabled) {
        let _ = api_key_repo::revoke(pool, &key.id);
    }
}
```

Two discarded failures in four lines. A failed `list` skips revocation **entirely and silently**; a
failed `revoke` leaves a live key **entirely and silently**. The comment above states the purpose —
*"prevent stale tokens from accumulating"* — which is a security purpose whose failure is
unobservable. Live: 1,029 rows, 1,028 with `revoked_at` set, 1 enabled, `expires_at` NULL on all
1,029. **So it is currently working, and there is no way to know that except by counting rows
afterwards.** This is `brainiac`'s written warning, verbatim, in another codebase.

### P3 (L) — small, live, one line each

- **`get_rotation_status` recomputes the anomaly score and never persists it** (`:953-957`), while
  `detect_anomalies` persists a score it then refuses to act on (`:740-761`). Two paths, two
  scores, one of them written.
- **`detect_anomalies` skips every credential on this install** — `if score.data_stale { continue }`
  at `:755`, and `data_stale` is **true on 25 of 25**. The loop is a pure score-persister.
- **`resolve_tolerance` (`:304-318`) is `#[allow(dead_code)]`** — the environment-hint tolerance
  (`production` → 5 %, `development` → 50 %) is unreachable; the ledger's own
  `resolve_tolerance` is what runs.
- **`useRotateAll.ts:32-51` rotates every OAuth credential in a bare loop with no confirmation**, no
  preview and no blast radius — while the *delete* path has a full `BlastRadiusPanel`.
- **`RotationOverviewPanel.tsx:132`'s per-row rotate** likewise fires immediately.
- **`PRAGMA foreign_keys` is ON** in the pooled connection (`db/src/lib.rs:201`), so the
  `ON DELETE CASCADE` clauses are live; `credentials.rs:440-443`'s belt-and-braces explicit deletes
  are genuinely redundant — **except for `credential_audit_log`, which has no FK, and which is
  therefore deleted *only* because of that block.** The defensive code is what causes D-C.

---

## 8. Gaps

**Gap 1 — Nothing anywhere records whether a rotation changed the secret, so no instrument can be
built on top of it.** Not a column, not a return type, not a log line. `credential_fields.updated_at`
is the closest available proxy and it is contaminated: `save_fields` rewrites it on the *failure*
path, and `update_fields_targeted` bumps it on every runtime OAuth refresh. A `field_revision`
counter on the credential, incremented only by a value-changing write, would make every claim in
this document checkable at runtime — and would let `mark_rotated` demand one. **Every deviation
above except D5/D9/D10 is downstream of this.**

**Gap 2 — The census can count a discarded `Result`; it cannot see a rejected write.** §0.1's
finding — that the database refuses 6 of 11 values — was found by *executing the INSERT*, not by
matching anything. No regex relates a `CHECK` vocabulary in one migration to the domain of a
variable in another crate. The instrument that would own this is a **test that enumerates every
value each `record_rotation` call site can supply and asserts the constraint accepts it** — a
property test over two closed sets, which is cheap and which nothing in this repo does for any
CHECK'd column.

**Gap 3 — There is no way to express "this credential must be rotated because of something that
happened outside it".** A leaked value in an execution log, a departed team member, a provider
breach — none of these are healthcheck failures, and every trigger this app has
(`cron_schedule`, `expiration_threshold`, `healthcheck_failure`, `rotation.rs:1058-1077`) is derived
from the credential's own liveness. The `on_suspicious` and `on_member_departure` policy types exist
in the schema CHECK and **have no producer anywhere in the tree** — the vocabulary for this was
designed and never wired. And there is no reverse-lookup surface (§6 (iv)), so even a human who
finds a leaked literal cannot ask the app which credential it belongs to.

**Gap 4 — `data_stale` is read in three places and means something different in each.**
`rotation.rs:755` uses it to *skip* (so a stale window suppresses anomaly recording);
`AnomalyScorePanel.tsx:29-31` renders it as an informational chip; `credentialHealthScore.ts:51-54`
ignores it entirely, so a stale window scores at full confidence. The field is honest; there is no
shared decision about what it licenses. (This corrects
[`scoring-and-thresholds`](./scoring-and-thresholds.md) D10 — see §12.4.)

**Gap 5 — Revocation propagation is one boundary away and nobody has decided which boundary.**
`inject_credential` (`runner/credentials.rs:753-765`) already re-reads inside a lock, so a
credential could be re-checked at each injection; the MCP tools cache has an invalidation hook; the
proxy resolves per request. **The mechanism exists three times over and the contract exists zero
times.** P4 says the sentence has to be written; this repo has the code and not the sentence, which
is the better half to have and is worth saying.

**Gap 6 — The census rule keys on a function-name vocabulary, and the doctrine's warning applies
directly.** *A vocabulary-based signal's recall is bounded by its author's word list, and the
misses cluster on the unusual cases.* A future `expire_policy`, `retire_credential` or
`quarantine_key` is invisible to §9 until someone adds it. I mitigated this by choosing the
vocabulary from the *repository layer's actual export list* rather than from intuition, and by
making the positive control share the identical vocabulary so a stale word list degrades both halves
symmetrically — but the recall bound is real and an adopting repo must re-derive its own list.

---

## 9. The missing gate

**The condition to enforce:** *a write that is the only durable record of a credential-lifecycle
event — a rotation, a policy state change, a revocation — is evaluated for its side effect alone,
so a rejected write is indistinguishable from a performed one.* Not "the ledger write is missing"
(that is [automated-credential-provisioning](./automated-credential-provisioning.md)'s rule); not
"the rotation didn't rotate" (that is a type, T1); not "two vocabularies disagree" (that is a
property test, Gap 2). **The one thing in this leaf that is a countable string and that this repo
gets wrong 22 times.**

### The condition, stack-free

> **A lifecycle event's record is written best-effort, so the belief the system forms — "this key
> was rotated", "this key is dead" — is created by a statement whose failure nobody can observe.**

There is no runtime signal. A discarded rejection produces no error, no log line, no metric, and a
UI that renders confidently from the *other* writes that did succeed. §0.2 is what that looks like
from the outside: a policy stamped as rotated today, with no history row and an unchanged secret.

### Existing rules checked first

I read all **145** rules in `scripts/census/rules.json` before authoring and checked **twelve** by
name, running each through the real engine against my own to measure overlap:

| neighbour rule | its files | shared files with mine | **shared MATCHES** |
|---|---:|---:|---:|
| `unledgered-credential-provisioning` | 5 | 1 (`management_api.rs`) | **0** |
| `unverified-effect-dispatch` | 60 | 1 (`rotation.rs`) | **0** |
| `discarded-timezone-parse` | 4 | 1 (`rotation.rs`) | **0** |
| `ledger-field-addressed-by-string-key` | 6 | 1 (`rotation.rs`) | **0** |
| `discarded-sync-watermark-write` | 4 | 0 | **0** |
| `blind-identity-write` | 35 | 0 | **0** |
| `discarded-guard-verdict` | 7 | 0 | **0** |
| `silent-row-skip` | 64 | 0 | **0** |
| `unfenced-work-outcome-write` | 7 | 0 | **0** |
| `secret-as-bare-string-field` | 5 | 0 | **0** |
| `undiscriminated-credential-rejection` | 6 | 0 | **0** |
| `process-global-caches-a-failure` | 3 | 0 | **0** |

**Zero shared matches with any of the twelve.** The file-level 50 % figures are a denominator
artefact — my population lives in **2** files, so one shared file reads as half — and are reported
rather than hidden.

**The `let _ =` family already has two members and this is the third, deliberately.**
`unverified-effect-dispatch` keys the same prefix on `.emit(`; `discarded-sync-watermark-write`
keys it on `cursor|watermark|checkpoint|…`. **The corpus has already accepted that the shape is
shared and the destination vocabulary is what partitions it**, and the three vocabularies are
disjoint by construction. The nearest by *subject* is
`unledgered-credential-provisioning`, and the two are complementary rather than overlapping: it asks
**does a ledger write exist near this provisioning call**, mine asks **is this lifecycle write's
failure observable**. A site can satisfy one and violate the other — and following that path's
prescription with `let _ = audit_log::insert(…)` produces exactly that (§6 (ii)).

### Signals I designed, measured, and rejected

| Candidate | Result | Why rejected |
|---|---|---|
| **a `rotate` impl whose body contains no field write** (the leaf's central defect) | **4 matches / 1 file** — `connector_strategy.rs:84`, `:376`, `:460`, `:493`; the whole `ConnectorStrategy` surface, and `:460`/`:493` both delegate to one helper, so **3 distinct behaviours** | The most important condition in the document and its syntactic population is four function bodies in one file. Per the corpus's reasoning a counter spends its authority on a population this small while the fix is a type. **Carried as T1 instead.** |
| **`mark_rotated` called without a preceding value write** | 2 matches | Population of two, and "value write" is not a string. Named in D-B. |
| **a `String` passed into a CHECK-constrained column** | no regex form | Requires relating a migration's CHECK vocabulary to a variable's domain across two crates. **Gap 2 specifies the instrument** (a property test over two closed sets), which is not a census rule. |
| **`if (!x \|\| !x.<flag> …) return <numeric literal>`** (D4's client-side shape) | **1 match / 1 file** in all 4,829 `.ts`/`.tsx` — and it is `credentialHealthScore.ts:57` itself | The exact condition, and its entire population is the single site this document is about. A one-site rule is a to-do item. `scoring-and-thresholds`'s `inline-verdict-band` already ratchets the band-literal family from a different angle. **Named in D4 with the executed replay instead.** |
| **`Record<string, …>` keyed on a serde-serialized enum** (D5) | **450 matches / 317 files**; deterministic every-30th sample of 15 hand-classified | **0 of 15 are the condition** — the population is payload builders (`Record<string, unknown> = {}`), label maps and connector registries keyed by genuinely free strings. Distinguishing "this key space is really a closed Rust union" needs the binding, not the literal. **A gate that fires on 450 sites to catch 1 is worse than no gate; declined outright.** |
| **`let _ =` on ANY `*_repo::`-shaped call** | **219 matches / 53 files** | Precision collapses across the whole repository layer: build sessions, review results, prompt-version tags, catalog upserts — most genuinely fire-and-forget, where the failure is immaterial. **The lifecycle vocabulary is what makes the condition load-bearing**, and narrowing 219 → 22 is what buys 22/22 precision. |
| **the shipped rule — `let _ =` on a credential-lifecycle write** | **22 / 2 files, 22/22 hand-verified** | **Shipped.** The compliant half is 7 in 5 files, including one in the same file as 21 of the violations. |

### The signal, and its precision

**22 matches in 2 files. All 22 hand-opened. Precision 22/22.**

| site(s) | write | why violating |
|---|---|---|
| `engine/rotation.rs` ×11 `record_rotation` (`:448`, `:475`, `:512`, `:554`, `:576`, `:609`, `:692`, `:716`, `:789`, `:885`, `:902`) | the rotation history row | **6 of the 11 reachable `rotation_type` values are rejected by the CHECK constraint** (§0.1, replayed). The rejection has been invisible since the constraint was written. |
| `engine/rotation.rs` ×2 `mark_rotated` (`:482`, `:897`) | `last_rotated_at` / `next_rotation_at` | The lifecycle clock. A failure leaves a policy that is due forever or rotated never, silently. |
| `engine/rotation.rs` ×4 `schedule_failed_retry` (`:586`, `:600`, `:620`, `:634`) | the backoff schedule | A failure means the retry is never scheduled — the failure mode is *the credential is never retried again*, which looks identical to *the credential is fine*. |
| `engine/rotation.rs` ×1 `disable_policy` (`:553`) | the `Disable` remediation itself | A failed disable leaves a policy the engine has decided is permanently broken, still enabled, still firing. |
| `engine/rotation.rs` ×3 `update_ledger` (`:489`, `:528`, `:740`) | the anomaly score + healthcheck ring buffer | The evidence every downstream verdict reads. Its sibling `oauth_refresh.rs:813`, `:952` **consumes** the result. |
| `engine/management_api.rs:583` `api_key_repo::revoke` | **a revocation** | The app's only kill-switch primitive, invoked in a loop whose enclosing `if let Ok(existing)` also discards a failed `list`. 1,028 revocations to date; a failed one leaves a live grant with no record. §7 D-K. |

**The `management_api.rs` match is the one worth defending, and it is the one that carries the
external warrant.** `brainiac/console/app/console/modules/keys/Keys.tsx:30-45` refuses to swallow
exactly this, and wrote down why: *"A swallowed revoke is dangerous: the operator believes a
compromised key is dead when it is still active."* Different language, different stack, no shared
document, same statement.

### The positive control — it partitions the anchor exhaustively

The anchor is "a call to a credential-lifecycle write". The rule matches the half bound to `let _ =`;
the control matches the half that is not — by the same vocabulary, in the same roots, over the same
564-file walk. **22 + 7 = 29 = the total anchor population**, so the two are disjoint and exhaustive
by construction.

```
  rule                                                     files  base  matches  base  walked  floor
  OK  discarded-lifecycle-write                                2     2       22    22     564    500
  OK  discarded-lifecycle-write-positive-control               5     —        7     —     564    500
```

**The decisive pair is in one file.** `rotation.rs` contributes **21 rule matches** and
**1 control match** — `:1382`, `if let Err(e) = rotation_repo::disable_policies_for_credential(…)
{ tracing::warn!(…) }`. Same file, same author-era, same repository module, opposite posture, three
lines apart in cost. **So the rule discriminates on whether the result is consumed, not on "files
about rotation".** A vocabulary-keyed rule with no result-consumption test would report all 29.

### Verified by a second independent implementation — and the two disagreed

The verifier is a private file-content walker with its own directory traversal, its own URL-safe
comment stripper, its own brace-matched `#[cfg(test)]` exclusion and its own regex assembly,
importing nothing from `scripts/census/lib/engine.mjs`.

- **First run: the two disagreed on the anchor total, 30 vs 29.** Cause: my pattern had **no word
  boundary before the vocabulary alternation**, so `revoke` matched the *suffix* of
  `fleet_companion_revoke` (`commands/fleet/pairing.rs:333`). A substring where a symbol was meant —
  the doctrine's own family. Fixed with `\b`; both then reported **29 / 22 / 7** with identical
  membership.
- **They then agreed on every count and disagreed on a line number**, and this is the one worth
  recording. My walker reported the `management_api.rs` site at **:567**; the engine reported
  **:583**. `grep -n` is the referee and says **583**. My brace-matched `#[cfg(test)]` stripper
  replaced each test module with *spaces*, not spaces-and-newlines — and `management_api.rs` has a
  `#[cfg(test)]` at line 236, **before** the site, so 16 newlines were eaten. **The counts were
  unaffected, which is exactly why they agreed.** Agreement on the headline number while the
  locations were wrong is a new costume for the doctrine's "agreement is not soundness": the number
  I would have published was right and the evidence pointing at it was not.

### Fail-loud properties — executed, exit codes captured directly, never through a pipe

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 1128 file-visits, 29 surviving violation(s) across 7 file(s)` |
| baseline deflated (a rise) | **1** | `[drift] files rose …` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped … without the baseline moving` |
| `floor` raised to 9000 | **1** | `[structural] walked 564 files but floor is 9000` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 500` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 500` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath" …` |
| `exclude` `reason` shortened to `"x"` | **1** | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| `exclude` path renamed | **1** | `[structural] exclude "…/MOVED.rs" matched no file` |
| **CONTROL pattern → a token appearing nowhere** | **1** | `[structural] matched zero files anywhere` |
| **shared vocabulary broken in BOTH halves** | **1** | `[structural] matched zero files anywhere` |
| **control given a baseline** | **1** | `must NOT carry a baseline — it exists to fail` |
| *empty registry (encountered accidentally)* | **1** | `the rule registry is empty — … declares no rules, so this run checked nothing at all` |

**One fault did NOT fail, and it is a real limit of the control, stated rather than hidden.**
Repointing the control's pattern at the *violating* form (so its population jumps 7 → 22) exits
**0** — a rule with no baseline cannot drift by construction. **The control's liveness guarantee is
that it fails structurally on zero matches, not that it detects a change in its population.** Rows
11 and 12 are the two faults that guarantee actually holds against: a broken control pattern, and a
broken shared vocabulary, both of which take it to zero and fail the run. An adopting repo should
know the control proves *the matcher family is alive*, not *the compliant population is stable*.

### Where this runs

`npm run census:check` — a step of **`npm run check`** (the PR self-review ritual in
`.claude/CLAUDE.md`) **and** the `golden-path-census` **pre-push** lefthook job. **Deliberately not
CI-only:** per the brief's calibration `ci.yml` is red on 10 pre-existing failures, so a CI-only
gate would run nowhere.

### How this gate could still fail, stated so the next repo can re-derive it

The signal keys on **seven Rust function names** and on **`let _ =` in rustfmt normal form**
(verified: all 22 sites use the literal `let _ = `; zero occurrences of `let  _`, `let _  =` or
`let _=` in either file). A repo that swallows a lifecycle write with `.ok()`, `.unwrap_or_default()`,
`if let Ok(_)`, a `catch {}`, a discarded promise, `_ = f()` in Go, or a decorator that logs and
continues will **match nothing while the condition is present at scale** — the exact portability
failure `golden-path-contract.md:34-60` documents. And per Gap 6 the vocabulary bound is real. **An
adopting repo must re-derive its own proxy and should check the positive control's population before
trusting a green run.**

```json
{
  "id": "discarded-lifecycle-write",
  "goldenPath": "docs/concepts/golden-paths/credential-rotation-and-revocation.md",
  "title": "A credential-lifecycle write - the row that records a rotation, a policy state change, or a revocation - is evaluated for its side effect alone, so a REJECTED write is indistinguishable from a performed one",
  "roots": ["src-tauri/src"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\blet\\s+_\\s*=\\s*(?:\\b[A-Za-z_]\\w*\\s*::\\s*){0,4}\\b(?:record_rotation|mark_rotated|disable_policy|disable_policies_for_credential|schedule_failed_retry|update_ledger|revoke)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A call to one of the seven functions that record or perform a credential-lifecycle transition - record_rotation / mark_rotated / disable_policy / disable_policies_for_credential / schedule_failed_retry (the rotation ledger and clock), update_ledger (the anomaly + healthcheck evidence every downstream verdict reads), revoke (the app's only kill-switch primitive) - bound to `let _ =`, so its Result is discarded. PROXY FOR the stack-free condition: a lifecycle event's record is written best-effort, so the belief the system forms ('this key was rotated', 'this key is dead') is created by a statement whose failure nobody can observe. THE `let _ =` BINDING IS THE DISCRIMINATOR AND THE PARTITION IS EXHAUSTIVE: the positive control below is the identical vocabulary in the identical roots with the binding negated, so every anchor occurrence lands in exactly one of the two rules and 22 + 7 = 29 is the whole surface. THE DECISIVE PAIR IS IN ONE FILE: engine/rotation.rs contributes 21 rule matches and 1 control match (:1382, `if let Err(e) = rotation_repo::disable_policies_for_credential(...) { tracing::warn!(...) }`) - same file, same module, opposite posture, three lines apart in cost - so the rule discriminates on whether the RESULT IS CONSUMED, not on 'files about rotation'. WHY IT IS A DEFECT AND NOT STYLE, MEASURED BY EXECUTION 2026-08-17 against a read-only copy of the operator's live database: credential_rotation_history.rotation_type carries CHECK(rotation_type IN ('scheduled','manual','token_refresh','suspicious','anomaly')). The engine can supply ELEVEN distinct values and SIX ARE REJECTED BY THE DATABASE - oauth_keepalive, on_suspicious, on_member_departure (all three arrive as &policy.policy_type, whose own CHECK is a DIFFERENT closed set), anomaly_remediation (rotation.rs:824), and event:{cron_schedule,expiration_threshold,healthcheck_failure} (rotation.rs:1103). Each rejected INSERT was replayed individually against the real table. oauth_keepalive is THE ONLY POLICY TYPE THE APP AUTO-PROVISIONS (rotation.rs:1327, :1393) and both live policy rows carry it. Replaying evaluate_due_rotations' success branch for that policy: the history INSERT is refused, `let _ =` at :475 discards the refusal, and mark_rotated at :482 stamps last_rotated_at=now and next_rotation_at=now+interval anyway - so the policy claims a rotation that has no record and did not change the secret. Also dead as a consequence: detect_anomalies at :775-777 guards on h.rotation_type == 'anomaly_remediation', a value the table cannot hold. LEGAL FIX: `if let Err(e) = ... { tracing::warn!(credential_id = %id, error = %e, \"...\"); }` - three lines, keeps the sweep going, and ALREADY EXISTS IN THIS FILE at rotation.rs:1382. The durable fix is a closed RotationKind enum with a total From<PolicyType>, which makes the six rejected values unspellable. DO NOT silence a match by widening the CHECK constraint (that leaves two disagreeing vocabularies and only moves the failure), by hoisting the call into a helper whose caller ignores it, or by adding a tracing line without consuming the Result. EXTERNAL WARRANT - THE CONDITION WAS INDEPENDENTLY REINVENTED, IN ANOTHER LANGUAGE, AND ITS AUTHOR WROTE DOWN WHY: ../brainiac console/app/console/modules/keys/Keys.tsx:30-45 refuses to swallow a failed revoke - 'A swallowed revoke is dangerous: the operator believes a compromised key is dead when it is still active.' - keeping the confirm dialog open and surfacing the error. Same statement, no shared document. The self-critique of the earlier swallowed-error version is preserved at brainiac docs/harness/refactor-bughunt-2026-07-14/con-keys.md:9. RELATIONSHIP TO ITS NEAREST NEIGHBOUR: unledgered-credential-provisioning asks whether a ledger write EXISTS near a provisioning call; this asks whether a lifecycle write's FAILURE IS OBSERVABLE. They are complementary and measured DISJOINT - 0 shared matches - and following that path's prescription with `let _ = audit_log::insert(...)` satisfies it while violating this one. Overlap measured against TWELVE neighbour rules through the real engine: ZERO shared matches with every one of them (unledgered-credential-provisioning, unverified-effect-dispatch, discarded-sync-watermark-write, blind-identity-write, discarded-guard-verdict, silent-row-skip, discarded-timezone-parse, unfenced-work-outcome-write, ledger-field-addressed-by-string-key, secret-as-bare-string-field, undiscriminated-credential-rejection, process-global-caches-a-failure). The `let _ =` family already has two accepted members partitioned by destination vocabulary (.emit for unverified-effect-dispatch; cursor|watermark|checkpoint for discarded-sync-watermark-write); this is the third and the three vocabularies are disjoint by construction. KNOWN BLIND SPOTS, equal on both halves so the partition stays unbiased: (a) the vocabulary is a word list, so a future expire_policy / retire_credential / quarantine_key is invisible until added - the list was taken from the repository layer's actual export set rather than from intuition; (b) `.ok()`, `.unwrap_or_default()`, `if let Ok(_)` and a match arm that drops Err are all equivalent swallows and none is matched; (c) `let _ = ` is assumed in rustfmt normal form - verified, zero occurrences of `let  _`, `let _  =` or `let _=` in either matching file. PRECONDITION (must be re-derived per repo): this signal keys on seven Rust function names and one Rust idiom. A repo that swallows with a catch block, a discarded promise, a Go `_ = f()`, or a decorator that logs-and-continues has the same condition wearing something this pattern cannot see. END OF LIFE: this rule is designed to reach zero. When it does the runner fails structurally on a zero-match rule BY DESIGN - DELETE the rule then, do not baseline it at 0.",
    "$measured": "2026-08-17 @ f432a4ef3 - 564 .rs files walked under src-tauri/src; 22 matches in 2 files, ALL 22 HAND-OPENED, precision 22/22; commentMatchesSkipped 0. Membership reproduced by a structurally independent walker (own traversal, own URL-safe comment stripper, own brace-matched #[cfg(test)] exclusion). The two implementations DISAGREED TWICE and both disagreements were findings: first at 30 vs 29, because the pattern lacked a word boundary and `revoke` matched the suffix of `fleet_companion_revoke` (fixed with \\b); then on a LINE NUMBER while agreeing on every count, because the verifier's test-module stripper replaced blocks with spaces rather than newlines and management_api.rs has a #[cfg(test)] at :236 - it reported :567 where grep -n says :583. Re-extracted from the finished document by parsing its own fenced blocks and re-run through the real runner: identical (22/2, 7/5, 564, floor 500, exit 0). Wall time 1.5-1.7 s for both rules including node startup. The full registry was NOT run."
  },
  "baseline": { "files": 2, "matches": 22 },
  "floor": 500
}
```

```json
{
  "id": "discarded-lifecycle-write-positive-control",
  "goldenPath": "docs/concepts/golden-paths/credential-rotation-and-revocation.md",
  "title": "POSITIVE CONTROL - not a gate. The same seven credential-lifecycle writes whose Result IS consumed: the compliant half of the identical anchor, which the rule must never report.",
  "roots": ["src-tauri/src"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "(?<![\\w:.])(?<!let _ = )(?:[A-Za-z_]\\w*\\s*(?:::|\\.)\\s*){0,4}(?:record_rotation|mark_rotated|disable_policy|disable_policies_for_credential|schedule_failed_retry|update_ledger|revoke)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE - carries no baseline by design. Same roots, same extensions, same 564-file walk, same seven anchors, pointed at the COMPLIANT half by negating the discard binding. EXHAUSTIVE AND DISJOINT BY CONSTRUCTION: a call site either is or is not bound to `let _ =`, so the rule's 22 plus this control's 7 is the entire anchor population (29). THE TWO LOOKBEHINDS ARE BOTH LOAD-BEARING AND THE FIRST ONE IS THE ONE THAT WAS WRONG FIRST: (?<!let _ = ) alone does NOT partition, because the optional `foo::bar::` path prefix lets the regex engine restart the match at the bare function name - where the preceding text is `rotation_repo::`, not `let _ = ` - so the control reported all 29 and the partition silently failed. (?<![\\w:.]) forces the match to begin at the head of the qualified path, where the discard binding is actually visible. Two implementations disagreeing on 29 vs 7 is what surfaced it. THE THREE COMPLIANT SHAPES, all hand-opened: `?` propagation in a command (commands/credentials/broker.rs:68 revoke_broker_consumer - whose doc comment is also the repo's only written statement of WHEN a revocation takes effect; external_api_keys.rs:74 and :218; desktop.rs:103); a consumed Result in the OAuth refresher (oauth_refresh.rs:813, :952 update_ledger); and `if let Err(e) = ... { tracing::warn!(...) }` at rotation.rs:1382, which sits in the SAME FILE as 21 of the 22 violations and is the exact three-line fix they need. Run both together whenever the rule's pattern or vocabulary is edited: if this control's count collapses, the walk or the shared word list broke rather than the codebase being fixed. LIMIT, STATED HONESTLY: a control with no baseline cannot drift, so repointing it at the violating form exits 0. Its liveness guarantee is that it FAILS STRUCTURALLY ON ZERO MATCHES - verified by two induced faults (control pattern replaced with a token appearing nowhere; the shared vocabulary broken in both halves), both exit 1. It is expected to RISE as the 22 violations are converted, which is exactly why it must never be baselined.",
    "$measured": "2026-08-17 @ f432a4ef3 - 7 matches in 5 files via the real runner; 22 + 7 = 29 = the full anchor population, reproduced by the independent walker with identical membership; commentMatchesSkipped 0."
  },
  "floor": 500
}
```

### Two conditions in this leaf I am refusing to gate, with the measurement that justifies each

1. **A rotation that replaces nothing** (§0.3, D-B) is the leaf's most important defect and its
   syntactic population is **three function bodies in one file**. A regex that caught it would have
   to understand what "writes a secret" means, which is a type question. **T1 is the answer.**
2. **Two closed vocabularies with an assignment between them** (§0.1) is the leaf's most *live*
   defect — it is firing right now — and it is a **relation between a migration's CHECK string and a
   variable's domain in another crate**. No pattern spans that. Gap 2 specifies the instrument: a
   property test enumerating every value each call site can supply and asserting the constraint
   accepts it. That is a test, not a rule, and this repo has no such test for any CHECK'd column.

---

## 12. Corrections to the brief

**12.1 — The spine's `sides: client` does NOT hold; `twoSided: true` does.** Of the eleven §7
deviations, **five are Rust** (A, B, C, G, K) and they include all three P0s; six are TypeScript.
The census rule is Rust-only. But the client half is not an afterthought — D4's `+20` and D5's
mislabelled panel are both genuine, both live, and both invisible from the backend. **The honest
label is `twoSided` with the *server* half carrying the P0s** — another spine `sides` label inverted
under measurement, with the same failure mode
[`automated-credential-provisioning`](./automated-credential-provisioning.md) §12.6 recorded for the
neighbouring leaf: **the leaf was labelled from the surface a user sees, and the subject is what the
engine does when nobody is looking.**

**12.2 — The spine's `convergence: converged` FAILS. Eleven labels tested, eleven failed — and this
one failed in the tenth way, exactly as the doctrine warned.** The fleet converged on the **disease**:

- deliberate rotation of a long-lived user-owned secret: **0 of 4 repos-that-could**;
- an enforced expiry on a stored long-lived credential: **0 of 4**;
- revocation propagating to in-flight work: **0 of 4**;
- the provider being told: **0 of 4**;
- rotating the encryption key: **0 of 2 that encrypt**.

Five unanimous absences. An oracle that only counted agreement would read that as the strongest
possible confirmation.

**But asking what the siblings agreed to DO returns a real answer, and it is the document's P2.**
Two genuinely independent repos — `brainiac` (Rust/Postgres) and `ascent` (TS/Prisma) — both
implement the credential lifecycle as `create` / `list` / `revoke` / `resolve` with **no update
verb**, in different languages, with no shared document. **The fleet's answer to "how do you rotate"
is "you don't; you mint a new one and revoke the old one."** Personas is the only repo that built
the verb the others declined to build, and built it hollow. That reframes the leaf: the defect is
not a missing feature, it is a **verb that should not exist in that shape**.

**And the lineage check inverted two of the three apparent convergences.** `personas-web`'s
Rotation Overview declares itself *"the web counterpart to the desktop overview's Rotation
Overview"* (`RotationOverviewCard.tsx:13-14`), is backed by a five-row literal, and is hidden behind
`if (!isDemo) return null`. `personas-cloud` shares this repo's table names, column names and
`$CONNECTOR_NAME_UPPER_FIELD_UPPER` env convention verbatim. **Removing both takes the cohort from
5 to 2 independent data points**, and every "physics" verdict in §6 rests on those two.

**12.3 — Two brief claims sharpened, one corrected.**

- *"0 rotation policies are enabled, so `rotationSubScore` returns 100 for 25 of 25 and contributes
  a constant 20 % of every health score."* **Confirmed and the mechanism is worse than stated.** Of
  the 25, **23** return 100 because no policy row exists and **2** because a policy was
  *disabled by the app's own `Disable` remediation* — and for those two the 100 is not absence of
  evidence, it is a reward for the removal of the control. **Replayed: +20 points each,
  `warning` where `degraded` is earned** (§0.4). The brief had the count and not the direction.
- *"`rotation.rs:269-272` computes `data_stale`, true on 25 of 25, and `:274` decides `Healthy`
  without consulting it."* **The two halves are both true and the framing is incomplete.**
  `:274` decides `Healthy` via `count_1h == 0`, which is a *second* expression of the same
  staleness — so the verdict and the flag are two descriptions of one fact, and only one is used.
  But `data_stale` is **not** unconsulted: `rotation.rs:755` skips the credential entirely when it
  is true, which on this install means `detect_anomalies` never records anything for anyone.
- *"`export_credentials` exports zero and returns `Ok(true)`."* **Not re-derived** — it is
  [`portable-export-bundle`](./portable-export-bundle.md)'s territory and outside this leaf.

**12.4 — A correction owed to a published path.**
[`scoring-and-thresholds`](./scoring-and-thresholds.md) **D10 says `data_stale` is "computed,
shipped, and consulted by nobody"** and that *"`credentialHealthScore.ts` never reads it"*. The
second clause is right; **the first is wrong twice.** `rotation.rs:755` reads it in Rust and acts on
it (`continue`), and `AnomalyScorePanel.tsx:29-31` reads it in TypeScript and renders it as a chip.
The honest finding is sharper than the published one: **`data_stale` is read in three places and
licenses a different conclusion in each** — skip, inform, ignore — with no shared decision about
what it means (Gap 4). Worth correcting there, because "nobody reads it" invites the fix "make
someone read it", and someone already does.

**12.5 — A correction to that path's §12.4, which recorded a hazard as latent.** It found the
`Remediation` snake_case/PascalCase double-serialization while debugging its own replay, resolved it
correctly, and noted *"the latent hazard is real … the snake_case form has a ts-rs binding of its
own, so it can reach the frontend, where the same lookup would silently return 50 for every arm."*
**It is not latent. `AnomalyScorePanel.tsx:6-17` is that bug, shipped**, and its fallback is not a
neutral 50 but an emerald *"Healthy"* chip for a `Disable`-level credential (§7 D5). The composer
predicted the exact failure and looked in the wrong file.

**12.6 — A correction to my own second implementation, recorded because it is the kind that
hides.** My independent verifier agreed with the census engine on every count and reported the
`management_api.rs` site sixteen lines too early, because its brace-matched `#[cfg(test)]` stripper
replaced test modules with spaces instead of preserving newlines. **The counts agreed *because* the
error was in the coordinates, not the population** — so the two-implementation check passed on the
number I would have published while the `file:line` I would have published beside it was wrong.
`grep -n` settled it. Two implementations agreeing is not soundness, and this is a costume the
doctrine had not yet catalogued: **they can agree on the finding and disagree on where it is.**

**12.7 — And the finding the brief did not ask for, which turned out to be the headline.** The brief
asked what a *deliberate* rotation would do differently from the involuntary master-key
regeneration in deferred-fix 1. The answer is that **there is no deliberate rotation to compare it
against.** The involuntary one at least changes the ciphertext; the deliberate one runs a GET and
stamps a date. I found this by replaying `record_rotation` rather than reading it — the CHECK
constraint is four lines of DDL in a file nobody opens, and the code that violates it is
type-correct, clippy-clean and has been in production since the constraint was written.
**The dangerous thing in a rotation leaf is not the rotation that fails. It is the one that
succeeds at something else.**
