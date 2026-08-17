# Golden path — Least-privilege scope grant

> **Topic path:** `integrations-security` › `credential-capture` › `least-privilege-scope-grant`
> [situation spine](../situation-spine.md) · recurrence 6 · risk **HIGH** · sides: **client**
> (spine label — **see §12.1, it inverts**) · convergence: **mixed**
> (**see §12.2 — the half that holds is a unanimous absence, and Personas is *ahead* on the other half**) ·
> dimensions: **security · function · code-quality · ui**
> Composed 2026-08-17 against `master` @ `2a874e692`.
>
> **Subject — the denominator nobody stores.** How much authority a credential or capability is
> *asked for*, versus how much is *used*. OAuth scopes, connector permission sets, IPC command
> tiers, agent capability grants. Not *whether* a grant is enforced (that is
> [ipc-command-authorization](./ipc-command-authorization.md) and
> [ownership-verification](./ownership-verification.md)); not *who issued it*
> (that is [automated-credential-provisioning](./automated-credential-provisioning.md)); not *how it
> ends* (that is [credential-rotation-and-revocation](./credential-rotation-and-revocation.md)).
> **This leaf owns the ratio.**
>
> **Sweep.** Read end to end: `src-tauri/src/ipc_auth.rs` (1,214 lines, both allowlists and the
> drift test), `src-tauri/macros/src/lib.rs`, `src-tauri/src/engine/credential_broker.rs`,
> `engine/management_api.rs:261-420`, `commands/credentials/oauth.rs:388-800`,
> `commands/fleet/{commands,pty,external,headless}.rs`, `engine/prompt/cli_args.rs`,
> `db/src/repos/core/settings.rs`, `db/src/settings_keys.rs:1154-1250`,
> `commands/execution/executions.rs:414-440`, plus the client half:
> `vault/sub_credentials/components/workspace/{workspaceProviders.ts,useWorkspaceConnect.ts}`.
> Walks: **1,585** registered IPC commands, **1,658** `#[tauri::command]` functions, **963** `.rs`
> files, **4,829** `.ts`/`.tsx`.
>
> **Measured by executing, not reading.** Every number was computed against a read-only **copy** of
> the operator's live 347 MB `personas.db`, copied 2026-08-17 01:31 UTC with the app running. The
> live file was never opened for write; **the copies were deleted afterwards.** Corpus: 78 personas,
> 2,188 executions, 25 credentials, 42 credential fields, 210 tool-grant edges, 5,720 tool-usage
> rows, 9,803 credential-audit rows, 1,029 self-minted API keys, 15 settings-audit rows.
>
> Five things were executed rather than argued:
> 1. **The full IPC tier cross-tab** — registration × annotation × allowlist membership, in two
>    independent implementations (§0.1).
> 2. **The discriminator race** — module membership vs four behavioural markers, over the same
>    1,585 commands (§0.2).
> 3. **The persona tool grant replayed against its own usage ledger** (§0.3).
> 4. **The live OAuth scope grants read out of `credential_fields`** and compared against the
>    endpoints the tree can actually call (§0.4).
> 5. **A working prototype of the §9 instrument**, run against the tree and against four induced
>    faults, exit codes captured directly (§9).
>
> **`cargo` was NOT run.** Every Rust claim is static or replayed in Node/Python/SQL.
> **Nothing was re-scoped, revoked, or re-authorised. No provider API was called and no consent
> screen was opened.** Scope strings appear below; **no token, prefix, partial or length does.**
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. Lineage reduced the cohort to **3** (§6).
>
> **Settles:** how wide to ask, and how you would ever find out.

---

## 0. The headline

**This app can tell you what authority it holds. It cannot tell you what authority it uses — not
for one credential, one command, one persona or one API key — and every mechanism that would close
the gap has been built and left unwired. The one type in the tree that names *which grant
authorized this use* is correct, is tested, and has recorded zero events, while the path that
actually resolves secrets has recorded 9,431.**

The four grant surfaces, each measured as *asked* over *used*:

| grant surface | asked | used | ratio |
|---|---:|---:|---:|
| **IPC command tier** — commands the wrapper actually gates | 229 of 1,585 | *nothing measures what a command exercises* | — |
| **Persona tool grants** (`persona_tools`) | **210** edges | **9** ever exercised | **4.3 %** |
| **Management-API key scopes** | 1,029 keys, 2 distinct scope sets | 1 recorded request (`api_key_audit`) | **0.1 %** |
| **Broker grants** (`BrokerGrant`, the one type that records the answer) | 3 arms, exhaustive | **0** rows | **0 %** |
| **OAuth scopes** (`credential_fields.scopes`) | 9 scope strings on 2 credentials | **0 production readers** | **0** |

### 0.1 — 85.6 % of the IPC surface is Public, and the two ways to say "privileged" disagree three ways

The tier system has **two independent expressions** and they are not the same thing:

- the **declaration** — `#[requires(privileged)]` / `#[requires(cloud)]`, a proc macro
  (`macros/src/lib.rs:58`) that prepends a guard call to the function body;
- the **enforcement** — membership of `PRIVILEGED_COMMANDS` (`ipc_auth.rs:117`) or
  `CLOUD_COMMANDS` (`:763`), the only thing `wrap_invoke_handler` (`:602-624`) consults before
  validating `x-ipc-token`.

`ipc_auth.rs` states the consequence in its own list, at `:118-122`: *"each already carried
`#[requires(privileged)]` but was absent from this list, **which for an async command is ZERO
enforcement**."* It is right — `require_privileged` (async, `:539-553`) only checks that the session
token was *initialised*, then returns `Ok(())`; and `require_auth_sync` / `require_auth`
(`:476-478`, `:531-533`) are literally `Ok(())`, so all **19** `#[requires(auth)]` annotations
enforce nothing by construction.

Cross-tabbed over the whole surface, twice, independently:

| | n | share |
|---|---:|---|
| commands registered in `generate_handler!` | **1,585** | |
| ↳ **wrapper-enforced** (on either allowlist) | **229** | **14.4 %** |
| ↳ **Public — no gate at all** | **1,356** | **85.6 %** |
| `#[tauri::command]` functions in the tree | 1,658 | (73 unregistered) |
| `#[requires(...)]` annotations | **243** | 168 privileged · 56 cloud · **19 auth (no-ops)** |
| `PRIVILEGED_COMMANDS` / `CLOUD_COMMANDS` entries | **184 / 50** | |
| **declared but NOT enforced** — annotated, registered, on neither list | **23** | **23 of 23 are `async` → zero enforcement** |
| **enforced but NOT declared** — listed, registered, no attribute | **33** | |
| **enforced but naming nothing** — listed, *not registered* | **5** | `github_create_patch_release`, `openapi_parse_from_url`, `openapi_parse_from_content`, `openapi_generate_connector`, `create_execution` |
| registered, ungated, and carrying no tier statement of any kind | **1,314** | 82.9 % |

**And the repo's own drift test is exactly satisfied and therefore cannot move.**
`ipc_auth.rs:1149-1211` walks the annotations and asserts that every annotated command appears on a
list *or* in a hand-maintained `DRIFT_BASELINE`. That baseline holds **23** entries. The measured
drift set holds **23**. Set-equal in both directions, verified: `baseline − drift = ∅`,
`drift − baseline = ∅`. **The gate passes with zero headroom, every deferral is async, and every
async deferral is zero enforcement.** Fifteen of the 23 carry the comment *"read-only; the
annotation is arguably the wrong tier"* — so the baseline is simultaneously the repo's list of
under-enforced commands and its list of over-declared ones, undifferentiated.

**Where it runs: nowhere.** The test lives in `cargo test`, which `npm run check` does not invoke
(`package.json:52`) and which appears in **neither** lefthook hook (`lefthook.yml` pre-commit:
eslint, gitleaks, i18n ×2; pre-push: tsc, census, i18n, evals, `.ai` doctor ×2). Per this brief's
own calibration `ci.yml` is red on 10 pre-existing failures. **The only instrument in the repo that
relates a declared tier to an enforced one executes at no gate a developer will see.**

### 0.2 — What earns a privileged tier is which folder the file is in

The rival hypothesis was raced before the discriminator was published. Same 1,585 commands, four
behavioural markers, brace-matched command bodies, `#[cfg(test)]` stripped as brace-matched ranges,
`d0` = the command's own body, `d1` = plus every same-file helper it calls:

| predictor | commands matching | of those, gated | commands not matching | of those, gated | **separation** |
|---|---:|---:|---:|---:|---:|
| **lives under `commands/credentials/`** | 158 | 119 (**75.3 %**) | 1,427 | 110 (7.7 %) | **9.77×** |
| reaches a decrypt/secret call (d0) | 9 | 6 (66.7 %) | 1,576 | 223 (14.1 %) | 4.71× |
| performs outbound HTTP (d0) | 7 | 3 (42.9 %) | 1,578 | 226 (14.3 %) | 2.99× |
| writes/deletes on the filesystem (d0) | 32 | 10 (31.3 %) | 1,553 | 219 (14.1 %) | 2.22× |
| **spawns a subprocess (d0)** | 28 | 4 (14.3 %) | 1,557 | 225 (14.5 %) | **0.99×** |

**Spawning a child process has no predictive power at all — 0.99× is the base rate.** Module
membership beats the best behavioural marker by 2.1× and beats subprocess-spawn by 9.9×. Half of
every gated command in the app (119 of 229) lives in one directory that is 10 % of the surface.

> **The honest limit, stated rather than hidden.** The spawn marker's *recall* is poor: it is a
> textual probe at depth ≤ 1, and `fleet_spawn_session` — which spawns `claude
> --dangerously-skip-permissions` — does not match it, because the spawn is two files away
> (`commands.rs:42` → `pty::spawn_session` → `pty.rs:324`). A low-recall marker measuring 0.99×
> is weak evidence on its own. **The Fleet module supplies the same result by hand and exhaustively**
> (§0.5), and the module result at 9.77× is the strong one.

### 0.3 — 210 capability grants, 9 ever exercised, and the capability actually used has no grant

`persona_tools` is the per-persona capability grant table; `persona_tool_usage` is what ran. They
are the only asked/used pair in the product, and they are joinable. Replayed against the live
corpus in pure SQL (a second implementation of a Python set computation; both agree exactly):

| | value |
|---|---:|
| grant edges (persona × tool) | **210** across 73 personas |
| grant edges **ever exercised** | **9** — **4.3 %** |
| grant edges never exercised | **201** |
| distinct (persona, tool) pairs actually used | 471 |
| ↳ **used with no grant edge** | **462** — **98.1 %** |
| distinct tool names used | 35 |
| ↳ **not present in `persona_tool_definitions` at all** | **32** |
| total recorded invocations | 37,921 |
| ↳ `Bash` — arbitrary shell | **29,303 (77.3 %)** |

The three most-granted capabilities and what they were used for:

| granted tool | personas holding it | invocations, all time |
|---|---:|---:|
| `file_read` | 71 | **4** |
| `http_request` | **61** | **0** |
| `file_write` | 49 | **6** |

**The two vocabularies are disjoint by construction, and the reason is upstream of both.**
`executions.rs:420` reads the persona's granted tools, then `:421-425` *appends* virtual tools, and
the result is rendered into the prompt. It never reaches the spawn. `build_cli_args_inner`
(`engine/src/prompt/cli_args.rs:91-112`) takes `persona: Option<&Persona>` and unconditionally
pushes `--dangerously-skip-permissions` at `:107`. **`--allowedTools` appears at exactly two sites
in the entire tree** (`commands/credentials/auto_cred_browser.rs:807`, `:820`) and neither is an
execution lane. So the persona is granted three tools, told about three tools, and handed
everything the CLI has.

> A capability list rendered into a prompt is documentation. The model's real capability set is
> whatever the runtime allows, and here the runtime was told to allow all of it.

### 0.4 — The record of what was granted is never read, and can silently record what was *asked* instead

Both of the operator's Google grants store their scope list in `credential_fields`, `field_key =
'scopes'`, **`is_sensitive = 0`, `iv` empty — plaintext, queryable**:

| credential | scopes recorded at grant time | endpoints the tree can call |
|---|---|---|
| `gmail` (usage_count 316) | `gmail.modify`, `gmail.send`, `gmail.readonly`, `userinfo.email`, `openid` | **5 named** — `GET messages`, `GET messages/{id}` (`mcp_server/tools.rs:1504`, `:1533`), `GET threads` (`connector_use.rs:620`), `POST threads/{id}/modify` (`:673`), `POST messages/send` (`:722`) |
| `google_calendar` (usage_count 133) | `calendar.events`, `calendar.readonly`, `userinfo.email`, `openid` | **1 named** — `GET calendars/{id}/events` (`mcp_server/tools.rs:1584-1613`). **No named site writes a calendar event, and `calendar.events` is a write scope.** |

> **And "named endpoint" is the wrong denominator, which is itself the finding.** `api_proxy.rs:548-551`
> maps each connector to a base URL and `execute_api_request` takes the path and method from the
> caller, so anything the token can reach under `https://www.googleapis.com/calendar/v3` is
> reachable — the same shape [sql-console](./sql-console.md) P7 states for a query surface
> (*"tool surfaces are usually bounded by their verb list; a query surface is bounded by the
> schema"*). **Behind a generic proxy the granted scope IS the capability surface, and the enumerated
> endpoints are decoration.** That is exactly why the scope must be narrowed rather than the endpoint
> list audited — and why P1's usage record is the only way to know what to narrow to.

**Production readers of the `scopes` field: zero.** Grepped for every access shape across 963 `.rs`
and 4,829 `.ts`/`.tsx` files; the only hits are two assertions inside `oauth.rs`'s own
`#[cfg(test)]` module (`:2171`, `:2216`) and an unrelated `params.get("scopes")` in a knowledge job
(`approval_exec_knowledge.rs:277`). Nothing decides anything from it. The app cannot answer "does
this credential have the scope this call needs", cannot show the user what they consented to, and
cannot narrow.

**And on the workspace path the field records the request, not the grant.**
`useWorkspaceConnect.ts:86-87`:

```ts
scopes: svc.scopes.join(' '),                       // :86 — always the CLIENT's ASK
[OAUTH_FIELD.SCOPE]: scope ?? svc.scopes.join(' '), // :87 — the provider's grant, or the ask again
```

`scope` is what Google returned. When it is null the fallback is the client's own literal list. **A
grant record that falls back to the request is not a grant record** — and because nothing reads it,
nobody would ever see the difference.

### 0.5 — Destroying a session is guarded; driving one is not

`commands/fleet/` registers **38** commands. **One** is on an allowlist:
`fleet_remove_session`, whose entry (`ipc_auth.rs:534-537`) reads *"`Registry::remove` drops ANY
session row, including one holding a live PTY child."* **It is the one Fleet command that deletes a
persisted row.** Every other Fleet command is Public, including:

| Public Fleet command | what it confers |
|---|---|
| `fleet_spawn_session` (`commands.rs:28`) | spawns `claude --dangerously-skip-permissions` (`pty.rs:324` Windows, `:364` otherwise) in a caller-supplied `cwd`, **with caller-supplied `args: Option<Vec<String>>` appended verbatim on both branches** (`pty.rs:336-338`, `:370-372`) |
| `fleet_spawn_headless_session` (`:59`) · `fleet_spawn_external_console` (`external.rs:120`) | the same escalation, two more lanes (`headless.rs:132`, `external.rs:169`) |
| **`fleet_write_input` (`:90`)** | **writes arbitrary bytes to that child's stdin** |
| `fleet_kill_pid` (`process_scan.rs:128`) | kills an arbitrary PID |
| `fleet_read_transcript` (`transcript_read.rs:356`) | reads the session transcript |
| `fleet_pair_device` (`pairing.rs:252`) · `fleet_companion_revoke` (`:333`) | grants and removes device trust |

**The tier tracks what the command does to a database row, not what authority it confers.** That is
§0.2's 9.77× stated as one module, by hand, exhaustively — and it is the leaf.

### 0.6 — Everything that would measure usage exists, is correct, and has zero rows

| mechanism | what it would answer | live rows |
|---|---|---:|
| `BrokerGrant` (`credential_broker.rs:50-69`) — `Broad` / `PerCredential` / `PerConnector`, *"recorded in the audit detail so 'who could do what, and why' is reconstructible from the ledger"* | **which grant authorized this use** | **0** |
| `credential_consumer_edges` — UPSERTed by the proxy on every call | which consumer used which credential | **0** |
| `external_api_keys` named `handle:%` — narrow derived handles, TTL clamped to `[5, 1440]` min | a grant scoped to one credential | **0** |
| `desktop_connector_approvals` | which desktop capability was approved | **0** |
| `api_key_audit` | requests made with a management key | **1** |
| **`credential_audit_log` `decrypt`** | *that* a secret was resolved — **never under which grant** | **9,431** |

**9,431 credential resolutions, 0 of them naming the authority that permitted it.** The type is
written, exhaustive, unit-tested (`credential_broker.rs:204-271`), and has never been reached,
because every one of those 9,431 went through the non-broker path — the one that does not ask.

Meanwhile the one authority-widening event the app *does* record, it records well:
`companion_autonomous_mode` — which per
[sql-console](./sql-console.md) §0 dissolves the human approval in front of every
`use_connector` write — is **`"true"` on this install** and its flips are in `settings_audit_log`
(`false→true` 2026-08-05, `true→false` 2026-07-26). That ledger is written at the **repository**
layer (`db/src/repos/core/settings.rs:25-61`), so internal Rust callers are audited too, no-op
writes are skipped, and secret-valued keys are structurally redacted. It is the best widening record
in the fleet (§6 clause 6, **1 of 5**) — and it covers exactly one of the app's five grant surfaces,
because the other four are not settings.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path,
primitive name or count. Each clause names its warrant so an adopting repo can tell physics from
local calibration.

> **P1 — physics, unanimous, and the whole subject. *A grant is a claim about the future; only use
> is evidence. Record which grant authorized each use, in the same write that performs it.*** Every
> other clause here is downstream. Without a per-use record of the authorizing grant, a scope a key
> has never touched is indistinguishable from one it exercises hourly, so nothing can be narrowed,
> nothing can be justified, and no review has an input. The record costs one column.
> *Warrant: **0 of 5** codebases records which scope was exercised. What exists everywhere is
> whole-credential granularity — a `last_used_at` bump — which answers "was this key used" and never
> "for what". One sibling bumps it **before** the scope check runs, so a request rejected for lacking
> a scope still advances the token's freshness. Measured here as 9,431 secret resolutions and 0
> naming the grant, with the type that would name it already written and correct.*
>
> **P2 — physics, 0 of 5, and it is P1's bill. *Without a usage record every grant ratchets one
> way.*** Attenuation — reissuing narrower — requires knowing what is safe to remove. Nobody knows,
> so nobody narrows, so grants only ever widen; and widening is cheap because it is the only move
> that is ever obviously safe. *Warrant: **0 of 5** repos can narrow a grant after issue. The two
> that reasoned hardest both arrived at the same shape independently — scopes immutable from mint to
> revoke, narrowing available only as a hardcoded mint-time constant, widening spelled as "mint a
> different token". One wrote the gap down: "Least privilege inside a fleet is not expressible."*
>
> **P3 — physics, 2 of 3 independent — and the 2 are exactly the 2 that wrote their reasoning down.
> *Enforce at the point of use, and make the miss branch the deny branch.*** The dangerous default is
> not a permissive rule; it is a fallthrough nobody wrote. An unknown verb, an unknown tool, an empty
> list — each must land on deny, and the arm must exist on purpose. *Warrant: the two repos with a
> default-deny fallthrough are the two carrying a written post-mortem about it, one of which gates
> unknown tools at the highest scope specifically "so a future tool cannot slip in ungated by
> accident". The inverse held just as cleanly: the repo with zero occurrences of "least privilege"
> anywhere has a comment reading "most restrictive: no tool access" directly above code that returns
> a permission-skipping flag.*
>
> **P4 — physics, converging as a defect, and the sharpest form of P3. *An empty authority set must
> mean "nothing", never "unrestricted".*** The natural spelling of maximum restriction is an empty
> list. If your runtime reads empty as "no constraint supplied, allow everything", then the safest
> thing a caller can write is the most dangerous thing it can do, and the mistake is invisible at
> every review. *Warrant: a sibling port inherited exactly this convention as behaviour while
> documenting the opposite intent — `{"allowedTools": []}` grants unrestricted access there, silently.
> The convention it inherited is this repo's.*
>
> **P5 — house-measured, and the discriminator nobody expects. *The authority a command exercises is
> not the authority its neighbourhood implies — so a tier assigned by module will be wrong in
> proportion to how varied the module is.*** Tiers get assigned when a directory is created and then
> inherited by every file added to it. The commands that most need a gate are the ones that arrived
> late, in a folder about something else. *Warrant: measured here by racing the hypotheses — module
> membership predicts the privileged tier at 9.77× separation; the strongest behavioural predictor
> reaches 4.71×; and spawning a subprocess predicts it at 0.99×, which is the base rate. A whole
> module of 38 commands that spawn and drive permission-skipping agents has one gated member, and it
> is the one that deletes a row.*
>
> **P6 — physics, from the mechanism. *Two expressions of one grant will disagree, and the two
> directions of disagreement fail in opposite ways — so you cannot pick the safer default.*** A
> declaration that outruns enforcement silently grants; enforcement that outruns declaration silently
> denies. Both look identical in review, and which one you get can depend on something as incidental
> as whether the function is `async`. Keep one expression, or make one derive the other, or join them
> in a test that runs where people look. *Warrant: measured here as 23 commands declaring a tier that
> nothing enforces (all async — zero enforcement), 33 enforcing a tier nothing declares, and 5
> allowlist entries naming commands that are not registered at all. The repo's own test for the first
> class passes with zero headroom and runs at neither local gate.*
>
> **P7 — physics, and the cheapest clause to satisfy. *A grant that is recorded and never read is a
> note.*** Storing the scope list feels like governance. It is only governance if something compares
> against it — before a call, in a review screen, or in a diff. Otherwise it is a string that ages.
> *Warrant: **3 of 5** repos record a grant at issue time and **0 of 5** compare against the record
> afterwards. Measured here as 0 production readers, and a write path that falls back to recording
> the request when the grant is absent — an error nothing could ever surface.*
>
> **P8 — physics, converging as a defect. *Read is not free. A blanket "GET is allowed" is a grant
> of the entire schema.*** Reads are where the data leaves. An authorization table whose read row is
> "any authenticated caller" has decided that the interesting question is mutation, and the
> interesting question is usually reach. *Warrant: **2 of 5** separate read from write at all, and
> both of those shipped exactly one documented inversion in the same place — usage-reporting, a
> write, classified as a read. Two independent codebases, same seam. Measured here as an
> `authorize()` whose `/api/` arm returns Ok for GET/HEAD/OPTIONS unconditionally.*
>
> **P9 — ergonomics, security-load-bearing; Personas is AHEAD here. *Record the widening where the
> widening happens — one level below the feature that performs it.*** An escalation is written by
> whoever needed it, in their own file, and each one will hand-roll its own record or none. Put the
> ledger at the layer every widening must pass through and coverage stops being a property of
> authorial diligence. *Warrant: **1 of 5** repos records a widening at all, and it is this one — at
> the repository layer, so internal engine callers are audited identically to the command surface,
> with no-op writes skipped and secret-valued keys structurally redacted. The clause is stated as a
> prescription rather than a finding because the fleet has no second example to corroborate it.*
>
> **P10 — physics, and the default that decides everything. *Make the request a narrowing of a
> maximum, never a union of contributions.*** When each caller can add scopes and none can remove
> them, the requested set is the union of everything anyone ever wanted, and it only grows. Compute
> the ask by intersecting a declared ceiling with the job, in one place, server-side.
> *Warrant: measured here as a `scopes.extend(extra_scopes)` on the OAuth request path — the
> server-side default is a floor the client may only raise — under a comment three hundred lines
> above asserting that the server list is "the single source of truth" and that the client
> "delegates scope selection to the backend".*
>
> **Scale condition.** P1 and P2 are free on day one and unpayable later — the record you did not
> take is the review you can never do. P3, P4 and P10 are correctness on the first grant. P6 bites
> the first time two people express the same tier. P5 bites when the second kind of thing lands in a
> folder. P7 and P9 bite the first time somebody asks "what changed". P8 bites once, quietly, and you
> find out from someone else.

---

## 1. Trigger

- "what scopes should we ask for?" / "just add the scope, it's easier than another consent screen"
- "does this command need to be privileged?" / "add it to the privileged list"
- "give this persona/agent the tools it needs" / "which tools is this agent allowed to use?"
- "mint an API key for the sidecar" / "what scopes does the system key need?"
- "why is it asking for access to my whole Drive?"
- "can we narrow this down?" — **and you cannot answer, which is the trigger**

**If you are about to write** an OAuth `scopes` array, a `permissions` / `capabilities` / `scopes`
column, an allowlist of command or tool names, a `#[requires(...)]`-style tier annotation, an
`allowedTools` / `--allow-*` argument, a `has(scope)` membership test, a `.extend(extra_scopes)`, a
`match` over a permission enum with a catch-all arm, or a flag that turns a confirmation off — **you
are in this situation.**

**You are especially in it when the change is "also add X to the list."** Adding is the only cheap
direction, and it is cheap precisely because nothing measures the cost.

**Not this path:** whether the gate fires at all is
[ipc-command-authorization](./ipc-command-authorization.md) and
[ipc-session-token-race](./ipc-session-token-race.md); whether the caller may touch *this row* is
[ownership-verification](./ownership-verification.md); what a product tier may show is
[tier-and-capability-gating](./tier-and-capability-gating.md) (which has already ruled itself out of
authorization); who created the credential is
[automated-credential-provisioning](./automated-credential-provisioning.md); what a child process
should hold is [credential-injection-into-child](./credential-injection-into-child.md); whether the
user understood the ask is [informed-consent-gate](./informed-consent-gate.md); whether an autonomy
setting dissolves an approval is [autonomy-gating](./autonomy-gating.md); ending a grant is
[credential-rotation-and-revocation](./credential-rotation-and-revocation.md).

### The seam with `ipc-command-authorization`, which is the one people get wrong

> **That path asks whether the gate can fire. This one asks whether the gate is on the right door.**

A command can be perfectly gated and still be the wrong tier, and a perfectly ungated command can be
harmless. `dry_run_trigger` is privileged while `update_trigger` is Public
([ownership-verification](./ownership-verification.md) D3); `credential_blast_radius` was Public
while `delete_credential` beneath it was privileged ([delete-semantics](./delete-semantics.md) §7).
Both are this leaf, not that one: the enforcement worked, and the assignment was wrong. **A green
authorization gate tells you the door is locked. It does not tell you the wall is there.**

---

## 2. The one way

**Make every authority a *pair* — the grant and the record of its use — and refuse to ship the first
without the second.** Concretely: (a) **at every point where a grant permits an action, record which
grant permitted it**, in the same write, as a closed enum, not a boolean — the type
`Broad | PerCredential | PerConnector` already exists in this repo and is the shape to copy. (b)
**Compute a request as `ceiling ∩ job`, server-side, in one function** — never `default ∪ caller
extras`; if a caller may pass scopes, the parameter narrows, it does not add. (c) **Make the empty
set mean nothing**: an empty `allowedTools`, an empty scope vec and a missing policy must all deny,
and the deny must be the arm someone wrote on purpose. (d) **Enforce at the point of use with an
exhaustive match and no catch-all** — an unknown verb, tool or scope lands on the strictest arm.
(e) **Have exactly one expression of a grant.** If you have two — an attribute and a list, a Rust
enum and a TypeScript map, a seed and a runtime default — make one derive the other, and if you
cannot, join them in a test that runs at the gate developers actually hit, with a precondition that
fails loudly when the walk finds nothing. (f) **Assign a tier from what the handler reaches, never
from where the file sits** — write the reason on the entry, in one sentence, naming the authority
(*"drops any session row"*, *"writes arbitrary stdin to a permission-skipping child"*). (g)
**Separate read from write, and treat reach as the real question**: a blanket GET allowance is a
grant of the schema. (h) **Read the grant back somewhere a human sees it** — a screen, a diff, a
startup log — because a grant with no reader decays into a note within one refactor. (i) **Record
every widening one layer below the feature that performs it**, so coverage is structural rather than
diligent. (j) **A capability list you hand to the thing it constrains is documentation** — if the
runtime does not enforce it, say so at the site, in the comment, next to the list.

If you must get one right first: **(a)**. Every other clause is unfalsifiable while nothing records
what was used — including (b), because you cannot compute a ceiling you have no evidence for.

---

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
|---|---|
| `src-tauri/src/engine/credential_broker.rs:93-116` `authorize_credential_use` | **The one true least-privilege primitive in the tree.** A pure, default-deny scope intersection: exact match, *"no substring, no case folding"*, and *"Empty scope lists — including the fail-closed empty vec that `parsed_scopes` returns for a corrupt column — authorize nothing."* This is P3 and P4 in nine lines. |
| `src-tauri/src/engine/credential_broker.rs:50-69` `BrokerGrant` | **The answer to P1, and the most important primitive in this document.** A closed enum returned by the authorizer naming *which* grant permitted the use — *"recorded in the audit detail so 'who could do what, and why' is reconstructible from the ledger."* Copy the idea before you copy the code: **an authorization function should return the reason, not a boolean.** 0 rows (§7 D1). |
| `src-tauri/src/engine/credential_broker.rs:40-46`, `:118-124` `clamp_handle_ttl` | *"'Short-lived' is a security property, not a suggestion; the mint path clamps, never trusts."* The narrowing that exists. |
| `src-tauri/src/engine/management_api.rs:335-394` `authorize(method, path, scopes)` | **Object-level capability, and the best authorization design in the repo** (also named by [ownership-verification](./ownership-verification.md) §3). `/api/proxy/{id}` accepts broad `proxy`, the exact `proxy:credential:<id>`, or any `cred:<connector>:use` — then re-checks default-deny once the row is loaded, with the reason written at `:361-366`. **The grant names the object.** Its one defect is `:386-392` (§7 D6). |
| `src-tauri/src/engine/management_api.rs:348-356` | **The anti-escalation rule, written down:** *"Minting consumer identities is a trust operation: broad `proxy` only. A derived handle must never be able to mint further handles."* Copy the sentence as much as the branch. |
| `src-tauri/db/src/repos/core/settings.rs:11-61` `audit_setting_change` | **P9, correct, and the fleet's only example.** The widening ledger at the repository layer *"so INTERNAL Rust callers … are audited too — not only the Tauri command surface"*, with the no-op skip (`:29-31`), a closed `audit_category` allowlist, and structural redaction for known-secret keys (`:44-48`). |
| `src-tauri/db/src/settings_keys.rs:1154-1250` `audit_category` | The closed key→category function that decides what a widening ledger covers. **Its `None` arm is the coverage boundary**; put an authority-bearing key on the wrong side and its widening is silent forever. |
| `src-tauri/src/ipc_auth.rs:1149-1211` the drift test | **The right instrument in the wrong suite.** It asserts `found.len() > 150` *before* asserting the result — *"the source walk is broken, not the codebase suddenly clean"* — which is the fail-loud discipline `golden-path-contract.md` §9 demands, done properly. §9 moves it, it does not replace it. |
| `src-tauri/src/ipc_auth.rs:117-127`, `:245-252`, `:396-401` | **Allowlist entries with a written reason.** `PRIVILEGED_COMMANDS`'s 184 entries sit under **43** comment headers; **28 of those headers state what authority the commands confer** (*"unlinks a file from disk"*, *"runs an unscoped `UPDATE personas SET icon = ''`"*, *"a second call on a `.trash/` path hard-deletes"*), covering **110** entries. This is what (f) looks like, and — with §6's finding that the two siblings who wrote their reasoning down are the two who got it right — it is the corpus's best evidence that the sentence is the control. |
| `src-tauri/src/engine/desktop_security.rs:326-351` `is_fully_approved` / `pending_capabilities` | **The re-consent diff** — what is still unapproved for a manifest. Named by [automated-credential-provisioning](./automated-credential-provisioning.md) §7.E; still 0 consumers. |
| `src-tauri/src/engine/db_query.rs:637` `connector_capability(service_type)` | **Honest capability advertising** — `FullSql` / `SelectSubset` / `KeyValue` / `IntrospectionOnly`, kept *"immediately next to the `execute_query` dispatch … so the advertised capability and the actual execution behavior can never silently drift."* The pattern §7 D3 needs and does not have. |
| `src-tauri/src/companion/jobs/operations_views.rs:27` `run_view` | **The grant that names exactly what is used**: 7 named views, clamped params, no string. Owned by [sql-console](./sql-console.md); named here because it is the only place in the product where the asked set and the used set are the same set by construction. |
| `scripts/check-command-contract.mjs` | The repo's only locally-enforced generated-artifact gate, and 90 % of §9's instrument: it already parses `lib.rs`'s handler block and walks every `.rs` file for `#[tauri::command]`. |

**Do not exist — this path names them:**

- **Any record of which grant authorized a use.** `BrokerGrant` is declared and has produced 0 rows;
  9,431 `decrypt` audit rows name no grant.
- **Any per-scope usage.** No column, no counter, no audit field, in any of the five repos (§6).
- **Any way to narrow a grant after issue.** No `UPDATE … SET scopes`, no re-mint-narrower, anywhere.
- **Any reader of `credential_fields.scopes`.** 0 in production.
- **Any enforcement of a persona's tool grant at execution time.** `--allowedTools` at 2 sites, both
  outside the execution lanes.
- **Any single expression of an IPC tier.** Two lists plus an attribute, joined only by a cargo test
  that runs at no gate.
- **Any reason recorded on an allowlist entry, enforced.** ~⅓ of `PRIVILEGED_COMMANDS` entries carry
  none, and nothing requires one — while the census engine three directories away *does* enforce a
  prose `reason` on its own excludes, for exactly this argument.

---

## 4. Steps

1. **Write down the ceiling before you write the request.** For each connector/command/agent, one
   list: the maximum authority this thing may ever hold, with a sentence per member naming what
   needs it. This is the artifact that makes narrowing possible later; it is not the request.
2. **Compute the request as `ceiling ∩ job`, in one server-side function**, and give that function
   the only literal. A caller parameter may subtract; it may never add. **And then stop** — do not
   also keep a client-side list "for the consent screen."
3. **Make the empty set deny.** Empty scopes, empty tool list, absent policy → nothing. Write the
   arm on purpose; do not let it be a fallthrough.
4. **Enforce at the point of use with an exhaustive match**, and have the authorizer return *which
   grant matched*, not `bool`.
5. **Write that value into the same row as the effect.** One column. This is step (a) and it is the
   only irreversible one — a use you did not attribute cannot be attributed later.
6. **Assign the tier from what the handler reaches**, and put the reason on the entry in one
   sentence naming the authority. If you cannot write the sentence, you do not know the tier.
7. **Have one expression of the grant.** If two are unavoidable, join them in a check that runs at
   the gate developers hit, with a precondition that fails when the walk finds nothing.
8. **Separate read from write and price reads by reach**, not by mutation.
9. **Surface the grant somewhere a human reads it** — even a startup log line listing the scopes
   held per credential is enough to make P7 true.
10. **Put the widening ledger one layer below the features that widen**, so a new escalation is
    audited without its author doing anything.
11. **After the first month, run the query.** Grants held minus grants exercised. If that query
    cannot be written, you skipped step 5.

### Can the type make the wrong call impossible? — asked before §9

**Yes for two of the three defect classes, decisively and cheaply. No for the third, and Q4 and the
serialization rule say exactly why — which is what §9 is for.**

**T1 — make an unattributed authorization unrepresentable.** The authorizer already returns the
answer; the effect just throws it away.

```rust
// today — credential_broker.rs:93
pub fn authorize_credential_use(scopes: &[String], credential_id: &str, service_type: &str)
    -> Result<BrokerGrant, String>;                  // ← the reason IS returned
// …and every non-broker resolution path never calls it, and audit_log::insert
// takes no grant argument at all.

// the fix — withhold the resolution, not the check
pub struct Authorized(BrokerGrant);                  // private field
pub fn resolve_credential_fields(pool: &DbPool, id: &str, auth: Authorized) -> Result<Fields, AppError>;
// `Authorized` is constructible ONLY by authorize_credential_use, and
// resolve_credential_fields writes auth.0.as_str() into the audit row it already writes.
```

Against the corpus's seven qualifications:

- **Q5 — withholding beats requiring.** The load-bearing half. Do not *require* callers to pass a
  grant to the audit call; **withhold the fields from anyone who has not been authorized.** The
  dangerous freedom is resolving a secret without having asked which grant permits it.
- **Q4 — a type anyone can construct authenticates nothing.** `Authorized`'s field must be private
  and its module must expose no other constructor. With a public field this is a comment. **Stated
  first because it is the whole risk.**
- **Q3 — count the construction sites.** The audit `decrypt` write is one repo function; the
  resolution paths that reach it are enumerable. This is a small edit, which is also why the defect
  survived — nobody was forced to look at it twice.
- **Q1 — a type carries only what it encodes.** `Authorized` encodes *an authorization decision was
  made and this is its reason*. It does **not** encode that the scope set was correct, that the
  ceiling was sane, or that the use was necessary. Those are P2 and P10, and they are not typeable.
- **Q6 — withhold the dangerous freedom, not the answer.** The caller keeps everything it
  legitimately needs; it loses only the ability to resolve a secret anonymously.
- **Q2 — requiredness is orthogonal to closedness.** `BrokerGrant` is already closed and already
  returned. The missing edit is not making it required; it is making the *effect* depend on it.

**T2 — make "unrestricted" unspellable as an empty list.** `Vec<String>` for a tool allowlist has
the P4 defect in its type: `vec![]` is both "deny all" and "no opinion". Replace with
`enum ToolGrant { All { because: &'static str }, Only(NonEmpty<ToolName>) }`. `All` then costs a
sentence at every call site, which is the entire point — the same shape
[automated-credential-provisioning](./automated-credential-provisioning.md) §4 proposed for
`GrantLifetime::NeverExpires { because }`. **Two leaves reaching the same construction independently
is the strongest argument in this document for it.**

**T3 — NO for the tier expressions, and this is where the type ends.** The declaration is a proc-macro
attribute in `commands/**`; the enforcement is a `&[&str]` in `ipc_auth.rs`; the registration is a
macro invocation in `lib.rs`. Making the attribute *generate* the list entry is the correct fix and
is not available: `wrap_invoke_handler` needs the set before dispatch, at a site the macro cannot
reach, and a proc macro cannot accumulate across crates. **The residue is a three-file join, and a
three-file join is a check, not a type** — §9.

**Propose T1 first (small, and it is P1), T2 second (one enum, and it is P4 and P10 together), and
§9's check as the ratchet that holds the tier surface until someone decides whether 1,356 Public
commands is a decision or an accumulation.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Recording a grant and never recording a use** | The denominator never exists, so no grant can ever be justified or narrowed. **Measured: 9,431 credential resolutions, 0 naming the authorizing grant; 0 of 5 repos in the fleet records one.** §0.6. |
| **`scopes.extend(extra_scopes)`** | The request becomes the union of every caller's wishes and can only grow. **Measured: `oauth.rs:595-597`, under a comment at `:392-394` asserting the server list is "the single source of truth" and the frontend "delegates scope selection to the backend."** §7 D5. |
| **An empty authority list meaning "unrestricted"** | The natural spelling of maximum restriction becomes maximum permission, invisibly. Convergent: a sibling port inherited this exact convention while documenting the opposite intent. §6 clause 4. |
| **Assigning a tier by module** | The commands that most need a gate are the ones that arrived late in a folder about something else. **Measured: module membership predicts the tier at 9.77×; spawning a subprocess predicts it at 0.99×.** §0.2. |
| **Two expressions of one grant with a hand-maintained join** | They fail in opposite directions and you cannot pick the safer default. **Measured: 23 declared-not-enforced (all async → zero enforcement), 33 enforced-not-declared, 5 allowlist entries naming unregistered commands.** §0.1. |
| **Baselining a drift set at exactly its current size** | The gate becomes a snapshot. **Measured: `DRIFT_BASELINE` is set-equal to the measured drift set in both directions, so the test passes with zero headroom — and it runs at neither lefthook hook nor in `npm run check`.** §0.1. |
| **Giving an agent a capability list in its prompt and everything at its runtime** | The list reads as a constraint in review and is documentation at runtime. **Measured: 210 grant edges, 9 ever exercised (4.3 %); `Bash` at 29,303 invocations with no grantable edge; `--allowedTools` at 2 sites, neither an execution lane.** §0.3. |
| **A grant record with no reader** | It decays into a string that ages, and an error in it can never surface. **Measured: 0 production readers of `credential_fields.scopes`; and the workspace write path falls back to storing the *request* when the provider returns no grant** (`useWorkspaceConnect.ts:87`). §0.4. |
| **`GET ⇒ Ok(())` in an authorization table** | Authentication silently becomes authorization for the entire read surface; reach, not mutation, is what leaks. `management_api.rs:386-392`. Convergent — only 2 of 5 repos separate the axes. §7 D6. |
| **A `_ =>` arm in a permission match** | A capability added later is granted by a line nobody edited. A sibling gets this right on purpose — *"gate them as admin so a future tool cannot slip in ungated by accident"* — and this repo's `AutopilotMode::allows` grants every capability at `full` through a catch-all ([autonomy-gating](./autonomy-gating.md) `:820`). |
| **An allowlist entry headed by a category label instead of a reason** | *"// Credentials -- Rotation"* says where the command lives, which is P5's defect written into the allowlist itself. **Measured: 15 of `PRIVILEGED_COMMANDS`'s 43 comment headers are category labels, covering 74 of 184 entries (40.2 %)** — while `scripts/census/lib/engine.mjs` three directories away *enforces* a prose `reason` on its own excludes, for this exact argument. |
| **Requesting a read-only scope alongside its own read-write superset** | It reads as caution and is noise; it also proves nobody checked what the calls need. **Measured: `builtin_connectors.rs:761`, `:803` ask for `calendar` + `calendar.readonly` and `spreadsheets` + `spreadsheets.readonly`; the live `google_calendar` grant holds a write scope and the tree has exactly one calendar endpoint, a GET.** §7 D4. |
| **Treating "add it to the list" as the cheap change** | Adding is the only direction that is ever obviously safe, because removal needs evidence the system does not collect. That asymmetry, not any individual decision, is what produced every number in §0. |

---

## 6. Evidence

**The ONE site to copy: `src-tauri/src/engine/credential_broker.rs:93-116`.**

```rust
/// Default-deny scope intersection: may a caller key with `scopes` use the
/// credential `credential_id` (connector `service_type`) through the proxy?
///
/// Grants are matched exactly (no substring, no case folding — scopes are
/// minted lowercase by this codebase and a mismatch must deny). Empty scope
/// lists — including the fail-closed empty vec that `parsed_scopes` returns
/// for a corrupt column — authorize nothing.
pub fn authorize_credential_use(scopes: &[String], credential_id: &str, service_type: &str)
    -> Result<BrokerGrant, String>
{
    if scopes.iter().any(|s| s == SCOPE_PROXY)             { return Ok(BrokerGrant::Broad); }
    let per_credential = format!("{SCOPE_PROXY_CREDENTIAL_PREFIX}{credential_id}");
    if scopes.iter().any(|s| s == &per_credential)         { return Ok(BrokerGrant::PerCredential); }
    if !service_type.is_empty() {                          // no degenerate empty-connector match
        let per_connector = cred_use_scope(service_type);
        if scopes.iter().any(|s| s == &per_connector)      { return Ok(BrokerGrant::PerConnector); }
    }
    Err(format!("caller key holds no grant for this credential (need `{SCOPE_PROXY}`, …)"))
}
```

Five things to copy: (1) **it returns which grant matched, not `bool`** — the reason survives the
call, which is the only reason P1 is reachable at all; (2) **empty authorizes nothing, and the
docstring says the corrupt-column case lands there too** — P4 stated where a reader will find it;
(3) **exact match, no substring, no case folding, and the docstring says why**; (4) the
empty-connector guard, closing a degenerate grant; (5) **it is pure** — no pool, no state — so it
is unit-testable and is unit-tested (`:204-271`, eight cases including four malformed scopes).

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `engine/management_api.rs:348-356` | **The anti-escalation rule, in prose, at the branch:** *"A derived handle must never be able to mint further handles."* |
| `engine/management_api.rs:358-377` | **Coarse gate then exact re-check**, with the reason for the two-stage design written inline (*"cannot be verified here … needs a DB read"*). The grant names the object. |
| `db/src/repos/core/settings.rs:11-61` | **P9 done right.** The widening ledger below the feature layer, no-op-skipped, structurally redacted, with the altitude choice argued in the docstring. |
| `ipc_auth.rs:1160-1168` | **Assert the instrument before the result** — `found.len() > 150` with the reason. The model for §9's preconditions. |
| `ipc_auth.rs:534-537` | **An allowlist entry that names the authority in one sentence** and distinguishes the safe sibling: *"`Registry::remove` drops ANY session row … (the liveness-checked variant is `forget_dead`)."* |
| `engine/db_query.rs:634-637` | **Advertised capability kept adjacent to the dispatch** *"so the advertised capability and the actual execution behavior can never silently drift."* |

### Convergence — 5 sibling repos, lineage-corrected to 3

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.**

**Lineage first, per the doctrine.** `personas-cloud` is a **self-declared port** —
`packages/shared/src/bus.ts:5` *"Ported from engine/bus.rs"*, `eventProcessor.ts:30` *"Ported from
desktop engine/background.rs"*, `types.ts:2` *"mirroring desktop Tauri models"*, and
`db.ts:275-289` reproduces `persona_credentials` column-for-column against
`db/src/migrations/schema.rs:160-170`. `personas-web` has **no scope system at all** — all 14
Personas security tells return zero and there is nothing to audit. `brainiac`, `ascent` and
`vibeman` are genuinely independent: every tell zero, and `ascent`'s `authz.ts:37-41,:107-109,
:141-144` narrates *its own* bug history — a port carries the donor's comments, not a different
repo's scars. **Independent cohort for this subject: 3.**

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **A closed scope vocabulary exists** | **3 of 5** | `brainiac` 8 members (`auth.rs:97-110`); `ascent` 3 (`org-api-tokens.ts:15`); `vibeman` 3 (`remote/types.ts:82`); `personas-cloud` open-valued `allowedTools: string[]`; `personas-web` none. |
| 2 | **Enforced default-deny at the point of use** | **2 of 5** | `brainiac` (`auth.rs:131-136`, 74 handlers + 18 MCP tools); `ascent` (`api-token-auth.ts:53-55`, 9 of 114 handlers). `vibeman` has all four postures at once. **`personas-cloud` is default-ALLOW** (`prompt.ts:725-743`). |
| 3 | **A grant is recorded at issue** | **3 of 5, all plaintext** | `scopes text[] DEFAULT '{read}'`; `scopes String` comma-joined; `permissions JSONB`. Personas matches: plaintext `credential_fields.scopes`. |
| 4 | **Anything records what was USED against the grant** | **0 of 5 — PHYSICS, and it is P1** | Whole-credential granularity everywhere and nothing finer. `brainiac tokens.rs:43` bumps `last_used_at`; its `retrieval_events` ledger stores `token_id`/`surface`/`tool` and a scope is *derivable* and never derived. **`ascent org-api-tokens.ts:151-153` bumps `lastUsedAt` INSIDE `verifyOrgApiToken`, before the scope check runs — a request 403'd for lacking a scope still advances the token's freshness.** `vibeman` logs `tool_use` richly and its `allowedTools` appears at 17 sites, **every one a declaration or an argv push, never a comparison**. `personas-cloud` declares `last_used_at` at `db.ts:286` and the string occurs exactly once in the repo. |
| 5 | **A grant can be narrowed after issue** | **0 of 5 — PHYSICS** | No `UPDATE … SET scopes` exists anywhere. The two serious repos reached the same shape independently: immutable mint→revoke, narrowing only via hardcoded mint-time constants, widening spelled as "mint a different token". `brainiac` wrote the gap down — `docs/harness/moonshot-2026-07-30/auth-middleware.md:27`: *"Least privilege inside a fleet is not expressible."* |
| 6 | **A widening is recorded** | **1 of 5 — and it is PERSONAS** | `ascent` records role changes only (`prevRole`→`newRole`); `brainiac`'s mint emits nothing; `vibeman` in-memory only; `personas-cloud` unlogged self-service. **Personas' repo-layer `audit_setting_change` is the fleet's best example** — and it covers one of five grant surfaces (§7 D8). |
| 7 | **Read separated from write** | **2 of 5** | `brainiac` and `ascent`: GET is never free. **`personas-cloud` is inverted**; `personas-web` GET-free on all 8 routes; **Personas' `authorize()` returns Ok for GET/HEAD/OPTIONS unconditionally** (§7 D6). Convergent detail worth keeping: **both correct implementations shipped exactly one documented read-scope-that-writes inversion, and both are usage-reporting** (`brainiac mcp.rs:244`; `ascent download/route.ts:47`). Two independent repos, same seam. |
| 8 | **A declared capability is checked before it is exercised** | **2 of 5, both partial** | `brainiac`'s `kb_enabled` fails closed; `ascent` proves commands and ignores boundaries; **`vibeman` is prompt-only**; `personas-cloud` checks `allowedTools` only when non-empty. **Personas is with `vibeman`** (§0.3). |
| 9 | **Spawn sites disabling a permission prompt** | **2 of 5 repos, 10 sites** | `vibeman` 8 of 69; `personas-cloud` 3 of 5; `brainiac` 0 **with a written prohibition**; `ascent` 0. Personas' own count (12 argv sites, `--allowedTools` at 2) is [credential-injection-into-child](./credential-injection-into-child.md)'s measurement and is not re-derived here. |

**The strongest result in the sweep is not a count.** The two repos that got clauses 2 and 7 right
are exactly the two that wrote their reasoning down, and one of them wrote the post-mortem into the
vocabulary declaration itself (`brainiac auth.rs:79-96`):

> *"This list is the token minter's vocabulary, and it MUST contain every scope any endpoint
> enforces — otherwise the product ships a scope it checks and refuses to issue, which is worse than
> having no scope at all: the endpoint looks governed, and the only key that can reach it is
> `admin`."*

**And the inverse held just as cleanly.** `personas-cloud` has zero occurrences of "least privilege"
or "default deny" anywhere, and its one sentence expressing the intent sits directly above code
doing the opposite (`prompt.ts:740-742` — the comment reads *"most restrictive: no tool access"*,
the code returns a permission-skipping flag). `vibeman` instructs its scanning agents to apply
"principle of least privilege" to *other* codebases (`securityProtectorPrompt.ts:119`) and states it
nowhere for itself. `ascent` scores other repos on *"Least-privilege workflow tokens"*
(`src/lib/security/checks.ts:45`) and **would score 0/10 on its own metric** — neither of its two
workflows declares a `permissions:` block. `personas-web` asserts per-agent minimum scopes in
marketing copy (`guide/content/credentials.ts:88`) while its connector catalog type has no scopes
field, and sets an unscoped bearer as `NEXT_PUBLIC_TEAM_API_KEY` in `.env.example:19`, sixteen lines
below its own warning that `NEXT_PUBLIC_*` is inlined into the client bundle.

> **Six codebases, and the ones that reasoned in writing are the ones that got it right. That is the
> most actionable finding in this section and it is free.**

### The composition defects with the neighbouring paths — offered upward

**(i) with [`automated-credential-provisioning`](./automated-credential-provisioning.md).** Its P4 —
*"A grant the system issues to itself must expire, and must be no wider than the job… the ratio of
their row counts is the real policy"* — is right and, measured from this side, **the ratio is not
the policy; it is the only observable the system produces.** Row counts are what you fall back on
when nothing records usage. Its Gap 4 hands "split the `proxy` system key into per-consumer narrow
handles" to [credential-injection-into-child](./credential-injection-into-child.md) §4. **That
design is blocked on this leaf**: you cannot choose per-consumer scopes without knowing which
consumers touch which credentials, and `credential_consumer_edges` has 0 rows because the path that
would write them has 0 callers. **The clause both paths need: a narrowing project must begin with a
usage-recording change, and that change ships first, alone, and waits.**

**(ii) with [`sql-console`](./sql-console.md).** Its P8 — *"A capability whose safety argument is 'a
human approves it' is only as strong as the weakest mode in which approval can be skipped"* — and
its §9 complementary instrument 2 (a `NEVER_AUTO_FIRE` set) are the enforcement shape this leaf's
P9 generalises. Read together: **a capability needs two written dependencies, not one — which
approval mode it relies on, and which grant permits it — and both must be re-read when either
machinery changes.** Its finding that `classify_db_query` is registered, privileged, typed and has
zero callers while a client re-implements it is, from this angle, a *tier* finding too: the
privileged tier is being spent on a command nothing calls.

**(iii) with [`ownership-verification`](./ownership-verification.md).** Its §2(f) says a tier
annotation *"says may you call this command, never may you touch this row"*, and measures the two as
disjoint (0 of 31 ownership-checking commands is privileged; 0 of 191 privileged commands checks
ownership). **This leaf supplies the third axis and it is also disjoint: neither answers *how much*.**
Three orthogonal questions — may you call, may you touch this row, how much may you reach — and the
repo has an instrument for the first, 31 instances of the second, and nothing for the third.

**(iv) with [`informed-consent-gate`](./informed-consent-gate.md) and its P6 (*"disclose the set,
not the count"*).** Following it here means rendering the scope set at the consent screen. **The set
this repo would render is the client's literal list, which is not the set that will be requested**
(§0.4, §7 D5): the server unions its own default on top. **The clause: disclosure must read from the
same expression the request is built from, or the consent screen is a second, more-trusted, wrong
answer.**

---

## 7. Deviations

Every entry is live on `master` @ `2a874e692`, verified by reading the file and — where a number is
quoted — by replay against a read-only copy of the operator's database. All shipped under a green
`npm run check` and a green census. **Per the campaign's no-destructive-applies rule, nothing here
was applied; nothing was re-scoped, revoked or re-authorised.**

> **Second pass — what is upstream of all of this.** Every entry reduces to one omission: **no write
> in this system records which grant permitted it.** Once that is true, the tier list cannot be
> pruned (D2), the persona tool grant cannot be enforced (D3), the OAuth ask cannot be narrowed (D4,
> D5), the GET allowance cannot be priced (D6), and the widening ledger has nothing to widen *from*
> (D8). **D1 is the edit that makes every other entry addressable**, and it is one column.

### P0 (D1) — the type that records which grant authorized a use has produced 0 rows, against 9,431 that do not · **executed**

`credential_broker.rs:50-69` declares `BrokerGrant`, documented *"recorded in the audit detail so
'who could do what, and why' is reconstructible from the ledger."* It is returned by
`authorize_credential_use` (`:93`), which is called from the broker proxy path only.

| | rows |
|---|---:|
| `credential_audit_log` `decrypt` | **9,431** |
| ↳ naming a `BrokerGrant` (`per_credential` / `per_connector` / broker operation) | **0** |
| `credential_consumer_edges` (observed consumer→credential usage) | **0** |
| `external_api_keys` named `handle:%` (derived narrow handles) | **0** |

**The authorization function is correct and unreached.** Every real credential resolution goes
through `runner/credentials.rs`, which resolves by id and writes an audit row with no grant field —
`audit_log::insert` has no parameter for one.

**Fix (note):** T1 — an `Authorized(BrokerGrant)` with a private field, constructible only by
`authorize_credential_use`, required by the resolution path, written into the audit row that is
already being written.

### P0 (D2) — 85.6 % of the IPC surface is Public and the tier is predicted by directory · **executed**

Full cross-tab in §0.1; discriminator race in §0.2. The three concrete drifts:

- **23 commands declare a tier nothing enforces** — all `async`, so per `ipc_auth.rs:118-122` the
  attribute expands to a `tracing::debug!` and nothing else. They include
  `execute_api_request` (`api_proxy.rs:37`), `import_portability_bundle_from_path`
  (`data_portability.rs:2194`), `export_credentials` (`:9556`) and `import_credentials` (`:9670`).
  **Four of these are deliberate** (`ipc_auth.rs:396-401`, `:245-252` — a documented Windows WebView2
  header-forwarding race); the rest are drift, and the file does not distinguish them.
- **33 commands are enforced with no declaration.** Nine of them are `commands/credentials/desktop.rs`
  in a block, which [automated-credential-provisioning](./automated-credential-provisioning.md) §0.4
  correctly reads as *"the list, not the macro, is the gate."*
- **5 allowlist entries name commands that are not registered** — `github_create_patch_release`,
  `openapi_parse_from_url`, `openapi_parse_from_content`, `openapi_generate_connector`,
  `create_execution`. Two carry a comment anticipating exactly this (`ipc_auth.rs:254-259`,
  `:544-549`). They protect nothing, and their presence is what stops anyone noticing.

**And `DRIFT_BASELINE` is set-equal to the current drift set in both directions**, so the one test
covering the first class has zero headroom — and it runs in `cargo test`, which is in neither
lefthook hook nor `npm run check`.

**Fix (note):** §9's Rule 5, which is red today on the third class.

### P0 (D3) — 210 capability grants, 9 exercised, and the runtime grants everything anyway · **executed**

§0.3 has the replay. The mechanism, in three files:

1. `executions.rs:420` reads `get_tools_for_persona`, appends virtual tools (`:421-425`), and the
   list is rendered into the prompt.
2. `engine/src/prompt/cli_args.rs:107` pushes `--dangerously-skip-permissions` unconditionally.
   `build_cli_args_inner` takes `persona: Option<&Persona>` and never consults its tools.
3. `--allowedTools` exists at **2 sites** in the tree, both `auto_cred_browser.rs` (`:807`, `:820`).

So `persona_tools` is an advertisement. Its 210 edges have a **4.3 %** exercise rate; the capability
actually exercised — `Bash`, 29,303 invocations, 77.3 % of all recorded tool use — has no row in
`persona_tool_definitions` and therefore cannot be granted or denied. **`http_request` is granted to
61 of 78 personas and has 0 recorded invocations.**

**Fix (note):** T2 — `ToolGrant::All { because } | Only(NonEmpty<ToolName>)`, threaded into
`build_cli_args`, so a lane that wants everything says so in a sentence. Until then, the honest
minimum is a comment at `executions.rs:420` stating that the list is not enforced — the one-line
version of §2(j).

### P1 (D4) — the grant record is never read, and the calendar grant holds a write scope for a read-only surface · **executed**

**0 production readers** of `credential_fields.scopes` across 963 `.rs` and 4,829 `.ts`/`.tsx`
files (§0.4). Consequences, all live:

- The `google_calendar` grant holds `calendar.events` — a write scope — and the tree contains exactly
  one *named* calendar endpoint, `GET calendars/{id}/events` (`mcp_server/tools.rs:1584-1613`). **No
  named site writes a calendar event.** The generic proxy (`api_proxy.rs:551`) can still reach any
  path under the connector's base with a caller-supplied method, **which is the point**: the scope,
  not the endpoint list, is the capability surface, and nothing measures which part of it is used.
- Both Google grants are expired (`needs_reauth: true` since 2026-06-09 and 2026-05-17; 49 and 21
  consecutive refresh failures) and the app cannot re-authorise them from the UI —
  [credential-rotation-and-revocation](./credential-rotation-and-revocation.md) §7 D6 owns that. **This
  leaf's addition: nothing records what those grants were used for, so a re-authorisation cannot ask
  for less than the original.** The only artifact that could inform the narrower ask is the field
  nothing reads.
- The seed disagrees with the runtime for the same connector: `builtin_connectors.rs:761` declares
  `calendar` + `calendar.readonly` where `oauth.rs:741-744` requests `calendar.events` +
  `calendar.readonly`, and `:803` declares `spreadsheets` + `spreadsheets.readonly`. **Two closed
  vocabularies for one connector, and both request a read-only scope beside a broader one.**

**Fix (note):** read the field somewhere — a startup log line per credential is enough to make P7
true — and make the seed derive from `default_google_scopes_for_connector` rather than restate it.

### P1 (D5) — the OAuth request is a union the client may only widen, under a comment saying the opposite

`oauth.rs:392-394`:

> *"Default Google OAuth scopes for the generic/workspace connector. **This is the single source of
> truth -- the frontend delegates scope selection to the backend** via
> `default_google_scopes_for_connector()`."*

`oauth.rs:595-597`:

```rust
if let Some(extra) = extra_scopes {
    scopes.extend(extra.into_iter().filter(|s| !s.trim().is_empty()));
}
```

`start_google_credential_oauth` (`:531-536`) takes `extra_scopes: Option<Vec<String>>`; the union is
sorted and deduped and sent. And the frontend keeps its own list anyway —
`workspaceProviders.ts:32-79`, four services, and `useWorkspaceConnect.ts:152-154` calls
`googleOAuth.startConsent('google_workspace', aggregateScopes(selectedServices))`.

Consequences, computed from the two literals:

| the user selects | client sends as `extra_scopes` | server default for `'google_workspace'` (falls to `_ =>`, `oauth.rs:754`) | **requested union** |
|---|---|---|---|
| Gmail only | `gmail.modify`, `gmail.send` | `gmail.modify`, `calendar.events`, `drive.file`, `openid`, `userinfo.email` | **6 scopes across 3 Google products** |
| Drive only | **`drive`** (full read/write of every file) | as above | 6, including both `drive` and `drive.file` |

**Selecting one service asks for three services' worth of authority**, and the client's Drive entry
(`workspaceProviders.ts:64`) asks for `drive` where the server's "single source of truth" asks for
`drive.file`. Nothing reconciles the two, and D4 means nothing ever will.

**Fix (note):** delete the client list; make `startConsent` send the *selected services*, not scopes;
compute `ceiling ∩ selection` in `default_google_scopes_for_connector`; change `extra_scopes` to
`narrow_to: Option<Vec<String>>` with an intersection. (§2(b).)

### P1 (D6) — every authenticated key may read everything

`management_api.rs:386-392`:

```rust
if path.starts_with("/api/") {
    return match *method {
        Method::GET | Method::HEAD | Method::OPTIONS => Ok(()),      // :388 — no scope required
        _ if has(SCOPE_EXECUTE) => Ok(()),
        _ => Err("api key lacks the personas:execute scope"),
    };
}
```

The function above it is the best authorization design in the repo (§3, §6), and this arm makes
`personas:read` structurally meaningless: **every one of the 1,029 minted keys carries it, and no
route requires it.** The live enabled key carries `["personas:read","personas:execute","proxy"]`;
730 of the 1,029 historical keys carry the two-scope set and 299 carry the three-scope set, so the
system key was widened with `proxy` at some point — **and no audit row records that widening**
(`api_key_audit`: 1 row; `management_api.rs:591-597` mints with three bare string literals in a file
that declares `SCOPE_EXECUTE`/`SCOPE_PROXY` constants 330 lines above).

Convergent: only 2 of 5 siblings separate read from write, and `personas-web` has the identical
GET-is-free arm on all 8 of its routes.

**Fix (note):** require `personas:read` on the GET arm. **This is a behaviour change to a live
transport and is deliberately NOT applied** — it is exactly the campaign's *"a security control whose
current setting may be deliberate"* case.

### P2 (D7) — 37 of 38 Fleet commands are Public, and the gated one is the row delete

§0.5 has the table. `fleet_write_input` (`commands.rs:90`) writes arbitrary bytes to the stdin of a
`claude --dangerously-skip-permissions` child; `fleet_spawn_session` (`:28`) takes
`args: Option<Vec<String>>` from the caller and appends them verbatim to that child's argv
(`pty.rs:336-338` and `:370-372`, both branches). Both Public. `fleet_remove_session` — which deletes a registry row — is the one
allowlist entry, and its comment is about the row.

**Not proposed as a re-listing.** The wrapper-level `x-ipc-token` check has a documented Windows
WebView2 failure mode for batched invokes (`ipc_auth.rs:245-252`) and the terminal panes issue
`fleet_write_input` on every keystroke; listing them could break the operator's daily workflow. **The
deviation is that the tier was never assigned from what the command reaches** — the fix is a written
reason per entry (§2(f)), then a decision, in that order.

### P2 (D8) — the widening ledger covers one grant surface of five

`audit_setting_change` (`settings.rs:25-61`) is the fleet's best widening record (§6 clause 6, 1 of
5) and its coverage is exactly `settings_keys::audit_category(key) != None`. Live:
**15 rows total**, 3 of them `autonomy`. The other four grant surfaces write nothing on widening:

| widening | recorded? |
|---|---|
| `companion_autonomous_mode` false→true (which dissolves every `use_connector` approval — [sql-console](./sql-console.md) §0) | **yes** — `settings_audit_log`, 2026-08-05 |
| a command added to `PRIVILEGED_COMMANDS` — or removed | no (a git diff, if anyone looks) |
| a tool granted to a persona (`persona_tools` INSERT) | no |
| a scope added to an API key | no (`api_key_audit`: 1 row) |
| an OAuth grant re-consented with more scopes | no (D4: nothing reads the old set to compare) |

**Fix (note):** the pattern generalises without redesign — a repo-layer hook on `persona_tools`
insert and on `external_api_keys` scope change, into the same table, with the same no-op skip.

### P3 (D9) — small, live, one line each

- **40.2 % of `PRIVILEGED_COMMANDS` entries are explained only by a category label.** Measured: 184
  entries under 43 comment headers; 15 headers are pure location labels (*"// Credentials --
  Rotation"*, *"// Signing"*) covering **74** entries, and 28 name an authority covering 110. The
  census engine in the same repo *enforces* a prose `reason` on its own excludes, with the argument
  written out — *"an unexplained exemption is how an allowlist becomes a place violations go to
  hide."* The allowlist that gates the IPC surface has no such rule, and its most common explanation
  is the directory name — which is P5's defect written down as documentation.
- **19 `#[requires(auth)]` annotations enforce nothing** (`ipc_auth.rs:476-478`, `:531-533` are
  `Ok(())`). Already ratcheted by `unfalsifiable-tier-guard`
  ([ipc-session-token-race](./ipc-session-token-race.md)); noted here because the attribute reads as
  a tier in review, and 19 commands therefore *look* governed.
- **`require_cloud_auth_sync` (`ipc_auth.rs:481-527`) is `#[allow(dead_code)]`** — the sync half of
  the cloud tier is unreachable, so `#[requires(cloud)]` on a sync fn is a compile error by design
  (`macros/src/lib.rs:83-90`) and the only cloud enforcement is the async path.
- **`management_api.rs:595-597` spells its scope set as three bare string literals** in the file that
  declares `SCOPE_EXECUTE` and `SCOPE_PROXY`. The mint side and the check side use two expressions
  of one vocabulary.
- **`useWorkspaceConnect.ts:87`'s `scope ?? svc.scopes.join(' ')`** stores the request as the grant
  when the provider returns nothing. Latent only because nothing reads it (D4).

---

## 8. Gaps

**Gap 1 — Nothing in the system produces the denominator, so no instrument can be built above it.**
Not a column, not a log line, not a metric. `credential_audit_log.decrypt` says a secret was
resolved; nothing says under which authority. `persona_tool_usage` records a tool name that is not
in the grant vocabulary. `external_api_keys` has no per-scope counter. **Every finding in §0 except
§0.1 and §0.2 is downstream of this one absence**, and it is one column on a row the app already
writes 9,431 times.

**Gap 2 — The census cannot express any form of this leaf's condition, and the reason is structural
rather than incidental.** The engine matches within one file by design. **Every instance of
asked-vs-used in this repo has its two halves in different files by construction** — the grant is a
registry, an allowlist, a seed or a column; the use is a handler somewhere else. That is not a
limitation of the patterns I tried; it is a property of what a grant *is*. Three composers have now
hit the same wall from three directions: [ownership-verification](./ownership-verification.md) §9
refused the tier join explicitly *"because the census matches within ONE file and this condition is
a join across two files"*; [sql-console](./sql-console.md) §8.5 refused the approval-dissolution
condition because *"no gate can see an approval that another file dissolves"*; and this leaf refuses
five candidates for the same reason (§9). **The instrument for a grant is a check, not a count.**

**Gap 3 — A tier cannot be derived from behaviour without a call graph, and the census has none by
design.** §0.2's behavioural markers are depth ≤ 1 textual probes and their recall is poor —
`fleet_spawn_session` spawns a permission-skipping child two files away and matches nothing. A real
answer needs "what does this handler transitively reach", which is a compiler question. The
achievable substitute is §2(f): make the *author* write the sentence, and let the absence of a
sentence be the signal.

**Gap 4 — There is no way to express "this capability set is advisory".** `persona_tools` looks
exactly like an enforcement table — an FK to a definition, a unique constraint, a config blob — and
is rendered into a prompt. Nothing in the schema, the type or the read path distinguishes a grant
that constrains from one that describes. The `connector_capability` pattern (`db_query.rs:634-637`)
is the answer at the connector layer and has no equivalent at the persona layer.

**Gap 5 — Narrowing the system key is blocked on Gap 1, and the block is now measured.**
[automated-credential-provisioning](./automated-credential-provisioning.md) Gap 4 hands the
per-consumer-handle design to [credential-injection-into-child](./credential-injection-into-child.md)
§4. Both are correct that it is the right answer. **Neither can proceed**: choosing per-consumer
scopes requires knowing which consumers reach which credentials, `credential_consumer_edges` is the
table for that, it has 0 rows, and the path that writes it has 0 callers. The ordering is forced —
record first, narrow second — and nobody has written that down until now.

**Gap 6 — The one grant surface with a widening ledger has it because it is made of key/value
settings.** `audit_setting_change` works because every settings write passes through one repo
function. There is no equivalent chokepoint for "a tool was granted", "a scope was added" or "a
command was listed", so extending P9 to the other four surfaces is four separate small edits rather
than one. That is cheap, and it is still four decisions nobody has been asked to make.

**Gap 7 — The §9 check cannot tell an over-grant from an under-grant.** It joins declaration against
enforcement and reports disagreement. It cannot say whether `github_list_repos` should be privileged
or should lose its attribute — 15 of the 23 deferred entries are annotated *"read-only; the
annotation is arguably the wrong tier"*, which is the operator saying the same thing. **Deciding a
tier requires knowing what the command reaches, which is Gap 3, which needs a call graph.** The
check makes the question visible; it does not answer it.

---

## 9. The missing gate

**The condition to enforce:** *a grant is expressed in two places that must agree, the agreement is
maintained by hand, and the two directions of disagreement fail in opposite ways — one silently
grants, the other silently denies.* Not "the gate does not fire" (that is
[ipc-session-token-race](./ipc-session-token-race.md)'s `unfalsifiable-tier-guard`); not "the caller
may not touch this row" (that is [ownership-verification](./ownership-verification.md)); not "the
grant is too wide" (that is a judgment, Gap 7). **The one thing here that is mechanically checkable
and that this repo gets wrong 61 times.**

### The condition, stack-free

> **The authority a thing declares and the authority a runtime enforces are two artifacts. Nothing
> makes them agree, and which way a disagreement fails can depend on something as incidental as
> whether the function is `async`.**

### I am NOT proposing a census rule, and here are the five measurements that decided it

| Candidate signal | measured | why declined |
|---|---|---|
| **`#[requires(privileged)]` async and absent from both allowlists** | **23 violating / 201 compliant**, 100 % structural precision | **A three-file join** — attribute in `commands/**`, allowlists in `ipc_auth.rs`, registration in `lib.rs`. The census matches within one file by design. **Already measured and refused on the same grounds by [ownership-verification](./ownership-verification.md) §9 (at 10/158, a different sweep date), and the attribute half is already ratcheted by `unfalsifiable-tier-guard` (34 files / 105 matches).** Refusing it a second time on the same reasoning is the right outcome; §9's check is where it belongs. |
| **a requested authority set containing both a broad member and its own narrower sibling** (`X` and `X.readonly`) | **4 pairs / 3 files** — `builtin_connectors.rs:761`, `:803`, and the two generated JSON mirrors of them | Exactly the leaf's condition and semantically 4/4 correct, but **2 of the 4 are a codegen mirror of the other 2**, so the true population is two literals in one file. A two-site rule is a to-do item. **Carried as D4 instead.** |
| **a grant read whose result flows into a formatter rather than a conditional** (D3's shape) | **12 matches / 7 files**, and — decisively — **the compliant population is empty**: `get_tools_for_persona` has 30 call sites and *none* feeds a conditional | **No positive control exists.** A control that returns 0 fails structurally by design, and per the doctrine a control returning ~0 means the pattern is not discriminating on what you think. **Carried as T2 instead.** |
| **`--dangerously-skip-permissions` as a hardcoded constant** | 12 argv sites, `--allowedTools` at 2 | **Already measured and refused by [agent-dispatch](./agent-dispatch.md) §9 at 11 of 12** — *"a gate firing on 11 of 12 members is a to-do list"*. The flag is deliberate on every execution lane. Not re-derived. |
| **a self-issued grant with no expiry** | 2 violating / 2 compliant | **Already refused by [automated-credential-provisioning](./automated-credential-provisioning.md) §9** — separating "the app chose forever" from "the user chose forever" needs the argument's provenance, not its text. |

**And the general reason, which is Gap 2 and is the contribution:** every countable form of
asked-vs-used has its two halves in different files, because that is what a grant is — a declaration
in a registry and an exercise in a handler. The census is the right instrument for *a shape that is
wrong wherever it appears*. A grant is only wrong *relative to something else*. **Three composers
have now hit this wall from three directions and all three refused; the next one should not spend a
wave rediscovering it.**

### The instrument: Rule 5 of `scripts/check-command-contract.mjs` — prototyped and run

Per this brief's calibration, `check-command-contract.mjs` is the repo's only locally-enforced
generated-artifact gate, and it is **90 % of this instrument already**: it parses `lib.rs`'s wrapped
`generate_handler!` block (`:55-72`) and walks every `.rs` file for `#[tauri::command]` (`:113-124`).
Rules 1–4 check the command *name* and its *payload*. **Rule 5 checks its tier.** It is an extension,
not a rival: same file, same walk, same error style, one more `errors.push`.

**Three assertions, all three directions:**

1. **Declared but not enforced** — annotated `#[requires(privileged|cloud)]`, registered, on neither
   allowlist, not on the deferral list. Async ⇒ zero enforcement; sync ⇒ fails closed on every call.
2. **Enforced but naming nothing** — an allowlist entry that matches no registered command. *"An
   entry that matches no command is a stale exemption: it protects nothing and hides the fact that
   it protects nothing."* **This direction is what the existing Rust test does not check.**
3. **The deferral list may only shrink** — an entry that is now enforced, no longer annotated, or
   unregistered is stale and must be deleted. (Ported verbatim from `ipc_auth.rs:1193-1210`, which
   already gets this right.)

**Preconditions first — assert the instrument before the result.** Modelled directly on
`ipc_auth.rs:1160-1168` and on `check-csp-hosts.mjs`'s two silent-zero incidents: fewer than 500
registered commands, fewer than 150 annotations, or `PRIVILEGED < 100 || CLOUD < 20` is a broken
walk, not a clean codebase, and exits 1 before any result is computed.

**Executed against the tree, exit codes captured directly, never through a pipe:**

| Induced fault | exit | what it printed |
|---|:---:|---|
| **(unmodified)** | **1** | `Allowlist entries name commands that are not registered … github_create_patch_release, openapi_parse_from_url, openapi_parse_from_content, openapi_generate_connector, create_execution` |
| annotation walk yields nothing | **1** | `[precondition] found only 0 #[requires(privileged\|cloud)] annotations under src-tauri/src — the source walk is broken, not the codebase suddenly clean.` |
| `lib.rs` handler block unparseable | **1** | `[precondition] parsed only 0 registered commands from lib.rs — the handler-block extractor is broken, not the app suddenly small.` |
| `PRIVILEGED_COMMANDS` parses empty | **1** | `[precondition] allowlists parsed as PRIVILEGED=0 CLOUD=50 — ipc_auth.rs's const extractor is broken.` |
| source root renamed away | **1** | `[precondition] found only 0 … under src-tauri/src/does_not_exist …` |
| with direction 2 satisfied (the 5 entries resolved) | **0** | `Command tier contract OK (1585 registered; 234 wrapper-enforced = 14.8%; 224 tier annotations; 23 deferred).` |

**It is red today**, on direction 2, on five real stale entries. Directions 1 and 3 are clean because
`DRIFT_BASELINE` is set-equal to the drift set — which is the finding, not the reassurance (§0.1).

**Where it runs:** `npm run check:contracts`, which is the first step of **`npm run check`** — the
PR self-review ritual in `.claude/CLAUDE.md`. **Deliberately not CI-only** (this brief's calibration:
`ci.yml` is red on 10 pre-existing failures) and **deliberately not only in `cargo test`**, which is
where the equivalent assertion lives today and which appears in neither lefthook hook.

**Relationship to the existing Rust test — it does not replace it.** `ipc_auth.rs:1149-1211` runs
inside the crate, sees the real constants rather than parsing them, and should stay. Rule 5 adds the
two directions it does not check (unregistered allowlist entries; registration as a join term) and
moves the whole assertion to a gate a developer actually hits. **When both exist, delete neither: a
constant-parsing check and a compiled check fail on different things, and this leaf is about exactly
that kind of pair.**

**How this instrument could still fail, stated so the next repo can re-derive it.** It keys on one
proc-macro attribute name, two `pub const … &[&str]` declarations, and one `generate_handler!`
invocation — all four are Tauri/Rust-specific idioms. A repo expressing tiers as a decorator, a
route-table column, a middleware chain or a YAML policy has the identical condition wearing something
this parser cannot see. **The portable part is the shape: enumerate every artifact that expresses the
grant, join them on the thing they both name, and assert the join is total in both directions.**
State which condition your proxy stands for so the next repo can re-derive a different one.

### The two conditions in this leaf I am refusing to instrument at all, with the reason

1. **Whether a grant is too wide** (D4, D5, D7) is a judgment that needs the usage record from Gap 1.
   No check can compute it and no human can, today, because the denominator is not stored. **The
   instrument this leaf actually wants is a query — grants held minus grants exercised — and Gap 1 is
   why it cannot be written.** That is the same shape [ownership-verification](./ownership-verification.md)
   §9 reached from the other side: *"a counter on every ownership assertion reporting how often it has
   denied … a check that has never denied anything is either unnecessary or broken, and nothing in the
   repo can tell you which."* **Two leaves, two years of authority code, one missing column.**
2. **Whether the tier matches what the handler reaches** (D2, D7) needs a transitive call graph
   (Gap 3). The achievable substitute is social and is already two-thirds adopted: require a prose
   reason on every allowlist entry, exactly as `scripts/census/lib/engine.mjs` requires one on every
   `exclude`. That could be added to Rule 5 as a warning the day someone decides that 74 entries
   explained by a directory name should be 0.

---

## 12. Corrections to the brief

**12.1 — The spine's `sides: client` does NOT hold; the honest label is `server`, and this is the
fourth consecutive inversion.** Of the nine §7 deviations, **seven are Rust** (D1, D2, D3, D6, D7,
D8, D9) including all three P0s; **one is genuinely two-sided** (D5 — a client literal list and a
server union that widens it); **one is client-only** (the D9 sub-item at `useWorkspaceConnect.ts:87`).
The §9 instrument is Rust-parsing. Every headline number in §0 is server-side. **This joins the
`sides: client` inversions recorded by
[credential-rotation-and-revocation](./credential-rotation-and-revocation.md) §12.1 and
[automated-credential-provisioning](./automated-credential-provisioning.md) §12.6, with the same
cause both of them named: the leaf was labelled from the surface a user consents on, and the subject
is what the engine does with the consent afterwards.** Three leaves under one parent, three
inversions, one mechanism — the label appears to be derived from where the *feature* is, not where
the *decision* is.

**12.2 — The spine's `convergence: mixed` HOLDS, and it is worth saying which half is which**, since
this is a rare survival among labels the campaign has mostly refuted. The **grant** half converges as
a unanimous absence: usage-against-grant **0 of 5**, attenuation **0 of 5** — physics, converging as
a disease, exactly the failure mode the doctrine warns an agreement-counting oracle will misread. The
**enforcement** half genuinely splits: default-deny at use **2 of 5**, read/write separation **2 of
5**, and the split is not random — it tracks whether the team wrote its reasoning down. **And on one
clause Personas is ahead of the entire fleet: recording a widening, 1 of 5, at the repository layer
(§6 clause 6, §3).** A `mixed` label that survives should be reported as loudly as one that fails.

**12.3 — The independent cohort is 3, not 5, and the exclusions matter differently.**
`personas-cloud` is a self-declared port with six *"Ported from …"* docstrings naming this repo's
engine files and a byte-identical `persona_credentials` schema — **but its exclusion is itself the
finding**: the port carried the execution engine and left the entire authorization apparatus behind
(`PRIVILEGED_COMMANDS`, `x-ipc-token`, `DesktopCapability`, the Ed25519-signed `EnclavePolicy` — all
zero counterpart), and it inverted the empty-list convention it *did* inherit. **A port that drops the
authorization layer while keeping the execution layer is strong evidence that authorization reads as
incidental complexity to a careful engineer** — the same shape as the scheduler port that dropped the
compare-and-set. `personas-web` is excluded on the honest ground that it has no scope system to audit
at all.

**12.4 — Four of the brief's six primed leads confirmed, one sharpened, one reframed.**

- *"37 of 38 Fleet IPC commands are Public… destroying a session is guarded; driving one is not."*
  **Confirmed exactly** (§0.5), and sharper than stated: `fleet_spawn_session` also forwards
  **caller-supplied argv** into the permission-skipping child (`pty.rs:369-371`), so "driving" a
  session is not even the widest ungated verb — *starting* one is.
- *"`approval_autopilot.rs` removed the human from every `use_connector` write… a grant widened by a
  note elsewhere, which is this leaf's central shape."* **Confirmed, and reframed by measurement.**
  It is the leaf's central shape *and it is the one case the app records* —
  `settings_audit_log` holds the `false→true` flip (2026-08-05) because `audit_setting_change` sits at
  the repository layer. **The brief predicted a gap and the measurement found the fleet's best
  answer.** The real finding is the asymmetry: that ledger covers one grant surface of five (§7 D8).
- *"12 spawn sites pass `--dangerously-skip-permissions`, one inside `build_cli_args` referenced at 75
  sites."* **Confirmed and not re-derived** —
  [credential-injection-into-child](./credential-injection-into-child.md) owns the count and
  [agent-dispatch](./agent-dispatch.md) §9 already measured and refused the gate at 11/12. **This
  leaf's addition is the other half of the ratio: `--allowedTools` at 2 sites, neither an execution
  lane, against 210 tool grants with a 4.3 % exercise rate.**
- *"`classify_db_query` is registered, privileged, typed — and has zero callers."* **Confirmed** (it
  is `ipc_auth.rs:227`); owned by [sql-console](./sql-console.md) §7.E and not re-derived. **This
  leaf's angle: the privileged tier is being spent on a command nothing calls, which is an
  over-grant of a different kind.**
- *"63 of 78 personas declare `Codebase`, and client/server normalize that label differently on 5 of 5
  live values."* **NOT REPRODUCED, and the reason is a correction the brief needs.** `personas` has no
  `capabilities` column and no `Codebase` value appears in any persona-scoped table. What exists is
  three `service_type = 'codebase'` **credentials** (`Codebase — bookkeeper`, `— ai-paralegal`,
  `— gravitone`) and `persona_tools`, a different table with a different vocabulary. The
  normalization claim belongs to
  [credential-readiness-resolution](./credential-readiness-resolution.md), not here. **The capability
  grant this leaf found instead is a much better instance: 210 edges, 9 exercised, and a usage
  ledger sitting right next to it that nobody has joined.**
- *"Two Google OAuth grants are expired and cannot be re-authorised from the UI — ask what scopes they
  were granted and whether anything records what was actually used."* **Both halves answered.** The
  scopes are recorded, in plaintext, and are readable: gmail holds `gmail.modify`/`gmail.send`/
  `gmail.readonly`/`userinfo.email`/`openid`; calendar holds `calendar.events`/`calendar.readonly`/
  `userinfo.email`/`openid`. **Nothing records what was used — and nothing reads the record of what
  was granted either, which is the stronger finding and became P7.**

**12.5 — A correction owed to a published path.**
[`ownership-verification`](./ownership-verification.md) **Gap 6 says the right instrument is "a Rust
unit test that walks the registered command list and asserts the two agree, **which does not
exist**."** It exists: `ipc_auth.rs:1149-1211`, with a `DRIFT_BASELINE` of 23 and a
precondition-first structure the composer would have admired. **The honest finding is sharper than
the published one and worse:** the test exists, is well built, **runs at neither lefthook hook nor in
`npm run check`**, is baselined at exactly its current drift set so it has zero headroom, and does
not check the direction that is red today. *"It does not exist"* invites "write one"; the true state
invites "move the one you have, and add the missing direction," which is §9.

That path's Gap 6 also reports **"0 entries naming a nonexistent command — that last number is luck,
not a gate."** Measured here: **the functions all exist, but 5 entries name commands that are not
registered in `generate_handler!`**, so they gate nothing. The number was right about function
existence and the conclusion — luck, not a gate — was right for a different reason than it gave.

**12.6 — A correction owed to my own methodology, recorded because it is the kind that hides.** My two
implementations disagreed by exactly **1** on the registered-command count (1,585 vs 1,584). The
missing command was `greet` — the **first** entry in the handler list. Implementation B sliced from
the start of `tauri::generate_handler![` and then skipped tokens beginning `tauri::`, so the guard
that removed the macro name also removed the command fused to it by the leading split. **An off-by-one
at the boundary of the very construct being parsed, in the direction that looks like a rounding
difference.** The repo's own `check-command-contract.mjs` avoids it by capturing the group rather than
slicing from the match start. Everything else agreed exactly: 229 / 1,356 / 184 / 50 / 243 / 23 / 33 /
5, and 210 / 9 / 462 recomputed in pure SQL against Python set logic. **Two implementations agreeing
on twelve numbers and disagreeing on one is not a rounding error to reconcile; it is the one place to
look.**

**12.7 — And the finding the brief did not ask for, which turned out to be the head.** The brief asked
me to find the population and the discriminator for over-granting. The population is everywhere and
the discriminator for the IPC surface is *which directory the file is in* (9.77×, against 0.99× for
spawning a subprocess). But the thing that makes all of it unfixable is not a bad discriminator — it
is that **the app has never recorded, for any grant, that it was used.** 9,431 credential resolutions
with no authorizing grant; 210 tool grants with a 4.3 % exercise rate discovered by joining two tables
nobody has joined; 1,029 API keys and one recorded request; and a correct, tested, exhaustive
`BrokerGrant` type whose whole purpose is to answer this question, with zero rows. **I found it by
running the join, not by reading the code — the two tables sit four rows apart in the schema and no
query in the tree relates them.** The dangerous thing in a least-privilege leaf is not the grant that
is too wide. It is that nobody can prove any grant is too wide, so the only safe edit is always to
widen.
