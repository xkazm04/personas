# Golden path — automated credential provisioning

> Situation node: `integrations-security/credential-capture/automated-credential-provisioning` ·
> [situation spine](../situation-spine.md) · recurrence 14 · risk **HIGH** ·
> sides **client** (spine label; **see §12.6 — the leaf is overwhelmingly server-side**) ·
> convergence **mixed** ·
> dimensions: **security · function · resilience · code-quality · ui**
> Composed 2026-08-16 against `master` @ `2a874e692`.
>
> **Subject.** Every path by which this app comes to hold a credential *without a human typing
> it*: reading one out of a locally-installed CLI, scanning the filesystem for one, importing
> another application's config, driving a browser with a model to create one, and minting one
> for itself.
>
> **Sweep.** Read end to end: `commands/credentials/{cli_capture,foraging,desktop,desktop_bridges,
> auto_cred_browser,crud,broker,external_api_keys,credential_design,connectors,auth_detect}.rs`,
> `engine/{credential_broker,management_api,desktop_security,desktop_discovery,healthcheck,
> oauth_refresh}.rs`, `db/src/repos/resources/credentials.rs`, `db/src/credential_fields.rs`,
> `src/ipc_auth.rs`, plus the frontend halves: `vault/sub_catalog/components/{autoCred/**,
> foraging/**,desktop/**,picker/CliConnectionPanel.tsx}`, `onboarding/components/
> {useOnboardingState.ts,DesktopDiscoveryStep.tsx}`, `api/{auth/cliCapture.ts,system/desktop.ts,
> vault/foraging.ts}`. Census walk: **564** non-generated `.rs` files under `src-tauri/src`
> (the runner's own `walked`).
> Data: **read-only copies** of the operator's `personas.db` (347 MB) and `personas_data.db`
> (17.5 MB), copied 2026-08-16 21:05 and deleted after use.
>
> **Measured by executing, not reading.**
> 1. The four credential-write doors and three grant-mint doors were **partitioned by whether
>    the write reaches the append-only ledger**, by the real census runner and again by a
>    structurally different function-scope walker. Both return the same 3 / 3 split with
>    identical membership (§9).
> 2. The **metadata of all 25 live credentials was parsed and its key-space histogrammed**:
>    **0 of 25 carry any provenance key**, while the four doors write three different
>    provenance stories (§0.2).
> 3. **`external_api_keys` was replayed in full** — 1,029 rows, 92 distinct days, `expires_at`
>    NULL ×1,029, `bound_origin` NULL ×1,029, 1,022 never used, 1 live — against the narrow
>    door's **0 rows in 4 months** (§0.3). The count is **+2 on the figure a sibling path
>    measured earlier the same day**, which is the leak rate made visible.
> 4. Every automated door was checked against the **live audit trail** to see whether it has
>    ever run here. All but one have **never run** (§0.5).
> 5. `PRIVILEGED_COMMANDS` (192) ∪ `CLOUD_COMMANDS` (50) was parsed out of `ipc_auth.rs` and
>    each provisioning command tested for membership (§0.4).
>
> `cargo` was **not** run. **No capture flow was started, no browser was opened, no credential
> was transmitted, and no secret value, prefix, partial or length appears below.** Findings are
> reported as shape, column, and count.
>
> ### Sibling boundaries, settled in prose — and this leaf is surrounded
>
> This leaf sits inside a ring of five already-published paths, and **all five of the leads the
> brief primed turned out to be their published findings** (§12). Each is confirmed here and
> handed back:
>
> [**credential-capture-form**](./credential-capture-form.md) owns the moment a human types a
> secret, and owns the masking-policy-in-a-prompt finding (`auto_cred_browser.rs:648`; 45 of 196
> catalog fields encrypted-at-rest and rendered in cleartext). **Confirmed unchanged.** What this
> path adds is what happens when *nobody types*: three of its guarantees — the review screen, the
> ref-not-state discipline, the fail-secure classifier read — are properties of a *form*, and
> three of the four provisioning doors have no form.
>
> [**oauth-connect-flow**](./oauth-connect-flow.md) owns the credential obtained by consent —
> the handshake and, more importantly, the lifetime. **Confirmed and extended in one direction:**
> that path found the refresh engine writes a fabricated expiry; this path found the **CLI-capture
> door sets `healthcheck_passed: Some(true)` into a struct field the persistence layer never
> reads** (§0.6) — the same "assert a verification you did not perform" shape, arriving at the
> opposite outcome because the type silently swallowed it.
>
> [**credential-injection-into-child**](./credential-injection-into-child.md) owns the system key
> as a thing **handed to a subprocess**, and published the 1,027-row measurement. **Confirmed at
> 1,029 and extended with the rate**: 7.87 rows/day over 131 days, 11.2 on the 92 days the app
> actually ran, against **1** hand-created key in `settings_audit_log` and **0** broker handles.
> Where that path asks "what should the child hold", this one asks "what should the *minting*
> look like" — and finds the mint is the only provisioning write in the tree that touches neither
> ledger (§9).
>
> [**informed-consent-gate**](./informed-consent-gate.md) owns consent, and §7.B already publishes
> onboarding's grant-everything-display-nothing. **Confirmed, with one correction upward:** that
> path calls `CapabilityApprovalCard` *"the best disclosure surface in the frontend"* and names
> `description()`/`risk_level()` as its Rust mirror. It missed a third field —
> `DesktopConnectorManifest.justifications`, **14 hand-authored, connector-specific reasons** that
> cross IPC in the ts-rs binding and have **zero frontend consumers** (§7.E). The card renders the
> generic per-capability description instead.
>
> [**external-url-opening**](./external-url-opening.md) owns the `OPEN_URL:` auto-open
> (`auto_cred_browser.rs:939-956` → `TauriPlaywrightAdapter.ts:91`, unsanitized). **Confirmed
> verbatim.** Not re-derived here.
>
> [**secret-and-pii-redaction**](./secret-and-pii-redaction.md) owns `scrub_secrets`. **Confirmed
> with a denominator correction: it is 9 of 12 call sites passing `&[]`, not 9 of 10** (§12.3).
>
> [**untrusted-definition-validation**](./untrusted-definition-validation.md) owns
> validate-by-reconstruction. **Confirmed and given a new instance with an unusual ending:** the
> auto-cred *universal* mode asks a model to author a whole connector definition, Rust passes it
> through by `.cloned()`, the TypeScript adapter **reconstructs it correctly** into a closed
> shape — and **nothing consumes the result** (§7.F). A textbook P2 implementation protecting
> nothing.
>
> The **Deviations** section is a fix backlog.

---

## 0. The headline

**This app has four doors that write a credential into the vault and three that mint an access
grant. One door — the one a human types into — carries the audit entry, the server-side
re-verification, the OAuth redemption and the rotation policy. The other six inherit exactly
what the *storage layer* does, and nothing else. The controls that survived automation are the
ones that were never at a door.**

### 0.1 — The split, counted

Two credential controls live inside `insert_credential_and_fields_tx`
(`db/src/repos/resources/credentials.rs:242-294`), the function every writer ends up calling.
Seven live inside `create_credential` (`commands/credentials/crud.rs:35-133`), which only one
writer is. The coverage follows exactly:

| control | where it lives | doors covered |
|---|---|---:|
| encrypt-at-rest via `is_field_sensitive` (name backstop, fail-secure default) | **repository** (`credentials.rs:269`) | **4 of 4** |
| `field_type` via `classify_field_type` | **repository** (`:273`) | **4 of 4** |
| append-only `credential_audit_log` `create` row | door (`crud.rs:87`) — plus **one hand-rolled copy** (`foraging.rs:758-762`) | 2 of 4 |
| session-key decryption of the IPC payload | door (`crud.rs:41-51`) | 1 of 4 |
| `oauth_session_ref` redemption (tokens never cross IPC) | door (`crud.rs:62-65`) | 1 of 4 |
| **refusing the caller's `healthcheck_passed` and re-probing server-side** | door (`crud.rs:69-94`) | 1 of 4 |
| rotation-policy auto-provision | door (`crud.rs:122`) | 1 of 4 |
| OAuth connect-seed expiry stamp | door (`crud.rs:128-130`) | 1 of 4 |
| provenance in `metadata` | **ad hoc, per door, three different vocabularies** | 2 of 4 |

The two rows that read *4 of 4* are the two that are not at a door. That is the whole finding,
and it generalises: **a control's coverage is a property of its altitude, not of its
importance.** The most security-critical control in this territory — the fail-secure
sensitivity classifier `credential-capture-form` calls *"the best small piece of design in this
territory"* — is also the only one every automated door gets for free, **because it is a line
inside the INSERT loop rather than a line inside a command.**

### 0.2 — A provisioned credential is indistinguishable from a typed one

`metadata.source` is not decorative. It is read by **four** consumers and it changes behaviour:
`healthcheck.rs:88-98` `is_cli_sourced` routes the probe to a local CLI instead of HTTP;
`oauth_refresh.rs:471-489` routes the *refresh* to `recapture_for_credential` instead of a token
exchange; `connector_strategy.rs:697,:714` documents the same; and `ReauthBanner.tsx:107,:139`
picks which recovery button to render.

Exactly **one** of the four doors writes it:

| door | what it stamps | consequence |
|---|---|---|
| `cli_capture_save` (`cli_capture.rs:1028-1038`) | `source: "cli"`, `cli_captured_at`, `oauth_token_expires_at` | ✔ renewable, probed locally, correct banner |
| `register_imported_mcp_server` (`desktop.rs:143-148`) | `source: <absolute path of claude_desktop_config.json>`, `imported_from: "claude_desktop"` | **`source` overloaded** — same key, a second vocabulary, and a local filesystem path lands in a column the export bundle round-trips |
| `import_foraged_credential` (`foraging.rs:735-744`) | **`metadata: None`** | the door that knows exactly where the value came from (it holds `foraged_id`) records nothing; a foraged AWS key can never be re-read |
| auto-cred browser → `createCredential` (`useAutoCredSession.ts:206-211`) | nothing — the frontend sends `{name, service_type, data, healthcheck_passed}` | a model-extracted credential is byte-identical, at rest, to a hand-typed one |

**Live, measured:** the `metadata` JSON of all **25** credentials was parsed and its keys
histogrammed. The key-space is `healthcheck_*` (25/25), `usage_count`/`last_used_at`/
`anomaly_score` (25/25), `description` and `is_builtin` (4), the ten `oauth_*`/`needs_reauth`
keys (2), `always_active` (1). **`source`: 0. `imported_from`: 0. Any provenance key at all:
0 of 25.**

The audit ledger is the fallback answer, and it is honest but narrow: `credential_audit_log`
holds **4** `create` rows, and that is **4 of 4** for the credentials created since the ledger's
first row (2026-05-19) — the other 21 predate it. So the *coverage* is currently perfect and
the *mechanism* is not: two of the four doors do not write a `create` row at all (§9), so the
number is 4/4 only because those two doors have never been used here (§0.5).

### 0.3 — The wide door and the narrow door, still running

The corpus has already measured this population once
([credential-injection-into-child](./credential-injection-into-child.md) §0). Re-measured
2026-08-16 21:05 it has **moved**, and the movement is the point:

| | narrow door — `credential_broker::mint_derived_handle` (`:130`) | wide door — `management_api::get_or_create_system_api_key` (`:570`) |
|---|---|---|
| scope | `proxy:credential:<id>` + `cred:<connector>:use` | `proxy` — **every credential in the vault** |
| TTL | clamped into `[5, 1440]` minutes; *"'Short-lived' is a security property, not a suggestion; the mint path clamps, never trusts"* (`:42-44`) | `expires_at: None` |
| origin binding | `None` (n/a) | `None` |
| names its holder | **required, rejected if empty** (`:136-141`) | name is the literal `"system"` on all 1,029 rows |
| audit | `audit_log::insert_warn(… "broker_handle_minted" …)` at `:165` | **none — neither ledger** |
| **call sites** | **2** | 1 |
| **live rows** | **0**, in 4 months | **1,029** |

`external_api_keys`, replayed: **1,029 rows** over 2026-04-07 → 2026-08-16 (131 days, 92 of
them with rows) = **7.87 rows/day**, **11.2/day when the app actually ran**. `expires_at` NULL
on 1,029 of 1,029. `bound_origin` NULL on 1,029 of 1,029. `last_used_at` NULL on **1,022**;
seven were ever used, all on 2026-05-25/26. `enabled = 1` on **one** row. The 1,028 revocations
were not a policy — `get_or_create_system_api_key` revokes the previous keys *at the start of the
next mint* (`:579-585`), so revocation is a side effect of app launch.

Two comparisons make the ratio legible. The user has hand-created **1** API key in four months
(`settings_audit_log`, `category='api_keys'`, `action='create'`). And `api_key_audit` — the
request trail for these keys — holds **1 row** (a `POST /api/scrape/readable` on 2026-07-08).
**1,029 identities minted, 1 request recorded, 0 expiries, 0 origin bindings, and the facility
that clamps a TTL has produced nothing.**

### 0.4 — Two doors hand the renderer the plaintext, and one of them is not gated

The IPC tiers were extracted from `ipc_auth.rs` and each provisioning command tested for
membership in `PRIVILEGED_COMMANDS` (192) ∪ `CLOUD_COMMANDS` (50) — which is the *only*
enforcement, since `wrap_invoke_handler` (`:617-624`) validates `x-ipc-token` for exactly those
names and `require_auth` is `Ok(())` (`:537-539`).

| command | tier | returns |
|---|---|---|
| `cli_capture_run` (`cli_capture.rs:818`) | **PUBLIC** | `CliCaptureResult.fields: HashMap<String,String>` — **the live `gh` / `gcloud` / `aws` / `stripe` token, in plaintext** (`:603-612`) |
| `import_claude_mcp_servers` (`desktop.rs:35`) | gated | `ImportedMcpServer.env: HashMap<String,String>` — **Claude Desktop's MCP server environments, which is where its API keys live** (`desktop_discovery.rs:441`) |
| `import_foraged_credential` (`foraging.rs:716`) | gated | an id + a count. **No value on the wire in either direction** |

`cli_capture_run`'s in-body guard is `require_auth(&state).await?`, which returns `Ok(())`
unconditionally. Its **production UI call sites: 0** — `CliConnectionPanel.tsx:95` calls
`cliCaptureSave` (which is gated and returns no value). Its only caller is
`src/test/automation/bridge.ts:1713`, the test-automation HTTP bridge, which deliberately
projects `fieldKeys` and never values (*"Returns captured field keys (never the secret values)"*).
**So the safe behaviour of this surface is a property of its one caller, not of the door** — the
same shape `untrusted-definition-validation` §7.A measured for `create_connector`'s `metadata`.
And the app's own doc comment names the threat model this defeats:
*"any unexpected callers (compromised renderer, malicious plugin webview, test-automation HTTP
bridge) leave a trail"* (`external_api_keys.rs:110-112`).

Two clean results worth stating, because they were checked rather than assumed:
`desktop.rs` carries **9 commands and 0 `#[requires]` attributes**, and **all 9 are in
`PRIVILEGED_COMMANDS`** — enforcement is present, the annotation is absent, which is the exact
inverse of `ipc-session-token-race`'s finding and confirms the list, not the macro, is the gate.
And `execute_desktop_bridge` (`desktop_bridges.rs:36`) really does call
`desktop_security::check_permission` before dispatch, so an unapproved capability cannot run.

### 0.5 — Everything here is armed and unexercised, except the part that runs on the app itself

The live audit trail was searched for each door's own marker. The result reframes every
deviation below as **structural, not live**:

| door | live evidence of ever having run |
|---|---|
| foraging scan (`__foraging_scan__` audit rows) | **0** |
| AI browser capture (`__autocred_session__` rows; `playwright_procedures`) | **0 / 0** |
| CLI capture (a credential with `metadata.source == "cli"`) | **0** |
| MCP import (a credential with `service_type LIKE 'mcp_%'`) | **0** |
| desktop capability approval (`desktop_connector_approvals`) | **0** |
| broker handle (`credential_consumer_edges`; `external_api_keys` named `handle:%`) | **0 / 0** |
| model-authored connector (`connector_definitions WHERE is_builtin = 0`) | **0** (134 rows, all builtin) |
| **the app minting a key for itself** | **1,029** |

**The only automated provisioning path this installation has ever used is the one the app runs
on itself, eight times a day.** That is why the defects survived: nothing exercises them, and
the one thing that does is the one with no ledger entry, no expiry and the broadest scope in
the system.

### 0.6 — And the one place a door *does* assert a verification, the type eats it

`cli_capture_save` (`cli_capture.rs:1041-1052`) builds a `CreateCredentialInput` with
`healthcheck_passed: Some(true)` and hands it to `cred_repo::create_with_fields`.
`insert_credential_and_fields_tx` (`credentials.rs:242-294`) **never reads that field.** The
INSERT lists seven columns and `healthcheck_passed` is not among them, nor is any probe
scheduled.

So the field is inert, and both halves of that are findings:

- The **fabrication does not ship** — but only by accident. The reason it does not is that the
  field is meaningful at exactly **one** of its four production construction sites,
  `create_credential` (`crud.rs:75`), where a 2026-06-07 bug-hunt made it a *request* rather
  than a claim: *"`healthcheck_passed` from the client is a UX hint that a probe was attempted
  in the renderer — it is NOT proof. Stamping it verbatim let any IPC caller fabricate a
  'Connection verified' badge."* That fix is excellent and it is scoped to that function.
- The **verification also does not happen.** A CLI-captured credential is stored with no probe
  requested and no probe run, so it enters the vault in the `unverifiable` state while its
  author believed it entered `verified`.

This is [doctrine Q1](../golden-path-doctrine.md#1--prefer-a-type-over-a-gate--and-the-seven-qualifications)
in its purest form: `CreateCredentialInput.healthcheck_passed: Option<bool>` sits on a
*persistence-input* struct and encodes a *command-level* request. Three of its four constructors
set it or omit it into the void.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no file path,
primitive name or count, and each clause carries its warrant so an adopting repo can tell
physics from local calibration.

> **P1 — physics, and it is the whole subject.** *Automation removes the human from the loop,
> and every guarantee that lived in the human's screen leaves with them.* Consent, disclosure,
> the review before the write, the audit entry someone would have expected, the check that ran
> because a person clicked — each of those is, by default, a property of the surface the person
> used. Building a second, unattended door does not copy them; it bypasses them. Before you
> add that door, enumerate what the first one did that was not about typing.
>
> **P2 — physics, confirmed 3 of 3, and the corollary that decides every case below.** *Put the
> invariant at the store, not at the door.* A check inside the write path covers every writer
> that will ever exist, including the ones not yet imagined. A check inside a command covers one
> command. The distribution is never even, and the lopsidedness predicts exactly which paths
> will be wrong — so count your controls by altitude before you count them by importance.
> *Warrant: every sibling that could have converged on one write door did, one of them with the
> reason for each divergence written down, and this repo is the fleet's only outlier.*
>
> **P3 — strongly reasoned, externally UNTESTED; a unanimous absence.** *A credential must
> record how it arrived, in the same write that stores it.* Provenance is not documentation; it
> is an input to later decisions — how to renew this, whether to re-probe it, which recovery to
> offer, whether to trust it at all. A decision cannot read a log line. And one provenance field
> carrying two different vocabularies is worse than none, because now the readers are
> confidently wrong instead of blind. *Warrant: nobody does this. Four codebases independently
> built a column to put it in and left it empty; the closest anyone comes is a naming
> convention in a display field.*
>
> **P4 — physics, converging as a DEFECT, and automation makes it acute.** *A grant the system
> issues to itself must expire, and must be no wider than the job.* A human-issued grant has a
> human who remembers it; a machine-issued one has nobody and is issued on a schedule, so its
> worst property compounds at the rate of the schedule rather than at the rate of human
> attention. If your codebase contains both a narrow minting facility and a broad one, the ratio
> of their row counts is the real policy. *Warrant: scope is done correctly everywhere and
> expiry nowhere — and the sharpest case is a codebase that expires its human invitations and
> not its machine tokens, in the same schema.*
>
> **P5 — the discipline is physics (3 of 3); the preview mechanic is untested.** *On preview,
> withhold the secret from the client.* A discovery flow is the one place a program deliberately
> reads secrets it does not yet own. Show a masked preview and an opaque handle; re-resolve the
> real value at the moment of import, on the side of the boundary that already has the
> authority. This costs one indirection and deletes the entire class of "the value was sitting
> in the renderer". **And the better question, which one sibling asks and nobody else does, is
> not "how do I show less of the secret" but "what does this credential reach" — preview the
> blast radius instead.** *Warrant: no other codebase has a discover-then-import flow, so the
> masked-preview mechanic is a local invention; the show-once, never-re-servable, presence-flag
> discipline underneath it is unanimous.*
>
> **P6 — security wearing ergonomics; converging as a defect, 2 of 2.** *Disclose the set, not
> the count.* "N environment variables", "the permissions this app needs", "connect the CLI" are
> all consent to a set the user cannot see. A count is not disclosure, a category is not
> disclosure, and a risk badge derived from a hand-maintained list of names is a disclosure that
> will be wrong the first time the list is not updated. *Warrant: two codebases request a
> capability set on the user's behalf and name none of it before the grant; the one that gets it
> right renders the scope vocabulary from a single shared source and keeps the autopsy of the
> day its UI copy drifted from that source beside it.*
>
> **P7 — physics, and a house-confirmed clause rather than a fleet-confirmed one.** *A
> verification you did not perform is not a verification — and a field that asserts one must be
> read by something.* Two failures share this shape and the second is worse: a caller stamping
> "verified" it never checked, and a callee silently discarding the caller's request to check.
> The second looks exactly like the first having been prevented. *Warrant: no sibling has a
> health-verdict field at all, so this is confirmed only against this repo's own two instances —
> and against a neighbouring path that measured the same substitution in the OAuth refresher.*
>
> **P8 — security, 1 of 3.** *Everything a model names is input, and the check belongs where the
> name is used, not where it was produced.* When a model drives a third party's live page, its
> context is a document you do not control, and the dangerous part of its output is never the
> prose — it is the identifiers: a URL that will receive a credential, a field key that will
> become a column, a schema that will decide what is masked, a capability that will be granted.
> *Warrant: one sibling validates such a target with a shared private/CGNAT/ULA/metadata-host
> guard and declares DNS rebinding out of scope in writing; one whitelists the only such value
> it has; one does neither.*
>
> **P9 — ergonomics, and the only clause here with no external evidence in either direction.**
> *An automated door needs a way back out.* Grant needs revoke; import needs "where did this come
> from"; provisioning needs a list of what was provisioned. Without them the only operation a
> user can perform on the machine's decisions is to repeat them. *Warrant: SILENT. Two siblings
> ship a revoke; none ships an inventory of what was provisioned, because none provisions.
> Adopt as reasoning, not as validated practice.*
>
> **Scale condition.** P1 and P2 bite at the *second* door — the first one is always fine
> because the checks were written for it. P3 bites the first time a provisioned credential needs
> renewing. P4 bites on day one and compounds daily. P5 and P6 bite on the first discovery flow.
> P7 bites the first time somebody reads the badge. P8 bites the first model-authored
> definition. P9 bites the first regret.

### Warrant evidence — the five siblings, censused 2026-08-16

`personas-web` (Next.js · 1,275 source files), `brainiac` (Rust workspace + Next.js console ·
1,393), `personas-cloud` (TS orchestrator + Python facade · 64), `vibeman` (Next.js **+ Tauri** ·
2,573), `ascent` (Next.js + GitHub App · 1,651). **All five checkouts exist and were opened;
nothing below is reported by omission.**

**Only three of the five have an automated provisioning path at all**, and the two that do not
were checked rather than assumed: `personas-web` takes a bearer from
`process.env.NEXT_PUBLIC_TEAM_API_KEY` (`src/lib/api.ts:89`) and otherwise rides a Supabase
session — no credential store, no mint, no import; `vibeman` reads provider keys straight out of
`.env.local` (`src/lib/config/envConfig.ts:124-145`) and its schema has **no credential table at
all** (`src/app/db/schema.tables.ts` holds only LLM token *counters*). **So every denominator
below that reads "of 5" is really "of 3 that could have had it", and that is stated per row.**

| clause | personas-web | brainiac | personas-cloud | vibeman | ascent | verdict |
|---|---|---|---|---|---|---|
| has an automated provisioning path | ✘ | **✔ ×3** | **✔** | ✘ | **✔** | **3 of 5** |
| **P2** one write door shared by manual + automated | n/a | **✔** 3 routes → 1 store fn | **✔** | n/a | **✔** (only one path) | **3 of 3 — see (a)** |
| **P3** provenance recorded on the credential | n/a | ✘ name-only convention | ✘ unpopulated `metadata TEXT` | n/a | ✘ `createdBy`, no origin | **0 of 3 — see (b)** |
| a ledger row on credential/key creation, rendered | n/a | **✘✘ has the ledger, does not write it** | ✘ | n/a | **✔ best-in-fleet** | **1 of 3 — see (c)** |
| **P4** self-issued grant has an expiry | n/a | ✘ `api_tokens` has no `expires_at` | ✔ | n/a | ✘ `OrgApiToken` has only `revokedAt` | **0 of 3 long-lived — see (d)** |
| …and a scope narrower than admin | n/a | **✔** `["read","write"]`, reasoned | ✔ | n/a | **✔** never-empty-scope | **3 of 3** |
| **P5** the secret is withheld from the client on preview | n/a | **✔✔ previews blast radius, not the secret** | ✔ `'[REDACTED]'` + `hasWebhookSecret: boolean` | n/a | ✔ | **3 of 3 — see (e)** |
| **P8** a target that will receive a credential is validated | n/a | partial (git remote, whitelisted) | **✘** | n/a | **✔** shared private/CGNAT/ULA guard | **1 of 3** |
| **P6** the permissions being requested are named *before* the grant | n/a | **✔** one shared scope vocabulary | **✘ inverted** — scopes shown only after | n/a | partial | **1 of 3 — see (f)** |

**Six results this document rests on.**

**(a) P2 is convergent, 3 of 3, and Personas is the only repo in the fleet with more than one
write door.** That inverts the expectation this path started from. `brainiac`'s human route
(`POST /v1/tokens` → `create_token`, `crates/brainiac-server/src/http.rs:1486`) and **both** its
automated routes (`provision.rs:144`, `onboard.rs:348`) converge on the same storage function,
`brainiac_store::tokens::create` (`crates/brainiac-store/src/tokens.rs:96-124`) — and
`provision.rs:16-18` writes down *why the route* could not be shared (the human route mints
strictly for the console's own org, never a just-created one) while the *store function* is.
**Three authorization front doors, one write door, each divergence justified in prose.** That is
§2's prescription, independently reinvented, in a different language, with the reasoning
recorded. `ascent` reaches it trivially (`createOrgApiToken`, `src/lib/db/org-api-tokens.ts:60`,
has exactly one caller) and `personas-cloud`'s Python facade proxies to the same TS route rather
than reaching the DB (`facade/routers/credentials.py:7-9`). **P2 is physics.**

**(b) P3 is a unanimous absence across everything that could have it — 0 of 3, and 0 of 4 with
Personas.** Nobody records how a credential arrived. `brainiac` comes closest **by convention
only**: a provisioned key is *named* `"device key"` (`provision.rs:147`) or
`"onboard · {label} · {repo}"` (`onboard.rs:354`) and carries `created_by`
(`migrations/0003_api_tokens.sql:17`) — free text in a display column, not a queryable origin,
and nothing stops a hand-minted key being named identically. `ascent`'s `OrgApiToken` has
`createdBy` and no origin column (`prisma/schema.prisma:670-686`). `personas-cloud` has a
free-form `metadata TEXT` on `persona_credentials` (`packages/orchestrator/src/db.ts:275-289`)
that **no write path populates with provenance** — the same column Personas has, equally empty.
**P3 must therefore be reported as strongly-reasoned and externally untested**, and the
strongest thing that can be said for it is that four codebases independently built the *place*
to put provenance and none of them put any there.

**(c) The §9 condition was independently reinvented, in Rust, in the strongest repo in the
fleet — and that is the best warrant in this document.** `brainiac` has a genuinely good audit
ledger: `/v1/audit` (`crates/brainiac-server/src/console.rs:47,1601-1673`) rendered by
`console/app/console/modules/audit/AuditLedger.tsx`. **Minting a device key emits
`tracing::info!` and nothing else** (`provision.rs:167-173`, `onboard.rs:364-370`) — a log line,
not a row, not rendered anywhere, because the ledger's kinds are governance-only
(`promotion_review | contradiction_resolution | feedback_resolution`). That is **byte-for-byte
the defect at `cli_capture.rs:1052`**: a rendered append-only ledger exists, the provisioning
path writes a tracing event instead, and the author plainly believed that was the audit trail.
Two repos, two languages, no shared document, same substitution. **A `tracing` target is not a
ledger is physics, and §9 gates the right thing.** `ascent` is the control that makes it bite:
`recordOrgAudit("org_api_token.created", …)` (`src/app/api/org/tokens/route.ts:37`), with a
per-row HMAC folded into the meta before insert (`src/lib/db/scans-audit.ts:29`), a `false`
return rather than a pretended success on failure (`:40-49`), and a keyset-paginated org viewer
with CSV export. **That is better than Personas' ledger and worth importing.**

**(d) P4 converges as a defect — 0 of 3 long-lived self-minted keys carry an expiry — and
`ascent` supplies the sharpest single detail in the sweep.** `brainiac`'s `api_tokens` has
`created_at`, `last_used_at`, `revoked_at` and **no `expires_at`**
(`migrations/0003_api_tokens.sql:9-21`); the 15-minute TTL at `onboard.rs:54` bounds the
*pairing request*, not the key it produces. `ascent`'s `OrgApiToken` carries only `revokedAt`
(`schema.prisma:679`) — **while its own `Invite` model has `expiresAt` (`schema.prisma:152`,
minted at `src/lib/db/invites.ts:35`). The codebase knows the pattern and applied it to the
human's short-lived thing and not to the machine's long-lived one.** That is P4's warrant stated
better than this document could state it. The one repo that does expire (`personas-cloud`) is
also the one whose token is an OAuth access token with a provider-supplied lifetime, i.e. it did
not choose. **Scope, by contrast, is 3 of 3 correct** — `brainiac` hard-codes
`DEVICE_SCOPES = ["read","write"]` with the reason inline (*"A leaked device key must not be
able to issue more keys"*, `provision.rs:82`), project-scopes the onboard key (`onboard.rs:358`)
and binds it to a normalized-git-remote whitelist so *"the operator confirms, they don't choose,
and a key can never land in the wrong project by mis-click"* (`onboard.rs:14-16`). **Personas'
system key is the fleet's only broad, immortal, unbound self-minted identity.**

**(e) P5's literal clause has no warrant and its discipline has three — and `brainiac` has a
better idea than this repo's.** No sibling has a discover-then-import preview, so "mask the
preview" is n/a everywhere and must be reported as **Personas-only**. But the discipline it
protects is unanimous: `brainiac` serves the secret in exactly one response, never re-servable
(`onboard.rs:18-20`, `http.rs:1455-1467`), behind a dialog labelled *"shown exactly once · this
secret is not stored"* (`console/.../keys/KeyShared.tsx:235-264`); `personas-cloud` masks lists
to `'[REDACTED]'` and replaces `webhookSecret` with a `hasWebhookSecret: boolean`
(`httpApi.ts:678`, `:1422`) — an opaque presence flag, the right shape. **And `brainiac`
previews *blast radius instead of secret*:** `/api/keys/preview`
(`console/app/api/keys/preview/route.ts:13-35`) returns the principal's email, team names and a
count of the memories a key acting as them could see — authorized with `assertOrgMember`
precisely because *"the preview echoes back an email and team names, which is precisely the kind
of roster an unchecked uuid parameter invites a caller to enumerate"* (`:10-12`). **That is a
strictly better answer to "what should a preview show" than a masked value, and this repo should
import it** for the CLI and MCP doors (§7.G): show what the credential *reaches*, not four
characters of what it is.

**(f) P6 converges as a defect with the exact shape of onboarding's, in a repo with no UI at
all.** `personas-cloud`'s Anthropic OAuth flow hardcodes
`SCOPES = 'org:create_api_key user:profile user:inference'`
(`packages/orchestrator/src/oauth.ts:9`) into the authorize URL (`:71`), and
`handleOAuthAuthorize` (`httpApi.ts:1470-1484`) returns that URL plus five instruction strings
**without naming any of the three permissions** — including the right to create API keys in the
user's Anthropic organisation. The scopes appear only *after* the grant
(`httpApi.ts:1512`, `:1522`). **Requesting a capability set on the user's behalf and displaying
none of it is convergent, 2 of 2** (with `useOnboardingState.ts:159-176`). `brainiac` is the
counterexample and it is instructive: the mint form renders the **full scope vocabulary as chips
from one shared source**, carrying a written autopsy of the day the UI's list drifted from
`auth.rs::SCOPES` (`console/.../keys/keys-data.ts:51-60`), and colours `admin` magenta in the key
table (`Keys.tsx:87-88`). One source of truth for the vocabulary, and the drift incident recorded
next to it — which is precisely what §7.E's three copies of the capability-risk vocabulary lack.

**And the spine's `convergence: mixed` label HOLDS**, which is worth recording because the
campaign has inverted five of them. The split is exactly the seam P1 names: the clauses about
*how the write is performed* (one door, narrow scope, withhold on preview) converge at 3 of 3,
and the clauses about *what the system remembers afterwards* (provenance, ledger row, expiry,
disclosure) are unanimous absences or convergent defects. **Codebases agree about plumbing and
disagree about memory.**

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "we can read their token straight out of `~/.aws/credentials` / the `gh` CLI / their `.env`"
- "import their MCP servers from Claude Desktop"
- "let the agent go get the API key from the dashboard"
- "scan the machine and pre-fill what they already have"
- "the app needs a key to call its own API"
- "mint a token for the sidecar / the subprocess / the CLI"
- "just grant whatever the manifest asks for, they clicked Approve"
- "we detected they're already logged into &lt;service&gt; — set it up for them"

**If you are about to write** a `Command::new` whose output you will store, a read of another
program's config file, a `HashMap<String, String>` of field values crossing a process or IPC
boundary, a call to your credential store from anywhere other than its one command, a
`metadata: None` on a credential you did not receive from a form, an `expires_at: None` on a
key you are minting, or a prompt that asks a model to *return* a credential — **you are in this
situation.**

**You are also in it, and this is the case people miss, when you add the second door.** The
first credential-writing path in a codebase is always correct, because the checks were written
inside it. The second one is where they stop being checks and become one caller's habits.

**And you are in it when you grant a permission on the user's behalf.** An access grant the app
issues for itself is a credential with a different shape and the same lifetime problem.

**Not this path:** a human typing a secret is
[credential-capture-form](./credential-capture-form.md); consent-based token acquisition and its
renewal is [oauth-connect-flow](./oauth-connect-flow.md); what a *child process* should be handed
is [credential-injection-into-child](./credential-injection-into-child.md); whether the user is
asked before an irreversible action is [informed-consent-gate](./informed-consent-gate.md);
opening a model-supplied URL is [external-url-opening](./external-url-opening.md); rebuilding a
model-authored object is [untrusted-definition-validation](./untrusted-definition-validation.md);
importing a credential from a portable bundle is
[portable-export-bundle](./portable-export-bundle.md); redaction of what leaks out is
[secret-and-pii-redaction](./secret-and-pii-redaction.md).

---

## 2. The one way

**Give the resource one provisioning function, make every door call it, and make it require the
door to name itself.** Before adding an automated path, list what the manual path does that is
not "read the keystrokes" — in this repo that is the audit row, the OAuth redemption, the
server-side re-probe, the rotation policy and the connect-seed — and **move each one down into
the write path** rather than copying it. The test is P2: a control at the store covers four
doors and a control at a command covers one, and here that is exactly the observed 4-of-4 versus
1-of-4 split. **Stamp provenance in the same write as the value**, as a closed enum with one
meaning per arm, never a free string shared with a filesystem path — because provenance decides
how the credential is later renewed and probed, and a log line cannot be read by a `match`.
**Never let a caller assert a verification**: take `healthcheck_passed` as a *request* to probe
and probe server-side, as `create_credential` already does, and delete the field from any struct
that will not act on it. **On preview, hand the client an opaque id and a masked value and
re-resolve server-side at import** — `scan_credential_sources` + `import_foraged_credential` is
the shape to copy, and it means no discovery flow can leak a secret into a renderer by mistake.
**Show the set, not the count, before you write**: the field keys, the capability list with each
capability's own justification, the source file — a screen that says "12 environment variables"
or renders a risk badge from a hand-kept list of app names is not disclosure. **Mint a
self-issued grant only through the narrow facility**: named holder, clamped TTL, scope of one
resource, audit row — and if you need a broad, immortal key for the app to talk to itself, treat
that as a *design defect to be retired*, not a bootstrap detail, and at minimum audit each mint.
**Treat every identifier a model produces as input**, checked where it is used: a healthcheck URL
gets the SSRF pipeline (`validate_template_url` → `validate_field_values` →
`validate_healthcheck_url` → SSRF-safe client, all four, as `test_credential_design_healthcheck`
already does), a field key gets the name classifier, a capability gets membership in the
manifest. And **give every grant a revoke and every import a "where did this come from"**, or
the user's only available response to the machine's decision is to make it again.

If you must get one thing right first: **put the ledger write inside the provisioning function.**
It is the single control that would have caught every deviation in §7 at review time, and it is
the one this repo has at 3 of 6 sites.

---

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
|---|---|
| `db/src/repos/resources/credentials.rs:242` `insert_credential_and_fields_tx` | **the one write path**, and the reason automation is not a disaster here. Per field it calls `is_field_sensitive` (name backstop → schema flag → fail-secure default) and `classify_field_type`, inside the transaction, for every caller. Copy the *altitude*, not just the code |
| `db/src/repos/resources/credentials.rs:80` `is_field_sensitive` + `db/src/credential_fields.rs:97` `classify_field_type` | the fail-secure classifier a user- or AI-authored schema cannot downgrade. Its module doc records why it was de-triplicated |
| `commands/credentials/foraging.rs:636` `scan_credential_sources` + `:716` `import_foraged_credential` | **the reference provisioning pair, and the best door in the tree.** Masks on read (`mask_value`, `:169`) so *"raw secrets are never accumulated in intermediate collections"*; returns an opaque `foraged_id` + masked preview; **re-reads the real value server-side at import** (`resolve_real_values`, `:725`); writes the credential, its fields and its audit row **in one transaction** (`:746-765`); and logs the *shape* of the scan (`sources_scanned`, `credentials_found`, `read_errors`) and never a value (`:687-700`) |
| `src/features/vault/sub_catalog/components/foraging/ForagingConsent.tsx:19-27` | the pre-scan disclosure: **all eight source classes named, in scan order, before any secret is touched**, with the reason in the component's own doc comment. `AutoCredConsent.tsx` mirrors it, and says so |
| `useCredentialForaging.ts:62-64` | *"Nothing is pre-selected: importing a credential is an explicit, informed choice."* Per-row opt-in with the rationale written down |
| `commands/credentials/crud.rs:69-94` `create_credential` | **the door that refuses its caller's claim.** `healthcheck_passed` is treated as a request; the real probe runs server-side afterwards and only that stamps the ledger. The comment names the bug (2026-06-07 #3) |
| `engine/credential_broker.rs:130` `mint_derived_handle` | the narrow grant: required non-empty consumer name, TTL clamped into `[5, 1440]` minutes, scopes `proxy:credential:<id>` + `cred:<connector>:use`, a descriptive label, an audit row at mint, and a handle that cannot mint further handles |
| `engine/credential_broker.rs:93` `authorize_credential_use` | pure, default-deny scope intersection: exact match, no substring, no case folding, empty list authorizes nothing |
| `commands/credentials/credential_design.rs:203-221` | **the reference treatment of a model-chosen URL that will receive a credential**: `validate_template_url` (pre-resolution, host-position templates rejected) → `validate_field_values` → `validate_healthcheck_url` (post-resolution, private IPs rejected) → `build_ssrf_safe_client` (DNS-rebinding + redirect re-validation) → `e.without_url()` on the error path so the resolved endpoint cannot reach a toast |
| `engine/desktop_security.rs:326-351` `is_fully_approved` / `pending_capabilities` | the capability diff — what is still unapproved for a manifest. **The re-consent primitive, with 0 frontend consumers (§7.E)** |
| `engine/desktop_security.rs:120,:437-583` `is_binary_allowed` + the five manifests | full-path equality after canonicalising symlinks, NTFS junctions, 8.3 names and `PATH` lookups, so a bare `"docker"` entry matches only the binary `PATH` would launch |
| `commands/credentials/auto_cred_browser.rs:362` `scrub_secrets(text, known)` | **subtract-the-held-literals, then pattern-match** — the only redaction in the tree that is not a shape guess. Owned by [secret-and-pii-redaction](./secret-and-pii-redaction.md); named here because the credential-extraction path is where the held literals exist |
| `src/lib/bindings/CredentialFieldMeta.ts` | the read type with `isSensitive` and **no value field** — the reason no provisioning door can accidentally re-display a stored secret |

**Do not exist — this path names them:**

- **Any shared "provision a credential" function.** Four doors, four hand-assembled
  `CreateCredentialInput`s, three provenance stories, two audit stories.
- **Any provenance type.** `metadata.source` is a free `String` written by two doors with two
  unrelated vocabularies (a provisioning-path token and an absolute file path) and read by four
  consumers that understand only one of them.
- **Any expiry on a self-issued grant** outside `mint_derived_handle`, which has produced no rows.
- **Any audit row for the system-key mint** — in either ledger.
- **Any UI for what has been provisioned or granted.** `revoke_desktop_approvals`,
  `get_pending_desktop_capabilities` and `is_desktop_connector_approved` have **0 frontend
  consumers** between them.
- **Any review step on the CLI or MCP doors.** The user sees a binary name and an identity, or a
  count of environment variables.
- **Any consumer of `DesktopConnectorManifest.justifications`** — 14 authored, 0 rendered.
- **Any consumer of the model-authored connector definition** the universal-mode prompts ask for.

---

## 4. Steps

1. **Before writing the automated door, open the manual one and list what it does besides
   reading input.** Here: decrypt the session payload, redeem the OAuth ref, refuse the client's
   health claim and re-probe, write the audit row, auto-provision rotation, seed the OAuth
   expiry. Six things, none of them about typing.
2. **Move every one of them that belongs to the resource down into the write path**, and make
   the write path the only public entry. If a control genuinely belongs to one command (a
   session-key decrypt does), say so explicitly in its comment so the next door knows it is not
   inheriting it.
3. **Make the write path demand a provenance value it cannot default.** Ask the type question
   now (below); the answer for this leaf is one enum and one signature change.
4. **Disclose the set before the write.** Field keys, capability list with per-capability
   justification, source path, and the values *masked* if you have them. Not a count.
5. **Never put the plaintext on the client for a preview.** Return `(id, masked_preview)` and
   resolve `id` server-side at import.
6. **Take verification as a request, never as a claim** — and delete any field that asserts one
   from every struct that will not act on it.
7. **Mint self-issued grants narrowly**: named holder, clamped TTL, one-resource scope, audit row.
   If you find yourself needing an immortal broad key so the process can talk to itself, that is
   a design finding, not a step.
8. **Validate every identifier a model produced at the point of use** — URL through the full SSRF
   pipeline, field key through the name classifier, capability through manifest membership.
9. **Ship the revoke and the "what did this provision" list in the same change as the grant.**
10. **And then stop.** Do not add a fifth credential-writing door, a second provenance
    vocabulary, a client-side copy of the sensitivity classifier, or a "remember what I imported"
    cache.

### Can the type make the wrong call impossible? — asked before §9

**Yes, and it is one enum plus one visibility change.** Held against the seven qualifications:

```rust
// today — commands/credentials/{crud,cli_capture,desktop,foraging}.rs each build this
// and each decides for itself what `metadata` means.
cred_repo::create_with_fields(pool, CreateCredentialInput { metadata, .. }, &fields)

// the fix
pub enum ProvisionSource {
    UserEntered,
    OAuthConsent { provider: &'static str },
    LocalCli { spec: &'static str },
    FilesystemForage { forage_id: String },
    ImportedApp { app: &'static str },
    ModelBrowserSession { session_id: String },
}
pub fn provision_credential(
    pool: &DbPool,
    input: CreateCredentialInput,
    fields: &HashMap<String, String>,
    source: ProvisionSource,          // no Default, no Option
) -> Result<PersonaCredential, AppError>
// …and `create_with_fields` / `insert_credential_and_fields_tx` become pub(crate).
```

- **Q5 (withholding beats requiring) — this is the load-bearing half.** Do not *require* callers
  to remember the audit row and the provenance stamp; **withhold the raw write** so remembering
  is not a thing they can fail at. `provision_credential` becomes the only thing that produces a
  credential row, exactly as `save_tour` is the only thing that produces a validated tour in
  [untrusted-definition-validation](./untrusted-definition-validation.md) §0.
- **Q3 (count the construction sites).** **4 production construction sites** of
  `CreateCredentialInput` (`crud.rs:76`, `cli_capture.rs:1041`, `desktop.rs:150`,
  `foraging.rs:735`) and **4 production call sites** of the two write functions — all enumerable,
  all in one crate. This passes.
- **Q4 (a type anyone can construct authenticates nothing) — the honest limit, stated first.**
  `ProvisionSource` is an enum, not a newtype over `String`, so a caller **cannot omit** a
  source and cannot invent a new one without a compile-time addition. It **can** pick the wrong
  arm. That is a much smaller failure than today's: `metadata: None` is invisible, a wrong arm
  is a line someone wrote on purpose and a reviewer can read.
- **Q6 (withhold the dangerous freedom, not the answer).** Correct: the caller still supplies the
  name, the service type and the fields — everything it legitimately knows. What it loses is the
  freedom to write a credential row *silently*.
- **Q1 (a type carries only what it encodes).** `ProvisionSource` encodes **which door**. It does
  **not** encode whether the user saw what was stored, and pretending otherwise is exactly the
  mistake this qualification exists to prevent. Disclosure (§7.C, §7.E) is a UI property and no
  signature reaches it.
- **Q7 (withholding a requirement is inert when the caller supplies the bad value
  voluntarily).** Applies to `healthcheck_passed`: making it required would change nothing,
  because `cli_capture_save` *volunteers* `Some(true)`. The fix there is **deletion** — remove
  the field from `CreateCredentialInput` and take a probe request as a parameter of the
  provisioning function, which is `create_credential`'s existing local variable
  (`verify_requested`, `crud.rs:75`) promoted one level down.
- **Q2 (requiredness is orthogonal to closedness).** Both edits are needed and they are
  different: `source` must be **required** (no `Option`, no `Default`) *and* **closed** (an enum,
  not a `String`). Today `metadata` is neither, which is why one door writes a filesystem path
  into the same key another door writes `"cli"` into.

**Where the type cannot reach.** Three places, all measured:

1. **The system key's minting.** `get_or_create_system_api_key` writes to
   `external_api_keys`, a different table with a different repository, and it is called from
   process bootstrap rather than from a command. No credential-provisioning signature reaches
   it. Its own type — `create(pool, name, scopes, expires_at: Option<String>, bound_origin:
   Option<String>, label: Option<String>)` — has the same defect one level up: **`None` is the
   dangerous value and it is also the easiest to write.** The parallel fix is
   `enum GrantLifetime { ExpiresAt(DateTime<Utc>), NeverExpires { because: &'static str } }`,
   which makes "forever" a thing you have to justify in the call.
2. **Whether the user saw it.** Disclosure is markup. `CapabilityApprovalCard` renders the set
   and `DesktopDiscoveryStep` does not, and both call the identical, correctly-typed IPC.
3. **What the model wrote.** The universal-mode prompt asks for a `connector_definition` with a
   `healthcheck_url`, and the field travels as `serde_json::Value` end to end
   (`auto_cred_browser.rs:177`, `:1708`) precisely so that nothing has to type it. Only a
   runtime validator reaches that — which is why §2 sends it through the SSRF pipeline that
   `credential_design.rs:203-221` already implements.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A second credential-writing door that calls the store directly** | Every control written inside the first door is silently dropped. **Measured: 4 writers; the audit row reaches 2 of 4, the server-side re-probe 1 of 4, provenance 2 of 4 — while the two controls inside the write path reach 4 of 4.** The door's checks look like the system's checks right up to the moment somebody adds a door. |
| **`metadata: None` on a credential the app obtained by itself** | `import_foraged_credential` (`foraging.rs:740`) knows the exact source file and records nothing. Downstream, `oauth_refresh.rs:471-489` and `healthcheck.rs:88-98` both branch on `metadata.source`, so a foraged credential can never be re-read or locally probed — the door with the most provenance produces the least. |
| **One free-string provenance key with two vocabularies** | `metadata.source` is `"cli"` from one door (`cli_capture.rs:1028`) and **an absolute path to `claude_desktop_config.json`** from another (`desktop.rs:145` ← `desktop_discovery.rs:442`). Four consumers compare it to `"cli"`. A local filesystem path also lands in a column the export bundle round-trips (`data_portability.rs:9863`). |
| **Asserting a verification into a struct nothing reads** | `cli_capture.rs:1048` sets `healthcheck_passed: Some(true)`; `insert_credential_and_fields_tx` never reads it. The fabrication is prevented by accident and the verification never happens — the credential is stored `unverifiable` while its author believed `verified`. |
| **Minting a self-issued grant with `expires_at: None` and the broadest scope** | `management_api.rs:591-602` — `proxy` (every credential), no expiry, no origin, no label, **no audit row in either ledger**, once per app start. **1,029 rows, 7.87/day, 1,022 never used**, against **0** rows from the narrow facility that clamps a TTL. |
| **A public command that returns credential material** | `cli_capture_run` (`cli_capture.rs:818`) is absent from `PRIVILEGED_COMMANDS` and its in-body `require_auth` is `Ok(())` (`ipc_auth.rs:537`). It returns the live CLI token in plaintext. **0 production UI callers**; the safe posture is a property of who happens to call it. |
| **Round-tripping a discovered secret through the renderer** | `import_claude_mcp_servers` returns `env: HashMap<String,String>` and `register_imported_mcp_server` takes the whole `ImportedMcpServer` **back** as an IPC parameter. The sibling door does the opposite: an opaque id out, the real value re-read server-side. |
| **Disclosing a count instead of a set** | `McpServerCard.tsx:16,:25-29` renders *"N environment variables"* — the user consents to storing N unnamed secrets. `CliConnectionPanel.tsx:88-100` shows the binary and the identity, never the field keys. Neither door has a review step. |
| **A risk badge derived from a list of names instead of from the capabilities** | `DesktopDiscoveryStep.tsx:47` — `HIGH_RISK_APPS`, a hand-kept `Set`. Its own comment records that it was not updated when `desktop_terminal` (`ProcessSpawn`+`FileRead`+`FileWrite`+`EnvRead` over six shells) arrived, and rendered SAFE. Owned by [informed-consent-gate](./informed-consent-gate.md) §7.B; listed here because *deriving disclosure from the grant* is the provisioning-side rule. |
| **Authoring a per-item justification and rendering a generic one** | `DesktopConnectorManifest.justifications` carries 14 connector-specific reasons (*"Execute shell commands"*, *"Read notes from your Obsidian vault"*) across IPC. **Frontend consumers: 0.** The card renders `CAPABILITY_INFO[cap].descriptionKey` instead — the generic *"Launch desktop applications"*. |
| **Asking a model to author a definition nobody consumes** | Both universal-mode prompts (`auto_cred_browser.rs:634-641`, `:710-717`) request a `connector_definition` including a `healthcheck_url`. Rust passes it through by `.cloned()` (`:1707-1708`); `TauriPlaywrightAdapter.ts:164-173` **reconstructs it correctly**; `useAutoCredSession.ts:147,:261` stores and exports it; **nothing reads it.** A correct validator with no consumer is a validator that will be bypassed the day someone wires the feature up. |
| **A grant with no revoke and no inventory** | `approve_desktop_capabilities` has 2 UI call sites. `revoke_desktop_approvals`, `get_pending_desktop_capabilities` and `is_desktop_connector_approved` have **0 between them**, so a granted capability cannot be seen, diffed or withdrawn from the product. |

---

## 6. Evidence

### The one site to copy — `foraging.rs:636-775` plus `ForagingConsent.tsx`

The credential-foraging pair is the best provisioning design in this repo and every property is
deliberate:

- **Consent names the set first.** `ForagingConsent.tsx:19-27` lists all eight source classes, in
  scan order, before anything is read, and the component's doc comment states the rule:
  *"it names every source class the scan reads BEFORE any secret is touched, so reading real
  credentials from disk is never a surprise."*
- **Masking happens at the point of read, not at the point of render.** `mask_value` (`:169-177`)
  is applied inside `scan_env_vars` / `scan_aws_credentials` / … with the reason written down:
  *"Values are masked immediately on read — raw secrets are never accumulated in intermediate
  collections, preventing plaintext exposure in memory dumps."*
- **The client never holds the value.** The scan returns `(foraged_id, masked fields, source,
  confidence)`; `import_foraged_credential` takes the **id** and calls `resolve_real_values`
  server-side (`:725`). The renderer cannot leak what it was never given, and cannot substitute
  a value either.
- **Nothing is pre-selected** (`useCredentialForaging.ts:62-64`), and the reason is a comment.
- **The credential, its fields and the audit row are one transaction** (`:746-765`) — so an
  imported credential with no audit trail is not representable.
- **The scan itself is audited by shape** (`:687-700`): `sources_scanned=8; credentials_found=N;
  read_errors=M`, never a value.

**Copy the whole shape, including the comments.** What it is missing is one line — `metadata`
(§7.B) — and that omission is what makes it a deviation rather than the exemplar it otherwise is.

Second site to copy, for the model-authored-target half: **`credential_design.rs:203-221`**, the
four-stage SSRF treatment of an endpoint a language model chose, with `.without_url()` on the
error path.

Supporting exemplars, each for one property:

| site | the property to copy |
|---|---|
| `db/src/repos/resources/credentials.rs:268-291` | **the control at the store.** Sensitivity and field-type are decided inside the INSERT loop, so every writer that will ever exist inherits them |
| `crud.rs:69-94` | a door that treats its caller's `healthcheck_passed` as a *request*, runs the real probe server-side, and lets only that stamp the ledger — with the bug it prevents named in the comment |
| `credential_broker.rs:40-46,:130-183` | the narrow grant: a TTL constant that argues for itself, a floor so a mistyped `0` is not a dead handle, a required consumer name, and an audit row at mint |
| `desktop_security.rs:98-140` | binary allow-listing by **canonicalised full path**, so a bare `"docker"` entry matches only what `PATH` would launch |
| `desktop_bridges.rs:36` | `check_permission` before dispatch — the grant is actually enforced at use |
| `cli_capture.rs:1-14, 42-70` | capture specs as **compile-time constants** — *"never loaded from the catalog or user input"* — with a per-field `sensitive` flag and an allow-listed binary. The trust boundary is a `const`, not a row |
| `cli_capture.rs:728-742` | a `tracing::debug!` that deliberately omits the value on the *non*-sensitive branch, with a written rationale that the static `sensitive` flag has no name-based backstop and therefore should not be trusted alone |
| `src/test/automation/bridge.ts:1707-1732` | a test harness that projects `fieldKeys` and `fieldCount` out of a plaintext response and never the values |

### The provisioning surface, measured (2026-08-16 @ `2a874e692`)

| | value |
|---|---:|
| `.rs` files walked under `src-tauri/src` | **564** |
| credential-writing doors (production) | **4** |
| …reaching the credential audit ledger | **2** |
| …refusing the caller's `healthcheck_passed` | **1** |
| …stamping any provenance | **2** (with 2 different vocabularies) |
| grant-minting doors (production) | **3** (system key, pairing, broker handle) |
| …writing an audit row | **2** (`credential_broker`, `create_external_api_key` → `settings_audit_log`) |
| provisioning writes reaching a ledger / total (census partition) | **3 / 6** |
| `CreateCredentialInput` production construction sites | **4** |
| …whose `healthcheck_passed` is read by anything | **1** |
| `scrub_secrets` call sites (excl. definition) | **12** — 9 production (8 `&[]`, 1 literals), 3 test |
| frontend consumers of `DesktopConnectorManifest.justifications` | **0** (14 authored entries) |
| frontend consumers of `revoke_desktop_approvals` / `get_pending_desktop_capabilities` / `is_desktop_connector_approved` | **0 / 0 / 0** |
| consumers of the model-authored `discovered_connector` / `discovered_fields` | **0 / 0** (both reconstructed in TS first) |
| provisioning commands absent from `PRIVILEGED_COMMANDS` ∪ `CLOUD_COMMANDS` | **`cli_capture_run`** (returns plaintext), `cli_check_installed`, `cli_verify_auth`, `list_cli_specs`, `list_cli_capturable_services`, `detect_authenticated_services`, `check_auto_cred_playwright_available` |
| `desktop.rs` commands / carrying `#[requires]` / in `PRIVILEGED_COMMANDS` | **9 / 0 / 9** |

### The live vault, replayed (read-only copy, 2026-08-16 21:05)

| | value |
|---|---:|
| `persona_credentials` rows | **25** |
| …carrying `metadata.source` | **0** |
| …carrying `metadata.imported_from` | **0** |
| …carrying **any** provenance key | **0** |
| distinct `metadata` keys across all 25 | 21, of which 9 appear on all 25 (`healthcheck_*`, `usage_count`, `last_used_at`, `anomaly_score`) |
| `credential_audit_log` `create` rows | **4** — 4 of 4 for credentials created since the ledger's first row (2026-05-19); the other 21 predate it |
| `credential_audit_log` rows by op | `decrypt` 9,431 · `oauth_token_refreshed` 201 · `healthcheck` 145 · `delete` 10 · `create` 4 |
| `external_api_keys` rows | **1,029** (2026-04-07 → 2026-08-16; 92 distinct days; **7.87/day**, 11.2/day when running) |
| …with `expires_at` | **0** |
| …with `bound_origin` | **0** |
| …with a `label` | **0** |
| …ever used (`last_used_at`) | **7** |
| …enabled | **1** |
| …named anything other than `"system"` | **0** |
| `api_key_audit` rows (the request trail for all 1,029) | **1** |
| `settings_audit_log` `api_keys`/`create` (user-created keys) | **1** |
| `desktop_connector_approvals` rows | **0** |
| `credential_consumer_edges` rows | **0** |
| `playwright_procedures` rows | **0** |
| `__foraging_scan__` / `__autocred_session__` audit rows | **0 / 0** |
| `connector_definitions` rows / `is_builtin = 0` | **134 / 0** |

**The last four rows are the honest limit and they cut both ways.** No human-facing automated
provisioning door has ever run on this installation, so nothing in §7 is a live leak. It also
means **none of it has ever been reviewed against real data** — the first foraging scan, the
first CLI capture and the first model-authored connector will each exercise a path whose only
verification to date is that it compiles.

---

## 7. Deviations

Every entry is live on `master` @ `2a874e692`.

> **Second pass — what is upstream of all of this.** Every entry below reduces to one question
> never asked: **"what did the human's door do that was not about typing?"** Asked once, at the
> right altitude, it produces the two rows in §0.1 that read *4 of 4*. Not asked, it produces
> six doors that each re-decide, independently, whether a credential deserves an audit row, a
> provenance stamp, a probe, an expiry and a review screen — and get a different answer each
> time. **A, B and D are the same edit** (§4's `provision_credential`), and it closes them
> together.

### P0 (A) — three provisioning writes reach neither ledger

| Path | What's wrong |
|---|---|
| `commands/credentials/cli_capture.rs:1052` | `cred_repo::create_with_fields(…)` then `tracing::info!(target: "audit", …)`. **A tracing event with an `audit` target is not a row in `credential_audit_log`** — it reaches a rotating log file, not `list_credential_audit`, not `AuditLogTable.tsx`, not the incidents taxonomy (`incidentTaxonomy.ts:16`). The author believed this was the audit trail. |
| `commands/credentials/desktop.rs:164` | `credentials::create_with_fields(…)` then a plain `tracing::info!`. No ledger row. |
| `engine/management_api.rs:591` | `api_key_repo::create(pool, "system", [read, execute, proxy], None, None, None)` — **1,029 rows and not one audit entry** in `credential_audit_log` or `settings_audit_log`. Its sibling `create_external_api_key` (`external_api_keys.rs:46-56`) writes `settings_audit_log`; its sibling `approve_pairing` (`:192-200`) does too; the self-issued one does not. |

**Measured (census + a second, function-scope implementation, identical membership):** of the six
production provisioning writes, **3 reach a ledger and 3 do not**, and the three that do —
`crud.rs:85`, `foraging.rs:751`, `credential_broker.rs:156` — are the three whose authors thought
about it independently.

**Fix:** §4's `provision_credential` for the two credential writes; for the system key, either an
audit row per mint or (better) stop minting a new one per launch — the process cache
(`SYSTEM_API_KEY`, `:561`) already makes the row unnecessary after the first, and the revoke-then-
mint loop at `:579-602` exists only to clean up after itself.

### P0 (B) — a provisioned credential is indistinguishable from a typed one

`metadata.source` gates two behaviours (`healthcheck.rs:92-98`, `oauth_refresh.rs:471-489`) and
one UI affordance (`ReauthBanner.tsx:107,:139`). Written by 1 of 4 doors in a usable form.

| Path | What's wrong |
|---|---|
| `commands/credentials/foraging.rs:740` | `metadata: None` — on the door that holds `foraged_id`, i.e. the exact provenance, and re-reads from it at import. |
| `commands/credentials/desktop.rs:145` | `"source": server.source` where `server.source` is `config_path.to_string_lossy()` (`desktop_discovery.rs:442`) — **an absolute local filesystem path in the same key four consumers compare to `"cli"`**, and one that the export bundle round-trips (`data_portability.rs:9863`). |
| `src/features/vault/…/autoCred/helpers/useAutoCredSession.ts:206-211` | `createCredential({name, service_type, data, healthcheck_passed})` — no metadata at all for a credential a model extracted from a live third-party page. |

**Live: 0 of 25 credentials carry any provenance key.**

**Fix:** the `ProvisionSource` enum in §4, stamped by `provision_credential`, and a separate
`imported_from_path` key for the MCP door so `source` regains one meaning.

### P0 (C) — `cli_capture_run` is public and returns the plaintext token

`commands/credentials/cli_capture.rs:818` is **not** in `PRIVILEGED_COMMANDS` ∪ `CLOUD_COMMANDS`
(192 + 50 names, parsed), so `wrap_invoke_handler` (`ipc_auth.rs:624`) never checks
`x-ipc-token` for it; its in-body `require_auth(&state).await?` is `Ok(())` (`:537-539`). It
returns `CliCaptureResult.fields: HashMap<String,String>` — *"field_key -> captured value (both
secret and non-secret)"* (`:605`) — i.e. a live `gh` / `gcloud` / `aws` / `stripe` /
`cloudflare` token.

**Production UI callers: 0.** `CliConnectionPanel.tsx:95` uses the gated `cliCaptureSave`, which
returns no value. The only caller is the test-automation bridge (`bridge.ts:1713`), which
projects `fieldKeys` and discards the values on purpose. So the exposure is currently zero and
the *door* is open — the shape `untrusted-definition-validation` §7.A named for `create_connector`:
**the safe behaviour of the live surface is a property of its call sites, not of the door.**

Also public and worth listing for completeness: `cli_check_installed`, `cli_verify_auth`,
`list_cli_specs`, `list_cli_capturable_services`, `detect_authenticated_services`,
`check_auto_cred_playwright_available`. None returns secret material; `detect_authenticated_services`
returns which services the machine is logged into, which is inventory rather than credential.

**Fix:** add `cli_capture_run` to `PRIVILEGED_COMMANDS`; better, change its return type to
`{ service_type, field_keys: Vec<String>, token_ttl_seconds, captured_at, expires_at }` so the
value is not on the wire at all — the test bridge already models exactly that projection.

### P1 (D) — `healthcheck_passed` is asserted into a field the persistence layer discards

`cli_capture.rs:1048` sets `healthcheck_passed: Some(true)`; `create_with_fields` →
`insert_credential_and_fields_tx` (`credentials.rs:242-294`) never reads it and the INSERT does
not carry it. Four production `CreateCredentialInput` construction sites; **one**
(`crud.rs:75`) reads the field, and it reads it as a *request*, not a claim.

Consequence, both directions: the CLI door does not fabricate a verdict (good, by accident) and
does not obtain one either (bad, silently) — the credential lands in the vault with no probe
requested and no probe run.

**Fix:** delete `healthcheck_passed` from `CreateCredentialInput` and make the probe request a
parameter of `provision_credential`, promoting `crud.rs:75`'s local `verify_requested` one level
down so every door inherits the 2026-06-07 fix.

### P1 (E) — the capability grant discloses less than the app already knows

Two doors, one grant. `CapabilityApprovalCard.tsx:39-72` renders every capability with a label,
a description, a risk dot and badge, plus the allow-listed binaries — and
`useOnboardingState.ts:159-176` grants `manifest.capabilities` wholesale and renders a risk badge
derived from `HIGH_RISK_APPS`, a hand-kept `Set` (`DesktopDiscoveryStep.tsx:47`). That half is
[informed-consent-gate](./informed-consent-gate.md) §7.B and is not re-derived here.

**What is new: the disclosure surface the corpus calls "the best in the frontend" is rendering
the wrong text.** `DesktopConnectorManifest.justifications` (`desktop_security.rs:95`) carries
**14 hand-authored, connector-specific reasons** — `desktop_terminal` → `process_spawn` =
*"Execute shell commands"*, `desktop_obsidian` → `file_read` = *"Read notes from your Obsidian
vault"* — and is exported to TypeScript (`src/lib/bindings/DesktopConnectorManifest.ts:43`).
**Frontend consumers: 0.** The card renders the generic `CAPABILITY_INFO[cap].descriptionKey`
instead, so `process_spawn` reads *"Launch desktop applications"* on the connector that
allow-lists `bash`, `sh`, `zsh`, `powershell.exe`, `pwsh.exe` and `cmd.exe`.

Beside it: `DesktopCapability::risk_level()` and `::description()` (`desktop_security.rs:42-63`)
have **0 production Rust callers** (`:611` uses `description()` inside an error string), and
their TypeScript twin `CAPABILITY_INFO` re-declares the same 8 risk levels — **which agree
exactly, 8 of 8**, and that is worth saying: a duplicated vocabulary that has not yet drifted is
still a duplicated vocabulary, and the third copy (`HIGH_RISK_APPS`) is the one that was wrong.

And the grant has no way out: `revoke_desktop_approvals`, `get_pending_desktop_capabilities` and
`is_desktop_connector_approved` are registered commands with **0 frontend consumers between
them**, so `pending_capabilities` — the re-consent diff for a manifest that grows a capability —
has never been asked.

**Fix:** render `manifest.justifications[cap]` with `CAPABILITY_INFO[cap]` as the fallback; use
`CapabilityApprovalCard` in onboarding; wire `get_pending_desktop_capabilities` so a manifest
that gains a capability re-prompts; ship the revoke.

### P1 (F) — the model authors a connector definition that nothing consumes

Both universal-mode prompts (`auto_cred_browser.rs:617-654`, `:693-727`) ask the model for
`connector_definition: {name, label, category, color, healthcheck_url}` and `discovered_fields`.
`extract_browser_result` (`:1701-1709`) takes them by `.cloned()` — pure pass-through, no
reconstruction. `TauriPlaywrightAdapter.ts:152-173` then **does** reconstruct them, correctly:
named keys only, `String(…)` coercion, `.filter((f) => f.key && f.label)`. `useAutoCredSession.ts`
stores both in state (`:74-75`), sets them (`:146-147`) and returns them (`:260-261`).

**Consumers: zero.** `AutoCredReview.tsx:93` renders `buildConnectorContext(designResult).fields`
— the *designed* connector, from a different model call — not `discoveredFields`.

Two things follow. The model is being asked, on every universal-mode run, to produce a
`healthcheck_url` — **an endpoint the app would later send the credential to** — and the field is
dropped, so the SSRF question is currently moot and will stop being moot the moment anyone wires
the feature up. And the reconstruction that would make it safe already exists in TypeScript, one
layer from where it is needed, doing nothing — the `record_oauth_refresh()` / `HealthProbeState` /
`CredentialFieldMeta.isSensitive` shape the corpus keeps finding: **a correct answer, complete,
beside a path that does not call it.**

**Fix:** either wire it — routing `healthcheck_url` through `validate_template_url` →
`validate_healthcheck_url` → `build_ssrf_safe_client` as `credential_design.rs:203-221` does —
or delete the two prompt sections and the three plumbing layers. Shipping a validator with no
consumer is how the next author concludes the validation is handled.

### P2 (G) — two doors show a count where the set is what matters

| Path | What the user sees before the write |
|---|---|
| `McpServerCard.tsx:16,:25-29` | the server label, the command line, and **"N environment variables"**. Not their names, not masked values. Consent to storing N unnamed secrets. |
| `CliConnectionPanel.tsx:88-100,:113-136` | the binary, the docs link, and the identity from `cli_verify_auth`. **No field keys, no values, no review step** — `handleSave` calls `cliCaptureSave`, which runs the spec and persists in one server-side call. |

Contrast `ForagingResultCard.tsx:129-138`, which renders `key: maskedValue` for every field, plus
the source and a confidence badge, on the same kind of data.

**Fix:** return `field_keys` from `cli_capture_run`-shaped previews and render them; render the
env-var **names** (never values) on the MCP card; give both doors the foraging pair's
scan-then-confirm shape.

### P2 (H) — the MCP import round-trips the secret through the renderer, and flattens it

`import_claude_mcp_servers` returns `env: HashMap<String,String>` to the webview, and
`register_imported_mcp_server(server: ImportedMcpServer, …)` takes the **whole object back** as
an IPC parameter (`desktop.rs:123-127`). The value therefore crosses the boundary twice and lives
in renderer memory in between — the exact class `import_foraged_credential` was built to avoid.

Then `desktop.rs:136-140` serialises the whole map into **one** field, `env_vars`. The
fail-secure classifier saves it (`classify_field_type("env_vars")` = `"text"`, not in
`NON_SENSITIVE_KEYS`, so `is_field_sensitive` rule 3 encrypts it) — but per-field sensitivity,
per-field rotation and per-field display all collapse into a single opaque blob, and the stored
`field_type` says `"text"` for a value that is a map of tokens.

**Fix:** return `env_keys` from the discovery command, take `(server_name, chosen_keys)` at
import, and re-read the config server-side — i.e. the foraging shape. Store one credential field
per environment variable.

### P3 (I) — small, live, and worth a line each

- **`McpServerCard.tsx:44` and `CapabilityApprovalCard.tsx:100`** use
  `feedback/LoadingSpinner` as the busy state of a button the user just pressed. It renders
  `null` (`.claude/CLAUDE.md`, "the spinner boundary"), so **Import** and **Approve** go blank
  while working. `AsyncButton` is the primitive.
- **`register_imported_mcp_server` builds `service_type = format!("mcp_{}", server.name)`**
  (`desktop.rs:142`) from a config key the app did not author, with no charset or length check,
  and `service_type` is the join key every connector lookup uses.
- **`import_claude_mcp_servers` returns after the first existing config path**
  (`desktop_discovery.rs:413-454`), so a machine with both a per-user and a per-machine Claude
  config silently sees only one.
- **`scan_credential_sources` (`foraging.rs:636`)** is `require_privileged_sync` and correct;
  its result is capped by nothing — no limit on discovered rows — so a repository tree full of
  `.env` files produces an unbounded IPC payload.

---

## 8. Gaps

1. **The census cannot see a *missing* review screen, and that is the biggest deviation here.**
   §7.G is an absence in markup — "this door has no confirm step" — and an absence requires
   knowing what the door *should* show. The countable half is the ledger write (§9); the
   disclosure half needs a human or a per-door checklist.

2. **No instrument spans a control's altitude.** §0.1's table — which controls are at the store
   and which are at a door — is the document's core finding and it is a *relationship* between a
   command body and a repository function. No lint rule, type check or count expresses "this
   check should have been one level down". The measurement that found it is the one this
   document ran: enumerate the writers, enumerate the controls, cross them.

3. **`ProvisionSource` cannot encode consent.** §4 is explicit about this (Q1). A door can name
   itself honestly and still have shown the user nothing. Provenance and disclosure are
   different axes and only one of them is typeable.

4. **The system key cannot be narrowed without a design decision this path cannot make.** It
   authenticates the desktop's own in-process fetches *and* the MCP sidecar bridge, and the
   `proxy` scope exists because the connector bridge was gated off `personas:execute`
   (`management_api.rs:587-590`). Splitting it into a per-consumer set of narrow handles is the
   right answer and is a larger change than any deviation above.
   [credential-injection-into-child](./credential-injection-into-child.md) §4 owns that design.

5. **Nothing verifies that a provisioned credential is the one that was on disk.**
   `verify_field_roundtrip` (`credentials.rs:1383`) checks the encryption round-trip; nothing
   checks that the value stored equals the value the CLI printed, so a truncated `gcloud`
   token is indistinguishable from a good one until first use. Same capture-side twin
   [credential-capture-form](./credential-capture-form.md) §8.6 names for typed values.

6. **Provenance cannot survive an export.** `data_portability.rs:9863-9915` re-implements the
   credential insert inline (correctly calling `is_field_sensitive` and `classify_field_type`)
   and writes `entry.metadata` verbatim from the bundle — so an imported credential inherits
   whatever provenance the bundle claims, including one it fabricated. That is
   [portable-export-bundle](./portable-export-bundle.md)'s territory, and it is the reason
   `ProvisionSource` must have an `Imported` arm rather than trusting the blob.

---

## 9. The missing gate

### The condition, stack-free

> **A credential or access grant is written to durable storage by a path that records nothing in
> the append-only ledger the product renders — so "how did this get here" has no answer, and the
> checks that door skipped are invisible.**

There is no runtime signal. An unledgered credential works exactly like a ledgered one: it
resolves, it decrypts, it authenticates, it appears in the vault list. The only observer who
could notice is a user asking a question the product cannot answer. It is the same
silent-success family as [column-encryption-at-rest](./column-encryption-at-rest.md)'s
delimiterless prefix and [retention-and-pruning](./retention-and-pruning.md)'s status allowlist.

**The proxy, for this stack:** a call to one of the three functions that create credential
material or mint an access grant, with **no ledger write within 900 characters**. The direction
is the discriminator and it is not arbitrary — the compliant half is the *same* three anchors
with a ledger write nearby, so the two populations are exhaustive and mutually exclusive by
construction, and together they are the whole surface.

**What the next repo must re-derive.** This signal keys on three Rust function names and on
proximity in characters. A repo with an ORM hook, a database trigger, an outbox table, a
decorator, or a middleware that audits centrally has **the same condition wearing something this
pattern cannot see** — and if it audits at the store rather than at the door, the condition may
not exist there at all, which is the outcome §2 is asking for. Re-derive the proxy against the
local write path; keep the condition and keep the "which side of the write is the check on"
question.

### Existing rules checked first

I read all **130** rules in `scripts/census/rules.json` before authoring, and checked these seven
by name:

- **`unfalsifiable-tier-guard`** (`ipc-session-token-race.md`, 34 files / 105 matches,
  `roots: ["src-tauri/src"]`, `.rs`) — **the nearest neighbour by root and language.** It keys on
  a `#[requires(auth)]` / `#[requires(privileged)]` *attribute* whose expanded guard cannot
  return `Err`. Mine keys on a *call expression* and its lexical neighbourhood. Checked directly:
  of my 3 matches, **`cli_capture_save` carries `#[requires(privileged)]` and would be one of its
  105, and `cli_capture.rs:1052` is inside that function** — so the *files* touch, and the
  *matches* do not: its match is the attribute line (`:1015`), mine is the write call (`:1052`).
  Different lines, different condition (is the annotation enforceable vs is the write recorded),
  no shared match.
- **`persistence-handle-in-command-tree`** (`command-naming-placement.md`, `roots:
  ["src-tauri/src/commands"]`) — the closest by *shape*: a persistence handle reached from the
  command tree. It keys on `…db.get()`, a connection checkout. None of my three sites calls
  `.get()`; they call a repository function. **No shared match**, and the conditions differ:
  that rule is about layering, this one is about a missing side effect.
- **`blind-identity-write`** (`repository-crud-surface.md`, `roots: ["src-tauri/db/src/repos"]`)
  — disjoint root by construction; it governs the repository's own signatures.
- **`unverified-effect-dispatch`** (`post-write-side-effects.md`, `roots: ["src-tauri"]`) — the
  closest by *subject* (a side effect after a write). It keys on `let _ = …emit(…)`, a discarded
  result. Mine keys on an audit call that is **absent**, not one whose result is dropped.
  Checked: no shared match.
- **`ledger-field-addressed-by-string-key`** (`oauth-connect-flow.md`, 6/16, `roots:
  ["src-tauri"]`) — about the *credential ledger blob*'s field names as string literals, a
  different ledger (`metadata`, not `credential_audit_log`) and a different failure. No overlap.
- **`settings-key-holding-secret`** (`app-settings-store.md`, `roots: ["src-tauri/db/src"]`) and
  **`secret-as-bare-string-field`** (`secret-display-and-transfer.md`, `roots: ["src-tauri"]`) —
  both key on declarations (a `const`, a struct field). Neither can match a call expression.
  Reviewed because my sites are credential-shaped; no overlap.

**No existing rule asks whether a write was recorded.** The corpus gates declarations, call
sites, statements, types, attributes, class strings, regex bodies and — since
`credential-capture-form` — an expression's branch direction. **This gates the *neighbourhood* of
a write: what else the code does within the same few hundred characters**, which is the shape a
missing side effect has. That is the territory gap this rule fills, and it is why the condition
survived: all three sites are type-correct, clippy-clean, and one of them even *looks* audited
(`tracing::info!(target: "audit", …)`).

### Where it runs

`npm run census:check`, which is a step of **`npm run check`** — the script the PR self-review
ritual in `.claude/CLAUDE.md` requires green before a branch leaves the box — **and** the
`golden-path-census` **pre-push** lefthook job (`lefthook.yml:74-75`, added 2026-08-16 for
exactly this reason: *"it was enforced NOWHERE"*). **Deliberately not CI-only:** per the brief's
calibration, `ci.yml` is red on 10 pre-existing failures, so a gate that only runs there runs
nowhere.

**How it fails loudly if its own precondition is absent** — inherited from the runner, not
re-derived: the run **fails** when the walk sees fewer than `floor: 500` files (measured
**564** `.rs` files under `src-tauri/src`), when the rule matches zero files anywhere, when
either `exclude` entry goes stale, when the count rises, **and when it drops without the
baseline moving**. Surviving counts print on success.

### The signal, and its precision

**3 matches in 3 files, all three hand-opened. Precision 3/3.**

| site | the write | why it is violating | legal fix |
|---|---|---|---|
| `commands/credentials/cli_capture.rs:1052` | `cred_repo::create_with_fields` | the only nearby "audit" is `tracing::info!(target: "audit", …)` at `:1054-1059` — a log line, not a row in the table `AuditLogTable.tsx` / `CredentialIntelligence.tsx` / `incidentTaxonomy.ts` render | route through `provision_credential` |
| `commands/credentials/desktop.rs:164` | `credentials::create_with_fields` | plain `tracing::info!` at `:166-171`; no ledger row for a credential built from another app's config | route through `provision_credential` |
| `engine/management_api.rs:591` | `api_key_repo::create(… None, None, None)` | 1,029 rows, no entry in `credential_audit_log` **or** `settings_audit_log`, while both sibling mint paths write one | `settings_audit_log::insert("api_keys", …, "mint")`, or stop minting per launch |

**The first is the one worth defending, because it could look like a false positive.** It is not:
`target: "audit"` is a `tracing` *target*, which routes to the log subscriber. The ledger this
rule is about is the SQLite table with an IPC command (`credential_audit_log`), four render sites
and an incident-promotion hook. A gate that accepted a log line would accept the exact mistake
this site made.

### The positive control — it partitions the anchor

The anchor is "code that creates credential material or mints an access grant". The violating
half writes nothing to a ledger within 900 characters; the compliant half writes
`audit_log::insert` / `insert_warn`, `settings_audit_log::insert` (which the same substring
matches) or a raw `INSERT INTO credential_audit_log`. **They are disjoint by construction** — one
call site cannot both have and not have a ledger write in its window — and together they are the
entire anchor: 3 + 3 = 6, the full anchor count after the two test exclusions.

```
  rule                                                  files  base  matches  base  walked  floor
  OK  unledgered-credential-provisioning                    3     3        3     3     564    500
  OK  unledgered-credential-provisioning-positive-control    3     —        3     —     564    500
```

**A 1:1 partition, and the ratio is the finding**: this codebase is split exactly down the
middle on whether a provisioning write is recorded. The decisive pair sits in one directory —
`commands/credentials/foraging.rs:751` contributes **1 control match and 0 rule matches** (its
`INSERT INTO credential_audit_log` is inside the same transaction as the credential insert),
while its sibling `commands/credentials/cli_capture.rs:1052` contributes **1 rule match and 0
control matches**. Two local-machine credential-import doors, same folder, opposite postures — so
the rule discriminates on **whether the write was recorded**, not on "files about credentials".
A vocabulary-keyed rule would report both.

```json
{
  "id": "unledgered-credential-provisioning",
  "goldenPath": "docs/concepts/golden-paths/automated-credential-provisioning.md",
  "title": "A credential or access grant is written to durable storage by a path that records nothing in the append-only ledger the product renders.",
  "roots": ["src-tauri/src"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:create_with_fields|insert_credential_and_fields_tx|api_key_repo::create)\\s*\\((?![\\s\\S]{0,900}?(?:audit_log::insert|INSERT INTO credential_audit_log))",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A call to one of the three functions that create credential material (create_with_fields, insert_credential_and_fields_tx) or mint an access grant (api_key_repo::create), with NO ledger write in the following 900 characters. PROXY FOR the stack-free condition: a credential or grant is written to durable storage by a path that records nothing in the append-only ledger the product renders, so 'how did this get here' has no answer and the checks that door skipped are invisible. THE LOOKAHEAD IS THE DISCRIMINATOR AND IT IS EXHAUSTIVE: the positive control below is the identical anchor with a POSITIVE lookahead, so every anchor occurrence lands in exactly one of the two rules and 3 + 3 = 6 is the whole surface. The compliance vocabulary is deliberately three-fold and substring-based: `audit_log::insert` matches audit_log::insert, audit_log::insert_warn AND settings_audit_log::insert (the Settings-History ledger, which is the correct one for an API key), and `INSERT INTO credential_audit_log` catches the hand-rolled in-transaction form at foraging.rs:758. LEGAL DESTINATION: personas_db::repos::resources::audit_log::insert / insert_warn (db/src/repos/resources/audit_log.rs:23) — 'the single chokepoint for ALL credential audit writes', which counts its own failures into vault_status so a decrypt can never happen with a silently-missing trail; its rows are read by the credential_audit_log IPC command and rendered by AuditLogTable.tsx, CredentialIntelligence.tsx and ExecutionsTab.tsx, and promoted into the Incidents inbox via incidentTaxonomy.ts:16. MEASURED 2026-08-16 at 2a874e692: 3 files / 3 matches, ALL THREE HAND-OPENED, precision 3/3, against 3 files / 3 matches for the compliant half — a 1:1 partition of the same anchor. Counts reproduced by a SECOND, STRUCTURALLY INDEPENDENT implementation — a brace-matching walker that resolves each anchor's ENCLOSING FUNCTION BODY and asks whether that body contains a ledger write, rather than counting characters — which agreed on MEMBERSHIP, not merely on the total, and independently classified both excluded files as test code (one by brace-matched #[cfg(test)], one by filename). WHY IT IS A DEFECT AND NOT STYLE: of the four production doors that write a credential into this vault, the audit row reaches 2, the server-side health re-probe reaches 1, the OAuth session redemption reaches 1 and a provenance stamp reaches 2 — while the two controls that live INSIDE insert_credential_and_fields_tx (is_field_sensitive, classify_field_type) reach 4 of 4. Coverage is a property of a control's ALTITUDE, not its importance. Live consequence, measured on a read-only copy of the operator's database: 0 of 25 credentials carry any provenance key, and external_api_keys holds 1,029 self-minted rows (7.87/day over 131 days) with expires_at NULL on 1,029, bound_origin NULL on 1,029, 1,022 never used, 1 enabled, and ZERO audit entries in either ledger — while the narrow minting facility that clamps a TTL into [5,1440] minutes and writes an audit row (engine/credential_broker.rs:130) has 2 call sites and 0 rows in 4 months. FIRST MATCH DEFENDED: cli_capture.rs:1052 is followed at :1054 by tracing::info!(target: \"audit\", ...). That is a TRACING TARGET, not a row — it reaches a rotating log file, not the SQLite table the vault renders. A gate that accepted a log line would accept the exact mistake this site made. LEGAL FIX: introduce provision_credential(pool, input, fields, source: ProvisionSource) that writes the row, stamps provenance and runs the server-side probe, make create_with_fields/insert_credential_and_fields_tx pub(crate), and route all four doors through it; for management_api.rs:591, write settings_audit_log on each mint or stop minting one per app launch. DO NOT silence a match by adding a tracing line, by widening this window, or by hoisting the write into a helper whose caller audits — the honest fix always puts the ledger write INSIDE the function that performs the write. KNOWN BLIND SPOTS, both equal on the two halves so the partition stays unbiased: (a) an alias — external_api_keys.rs uses `repo::create`, so the user-initiated key mint is invisible to BOTH rules (it is compliant; it writes settings_audit_log at :46); (b) an unrelated audit write for a different resource inside the 900-character window would read as compliance. EXTERNAL WARRANT — THE CONDITION WAS INDEPENDENTLY REINVENTED: the sibling checkout ../brainiac ships a rendered append-only audit ledger (crates/brainiac-server/src/console.rs:47,1601-1673 -> console/app/console/modules/audit/AuditLedger.tsx) and mints its two automated device-key paths with `tracing::info!` and nothing else (provision.rs:167-173, onboard.rs:364-370) — byte-for-byte the substitution at cli_capture.rs:1052, in a different language, with no shared document. A third sibling (../ascent) does it correctly and better than this repo: recordOrgAudit('org_api_token.created', ...) at src/app/api/org/tokens/route.ts:37, with a per-row HMAC folded into the meta before insert (src/lib/db/scans-audit.ts:29) and a keyset-paginated viewer with CSV export. PRECONDITION (must be re-derived per repo): this signal keys on three Rust function names and on character proximity. A repo that audits in an ORM hook, a database trigger, an outbox, a decorator or a middleware has the same condition wearing something this pattern cannot see — and a repo that audits at the STORE rather than at the door may not have the condition at all, which is the outcome section 2 asks for. END OF LIFE: this rule is designed to reach zero. When it does, the runner fails structurally on zero matches BY DESIGN — DELETE the rule then, do not baseline it at 0.",
    "$measured": "2026-08-16 @ 2a874e692 — 564 .rs files walked under src-tauri/src; commentMatchesSkipped 0; validated standalone in a scratch registry with a filename unique to this composer, membership reproduced by a brace-matching enclosing-function implementation, then re-extracted from this finished document by a fenced-block parser and re-run through the real runner: identical (3/3, 3/3, 564, floor 500, exit 0). Wall time 0.6-1.1 s for both rules together including node startup. The full registry was NOT run."
  },
  "exclude": [
    {
      "path": "src-tauri/src/mcp_server/auth_tests.rs",
      "reason": "test module by filename convention, carrying no #[cfg(test)] attribute the engine could brace-match; both matches seed API keys into an in-memory fixture pool"
    },
    {
      "path": "src-tauri/src/engine/runner/credentials.rs",
      "reason": "its only match is seed_credential(), a fixture helper inside #[cfg(test)] mod tests; the file's production half writes no credential"
    }
  ],
  "baseline": { "files": 3, "matches": 3 },
  "floor": 500
}
```

```json
{
  "id": "unledgered-credential-provisioning-positive-control",
  "goldenPath": "docs/concepts/golden-paths/automated-credential-provisioning.md",
  "title": "POSITIVE CONTROL — not a gate. The same three provisioning writes that DO reach the ledger: the compliant half of the identical anchor, which the rule must never report.",
  "roots": ["src-tauri/src"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:create_with_fields|insert_credential_and_fields_tx|api_key_repo::create)\\s*\\((?=[\\s\\S]{0,900}?(?:audit_log::insert|INSERT INTO credential_audit_log))",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE — carries no baseline by design. Same roots, same extensions, same 564-file walk, same two test exclusions, same three anchors, pointed at the COMPLIANT half by inverting the lookahead: a provisioning write WITH a ledger write in the following 900 characters. EXHAUSTIVE AND DISJOINT BY CONSTRUCTION: one call site cannot both have and not have a ledger write in its window, so the rule's 3 plus this control's 3 is the entire anchor population (6). MEASURED 2026-08-16 at 2a874e692: 3 files / 3 matches; commentMatchesSkipped 0. THE THREE COMPLIANT SITES ARE THE THREE WHOSE AUTHORS THOUGHT ABOUT IT INDEPENDENTLY: commands/credentials/crud.rs:85 (audit_log::insert_warn two lines later — the human-typed door), commands/credentials/foraging.rs:751 (a hand-rolled INSERT INTO credential_audit_log inside the SAME transaction as the credential insert, which is stronger than the best-effort form), and engine/credential_broker.rs:156 (audit_log::insert_warn with operation 'broker_handle_minted'). THE DECISIVE PAIR SITS IN ONE FOLDER: foraging.rs contributes 1 control match and 0 rule matches while its sibling cli_capture.rs contributes 1 rule match and 0 control matches — two local-machine credential-import doors, same directory, opposite postures — so the rule discriminates on whether the write was RECORDED, not on 'files about credentials'. Run both together whenever the rule's pattern is edited: if this control's count collapses, the walk or the anchors broke rather than the codebase being fixed. It is expected to RISE as the 3 violations are converted, which is exactly why it must never be baselined.",
    "$measured": "2026-08-16 @ 2a874e692 — 3 files / 3 matches via the real runner; commentMatchesSkipped 0."
  },
  "exclude": [
    {
      "path": "src-tauri/src/mcp_server/auth_tests.rs",
      "reason": "same test-file exemption as the rule, so both halves walk the identical population"
    },
    {
      "path": "src-tauri/src/engine/runner/credentials.rs",
      "reason": "same test-fixture exemption as the rule, so both halves walk the identical population"
    }
  ],
  "floor": 500
}
```

### Verification of this gate's own preconditions

- **Backtracking checked, not assumed.** The pattern is one alternation of three literals, a
  `\s*\(`, and a single negative lookahead containing one **capped** lazy quantifier
  (`[\s\S]{0,900}?`) over an alternation of two literals. No nested quantifier, no alternation
  inside a quantifier, no lookbehind. Real-runner wall time over 564 files: **0.6–1.1 s for both
  rules together**, node startup included.
- **`floor: 500` against 564 walked.** `src-tauri/src` is a narrower root than the `src-tauri`
  used by most Rust rules (floor 900) — chosen deliberately, because the two credential-write
  functions are *defined* in `src-tauri/db/src` and including that root would put the definition
  and its four test call sites into the population. A typo'd root walks 0 files and trips both
  `floor` and the zero-match structural failure.
- **`commentMatchesSkipped: 0` on both.** The flag is currently inert and is kept because the
  legal fix involves writing prose about these call sites.
- **Two independent implementations, agreeing on membership.** The runner's Node `RegExp` with a
  character window, and a brace-matching walker that resolves each anchor's **enclosing function
  body** and asks whether *that* contains a ledger write, return the **same three violating sites
  at the same three lines** and the **same three compliant sites**. The second implementation is
  structural, not a second regex, so a shared blind spot in character-window sizing cannot
  produce false agreement — and it independently reached the same verdict on the two excluded
  files, one by brace-matching `#[cfg(test)]` and one by filename, which is what makes those
  exclusions evidence rather than convenience.
- **One measurement error caught and worth recording.** The second implementation's first draft
  located the test module by taking the **first** `#[cfg(test)]` in a file. In
  `auto_cred_browser.rs` that attribute sits on a **method at line 266**, inside a production
  `impl` block — so a whole file was classified as test code and a nine-way production/test split
  came back as 0/12. The fix was to require `#[cfg(test)]` immediately followed by
  `mod tests`. Same family as the doctrine's `head -3` case: **the instrument answered a
  different question than the one asked, and the answer looked plausible.**
- **Re-extraction check performed.** Both JSON blocks above were pasted back out of this finished
  document into a scratch registry with a filename unique to this composer and re-run through the
  real runner — `node scripts/census/run-census.mjs --rules <scratch> --check`, not a
  re-implementation. Identical: **3 / 3 / 564 / floor 500** and **3 / 3**, no baseline on the
  control, no structural problems, exit **0**.
- **Two `exclude` entries, both defended above.** Both files exist, so neither can go stale
  silently; the blind spot they create is named in the rule description.
- Do **not** run `npm run census -- --update` against a registry containing the positive control;
  `updateBaselines` dereferences `baseline.files` unconditionally.
- **The full registry was NOT run**, per the doctrine. The orchestrator runs it on merge.
- **This rule can and should reach zero**, and the path is short: two of the three are one
  `provision_credential` refactor, the third is one `settings_audit_log::insert`. When it reaches
  zero the runner fails structurally on a zero-match rule **by design** — **delete it then, do not
  baseline it at 0.**

### Gates I rejected, with numbers

Refusing to gate is first-class, so here are the four candidates measured and declined:

| candidate | violating | compliant | why rejected |
|---|---:|---:|---|
| **a `CreateCredentialInput` literal with `metadata: None`** | 1 | 3 | The condition (§7.B) is real and it is the document's second-biggest finding, but the countable form is a **single site** and the honest fix is a type change (`ProvisionSource`) that makes the literal unspellable. Ratcheting one site would have frozen the wrong shape. Carried as §4's type answer instead. |
| **a self-issued grant with `expires_at: None`** | 2 | 2 | `api_key_repo::create(…)` with a bare `None` in the fourth argument. Precision is fine but the population is 4 total, two of the four are the *user's* choice ("never expires" is a legitimate option in `create_external_api_key`), and separating "the app chose forever" from "the user chose forever" needs the argument's provenance, not its text. **A gate that fires on a user's deliberate setting is worse than no gate.** |
| **`create_with_fields` called anywhere outside the CRUD door** | 3 | 1 | 83% overlap with the rule above by construction — same three files — while being *weaker*: it says "you called the store directly", which is sometimes correct, instead of "you did not record it", which never is. Declined for overlap. |
| **a `#[tauri::command]` returning a `HashMap<String,String>` of credential values** | 1 | — | §7.C's condition, and one match (`cli_capture_run`). A single-site rule is a to-do item, and identifying "of credential values" needs the field's semantics, not its type: a vocabulary attempt over command return types returned 9 hits of which 8 were unrelated string maps (env dumps, tag maps, header maps). **1/9 precision.** Declined twice over. |

The general limit worth stating: **the census can ratchet the presence or absence of a call in a
write's neighbourhood, and can say nothing about whether the write should have happened at all.**
The largest finding in this document — that 4 of the 9 controls in §0.1 are at a door and
therefore cover one writer — is a relationship between a command body and a repository function,
and it was found by **enumerating the writers and crossing them with the controls**, not by
matching anything. §8 Gap 2 specifies the instrument that would own it, and it is a per-door
checklist, not a rule.

---

## 12. Corrections to the brief

**The headline correction, and it is about the brief's method rather than any single claim: all
five primed leads were already the published findings of neighbouring paths.** Each was verified
against source rather than taken on trust, and each is confirmed; none of them is this
document's contribution.

**1. "`auto_cred_browser.rs:648` — the masking policy is a prompt line, and the model's object
carries no `sensitive` key; 45 of 196 catalog fields are `sensitive: true` + `type: "text"`."
CORRECT, and published in full** — [credential-capture-form](./credential-capture-form.md) §0.1,
§0.2, §5, §7.A and §7.D, with the 45/196 replay and the two-classifications table. Verified in
place at `:648` and `:726`. Not re-derived.

**2. "`auto_cred_browser.rs:939-956` — a model emits `OPEN_URL:<url>`, prefix-checked only,
`auto_open: true`, over a session whose context is a live third-party dashboard." CORRECT, and
published in full** — [external-url-opening](./external-url-opening.md) §"Where the two halves
meet" and §7.B, including the frontend half at `TauriPlaywrightAdapter.ts:91` and the measurement
that 374 of 2,188 stored executions carry URL tokens across 16 hosts including `169.254.169.254`.
Verified in place. Not re-derived.

**3. "`auto_cred_browser.rs:362` and `db_query.rs:151` replace the literal secrets the process
holds before pattern-matching — the best redaction technique in the tree, used at 1 of its own 10
call sites." HALF WRONG, and both halves matter.**
- **`db_query.rs` does not exist.** The nearest file is `commands/credentials/query_debug.rs`,
  and what it does is *different in kind*: `SENSITIVE_COLUMNS` (`:42-70`, 29 entries) →
  `[REDACTED]` by **column name**. That is a vocabulary-based redactor — the family the doctrine
  warns about, whose recall is bounded by its author's word list — not the literal-substitution
  technique. **`scrub_secrets` (`auto_cred_browser.rs:362`) is the only implementation of
  subtract-the-held-literals in the entire tree**, which strengthens the lead rather than
  weakening it.
- **The denominator is wrong in both the brief and the published path.** Counted by
  brace-matching every call and classifying its second argument: **12 call sites** (excluding the
  definition) — **9 production** (8 pass `&[]`, 1 passes literals at `:1230`) and **3 in
  `#[cfg(test)] mod tests`** (1 `&[]`, 2 literals). So the honest figures are **"9 of 12 pass
  `&[]`"** or **"1 of 9 production sites passes literals"**.
  [secret-and-pii-redaction](./secret-and-pii-redaction.md) states "9 of 10" at `:180`, `:396`
  and `:846` — **the numerator 9 is exactly right and the denominator is short by 2.** Worth
  correcting there, because the ratio is one of that path's headline numbers.

**4. "Onboarding grants every capability in the fetched manifest, displaying none." CORRECT, and
published in full** — [informed-consent-gate](./informed-consent-gate.md) §7.B, with the
`HIGH_RISK_APPS` badge, the `desktop_terminal` capability table and the missing revoke. Verified
at `useOnboardingState.ts:159-176`. **One correction upward to that path:** it calls
`CapabilityApprovalCard` *"the best disclosure surface in the frontend"* and names
`description()`/`risk_level()` as the Rust mirror — but `DesktopConnectorManifest` carries a
**third** field, `justifications`, with **14 hand-authored connector-specific reasons** that
cross IPC in the ts-rs binding and have **zero frontend consumers** (§7.E). The best disclosure
surface is rendering the generic text while the specific text sits unread in its own props.

**5. "1,027 self-minted keys, all with `expires_at` NULL and `bound_origin` NULL, 1,020 never
used; the narrow door with a clamped TTL has 2 call sites and 0 rows in 4 months." CORRECT, and
published in full** — [credential-injection-into-child](./credential-injection-into-child.md) §0,
§3, §5, §7. **Re-measured at 1,029 / 1,022 / 0 / 0 / 0** on a copy taken 2026-08-16 21:05, i.e.
**+2 rows since that path's measurement earlier the same day**, both never-used, both already
revoked. What this path adds is the **rate** — 7.87 rows/day over 131 days, 11.2/day on the 92
days the app ran — and the two comparisons that make it legible: the user has hand-created
**1** key in four months, and `api_key_audit` holds **1** request row for all 1,029 identities.

**6. The spine's `sides: client` label does not hold.** Of the seven provisioning doors, **six
are Rust** and the seventh (the auto-cred browser flow) has its only frontend responsibility in a
review screen. Every deviation in §7 except G is in `src-tauri`. The census rule is Rust-only.
**The label should read `twoSided` at best and `server` honestly** — this is the fifth spine
label the campaign has inverted under measurement, and the failure mode is the familiar one: the
leaf was labelled from the surface a user sees, and the subject is what happens when there is no
surface.

**7. The spine's `convergence: mixed` label HOLDS, and it is worth recording that one did.**
Five `CONVERGED` labels have failed under measurement in this campaign; this one is accurate,
and accurate along a seam worth naming: the clauses about *how the write is performed* converge
at **3 of 3** (one shared write door, narrow scope, withhold the secret from the client) while
every clause about *what the system remembers afterwards* is a unanimous absence or a convergent
defect (provenance **0 of 3**, ledger row **1 of 3**, expiry on a self-issued grant **0 of 3**,
naming the permissions before granting them **1 of 3**). **Codebases agree about plumbing and
disagree about memory.**

**And the single most useful thing the oracle returned: §9's condition was independently
reinvented.** `brainiac` has a rendered append-only audit ledger and mints its automated device
keys with `tracing::info!` and nothing else (`provision.rs:167-173`, `onboard.rs:364-370`) —
byte-for-byte the substitution at `cli_capture.rs:1052`, in a different language, in the repo
this corpus otherwise treats as the exemplar. Two codebases, no shared document, the same
mistake: **a log line where a ledger row belongs.** That is the strongest warrant available for
gating it.

**8. And the question the brief asked that produced the document.** *"Whether a provisioned
credential is distinguishable from a typed one afterwards"* is the right question and the answer
is **no — 0 of 25 live credentials carry any provenance key** — but the *reason* is not that
somebody forgot to write one. It is that provenance, the audit row, the re-probe, the OAuth
redemption and the rotation policy are all inside `create_credential`, and the automated doors do
not call `create_credential`; they call the store. **The distinguishing question turned out to be
a symptom of an altitude question**, and I only saw that because I enumerated the writers before
enumerating the fields.

**One correction to my own first draft.** I expected the headline to be the AI browser-capture
flow — the model reading a live third-party dashboard is the loudest thing in this leaf — and
spent the first third of the sweep there. It is almost entirely already published, and the part
that is not (§7.F) turns out to be **dead code with a correct validator in it**. The live,
unpublished, and much duller finding was three `create_with_fields` calls and a metadata field
nobody sets. **The dangerous door in an automated-provisioning leaf is not the one with the model
behind it; it is the one somebody added quickly because the interesting one already existed.**
