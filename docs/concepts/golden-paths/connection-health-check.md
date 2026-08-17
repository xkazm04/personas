# Golden path — the connection health check

> Situation node: `integrations-security/credential-readiness/connection-health-check` ·
> [situation spine](../situation-spine.md) · recurrence 20 · risk **HIGH** ·
> sides **client** (`twoSided: true`, `fusedAcrossSides: false`) · convergence **mixed** ·
> dimensions: **function · resilience · ui · performance**
> Composed 2026-08-15 against `master` @ `7bd14eb9c`.
>
> **Sweep size.** The whole probe engine read end to end — `src/engine/healthcheck.rs`
> (2,117 lines), `core/src/healthcheck_ledger.rs`, `core/src/models/credential_ledger.rs`,
> `src/engine/oauth_refresh.rs` (1,149), the two persistence doors in
> `db/src/repos/resources/credentials.rs`, the run-time auth paths in
> `src/engine/api_proxy.rs` and `src/engine/tool_runner.rs`, and the readiness consumer
> at `commands/design/connector_readiness.rs:1004-1074`. Frontend: all **4,829**
> `.ts`/`.tsx` files under `src/` walked by the census engine; 21 probe triggers and 13
> indicator renderers enumerated by hand. Data: **read-only copies** of the operator's
> `personas.db` (347 MB) and `personas_data.db`, plus the six retained structured app
> logs (2026-08-10 → 2026-08-15).
>
> **Measured by executing, not reading.** Every headline number below came from running
> something:
> 1. `credential_is_usable`'s three SQL statements were **replayed verbatim** against a
>    copy of the live vault, for all 25 credentials, and the verdict printed per row.
> 2. The 104 healthcheck sweeps in this installation's history were **reconstructed** by
>    clustering `credential_audit_log` decrypt rows, then joined against each
>    credential's ring buffer to find probes that ran and were never persisted.
> 3. That result was then confirmed a **third** time, independently, from the app's own
>    `WARN` lines — same credential UUIDs, same second.
> 4. The census rule was validated in a scratch registry unique to this composer, then
>    **re-extracted from this finished document and re-run**: identical (9 files / 9
>    matches; control 4 / 6). Both counts were reproduced by a second engine
>    (Node `RegExp` and ripgrep's Rust `regex`) and all 15 matches hand-audited.
>
> `cargo` was **not** run. **No secret value, prefix or partial appears anywhere below.**
> Two timestamp values are printed verbatim; they are `is_sensitive = 0`, `iv = ''`
> expiry stamps, not credential material. No probe was fired at any provider.

---

## 0. The verdict on the primed lead

**The lead is CONFIRMED — and it was pointed at the wrong organ.** It has been outstanding
across several batches because everyone looked at the *readiness resolver*, which is
mostly right. The defect is in the *probe*, and there are three independent routes by
which a credential the app **knows** is revoked resolves as `Ready`.

### Route 1 — the app detects revocation at run time and writes nothing

```rust
// src/engine/api_proxy.rs:924-934      ← the whole branch body
Err(e) => {
    // Refresh genuinely failed (e.g. invalid_grant / revoked grant) —
    // the credential needs re-auth. Keep the original 401 response so
    // the caller sees the real provider error.
    tracing::warn!(credential_id, service_type = %credential.service_type, error = %e,
        "api_proxy: 401 retry — forced refresh failed; credential likely needs re-auth");
}
```

This is the sharpest moment of truth the system ever gets: a real run, a real 401, a
forced token exchange, and the provider answering `invalid_grant`. The comment states the
conclusion correctly. The branch then **does not** call `mark_needs_reauth`
(`oauth_refresh.rs:951` — four lines of code, already written), **does not**
`append_healthcheck_metadata(pool, id, false, …)`, **does not**
`route_revocation_to_healing`, and **does not** `emit_reauth_required`.

The identical condition reached from the background refresher does all four:

| | `oauth_refresh.rs:117-138` (startup sweep) | `oauth_refresh.rs:223-247` (periodic tick) | `api_proxy.rs:924-934` (**during a run**) |
|---|---|---|---|
| `mark_needs_reauth` | ✔ `:126` | ✔ `:234` | ✘ |
| `route_revocation_to_healing` | ✔ `:127` | ✔ `:235` | ✘ |
| `emit_reauth_required` | ✔ `:128` | ✔ `:236` | ✘ |
| demote the health verdict | ✘ | ✘ | ✘ |
| `tracing::warn!` | ✔ | ✔ | ✔ **(only this)** |

**Three call sites of one fact; two record it, one logs it.** `tool_runner.rs:266-291` is a
fourth: on `ToolErrorKind::Auth || http_status == Some(401)` it force-refreshes and, when
the refresh returns `0`, returns the original error with no ledger write either.

And the asymmetry is *observable in the artefact*. `needs_reauth` is `true` on two
credentials in the live vault, stamped `2026-05-17` and `2026-06-09` — the background
branch's evidence survived 90 days in a database. The `api_proxy` branch's evidence is a
log line, and this machine retains **six days** of logs. **One branch is auditable
forever; the other is unobservable by construction.** That is not a metaphor for the
defect — it *is* the defect.

### Route 2 — 15.3% of probe verdicts are computed and then silently dropped

Reconstructing the last 8 real sweeps from the audit log and joining against each
credential's ring buffer:

| sweep | credentials probed | verdicts persisted | **lost** |
|---|---:|---:|---:|
| 2026-08-07T20:07 | 24 | 24 | 0 |
| 2026-08-09T01:17 | 24 | 11 | **13** |
| 2026-08-10T08:29 | 24 | 24 | 0 |
| 2026-08-11T08:47 | 24 | 24 | 0 |
| 2026-08-12T09:07 | 25 | 25 | 0 |
| 2026-08-13T10:06 | 25 | 12 | **13** |
| 2026-08-14T10:41 | 25 | 25 | 0 |
| 2026-08-15T12:23 | 25 | 21 | **4** |
| **total** | **196** | **166** | **30 (15.3%)** |

A second method, immune to the ring buffer's 20-entry eviction, agrees on the newest
sweep: comparing each credential's *last* audit probe against its *last* ring entry marks
exactly **4 of 25** as lost — `airtable`, `linear`, `notion`, `google_calendar` — each
carrying a verdict **1,542 minutes stale** while the audit log says it was probed 8 hours
ago. A third source, the app's own log, names the same four UUIDs at the same second:

```
12:23:20.664  WARN healthcheck.rs:700: sweep: failed to persist healthcheck metadata
              credential_id=3e417435-…  error=Database error: database is locked
```

Nine such lines on 2026-08-15, twenty-three on 2026-08-13, plus five and ten more from
the `persist_probe_state` patch. **Three independent sources, one answer.**

The mechanism belongs to [`transaction-boundary`](./transaction-boundary.md), which
already measured it: both writers of the health ledger —
`append_healthcheck_metadata` (`credentials.rs:832`) and `patch_metadata_atomic`
(`credentials.rs:753`) — open `conn.transaction()`, a **deferred** transaction, around a
read-then-write, and a deferred upgrade that loses the race fails with
`SQLITE_BUSY_SNAPSHOT` **in 0 ms without consulting `busy_timeout` at all**.

**What belongs to *this* path is what the system then believes.** Both call sites
(`healthcheck.rs:699`, `crud.rs:359`) reduce that `Err` to a `tracing::warn!` — and the
row keeps its **previous verdict**. A dropped `true → false` transition therefore leaves
`Ready` standing, indefinitely, with no surface anywhere reporting that the answer on
screen is not the answer the probe computed. A failed *write* of a health verdict is not
a logging problem. It is a **transition of the verdict to unknown**, and nothing in the
tree models that.

### Route 3 — "we could not check" is stored as `true`, and 21% of Ready rows rest on it

`HealthcheckResult::unverifiable` (`healthcheck.rs:79-85`) sets `success: true`
deliberately, so that a connector with no probe is not read as broken. The consequence,
replayed against the live vault:

| | count |
|---|---:|
| credentials | **25** |
| `healthcheck_last_state = verified` | 15 |
| `= unverifiable` | **8** |
| `= failed` | 2 |
| resolve **Ready** under `credential_is_usable` | **19** |
| …**Ready on an `unverifiable` verdict** (no probe was ever run) | **4 (21% of Ready)** |
| connector definitions with **no healthcheck config of any kind** | **21 of 134 (15.7%)** — incl. every `*_webhook`, `postgres`, `redis`, `mongodb`, `codebase`, `local_drive` |
| …of those 21, covered by a CLI probe instead | **0** |

For those four credentials — a Supabase connection string and three codebase tokens —
revocation is **undetectable by design**: there is no probe, `needs_reauth` is
OAuth-only, and the boolean stays `true` forever. `Ready` there means *present*, and the
UI does not say so at 9 of its 11 reading sites (§7 D).

### And the ambient condition under all three: a verdict never expires

`credential_is_usable` compares `healthcheck_last_success_at` against exactly one thing —
`MAX(credential_fields.updated_at)` — and **never against now**. A `true` from any point
in the past is honoured forever provided nobody edited the fields. There is no maximum
age on a health verdict anywhere in the Rust tree.

The repo has already written the correct answer, on one surface, with the right sentence
attached:

```ts
// src/features/agents/sub_connectors/libs/connectorTypes.ts:28-31
/* A day is long enough that a working setup isn't nagged every session, short
 * enough that "it worked yesterday" isn't treated as evidence about today. */
export const STALE_HEALTHCHECK_MS = 24 * 60 * 60 * 1000;
```

…and 74 lines later records that the other surface lacks it: *"adds `stale`, which is
specific to this surface — **the vault has no notion of a restored result ageing out**"*
(`:105-111`). **`isStaleResult` has 2 consumers, both inside `agents/sub_connectors`.**

### The honest limit of this verdict

**On the live installation today, 0 of the 19 Ready credentials are revoked.** The two
revoked OAuth grants (`gmail`, `google_calendar`) *are* correctly blocked — because their
probes happened to fail and those particular writes happened to land. So the literal
sentence "a revoked credential resolves as Ready" is **not reproducible against the
current data**, and this document does not claim it is. What is proven is the mechanism,
three times over, by execution: the run-time detector writes nothing, 15.3% of verdicts
never reach disk, and 21% of Ready verdicts were never probes. The instance is absent;
the machinery that produces it is present and running.

### Sibling boundaries, settled in prose

[**credential-readiness-resolution**](./credential-readiness-resolution.md) owns the
`Ready` / `NeedsSetup` verdict, `SetupKind`, and the `detached-readiness-verdict` rule.
**This path owns the probe that feeds it** — whether one exists, whether it ran, whether
its answer reached disk, and how old the answer is. Where we meet is
`credential_is_usable`'s single read of `healthcheck_last_success`; that path owns the
*verdict*, this path owns *the quality of the input*, and §0 is the input's audit.

[**outbound-http-call**](./outbound-http-call.md) owns the socket. **Confirmed and
extended:** the health probe is on the *good* side of that census — it takes
`build_ssrf_safe_client(Duration::from_secs(10))` (`healthcheck.rs:1065`), one of the 13
of 44 constructions with the SSRF resolver *and* a hop-revalidating redirect policy, or
`HTTP_ALLOW_PRIVATE` when the connector declares it. Nothing in §7 is an HTTP defect.

[**column-encryption-at-rest**](./column-encryption-at-rest.md) owns the metadata blob as
a *secret container* and already reports that `healthcheck_results` holds up to 5,488
bytes of verbatim remote-API output. **This path owns the same blob as a *verdict*
store** — and adds the finding that path's scan could not see: the two writers of that
blob drop 15.3% of what they are asked to write.

[**transaction-boundary**](./transaction-boundary.md) owns *why* the write fails
(deferred upgrade, `SQLITE_BUSY_SNAPSHOT` at 0 ms). **This path owns what the system
believes when it does.**

[**background-loop**](./background-loop.md) and
[**scheduled-trigger-firing**](./scheduled-trigger-firing.md) own cadence machinery.
Note for anyone carrying that path's finding across: **the health sweep is not on the
scheduled-trigger pipeline** and has *not* been dormant — see §12.

[**status-and-severity-badges**](./status-and-severity-badges.md) owns badge tokens and
their i18n. This path owns *what the badge is allowed to claim*.

The **Deviations** section is a fix backlog.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no file
path, primitive name or count, and each clause carries its warrant so an adopting repo
can tell physics from local calibration.

> **P1 — physics, and it is the whole subject.** A health check answers *"did this work
> just now"*, and its answer decays. Every consumer that reads a stored verdict is
> reading a claim about the past and using it as a claim about the present. The verdict
> is therefore not a value; it is a **value with an age**, and code that stores one
> without the other has stored an assertion it cannot justify.
>
> **P2 — physics, and it is the clause every codebase gets wrong first.** A probe has
> **three** outcomes, not two: it ran and passed, it ran and failed, and *it could not
> run*. "Could not run" is not a failure and it is emphatically not a pass. Collapsing it
> into either one is a lie in a specific direction: fold it into failure and you gate
> working setups; fold it into success and you certify things nobody has ever checked.
>
> **P3 — physics, corollary of P2 and the one people skip.** If the third state is
> encoded as a *value of the two-state field* — a boolean that is `true` for both
> "verified" and "unverified" — then every consumer that was written against the boolean
> is wrong, and none of them will look wrong. Carry the third state as its **own type**,
> and do not keep a two-valued view of it alive beside the three-valued one.
>
> **P4 — physics.** *Failing to record a verdict is not the same as recording nothing.*
> When the write of a probe result fails, the previous verdict is still on disk and is
> now unjustified. Silence about the failure means the system reports an answer it did
> not compute. A verdict whose persistence failed must become **unknown**, not remain
> **stale**.
>
> **P5 — physics, and the sharpest one.** *Learn from the real call, not only from the
> synthetic one.* The probe is a rehearsal; the actual request is the performance. When
> a live operation is refused by the provider — the credential rejected, the grant
> revoked — that is a **stronger** signal than any probe, arriving free, at the moment of
> highest confidence. A system that records probe outcomes but discards run outcomes has
> chosen the weaker evidence and thrown away the stronger.
>
> **P6 — physics.** An expired credential and a revoked one need **different** remedies —
> one is refreshed by machine, the other requires the human to go and re-authorize — so
> they must be different states end to end. Likewise "you are not who you say" and "you
> may not do that": one is fixed by re-authenticating, the other never is. Collapsing
> either pair hands the user a button that cannot work.
>
> **P7 — ergonomics, and it is the two-sided half.** The indicator is not decoration; it
> is the *entire* user-visible output of this machinery. It must render every state the
> producer can emit — including the two nobody designs for, "never checked" and "could
> not check" — and it must render the **age** beside the state, because a green dot with
> no timestamp is the same pixel whether the check was ten seconds or six months ago.
>
> **P8 — resilience.** A probe is an outbound call to a system you do not control, so it
> must be bounded in time, bounded in concurrency, and must never be on the path that
> renders a screen. A health check that can hang has become the outage it was built to
> detect.
>
> **P9 — resilience.** A failing probe must back off, and a backed-off credential must
> not be re-probed on a schedule as though nothing were known about it. Repeatedly
> asking a provider to validate a credential you have already concluded is dead is cost
> without information, and on a rate-limited endpoint it is cost that harms the
> credentials that still work.
>
> **P10 — ergonomics.** When a background sweep changes a verdict, something must tell
> the surface currently displaying the old one. A store updated behind a rendered view
> is a view that is now lying, and the user has no way to know a refresh would change it.
>
> **Scale condition.** P2–P4 are correctness on the *first* probe. P1 and P7 bite the
> first time a verdict outlives the session that produced it. P5 bites the first time a
> credential is revoked out from under a working install. P8/P9 bite at the first
> multi-credential sweep. P10 bites the first time probing moves off the user's click.

### Warrant evidence — five siblings, censused 2026-08-15

`brainiac` (Rust/axum + a Next.js console), `personas-web` (Next.js), `personas-cloud`
(TS orchestrator + Python facade), `vibeman` (Next.js + Tauri), `ascent` (Next.js +
GitHub App). **All five checkouts exist and were read. Nothing below is reported by
omission.**

| clause | brainiac | personas-web | personas-cloud | vibeman | ascent | verdict |
|---|---|---|---|---|---|---|
| P2 three outcomes incl. *could-not-determine* | ✘ (`status:"ok"` only) | ✘ (2 + a *checking* flag) | ✘ (`healthy\|degraded`) | ~ (`pass\|fail\|warn`, but *warn* = partly bad) | **✔ `valid \| revoked \| unknown`** | **1 of 5 — diverged** |
| P1 verdict has an age *that something reads* | ✘ (for connections) | ✘ | writes a timestamp, **never reads it** | in-memory only, lost on restart | ✘ | **SILENCE 5/5** |
| P6 expired ≠ revoked | ✔ `revoked_at`, but issuer-side | ✘ | ✘ refresh failure → `null` | **✘ collapses 401+403 into one `auth_error`** | **✔** 401 re-mints once, 403 classified separately | **2 of 5** |
| P9 failure backed off | n/a | ✘ re-probes every mount | transport only | **✔ full circuit breaker** | ✔ capped exponential mint cooldown | **2 of 5** |
| P8 probe bounded in time | ✔ console 15 s | ✘ | **✘ unbounded fetch inside a token mutex** | ✔ 30 s (LLM path only) | ✔ per-call `AbortSignal.timeout` | **3 of 5** |
| P10 background re-probe exists | ✔ sweeps | ✘ mount/event only | ✔ 30 s heartbeat | ✔ 15 s poll | ✔ Vercel cron | **4 of 5** |
| P7 indicator renders age | ✘ | ✘ | n/a | ✘ | ✘ | **SILENCE 5/5** |

**Four results this document rests on.**

**(a) P1 is a five-repo blind spot, and it must be reported as a proposal, not as
validated doctrine.** Every sibling owns staleness machinery and **none of it points at a
probe verdict**. `personas-cloud` writes `updated_at` on every health update
(`orchestrator/src/db.ts:1052-1054`) and never reads it back. `vibeman` keeps
`lastSuccessAt`/`lastFailureAt` and spends them on circuit-breaker transitions, not on
trust. `ascent` has `tokenIsStale()`, `expiresAt`, `nextScanAt`, session `rexp` — all
about *credential* lifetime, none about *verdict* age. `brainiac` owns the only shipped,
tested age→verdict grader in the fleet (`console/src/health/age.ts`, graded at 1 h / 24 h,
with a `good|watch|bad` tone) and it grades **knowledge propagation**, not connections.
**No repo anywhere computes "the last check was N minutes ago, therefore treat this as
unknown."** So §2's staleness clause is this repo's own `STALE_HEALTHCHECK_MS` promoted
across a boundary — strong reasoning, weak external warrant. Adopt it as such.

**(b) P2 is diverged, Personas is ahead of four of five, and the word does not exist
anywhere else.** Grepping all five checkouts for `unverifiable` returns **zero**. Only
`ascent` names the third state as a first-class concept —
`type VersionVerdict = "valid" | "revoked" | "unknown"` (`src/lib/auth.ts:220-233`), whose
doc says *"no authority to check … we can neither confirm nor disprove"* and whose
consumer at `:277` treats `unknown` differently from **both** neighbours. `vibeman`'s
three-valued enums are the trap: `warn` means *partly bad*, a thrown probe becomes `fail`,
and `useProviderHealth.ts:49` **discards a network error to keep showing the last good
state** — the unverifiable case rendered as green, arrived at independently. **The
`verified | unverifiable | failed` triple is the best design in the six-repo sample. §7 D
is about the fact that Personas' own frontend does not use it.**

**(c) P6 splits the fleet cleanly, and the split is instructive.** `ascent` distinguishes
401 from 403 with a written rationale and refuses to read a 403 as clean
(`src/lib/github/source.test.ts:582`); `vibeman` explicitly merges
`'401' || 'unauthorized' || 'invalid api key' || 'forbidden'` into one terminal
`auth_error` (`src/lib/llm/retryStrategy.ts:85-93`). **Personas is on `vibeman`'s side**:
`ErrorClass::from_status_code` maps `401 | 403 => Permanent`
(`core/src/healthcheck_ledger.rs:39`) and the probe itself has **one** non-2xx branch
(`healthcheck.rs:1133-1144`). `invalid_grant` appears in **zero of the five** siblings —
so Route 1's failure has no cross-repo warrant as a *pattern*; it is a local defect with a
local fix, and the fix is four lines that already exist in the same repo.

**(d) The one clause the oracle refuses to support as hygiene.** I expected to prescribe
"probe every credential on a schedule". `personas-web` — the repo whose users would most
benefit — has no scheduled re-probe at all and no reported pain; the repos that built one
each built it for a *different* reason (worker liveness, rate-limit protection, cache
warming). Only `ascent` re-probes credentials specifically, and it does so as a
side-effect of a scan cron, not as health policy. **Scheduling is not the convergent
clause; recording what you already learned is.** That is why §2 leads with P5.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "add a **Test connection** button" · "check whether the key still works"
- "show a green dot when the integration is healthy" · "grey out the ones that are broken"
- "the card said connected and then the run failed"
- "probe every credential on startup" · "run them all and show a summary"
- "this connector has no API to call — just mark it OK"
- "we got a 401 during the run; log it and move on"
- "why does it say healthy when I revoked that token last week?"

**If you are about to write** `HealthcheckResult`, `HealthProbeState`,
`run_healthcheck`, `append_healthcheck_metadata`, `persist_probe_state`,
`healthcheck_last_success`, `healthcheck_last_state`, `success: true` on a probe you did
not run, a `match status { … }` over a probe response, an interval that re-probes, or a
component that maps a health value to a colour — **you are in this situation.**

**You are also in it, and this is the case everyone misses, if you are handling a 401,
a 403, or a failed token refresh anywhere in a request path.** That is a health check
you got for free and are about to throw away (P5).

**Not this path:** whether a persona may *run* is
[credential-readiness-resolution](./credential-readiness-resolution.md); how the probe's
HTTP request is constructed is [outbound-http-call](./outbound-http-call.md); why the
ledger write loses a race is [transaction-boundary](./transaction-boundary.md); what the
probe response is allowed to persist is
[column-encryption-at-rest](./column-encryption-at-rest.md); the app's *own* liveness
(`system_health_check`, `SystemHealthPanel`) is a different subject entirely and shares
only the word.

---

## 2. The one way

**Produce a three-valued verdict, stamp it with the time it was produced, refuse to hand
any consumer a two-valued view of it, and treat every authentication failure you observe
anywhere — probe or production — as a verdict.** Build the probe with
`HealthcheckResult::probed(success, msg)` when a request actually went out and
`HealthcheckResult::unverifiable(msg)` when no probe exists, never a hand-rolled bool;
take the client from `build_ssrf_safe_client(Duration::from_secs(10))` so the probe cannot
hang the sweep or reach your LAN, and bound the sweep's concurrency the way
`HEALTHCHECK_SWEEP_CONCURRENCY = 3` does. **Persist through
`append_healthcheck_metadata`, and treat its `Err` as a state transition, not a log
line** — a verdict you failed to store is now *unknown*, so clear the stale one rather
than leaving it standing; today both call sites reduce that `Err` to `tracing::warn!` and
15.3% of this installation's verdicts are silently stale as a result. **Read the verdict
back through `readCredentialHealthState` (frontend) or `healthcheck_last_state` (Rust) —
never through `healthcheck_last_success === true`,** because the backend writes `true` for
*"we could not check"* on purpose and the boolean cannot tell you which `true` you have;
if you only need "not known to be broken", compare against `false` and say so in the
name. **Show the age next to the state and mark it stale past a written threshold** —
copy `STALE_HEALTHCHECK_MS` and `isStaleResult` from `connectorTypes.ts`, which already
exist, already carry the rationale, and are used on exactly one of the six surfaces that
need them. **And when a real request comes back 401 or a token refresh returns
`invalid_grant`, write it down before you return the error**: `mark_needs_reauth` +
`append_healthcheck_metadata(false)` + `emit_reauth_required`, exactly as
`oauth_refresh.rs:126-128` already does, because that is the strongest evidence the system
will ever get about this credential and it currently reaches disk from two of its four
sources.

If you must get one thing right first: **the third state.** The cipher of this leaf is
that `unverifiable` is stored as `success = true` and 9 frontend sites read it as a
verified probe.

---

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
|---|---|
| `src/engine/healthcheck.rs:33` — `HealthProbeState { Verified, Unverifiable, Failed }` | **the type this whole path is about.** `#[ts(export)]`, stable `token()` at `:43` pinned to the serde wire form. The best design in the six-repo sample (§Warrant b) |
| `healthcheck.rs:65` — `HealthcheckResult::probed(success, msg)` | a verdict from a request that actually went out |
| `healthcheck.rs:79` — `HealthcheckResult::unverifiable(msg)` | **the one you will forget.** No probe exists for this connector. Sets `success: true` for back-compat gating and `state: Unverifiable` for truth |
| `healthcheck.rs:644` — `summarize_probe_states(&[…])` | tallies a sweep by **typed state, not by the boolean**, and its doc comment is the warrant for §9: counting on `success` *"silently folds 'never probed' into 'passed'"* |
| `healthcheck.rs:412` — `run_healthcheck(pool, credential_id)` | the whole per-credential probe: CLI-sourced routing, variant/connector/OAuth-provider config resolution, the per-credential OAuth lock, private-network opt-in, template resolution |
| `healthcheck.rs:367` — `race_local_probes(service_type)` | CLI and desktop probes raced via `tokio::select!`, first success wins |
| `healthcheck.rs:217` — `run_cli_probe(probe, Duration)` | a bounded subprocess probe that **keeps the child handle so it can kill a hung CLI** (`kill_on_drop`, `CREATE_NO_WINDOW`, 5 s deadline). Copy this shape for any external probe |
| `healthcheck.rs:1065` — `build_ssrf_safe_client(Duration::from_secs(10))` | the probe's HTTP door: 10 s total, private-IP-rejecting resolver at connect time, hop-revalidating redirect policy |
| `healthcheck.rs:614` — `HEALTHCHECK_SWEEP_CONCURRENCY = 3` | bounded fan-out, with the written rationale that many credentials share an API host |
| `healthcheck.rs:626` — `persist_probe_state(pool, id, state)` | stamps `healthcheck_last_state` into the ledger's `custom` map |
| `db/…/credentials.rs:821` — `append_healthcheck_metadata(pool, id, success, msg)` | the canonical verdict write: ring-buffer append + `last_success` + `last_message` + `last_tested_at`, in one transaction, sanitized |
| `core/src/healthcheck_ledger.rs:96` — `append_healthcheck_entry(...)` | the ring buffer itself: 20 entries, error classification, HTTP-status extraction, 200-char cap, defence-in-depth `sanitize_secrets` |
| `core/src/healthcheck_ledger.rs:26` — `ErrorClass { Transient, Permanent, Unknown }` | transient-vs-permanent classification of a probe failure |
| `core/src/models/credential_ledger.rs:256` — `mark_needs_reauth()` / `:262` `clear_needs_reauth()` | the revocation flag and its clear. **Four lines. Route 1 is the missing call to the first.** |
| `oauth_refresh.rs:951` — `mark_needs_reauth(pool, id)` + `:127` `route_revocation_to_healing` + `:128` `emit_reauth_required` | **the three-part revocation record.** Reached from 2 of 4 sites that learn the same fact |
| `src/features/vault/…/list/credentialListTypes.ts:29` — `readCredentialHealthState(cred)` | **the frontend read door.** Prefers the typed token, falls back to the boolean *deliberately and in writing*. Four-arm return incl. `untested` |
| `src/features/vault/…/list/CredentialListColumns.tsx:18` — `<HealthBadge state={…} />` | **the one indicator that is right.** Four states, `StatusBadge` variants, a tooltip explaining `unverifiable`, all copy through `t.vault.credential_list.*` |
| `src/features/agents/sub_connectors/libs/connectorTypes.ts:31` — `STALE_HEALTHCHECK_MS` / `:38` `isStaleResult(result)` | **the age doctrine, already written, with its rationale in the doc comment.** 2 consumers, both in one feature folder |
| `…/connectors/ConnectorStatusBadges.tsx:102` — `<LastCheckedNote/>` | the only component in the app that renders a probe's age: `RelativeTime` + amber + `Clock` + an inline **Retest** action past the threshold |
| `connectorTypes.ts:64` — `restoreHealthcheck(cred)` | rehydrate a persisted verdict into a live-shaped result **with `cached: true`**, which is what makes `isStaleResult` able to distinguish "you just watched this run" from "this is from a previous session" |
| `src/lib/bindings/HealthProbeState.ts:15` | the generated union. **Zero importers** — see §7 E |

**Do not exist — this path names them:**

- **Any maximum age on a verdict, anywhere in Rust.** `credential_is_usable` compares the
  success timestamp only against `credential_fields.updated_at`.
- **Any invalidation of a verdict whose write failed.** The `Err` is logged; the row keeps
  the old answer.
- **Any ledger write from a run-time authentication failure.** Routes exist for the
  background refresher only.
- **Any event, of any kind, emitted by the daily sweep.** `healthcheck.rs` contains zero
  `emit` calls, so a sweep that changes 25 verdicts tells the open UI nothing.
- **Any distinction between 401 and 403** — one `Permanent` class, one non-2xx branch.
- **Any short-circuit that skips probing a credential already flagged `needs_reauth`.**
  Both revoked credentials are probed every sweep, each acquiring the OAuth lock and
  attempting a real token exchange: 20 consecutive failures each, on this machine.
- **Any single writer for `oauth_token_expires_at`**, which exists in *two* places
  simultaneously (§7 G).

---

## 4. Steps

1. **Decide, in writing, whether this connector can be probed at all.** If there is no
   endpoint that authenticates the credential, the answer is `unverifiable` — say so in
   the connector definition and stop pretending. **21 of 134 connectors are in this
   class and none of them is marked as such anywhere a reader would look.**
2. **Return a `HealthcheckResult` built by the constructor that matches reality.**
   `probed(false, …)` for a request that came back non-2xx, `probed(true, …)` for 2xx,
   `unverifiable(…)` for no probe. **Never construct the struct literally** — the two
   constructors are the only places that get the `success`/`state` pair coherent.
3. **Bound it.** 10 s for HTTP via `build_ssrf_safe_client`, 5 s for a CLI probe, and
   keep the child handle so a hung CLI can be killed. Never call a probe on a render
   path; the sweep runs in Rust for exactly this reason (`healthcheck.rs:661-666` records
   that the previous frontend fan-out raced IPC-token injection and produced *spurious
   "degraded" cards even though the keys were valid and the probe never ran* — a false
   negative manufactured by the transport).
4. **Persist through `append_healthcheck_metadata`, then `persist_probe_state`** — and
   **handle the `Err`**. This is step 4 and it is the one this repo skips at 2 of 2 call
   sites. The minimum correct handling is: retry once, and if it still fails, clear
   `healthcheck_last_success` / `healthcheck_last_state` to `null` so the surface reads
   `untested` rather than a verdict nobody computed.
5. **Ask the type-over-gate question now**, before §9. The answer for this leaf is below
   and the type it names already exists and has zero importers.
6. **Read it back through the typed door.** `readCredentialHealthState` on the frontend,
   `healthcheck_last_state` in Rust. If you find yourself typing
   `healthcheck_last_success === true`, you have just written a bug against 32% of this
   installation's credentials; if you mean "not known to be broken", write `!== false`
   and name the variable accordingly.
7. **Render all four states and the age.** `untested`, `unverifiable`, `verified`,
   `failed`; then `RelativeTime` + `isStaleResult` + a retest affordance.
   `HealthBadge` + `LastCheckedNote` between them are the complete answer and they live in
   two different feature folders, which is why nobody has both.
8. **Wire the run-time failures in.** Every place you handle a 401, a 403, or a failed
   refresh: `mark_needs_reauth` when the grant is gone, `append_healthcheck_metadata(…,
   false, …)` always, `emit_reauth_required` if a human must act. One helper, called from
   all four sites.
9. **Back off, and respect the backoff.** A credential flagged `needs_reauth` with an
   expired grant should not be re-probed on the normal cadence — it needs a human, not a
   request. `oauth_refresh.rs` already has `set_refresh_backoff` /
   `is_in_refresh_backoff`; the probe does not consult either.
10. **Emit an event when a sweep changes anything**, so the surface currently rendering
    the old verdict can invalidate. Today: zero.
11. **And then stop.** Do not add a fourth state, a second boolean, a per-feature
    staleness constant, or a private copy of the union. There are already five
    declarations of a three-arm union in `src/` and the generated one is the unused one.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`healthcheck_last_success === true` as "verified"** | The backend writes `true` for *"there is no probe for this connector"*. **9 sites, 9 files**, all reading a certification that was never issued. Live blast radius: **8 of 25 credentials (32%)** are `unverifiable`; 4 of them are `Ready` on that basis. |
| **A probe result whose write failure is a `tracing::warn!`** | The row keeps the *previous* verdict, so the UI reports an answer the probe contradicted. **Measured: 30 of 196 verdicts (15.3%) over 8 sweeps**, and the only trace is a log line on a machine that retains six days of logs. |
| **Logging a revocation instead of recording it** | `api_proxy.rs:924-934`. The comment is right, the branch body is one `warn!`. The same fact reached from the background refresher writes three durable records. **The evidence of one path survives 90 days in a database; the other is gone in six.** |
| **A verdict with no maximum age** | `credential_is_usable` honours a `true` from any point in the past. `STALE_HEALTHCHECK_MS` exists, says why, and is used on 1 of 6 surfaces. **0 of 5 sibling repos have any verdict-age check either** — so expect to be the first, not to be catching up. |
| **`None => "passed"`** | `tool_runner.rs:1125`: when no HTTP status could be extracted, the tool test reports **passed**. An indeterminate probe outcome recorded as a pass is P2 collapsed in the more dangerous direction, in the surface that gates tool adoption. |
| **One branch for every non-2xx** | `healthcheck.rs:1133-1144` formats `"Service returned HTTP {n}"` for 401, 403, 429 and 503 alike. A rate limit, a scope problem and a dead key produce the same red dot and the same advice. `ErrorClass` exists and is computed *afterwards, by re-parsing the string the branch just formatted* (`healthcheck_ledger.rs:47-66`) — the status was in hand and was turned into prose first. |
| **Re-probing a credential you already know is dead** | Both revoked OAuth credentials are probed every sweep, take the per-credential OAuth lock, and attempt a real token exchange against the provider. **20 of 20 ring-buffer entries are failures on both.** `needs_reauth` is never consulted by the probe that would benefit from it. |
| **A background sweep with no notification** | Zero `emit` calls in `healthcheck.rs`. A sweep rewrites 25 verdicts and every mounted card keeps rendering the old one until an unrelated `fetchCredentials()` happens to land. |
| **Hand-declaring the state union** | Five declarations of `verified \| unverifiable \| failed` in `src/`, and the **generated** one (`bindings/HealthProbeState.ts`) has **zero importers**. One hand copy adds a fourth arm; another is `HealthcheckResult.ts`, whose header admits it is hand-maintained because the Rust struct has no ts-rs derive. |
| **A dot component nobody renders** | `CompositeHealthDot.tsx` — the only component in the app that maps health to a coloured dot with five tiers — has **zero importers**, and the 191-line scorer behind it is reachable from production only as a *sort comparator*, fed an object with no `state`, so its entire `unverifiable` branch is unreachable. |
| **Mirroring a bulk result into the per-item cache without its state** | `useBulkHealthcheck.ts:84` copies `{success, message}` and drops `r.state`, so pressing **Test all** downgrades every three-state verdict on screen to two-state. |

---

## 6. Evidence

### The one site to copy — `src/engine/healthcheck.rs:405-518` + `:644-655`

`run_healthcheck` plus `summarize_probe_states` are, together, the correct producer:
CLI-sourced credentials rerouted to their own verify path (`:422`); an audit-logged
decrypt (`:433`); per-variant → connector-level → OAuth-provider config resolution
(`:439`); the per-credential OAuth lock with a **re-read of the fields inside the lock**
because a concurrent refresh may have landed (`:472-475`); a rotated refresh token
persisted while the lock is held, with the comment explaining that not doing so *"would
brick the credential on the next refresh"* (`:486-495`); a connector-declared
private-network opt-in (`:506`); and — the part to copy above all — the `skip` branch that
returns **`unverifiable`, not success** (`:458-463`), with three lines of comment saying
exactly why. `summarize_probe_states` then tallies by `state`, and its doc comment is the
single best statement of P2 in the fleet.

On the consumer side the one site to copy is
**`CredentialListColumns.tsx:18-50` + `ConnectorStatusBadges.tsx:102-122`** — four states
with a tooltip on the hard one, plus the age with a stale threshold and a retest action.
They are in different feature folders and no surface has both. That is §7 D and §7 F.

### Supporting exemplars

| site | the property to copy |
|---|---|
| `healthcheck.rs:217-260` `run_cli_probe` | takes the stdio handles out so `child` survives, `timeout(deadline, …)` then an explicit kill — with a comment naming *"the bug we're fixing here"* (a hung CLI with no handle to terminate) |
| `healthcheck.rs:741-785` `daily_healthcheck_tick` | **writes the cadence timestamp BEFORE the sweep**, so a panic or a crash mid-run cannot produce a re-sweep every tick; a missing/corrupt stamp is treated as due and healed by that same write |
| `healthcheck.rs:661-666` | records that the *previous* design — N concurrent privileged IPC calls from the frontend — raced `x-ipc-token` injection and produced spurious "degraded" cards. **A transport that manufactures false negatives is a health-check failure mode, and this repo has already paid for it once** |
| `connectorTypes.ts:28-43` | a staleness threshold **with its rationale in prose**, and `isStaleResult` returning `false` for live results because *"the user just watched them run"* |
| `connectorTypes.ts:105-111` | a type comment that names its own gap: *"adds `stale`, which is specific to this surface — the vault has no notion of a restored result ageing out"* |
| `credentialListTypes.ts:29-36` | a legacy fallback that is **deliberate, documented, and in the right order** (typed token first, boolean second) — the correct way to keep a two-valued channel alive while migrating off it |
| `core/src/healthcheck_ledger.rs:109-119` | sanitizes the probe message *again* at the ring-buffer boundary, "even if callers have already sanitized, to guard against future call sites" |
| `mcp_tools.rs:2412-2440` | the gateway-member probe reusing `append_healthcheck_metadata` + `persist_probe_state` rather than inventing a second ledger — the only other producer in the tree and it went through the front door |

### The vault, measured (read-only copy, 2026-08-15)

| | value |
|---|---:|
| credentials | **25** |
| `healthcheck_last_state` present on | **25 of 25** |
| …`verified` / `unverifiable` / `failed` | **15 / 8 / 2** |
| boolean-vs-token disagreements today | **0** (the mechanism for one is proven; no instance is live) |
| resolve `Ready` under `credential_is_usable` | **19** |
| …Ready on an `unverifiable` verdict | **4 (21%)** |
| …Ready **and** revoked | **0** — see §0's honest limit |
| credentials with `needs_reauth = true` | **2**, stamped 2026-05-17 and 2026-06-09 |
| ring-buffer occupancy | 24 of 25 at the 20-entry cap |
| ring entries carrying an HTTP status code | **200 only**; **every failure in the vault has `status_code: null`** |
| connector definitions | **134**, of which **113** carry a healthcheck config, **0** carry `skip: true`, **21 (15.7%)** carry none |
| sweeps in this installation's history | **104** (`credential_audit_log`, `detail='healthcheck'`, 1,491 rows) |
| last sweep | **2026-08-15T12:23:18Z**, 8.4 h before composition |

**The `status_code: null` line is a finding.** `extract_http_status`
(`healthcheck_ledger.rs:77-92`) recovers the number by scanning the *message* for the
literal `"HTTP "`. The success path formats `"Connection successful (HTTP 200)"` and
parses cleanly; the failure path formats `"Service returned HTTP {n}"` — which also
contains `"HTTP "` — yet **0 of the ~40 failure entries in the live vault carry a code**,
because the failures that actually occur are `Connection failed: …` (transport) and
OAuth-resolution errors that never reach the HTTP branch at all. So `ErrorClass` on live
data is decided entirely by the keyword fallback (`"timeout"`, `"unauthorized"`,
`"revoked"`), and the observed classes are `permanent` and `unknown`. **The structured
half of the classifier has never fired on this installation.**

### The lost-write measurement, in full

Two independent methods, reported separately because the doctrine says agreement is not
soundness:

- **Method A (eviction-proof).** Per credential: last audit-logged probe vs last ring
  entry. **4 of 25 lost**, all on the most recent sweep, gap 1,541.9 minutes each.
- **Method B (last 8 real sweeps).** Per sweep: probed set from the audit log vs ring
  entries within ±3 min. **30 of 196 lost (15.3%)**, concentrated in three sweeps
  (13 / 13 / 4) and zero in the other five.

They agree on the intersection (the 08-15 sweep: 4 and 4) and the third source — the app's
own `WARN` lines with `error=Database error: database is locked` — names the identical
UUIDs. Method B's older sweeps could in principle be confounded by ring eviction; Method A
cannot be, and Method A alone establishes the defect. **The failure is bursty, not
uniform**: five of eight sweeps lost nothing, which is why it has never been noticed.

### The frontend half, in full

**21 probe triggers** (16 user-clicked, 2 save-path, 4 mount-effect fan-outs) and **13
indicator renderers**. The distribution is the finding:

| | count |
|---|---:|
| trigger sites using `AsyncButton` | **0** |
| …using `Button loading={…}` | **1** (`OverviewTab.tsx:117`) |
| …hand-rolled `<button disabled>` + `LoadingSpinner` (which renders `null`) | the remaining 20 |
| indicator renderers that distinguish `unverifiable` | **2 of 13** (`HealthBadge`, `ConnectorStatusCard`) |
| …that paint `unverifiable` **green** by reading the boolean | **7 of 13** |
| components that render the verdict's **age** | **1** (`LastCheckedNote`) |
| surfaces with **both** a correct state set and an age | **0** |
| frontend intervals that re-probe | **0** |
| Tauri events emitted by the backend sweep | **0** |

`useRemediationEvaluator.ts:147` runs a 30-minute interval, but it reads
`anomaly_score` from already-persisted metadata and never invokes a probe; its
`forceEvaluate` doc says *"e.g., after manual healthcheck"* and nothing wires it.

### Convergence — see the Warrant block above

Five checkouts, all reachable, none silent on the general subject. Two clauses come back
**SILENT 5/5** — verdict age, and rendering age in the indicator — and both are reported
as silences rather than promoted.

---

## 7. Deviations

> **Second pass — what is upstream of every item below.** One verdict is carried in
> **two encodings**, stored in **two places**, written by **two statements** in **two
> transactions**, and declared **five times** in TypeScript:
>
> | | the boolean | the typed state |
> |---|---|---|
> | produced by | `HealthcheckResult.success` | `HealthcheckResult.state` |
> | written by | `append_healthcheck_metadata` (`credentials.rs:821`) | `persist_probe_state` → `patch_metadata_atomic` (`healthcheck.rs:626`) |
> | lands in | `CredentialLedger.healthcheck_last_success` (a **typed field**) | `ledger.custom["healthcheck_last_state"]` (an **untyped map**) |
> | in the ts-rs binding | ✔ | **✘ absent** |
> | read by the readiness resolver | ✔ **only this** | ✘ |
> | read by the frontend | 18 sites | 2 sites |
>
> Every deviation below is a consequence. The boolean is the one that is typed, exported,
> bound, and therefore reachable — so it is the one everybody uses, and it is the one that
> cannot express the third state. **The fix is not eleven fixes. It is to make the typed
> state the only thing that exists on the wire and let the compiler find the callers.**

### 7.A — P0: the app detects a revoked grant during a run and records nothing

| Path | What's wrong |
|---|---|
| `src/engine/api_proxy.rs:924-934` | The `Err` arm of the forced 401 refresh. Its own comment says *"invalid_grant / revoked grant — the credential needs re-auth"*. The body is a single `tracing::warn!`. |
| `src/engine/tool_runner.rs:266-291` | Same shape: `ToolErrorKind::Auth \|\| http_status == Some(401)` → force-refresh → if `refreshed == 0`, return the original error. No ledger write. |
| `src/engine/oauth_refresh.rs:117-138`, `:223-247` | The two sites that get it **right**, three durable writes each. |

**Fix — lift the three-call block into one helper and call it from all four sites:**

```rust
// src/engine/oauth_refresh.rs — new, beside mark_needs_reauth (:951)
pub(crate) fn record_revocation(
    pool: &DbPool, app: Option<&AppHandle>, cred: &PersonaCredential, detail: &str,
) {
    mark_needs_reauth(pool, &cred.id);
    route_revocation_to_healing(pool, &cred.id, &cred.name, &cred.service_type);
    emit_reauth_required(app, cred, detail);
    // the piece none of the existing three sites do — demote the health verdict
    if let Err(e) = cred_repo::append_healthcheck_metadata(pool, &cred.id, false, detail) {
        tracing::warn!(credential_id = %cred.id, error = %e, "revocation: verdict write failed");
    }
    crate::engine::healthcheck::persist_probe_state(pool, &cred.id, HealthProbeState::Failed);
}
```

Then `api_proxy.rs:933` and `tool_runner.rs`'s `refreshed == 0` path call it. Note the
last two lines are new for **all four** sites: even the two correct ones flag
`needs_reauth` without demoting the health verdict, which is why `credential_is_usable` —
a function that never reads `needs_reauth` — needed the daily probe to catch up before it
would block.

### 7.B — P0: 15.3% of probe verdicts never reach disk, and the row keeps the old answer

| Path | What's wrong |
|---|---|
| `src/engine/healthcheck.rs:699-701` | `if let Err(e) = append_healthcheck_metadata(…) { tracing::warn!(…) }` — the sweep's only handling. |
| `src/engine/healthcheck.rs:632-634` | Same for `persist_probe_state`, so the boolean and the typed token can land independently. On 2026-08-15 `desktop_docker` and `arcade` lost **only** the state patch. |
| `src/commands/credentials/crud.rs:359-366`, `:369` | The per-credential IPC command has the identical pair. **The user presses Test connection, sees a result, and the result may not be stored.** The command returns `Ok(result)` either way. |
| `db/…/credentials.rs:832`, `:753` | Both writers open `conn.transaction()` — deferred — around a read-then-write. See [transaction-boundary](./transaction-boundary.md). |

**Measured on the operator's installation:** 30 of 196 verdicts over 8 sweeps; 4 of 25 on
the most recent one; 23 + 10 write failures logged on 2026-08-13 alone.

**Fix, in two parts.** (1) `transaction_with_behavior(TransactionBehavior::Immediate)` at
`credentials.rs:832` and `:753` — which makes `busy_timeout = 5000` actually apply and
removes most of the loss. (2) **The part that belongs to this path**: make the remaining
failure *change the verdict*.

```rust
// src/engine/healthcheck.rs:699 — replace the warn-and-continue
if let Err(e) = cred_repo::append_healthcheck_metadata(pool, &id, success, &message) {
    tracing::warn!(credential_id = %id, error = %e, "sweep: verdict write failed — invalidating");
    // A verdict we could not store must not leave the previous one standing.
    let mut patch = serde_json::Map::new();
    patch.insert("healthcheck_last_success".into(), serde_json::Value::Null);
    patch.insert("healthcheck_last_state".into(), serde_json::Value::Null);
    let _ = cred_repo::patch_metadata_atomic(pool, &id, patch);
}
```

`readCredentialHealthState` already returns `'untested'` for a null boolean, so the UI
degrades correctly with no frontend change. **A verdict you failed to record is unknown,
not still true.**

### 7.C — P0: `unverifiable` is read as verified at 9 sites, in 9 files

| Path | What it decides |
|---|---|
| `src/features/agents/shared/quickConfig/useHealthyConnectors.ts:47` | `healthcheck_last_success !== true` → skip. Offers unprobed connectors as healthy. |
| `src/features/agents/sub_connectors/…/AgentCredentialDemands.tsx:178` | emerald `CheckCircle2`. |
| `src/features/home/sub_cockpit/widgets/ConnectedServicesWidget.tsx:110` | cockpit `ok` state (emerald). |
| `src/features/teams/…/slackBridge/SlackBridgePickers.tsx:45` | **suppresses the `slack_bridge_credential_unverified` warning** for credentials that are, precisely, unverified. |
| `src/features/plugins/artist/hooks/useCreativeConnectors.ts:31` | `healthy: true`. |
| `src/features/plugins/companion/inbox/hooks/useCockpitSummary.ts:89` | the `okCreds` count in the companion summary. |
| `src/features/templates/sub_generated/design-preview/ConnectorsSection.tsx:123` | `isHealthy` → `CheckCircle2` in the design recap. |
| `src/features/templates/sub_generated/adoption/ucPicker/ucPicker.tsx:86` | filters the use-case picker. |
| `…/adoption/ucPicker/useUcPickerState.ts:102` | same, in the state hook. |

**All nine hand-audited: 9/9 true positives.** Every one asserts *verification* from a
value the backend also writes for *"no probe exists"*. The compliant form is present in
the same codebase — six sites compare against `false` (i.e. "not known to be broken"),
which matches `credential_is_usable`'s documented semantics exactly. **Fix:** route all
nine through `readCredentialHealthState(cred) === 'verified'`.

### 7.D — P1: the "one dot" this leaf is named for does not render

`src/features/vault/sub_credentials/components/card/badges/CompositeHealthDot.tsx` maps
health to a five-tier coloured dot (`critical`/`degraded`/`warning`/`healthy`/`unknown`)
and even carries a staleness hint in its `title`. **It has zero importers.** The
191-line `credentialHealthScore.ts` behind it is reachable from production code only via
`credentialListTypes.ts:181-182`, as a **sort comparator**, fed a `{success, message}`
object with no `state` — so its `unverifiable → 50` branch is unreachable in production.
Its `getTierStyle` also uses raw `bg-red-500` / `bg-emerald-400` rather than the
`var(--status-*)` tokens its live siblings use. **Either wire it or delete it**; a dead
renderer is why nobody noticed that seven live renderers are wrong.

### 7.E — P1: the generated state type has zero importers and is hand-copied five times

| declaration | arms |
|---|---|
| `src/lib/bindings/HealthProbeState.ts:15` (**ts-rs generated**) | 3 — **0 importers** |
| `src/lib/bindings/HealthcheckResult.ts:5` | 3, inline; header admits *"hand-maintained: the Rust struct has no ts-rs derive"* |
| `src/features/agents/sub_connectors/libs/connectorTypes.ts:3` | 3, re-declared with the same name |
| `src/features/vault/shared/hooks/health/useCredentialHealth.ts:42` | 3, and **optional/nullable** where the binding says required |
| `src/features/vault/…/list/credentialListTypes.ts:20` | **4** — adds `untested` |
| `src/lib/types/types.ts:84` | 3 |

And `src/lib/bindings/CredentialLedger.ts:17` — which *is* generated — carries
`healthcheck_last_success` but **not** `healthcheck_last_state`,
`healthcheck_last_tested_at` or `healthcheck_last_message`, because those live in the
Rust ledger's untyped `custom` map. That absence is the direct cause of
`credentialListTypes.ts:30` bypassing `parseCredentialLedger` to hand-parse
`cred.metadata` with `parseJsonOrDefault`. **Fix:** promote the three keys to typed
fields on `CredentialLedger`, add `#[derive(TS)] #[ts(export)]` to `HealthcheckResult`,
regenerate (`cargo test --workspace --features desktop export_bindings`), and delete the
five hand copies.

### 7.F — P1: the age of a verdict is invisible everywhere the verdict matters

`healthcheck_last_tested_at` is written on every probe and read by **one** file
(`connectorTypes.ts:70`). It reaches the screen in **one** component
(`ConnectorStatusBadges.tsx:102-122`). The vault credential list — the canonical place a
user looks — renders `last_used_at` and `created_at` in the same row and **never** the
probe timestamp. A verdict from 2026-05-09 and one from ten seconds ago are the same
pixels. `healthcheck_last_success_at` is written on every pass and read by **zero** UI.
`isStale` on `useCredentialHealth`'s `HealthResult` (`:46-47`) is declared and **never set
by any producer**. `BulkSummary.completedAt` is stored and never rendered.

**Fix:** `<HealthBadge>` takes the timestamp and composes `LastCheckedNote`; promote
`STALE_HEALTHCHECK_MS`/`isStaleResult` out of `agents/sub_connectors/libs` into a shared
module. Then give the *backend* the same notion — `credential_is_usable` should treat a
success older than the threshold as `untested`, not as `Ready`.

### 7.G — P2: three smaller ones

1. **`oauth_token_expires_at` exists twice.** It is a plaintext `credential_fields` row
   (`is_sensitive = 0`, `iv = ''`, 35 chars) **and** a metadata key, written independently.
   On **2 of 2** live OAuth credentials the two copies already disagree — by 20 µs and
   18 µs, so today it is harmless, and that is the point: there is no single writer and
   nothing compares them. The refresher reads the metadata copy (`extract_expires_at`);
   field resolution reads the other.
2. **A backed-off, `needs_reauth` credential is still probed every sweep.** Both revoked
   grants take the per-credential OAuth lock and attempt a real token exchange, daily,
   20 consecutive failures each. `is_in_refresh_backoff()` exists and the probe never
   asks.
3. **`tool_runner.rs:1125` — `None => "passed"`.** A tool test whose HTTP status could not
   be extracted is recorded as a pass.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **`HealthProbeState` cannot express age, and no reachable type can.** This is
   qualification Q1 exactly: the union is correctly closed on *outcome* and encodes
   nothing about *when*, because the timestamp lives in a sibling key. A perfectly
   migrated codebase in which all 13 renderers read the typed token would still render a
   green tick for a probe that passed in May. **The type-over-gate answer for the third
   state does not solve the staleness problem, and pretending otherwise is the mistake
   this Gap exists to prevent.**
2. **21 of 134 connectors cannot be probed at all**, and 4 of the 19 currently-Ready
   credentials sit on them. For a webhook URL, a Postgres connection string or a codebase
   token there is no cheap authenticated round trip. `unverifiable` is the honest answer
   and it is the right one; what is missing is that `Ready` does not say which kind of
   Ready it is. **No amount of probe engineering closes this; only the label can.**
3. **A probe proves the credential worked *for the probe's endpoint*.** The app has no
   notion of provider-granted scope (established by
   [credential-readiness-resolution](./credential-readiness-resolution.md) §4: scopes are
   captured at `oauth.rs:1604-1612` and never read back), so a token that can read a
   profile and not write an issue passes every check this path prescribes.
4. **A 401 and a 403 are one state end to end** — `ErrorClass::from_status_code`
   (`healthcheck_ledger.rs:39`), the single non-2xx branch (`healthcheck.rs:1133`), and
   `tool_runner.rs:1120`. Splitting them is a schema change to `ErrorClass` plus a new
   `SetupKind`, i.e. it crosses into the sibling path. `ascent` is the only repo in the
   fleet that has done it.
5. **The ring buffer is 20 entries with no aggregate**, so "this credential has failed 3
   of the last 20 times" is computable and computed by nobody; `anomaly_score` is a
   separate rotation-side signal on a separate cadence. Meanwhile the ring's
   `status_code` is `null` on every live failure (§6), so even the data that is there is
   thinner than its schema suggests.
6. **There is no verdict for "the probe itself is broken."** A connector whose
   `healthcheck_config` template fails to resolve produces a `Failed` verdict
   indistinguishable from a rejected credential — the user is told to fix their key when
   the catalog entry is wrong. `Misconfigured` exists as a `SetupKind` on the readiness
   side and has no counterpart here.

---

## 9. The missing gate

**The condition, stated stack-free so an adopting repo can re-derive its own proxy:**
*a consumer treats the two-valued back-compat view of a three-valued probe verdict as
proof that the probe ran and passed.* Any codebase that keeps a boolean beside a
tri-state — and they nearly all do, for one migration or another — has this condition, and
it will wear whatever shape that repo's boolean happens to have. **Do not port the
pattern below; port the sentence above.**

### Where it runs

`npm run census:check`, which is **step 7 of `npm run check`** and therefore runs on
every developer machine and in the pre-push hook. It is verified green at HEAD today
(96 rules, 241,951 file-visits, exit 0). **This deliberately does not depend on CI:
`ci.yml` has 0 successes in 260 all-time runs, so a gate that only runs there runs
nowhere.** The census runner also supplies the fail-loud contract this section requires —
`floor: 4000` fails the run if the walk sees fewer than 4,000 files ("the matcher is
broken, not the codebase clean"), a zero-match rule fails, and a silent *drop* fails just
as a rise does.

### The signal

The discriminator is the **comparison operand**, and it partitions the anchor cleanly:

- `healthcheck_last_success === true` asserts *verified* — and is wrong, because the
  backend writes `true` for `Unverifiable` on purpose (`healthcheck.rs:79-85`).
- `healthcheck_last_success === false` asserts *known-broken* — and is right, because it
  is exactly what `credential_is_usable` (`connector_readiness.rs:1042`) does.

Measured over 4,828 `.ts`/`.tsx` files, in two engines that agree exactly, with all 15
matches hand-audited:

```
15  comparisons of the probe boolean against a literal
 ├─  9  violating  — compared to `true`   (9 files)   ← the rule
 └─  6  compliant  — compared to `false`  (4 files)   ← the positive control
 +  2  ignored     — prose about the migration, on comment-only lines
```

The rule's warrant is the codebase's own: `summarize_probe_states`
(`healthcheck.rs:637-643`) exists **because this exact conflation was a bug**, and its
comment says counting on `success` *"silently folds 'never probed' into 'passed' — which
is exactly the bug this split fixes"*. It was fixed for the bulk summary and left standing
at nine frontend sites.

**Recall is deliberately partial and this is stated, not hidden.** The rule does not
catch bare truthiness (`healthOk: c.healthcheck_last_success` at `credentialGraph.ts:344`,
`:391`) or the documented ternary fallback at `credentialListTypes.ts:35`, because
neither can be told apart from correct code by a comparison operand. Widening it to bare
reads would sweep the parsers, the writers and the type declarations — precision would
fall from 9/9 to roughly 9/42. **A gate that fires on correct content is worse than no
gate.**

```json
{
  "id": "unverifiable-probe-read-as-verified",
  "goldenPath": "docs/concepts/golden-paths/connection-health-check.md",
  "title": "A credential's probe verdict is read as proof of verification by comparing its back-compat boolean to true — the value the backend also writes when no probe exists at all",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "healthcheck_last_success\\s*(?:===|!==|==|!=)\\s*true",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "The credential health boolean compared against the literal `true`. `HealthcheckResult::unverifiable` (src-tauri/src/engine/healthcheck.rs:79-85) sets success=true for a connector that has NO live probe, so `=== true` cannot distinguish `Verified` from `Unverifiable` and every such site certifies a check that never ran. The compliant form compares against `false` (\"not known to be broken\"), which is exactly what credential_is_usable does at connector_readiness.rs:1042 — see the positive control. PROXY FOR the stack-free condition: a consumer treats the two-valued back-compat view of a three-valued probe verdict as proof the probe ran and passed. An adopting repo must re-derive its own proxy; this one keys on a field name."
  },
  "baseline": { "files": 9, "matches": 9 },
  "floor": 4000
}
```

```json
{
  "id": "unverifiable-probe-read-as-verified-positive-control",
  "goldenPath": "docs/concepts/golden-paths/connection-health-check.md",
  "title": "CONTROL: the compliant half of the same anchor — the probe boolean compared against false, i.e. excluding known failures without claiming verification",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "healthcheck_last_success\\s*(?:===|!==|==|!=)\\s*false",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "Control for `unverifiable-probe-read-as-verified`. Partitions the same anchor population: 6 matches in 4 files today. A near-zero result here would mean the rule is not discriminating on the comparison operand but on the field name, and the 9 it reports would be the whole anchor rather than its violating half."
  },
  "floor": 4000
}
```

### Two things this gate cannot do, said plainly

- **It cannot see Routes 1 and 2** — the two most serious findings in this document. Both
  are **absences**: a branch that does not write, and an `Err` that does not invalidate.
  The census ratchets a count of something *present*; per the doctrine it cannot assert an
  absence. Route 1 needs a Rust test that asserts the revocation helper is called from all
  four sites (or, better, §"Prefer a type" below, which removes the choice). Route 2 needs
  the invalidating write in 7.B, after which the condition is structural rather than
  countable.
- **It cannot reach zero and must not be baselined at zero.** Nine is the fix backlog. If
  7.C lands and the count reaches zero, this rule must be **deleted**, not ratcheted to
  0 — a zero-match rule fails the runner by construction.

### Prefer a type over a gate — and here it is the whole answer

Held against the seven qualifications:

- **Q5 (withholding beats requiring) — this is the fix.** `HealthcheckResult` carries
  `success: bool` *and* `state: HealthProbeState`, and the doc comment at `:57-60` calls
  `success` back-compat. **Delete it from the wire type.** No call site can then compare a
  boolean to `true`, because there is no boolean; all nine sites in 7.C become compile
  errors, and so does `useBulkHealthcheck.ts:84`'s state-dropping mirror. The gating
  semantics that `success` encoded are recoverable as one method —
  `state != HealthProbeState::Failed` — expressed once instead of at nine call sites.
- **Q6 (withhold the dangerous freedom, not the answer).** Correct: callers still get the
  verdict, in full and in more detail. What is withheld is the *collapsed view*.
- **Q3 (a type nobody constructs constrains nothing) — the live warning.**
  `HealthProbeState` already exists, is already ts-rs exported, and has **zero importers
  in 4,829 files** while five hand-copies of its union circulate. Shipping the type was
  done in wave 9 and changed nothing, because the boolean beside it stayed reachable.
  **Adding a type does not remove a bad state; removing the alternative does.**
- **Q7 (withholding a requirement is inert when the caller supplies the bad value
  voluntarily).** Applies to the *storage* half. Making `healthcheck_last_state` a typed
  field on `CredentialLedger` (7.E) does not stop anyone reading
  `healthcheck_last_success`; the boolean must actually be removed from the ledger — and
  when it is, `credential_is_usable`'s single read (`connector_readiness.rs:1042`) becomes
  a compile error too, which is precisely the call site that decides `Ready`.
- **Q1 (a type carries only what it encodes) — the honest limit, and it is §8 Gap 1.**
  Closing the outcome union does nothing about age. A fully migrated codebase still shows
  a green tick for a May probe. The staleness half of §2 is **not** obtainable by this
  type change and has no external warrant either (SILENT 5/5). It needs a second edit:
  the timestamp travelling *inside* the verdict rather than beside it, so that no consumer
  can hold a state without also holding its age.

**Where the type cannot reach.** Route 1's defect is a branch that calls nothing — no
signature change makes an absent call present, and this is the doctrine's first
unreachable case (a decision that never crosses a parameter). The only structural fix
there is to make the *error* carry the obligation: give `AppError::OAuthRevoked` a
constructor that takes `&DbPool` and `&PersonaCredential` and performs the recording, so
that the value cannot be created without the ledger being written. That is a real design
and it is a proposal, not a measurement — no sibling repo has done it, and it should be
adopted as a house convention with its warrant stated as such.

---

## 12. Corrections to the brief

1. **"The scheduled-trigger pipeline has not fired since 2026-05-28, so anything gated on
   a schedule has not been exercised" — does not apply here, and this is the correction
   most likely to mislead a future composer.** The credential healthcheck is **not** a
   scheduled trigger. It is a `ReactiveSubscription`
   (`subscription.rs:933-941`, 600 s interval, 24 h gate inside the tick) driven by the
   engine's own loop. It has run **104 times** on this installation, most recently
   **8.4 hours before composition**, and `app_settings.credential_healthcheck_last` reads
   `2026-08-15T12:23:18`. **The probe machinery is thoroughly exercised — which is what
   made the 15.3% loss measurable at all.** Had the brief's assumption held, §0 Route 2
   would have been invisible.

2. **"The one dot that reports pass/fail/unverifiable" — the dot does not exist.**
   `CompositeHealthDot.tsx` has zero importers (§7 D). What ships is a **badge**
   (`HealthBadge`) on one surface and twelve other renderers with five different state
   sets. The leaf's own `why` field describes a component that renders nowhere.

3. **The primed lead is confirmed but mis-located.** It has survived several batches
   because it was framed as a readiness-resolver defect. The resolver's boolean read is
   the *last* link; the breaks are upstream — a run-time detector that writes nothing, a
   15.3% write-loss with no invalidation, and a third state stored as `true`. Verifying it
   by reading the resolver would have concluded "works as documented", which is probably
   what happened before.

4. **"A revoked credential still resolves as `Ready`" is not reproducible on the current
   data, and this document says so.** All 25 credentials were replayed through
   `credential_is_usable`: 19 Ready, 0 of them revoked. The two revoked grants are
   correctly blocked. **The mechanism is proven three ways; the instance is not present
   today.** Anyone re-testing this should expect a clean vault and should test the
   mechanism, not the state.

5. **"`oauth_token_expires_at` lives in an unencrypted `metadata` JSON blob" — true, and
   incomplete. It lives there *and* as a plaintext `credential_fields` row**
   (`is_sensitive = 0`, `iv = ''`, 35 chars) on both live OAuth credentials, written by
   two paths that already disagree on 2 of 2 rows (§7 G1). The disagreement is 20 µs and
   currently harmless; the structural fact is that there is no single writer.

6. **"`persona_credentials.encrypted_data`/`iv` are an empty husk on all 25 rows" —
   independently confirmed** while counting non-empty `credential_fields` per credential
   for the readiness replay. Also confirmed: the healthcheck's own field access goes
   through `get_decrypted_fields`, never the husk.

7. **"A connector's health probe is an outbound HTTP call; 40 of 44 clients set a timeout
   and `SSRF_SAFE_HTTP` covers 13 of 44" — confirmed, and the probe is on the good side of
   both.** `healthcheck.rs:1065` takes `build_ssrf_safe_client(10 s)`; the
   `HTTP_ALLOW_PRIVATE` branch is gated on the connector's declared
   `allow_private_network` (3 of 134 connectors). **There is no outbound-HTTP defect in
   this leaf**, and saying so matters: it moves the risk from the network layer, where a
   reader would expect it, to the persistence and typing layers, where it actually is.

8. **The spine's `sides: "client"` under-describes this leaf.** The probe, its cadence,
   its persistence and every one of the three §0 routes are **server-side**; the client
   half is the indicator and the triggers. The document is written two-sided
   (`twoSided: true` is correct) with the contract stated in §7's second-pass table — one
   verdict, two encodings, and the boundary is where the untyped one crosses the IPC line.

9. **One brief question answered in the negative, which is itself the finding.** *"Do
   probes ever run on a schedule?"* — yes, daily, reliably. *"What happens on a 401
   mid-run versus a 401 during a probe? Do they converge on the same state?"* — **no, and
   they diverge in the worse direction.** A 401 during a *probe* becomes
   `probed(false, …)` and demotes the credential. The identical 401 during a *run* — with
   strictly more evidence behind it, including a failed token exchange — produces a log
   line and leaves the verdict untouched. **The synthetic check is trusted; the real one
   is discarded.**
