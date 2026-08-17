# Connector setup panel

> **Situation node:** `integrations-security/credential-readiness/connector-setup-panel` ·
> spine `sides: "client"` · `twoSided: true` · `fusedAcrossSides: false` ·
> `convergence: "mixed"` · `risk: medium` · `recurrence: 9` ·
> dimensions: **ui · function · security · resilience** ·
> merged from *"Plugin connection setup panel"* + *"Guided setup instructions"*.
>
> **Composed 2026-08-17** against `master @ 2a874e692`. Ground-truth sweep: the whole
> vault credential-form stack (`CredentialTemplateForm` → `TemplateFormBody` →
> `CredentialEditForm` → `ConnectionTestSection` → `HealthcheckResultDisplay`, read end
> to end), the three Rust test doors (`crud.rs:329/377`, `credential_design.rs:126`), the
> healthcheck engine (`engine/healthcheck.rs`, 2,117 lines), 32 further connection-setup
> surfaces enumerated across `src/features/**`, the live `connector_definitions` and
> `persona_credentials` tables, and a convergence sweep of all five sibling checkouts.
>
> **Data provenance.** Credential and connector rows **were not touched by the
> 2026-08-17 purge** — the live database is the correct source for them and every count
> below is *current*, not historical. Persona-scoped counts come from
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`, and are labelled
> where they appear. See [§12.1](#121-register-entry-55-verified--the-credentials-are-intact-the-owners-are-gone).

---

## §0 — Headline

**The engine produces a three-valued verdict and the panel that establishes the
connection cannot spell it.** `HealthProbeState` is `Verified | Unverifiable | Failed`,
required on the wire type, and its own Rust doc comment promises *"this is NOT a
failure — it renders neutral/muted, never a green 'healthy' check"*
(`healthcheck.rs:26-28`). Nine prop slots along the setup path re-declare the verdict as
an inline `{ success: boolean; message: string } | null`, `Unverifiable` is constructed
with `success: true` (`healthcheck.rs:81`), and the terminal renderer branches on that
boolean — so an unverifiable credential paints a green `CheckCircle`. **8 of the
operator's 25 live credentials are `unverifiable`; 21 of 134 connectors can never
produce anything else.**

**And the panel's diagnostic layer is aimed at the wrong producer.**
`translateHealthcheckMessage` has four transport arms — timeout, DNS, connection-refused,
unreachable — all gated on `raw.includes('request failed:')`. The real probe emits
`"Connection failed: {e}"` (`healthcheck.rs:1156`). The **only** producer of
`request failed:` reaching this translator in 963 Rust files is the LLM design door
(`credential_design.rs:284`). Of **13 message-producing sites in the real healthcheck
engine, exactly one** reaches a diagnostic arm; the transport-failure class — every DNS,
TLS, timeout and SSRF-policy rejection — lands on the fallback, which sets
`friendly = raw`, which in turn makes `hasDifferentRaw` false and suppresses the
"Technical details" disclosure that would have shown the same string again. The user
gets one raw `reqwest` sentence and no suggestion.

**The two states the panel most needs, it has never had.** Two credentials in the live
vault carry `needs_reauth: true` with OAuth grants that expired **99 and 76 days ago**.
The metadata to say *"your Google token expired 99 days ago — re-authorize"* is present
and parsed (`CredentialLedger`), and it is rendered on the credential **card**
(`ReauthBanner.tsx:80`). The setup panel — the one surface with an Authorize button —
renders those two as an ordinary red box.

---

## §1 — Trigger

You are in this situation when you would say or type any of:

- *"Add a connection tab for &lt;service&gt;."*
- *"Where does the user paste the API key and press Test?"*
- *"Why does Test connection go green when nothing was tested?"*
- *"The panel says it failed but not why."*
- *"Should Save be disabled until the test passes?"*
- *"Where do the setup instructions for this connector come from?"*

**The "if you are about to write X" test:** if you are about to write
`result.success ? <green/> : <red/>` over the outcome of a connection attempt, or
`healthcheckResult?: { success: boolean; message: string } | null`, or a `<button>Test
connection</button>` whose handler calls anything other than the production request
path — you are in this situation and you are about to commit its canonical defect.

---

## §2 — The one way

**Model the panel as a closed state machine over the connection's real state space,
give the failure arm the step that failed, and make the test call the production door.**

Concretely, in this order. (a) Declare a **discriminated union** for the panel —
`type PanelState = { kind: 'unconfigured' } | { kind: 'testing' } | { kind: 'verified'; … }
| { kind: 'unverifiable'; reason } | { kind: 'failed'; step; detail } | { kind: 'expired'; expiredAt }
| { kind: 'error'; message }` — and switch on `kind` exhaustively, so an unhandled state
is a compile error rather than a missing branch. `CliConnectionPanel`'s seven-arm
`PanelState` (`CliConnectionPanel.tsx:17-24`) is the pattern and the only complete
instance in this repo. (b) **Never re-declare the verdict inline** — a panel prop that
holds a probe outcome is typed `HealthcheckResult`, the wire type whose `state` field is
*required*; an inline `{ success, message }` silently discards the third value.
(c) **Produce the failure with a step label**, not a sentence — the backend already does
this exactly once, in `cloud.rs:314-537`, which emits `URL format` / `DNS resolution` /
`TLS handshake` / `HTTP response` / `API compatibility`, each with `passed`, `detail` and
`durationMs`; a panel renders those as rows, and the user learns which half of the
problem is theirs. (d) **The Test button calls the same function a real call calls**, with
the same auth resolution, the same client and the same allowlist — `run_healthcheck` does
(it shares `connector_strategy::registry()` and `resolve_auth_token` with production);
`test_credential_design_healthcheck` does not, and must never be the door a shipped
connector's Test button reaches. (e) **Invalidate the verdict the instant an input
changes** — a green tick above an edited field is a lie the Save gate then trusts.
(f) **Show the guide from the connector, not from a suggestion**: `metadata.setup_guide`
is present on 120 of 134 connectors and `docs_url` on 125; render them, and stop
re-deriving instructions per surface.

The gate on Save follows from (a), not from `success`: **Save is blocked by `failed` and
`expired`, permitted by `verified`, and permitted-with-disclosure by `unverifiable`.**
Reading `!result.success` collapses those three decisions into one and gets
`unverifiable` right only by accident.

---

## §3 — Mandated primitives

| Primitive | `path` | What it gives you |
|---|---|---|
| `PanelState` discriminated union | `src/features/vault/sub_catalog/components/picker/CliConnectionPanel.tsx:17-24` | Seven closed arms (`checking`, `not_installed`, `installed_unverified`, `verifying`, `unauthenticated`, `authenticated`, `error`). Not-installed cannot be confused with not-authenticated, because they are different variants carrying different payloads |
| `HealthcheckResult` | `src/lib/bindings/HealthcheckResult.ts:5` | `{ success, message, state }` with `state` **required**. This is the wire type; use it as the prop type |
| `HealthProbeState` | `src-tauri/src/engine/healthcheck.rs:33-50` + `src/lib/bindings/HealthProbeState.ts` | The three-valued verdict and its stable `token()` for persistence |
| `readCredentialHealthState()` | `src/lib/credentials/healthState.ts:48` | Four-valued read (`verified \| unverifiable \| failed \| untested`) off persisted metadata, with the legacy-boolean fallback handled once |
| `deriveReadiness()` / `STATUS_CONFIG` | `src/features/agents/sub_connectors/libs/connectorTypes.ts:86-149` | Five-valued readiness plus the icon/tone map. `unverifiable` is a `ShieldQuestion`, deliberately not a check |
| `isStaleResult()` | `src/features/agents/sub_connectors/libs/connectorTypes.ts:31-43` | The 24-hour staleness dimension. The only implementation in the tree |
| `translateHealthcheckMessage()` | `src/features/vault/sub_catalog/components/design/CredentialDesignHelpers.ts:262-319` | Raw backend message → `{ friendly, suggestion, raw }`. Route every failure through it — and read §7.2 before trusting its transport arms |
| `resolveErrorTranslated()` | `src/i18n/useTranslatedError.ts` | Registry-backed friendly message for a thrown `AppError`. `CliConnectionPanel:50` is the only setup panel that uses it |
| `SetupGuideSection` | `src/features/vault/sub_credentials/components/forms/SetupGuideSection.tsx` | Numbered collapsible over `metadata.setup_guide` |
| `buttons/AsyncButton` / `Button loading=` | `src/features/shared/components/buttons/` | A **real** spinner on the Test button. `feedback/LoadingSpinner` renders `null` |
| `cloud_diagnose` step vector | `src-tauri/src/commands/infrastructure/cloud.rs:314-537` | `{ label, passed, detail, durationMs }[]` — the shape a failure arm should carry |

**Do not invent** a new verdict enum, a new "connected" boolean, or a per-plugin
`connectionResult`. Four already exist and they do not agree; see §7.1.

---

## §4 — Steps

1. **Write down the state space before the JSX.** For this domain it is at least:
   `unconfigured`, `untested`, `testing`, `verified`, `unverifiable`, `failed`, `expired`
   (`needs_reauth`/`oauth_token_expires_at` in the past), and `stale` (verified longer ago
   than `STALE_HEALTHCHECK_MS`). Eight. If your panel has two, it will render six of them
   wrongly.
2. **Ask whether the type can make the wrong render impossible.** Here it can, and this
   step outranks §9: a discriminated union plus an exhaustive `switch` turns "we forgot
   the unverifiable arm" from a runtime appearance into a compile error. See §9.0 for the
   qualifications that apply and the one that bites.
3. **Type the verdict prop with `HealthcheckResult`.** Not an inline object. The wire
   type's `state` is required, so the narrowing cannot happen by omission.
4. **Wire the test to the production door.** `healthcheck_credential` for a stored
   credential, `healthcheck_credential_preview` for unsaved values. Both land in
   `execute_healthcheck_request_with_strategy` with the same strategy registry, the same
   SSRF-safe client and the same `allow_private` decision production uses.
5. **Give the failure a step.** At minimum distinguish *policy rejection* (an
   `AppError` from `validate_template_url` / `validate_healthcheck_url` — the request was
   never sent), *transport* (`reqwest::Error`), and *protocol* (an HTTP status). Today
   all three arrive at the panel as one string and the first two are indistinguishable
   from a wrong password.
6. **Bind invalidation to the same event that changes the inputs.** `onValuesChanged →
   invalidate()`. Six panels do this; six comparable ones do not (§7.4).
7. **Render the guide from the connector row**, and link `docs_url`. Then stop — the
   catalog already carries it for 120 of 134 connectors.
8. **And then stop.** Do not add a second "connected" flag to a store from inside the
   panel. `obsidian-brain/sub_setup/SetupPanel.tsx:144-148` records in a comment exactly
   what happens when you do: *"Flipping global `obsidianConnected` / `obsidianVaultName`
   here used to leak: switching tabs after a successful test (without Save) made every
   consumer believe the vault was active."* A test result is not a configuration.

---

## §5 — Anti-patterns

**A1 — `success ? green : red` over a three-valued verdict.**
*Failure mode:* the middle value is invisible, and which end it lands on is decided by
whoever wrote the constructor. Here `unverifiable` is `success: true`
(`healthcheck.rs:81`), so it renders as a success — the exact opposite of the promise in
the doc comment eleven lines above it. 8 of 25 live credentials are in this state.

**A2 — Re-declaring the verdict as `{ success: boolean; message: string }` in a prop.**
*Failure mode:* structural typing accepts the richer object, so nothing errors; the field
simply becomes unreadable downstream. Nine slots do this. The information does not
survive one hop.

**A3 — A diagnostic table gated on a string the producer does not emit.**
*Failure mode:* the gate is silent. The arms exist, look thorough in review, and never
run. Four of `translateHealthcheckMessage`'s arms are in this state and the class of
failure they cover is the one the engine most often produces.

**A4 — A Test button whose code path is shorter or more privileged than a real call.**
*Failure mode:* the green tick certifies a different program. `test_credential_design_healthcheck`
spawns the Claude CLI for up to 300 s to *invent* an endpoint from the connector's name,
label and field keys — and is never handed the connector's stored `healthcheck_config`,
which exists for 113 of 134 connectors. Whatever it proves, it is not that the shipped
connector works.

**A5 — A healthcheck template that never references a credential field.**
*Failure mode:* Test passes for any value, including a wrong one. Three connectors
(`kalshi`, `pubmed`, `semantic_scholar`) declare an `api_key` field whose value appears in
neither the endpoint, the headers, nor the body of their probe.

**A6 — Two doors with opposite conventions for "no test is possible".**
*Failure mode:* the same condition unblocks Save on one path and permanently blocks it on
the other. Engine: `unverifiable(...)` → `success: true`. Design door: `config.skip` →
`{"success": false, "message": "Claude skipped automatic healthcheck: …"}`
(`credential_design.rs:178-183`), against a Save gate of `!health.result?.success`.

**A7 — Leaving a verdict on screen above an edited field.**
*Failure mode:* the Save gate reads a verdict for values that no longer exist. Six panels
invalidate; six do not.

**A8 — `{busy ? <LoadingSpinner/> : <Icon/>}` on the Test button.**
*Failure mode:* `feedback/LoadingSpinner` renders `null`. The icon disappears and nothing
replaces it, so the panel looks broken at the exact moment the user is least sure whether
their click registered. `ConnectionTestSection.tsx:43-47` is this, on the repo's primary
Test button.

**A9 — Persisting `healthcheck_last_tested_at` and never showing it.**
*Failure mode:* a verdict from 40 days ago is presented as current. Every panel that
tests writes the timestamp (`useCredentialHealth.ts:176-182`); exactly one surface in the
app renders staleness, and it is not a setup panel.

---

## §6 — Evidence

**The one site to copy: `src/features/vault/sub_catalog/components/picker/CliConnectionPanel.tsx`.**
It is the only connection panel in the repo built on a discriminated union
(`:17-24`), and every consequence follows from that one decision: *not installed* and
*not authenticated* are separate arms with separate remedies (install hint + copy button
at `:159-188`; `spec.auth_instruction` + Verify at `:190-212`); the Save gate reads the
variant, not a boolean — `disabled={state.kind !== 'authenticated' || saving || !credentialName.trim()}`
(`:271`); errors go through `resolveErrorTranslated` (`:50`) instead of a raw string; and
the guide (`spec.docs_url`, `spec.install_hint`, `spec.auth_instruction`) comes from the
spec rather than from the component.

Secondary exemplars, each for one clause:

| Clause | Site | What it proves |
|---|---|---|
| the failure names its step | `src-tauri/src/commands/infrastructure/cloud.rs:314-537` + `CloudConnectionForm.tsx:161-199` | five labelled steps with `passed`/`detail`/`durationMs`, rendered as rows. The only per-step failure UI in the product |
| a stored-but-unverified state is *not* green | `src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:68-74,:564-574` | `'stored'` is rendered deliberately neutral, with the rationale in the comment: *"Previously this used emerald visuals that misled users into thinking auth was verified"* |
| `undefined` gets its own tone | `src/features/teams/sub_factory/passport/improve/EnvConnectorSlot.tsx:81-85` | `boundHealth === true ? success : boundHealth === false ? error : neutral` — three tones for three facts |
| the middle verdict gets its own icon | `src/features/agents/sub_connectors/components/connectors/ConnectorStatusCard.tsx:26-34` | `unverifiable: ShieldQuestion`, never a check |
| a test result is not a configuration | `src/features/plugins/obsidian-brain/sub_setup/SetupPanel.tsx:139-154` | the comment records the leak that made this rule, and the fix keeps the result local until Save |
| invalidation bound to the edit | `src/features/vault/sub_credentials/manager/CredentialManagerViews.tsx:89-93` | `onValuesChanged` resets OAuth *and* the healthcheck together |
| a real busy state on the action | `src/features/vault/shared/playground/tabs/OverviewTab.tsx:118-125` | `<Button loading={isHealthchecking} disabled={isHealthchecking}>` — the correct half of the spinner boundary |
| the test shares production's plumbing | `src-tauri/src/engine/healthcheck.rs:469-517` | the probe resolves auth through `connector_strategy::registry()` and takes the OAuth refresh lock, exactly as a real call does |

**Live-vault ground truth** (`persona_credentials`, 25 rows, current — credentials
survived the purge):

| `healthcheck_last_state` | rows |
|---|---:|
| `verified` | 15 |
| `unverifiable` | **8** |
| `failed` | 2 |

Both `failed` rows (`google_calendar`, `gmail`) additionally carry `needs_reauth: true`
and `oauth_token_expires_at` in the past by **99** and **76** days.

**Connector catalog** (`connector_definitions`, 134 rows, current): **196** declared
fields; `healthcheck_config` on **113**, absent on **21**; `setup_guide` on **120**;
`docs_url` on **125**; `setup_instructions` on **1**; `setup_url` on **0**;
`rate_limit_rpm` on **0**.

---

## §7 — Deviations

### 7.1 The verdict is narrowed to a boolean at nine slots

Every slot below re-declares the outcome as `{ success: boolean; message: string } | null`.
`HealthcheckResult` (`src/lib/bindings/HealthcheckResult.ts:5`) is the wire type and its
`state` field is **required**; these declarations are structurally compatible and
therefore silent.

| Site | Prop |
|---|---|
| `src/features/vault/sub_credentials/components/forms/ConnectionTestSection.tsx:10` | `result` |
| `src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx:23` | `oauthPollingMessage` |
| `src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx:27` | `healthcheckResult` |
| `src/features/vault/sub_credentials/components/forms/OAuthSection.tsx:15` | `pollingMessage` |
| `src/features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx:63` | `oauthPollingMessage` |
| `src/features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx:74` | `healthcheckResult` |
| `src/features/vault/sub_catalog/components/forms/TemplateFormBody.tsx:26` | `oauthPollingMessage` |
| `src/features/vault/sub_catalog/components/forms/TemplateFormBody.tsx:35` | `healthcheckResult` |
| `src/features/agents/sub_connectors/components/automation/AutomationCard.tsx:29` | `testResult` |

The terminal renderer is `HealthcheckResultDisplay.tsx:6`, whose signature is
`{ success, message }: { success: boolean; message: string }` and whose first statement is
`if (success) return <green CheckCircle …>`. `unverifiable` arrives with `success: true`.

`useCredentialHealth.HealthResult` (`useCredentialHealth.ts:37-48`) *does* carry
`state?`, so the value is present in the store and dies at the prop boundary. Note also
that `checkDesign` (`:211-214`) constructs its `HealthResult` **without** `state` at all —
the design door never produces one.

**Four surfaces model this correctly and none of them is a setup panel:**
`connectorTypes.ts` (5 readiness values + `stale`), `healthState.ts` (4 values),
`ConnectorStatusCard` (6 UI keys), `ConnectedServicesWidget`. The knowledge exists in the
codebase and did not cross into the component that owns the transition — the same
transfer failure [`entity-picker`](./entity-picker.md) measured for truncation
disclosure.

### 7.2 Four of the failure translator's arms cannot fire from a real probe

`translateHealthcheckMessage` (`CredentialDesignHelpers.ts:262-319`) opens its network
family with `if (raw.includes('request failed:'))` and nests timeout / DNS /
connection-refused / unreachable inside it. Producer inventory, hand-verified against
`src-tauri/src/engine/healthcheck.rs` above its first `#[cfg(test)]` at `:1495`:

| Producer | Text | Arm it reaches |
|---|---|---|
| `:231`, `:293`, `:354` | `"{} is not installed — install it and try again"` | fallback |
| `:275` | `"{} is installed and authenticated"` | fallback (success) |
| `:282` | `"{} is installed but not authenticated — run \`{} auth\` …"` | fallback |
| `:308` | `"{} timed out — the tool may be unresponsive"` | fallback |
| `:349` | `"{label} is installed{path_info}"` | fallback (success) |
| `:425` | `verify.message` from `cli_capture::run_verify` | opaque |
| `:461`, `:544` | `"Connection type does not support HTTP healthcheck -- credentials stored"` | fallback |
| `:1129` | `"Connection successful (HTTP {})"` | success branch, untranslated |
| `:1143` ← `:1142` | `"Service returned HTTP {}"` | **the HTTP-status family** |
| `:1157` ← `:1156` | `"Connection failed: {e}"` | fallback |

**Thirteen sites; one reaches a diagnostic arm.** The only producer of `request failed:`
that reaches this translator anywhere in the tree is `credential_design.rs:284`
(`"Claude healthcheck request failed: {}"`) — the LLM design door. So the four arms
written for transport failure run only for the door that is not the product.

The consequence compounds: the fallback returns `{ friendly: raw, suggestion: '' }`, so
`hasDifferentRaw` (`HealthcheckResultDisplay.tsx:10`) is false and the *"Technical
details"* disclosure is not rendered either. A DNS failure shows one raw `reqwest`
sentence with no suggestion and no disclosure.

Note that `:308` is the sharpest instance: the engine has a **timeout** message and the
translator has a **timeout** arm, and they cannot meet.

### 7.3 The design door is a different program

`ConnectorCredentialModal.tsx:90-96` routes its Test button to
`health.checkDesign(…, { name, label, fields }, values)` →
`test_credential_design_healthcheck` (`credential_design.rs:126`), which:

- **spawns the Claude CLI** (`run_claude_prompt(…, 300, …)`, `:155`) to generate a
  healthcheck config from the connector's *name, label and field keys*;
- is **never given** the connector's stored `healthcheck_config`, which exists for **113
  of 134** connectors — the caller's third argument is literally `{ name, label, fields }`;
- returns `success: false` when the model declines (`:169-183`), against a Save gate of
  `saveDisabled={hasHealthcheck ? !health.result?.success : false}` (`ConnectorCredentialModal.tsx:201`) —
  so "no test is possible" **blocks Save permanently** here, and **unblocks it** on the
  engine path;
- redeems the OAuth session server-side (`:139-145`) and fires a real authenticated
  request at a model-chosen URL. The SSRF defences are present and correct
  (`validate_template_url`, `validate_field_values`, `validate_healthcheck_url`,
  `build_ssrf_safe_client`) — this is not a hole, it is a **different program being
  certified than the one that will run**.

`CredentialSchemaForm.tsx:101` (MCP / custom / **database** credentials) uses the same
door.

### 7.4 Save-gate and invalidation coverage are inconsistent

| Panel | Save gated on the test | Verdict invalidated on edit |
|---|---|---|
| `ConnectorCredentialModal.tsx:201` | yes | yes (`:200`) |
| `CredentialTemplateForm.tsx:188-193` | yes | yes (`CredentialManagerViews.tsx:89-93`) |
| `design/phases/PreviewPhase.tsx:173` | yes | yes (`useCredentialDesignOrchestrator.ts:142-148`) |
| `CliConnectionPanel.tsx:271` | yes | n/a (no verdict-affecting field) |
| `autoCred/steps/ReviewActions.tsx:149` | yes | no |
| `obsidian-brain/sub_setup/SetupPanel.tsx:376` | yes | yes (`:250`, `:226`, `:135`) |
| `CredentialSchemaForm.tsx:209-219` | **no** | yes (`:214`) |
| `playground/tabs/OverviewTab.tsx` | **no** | **no** (`:108` resets OAuth only) |
| `CloudConnectionForm.tsx:119` | **no** | **no** — diagnostics survive an edited URL/key |
| `settings/sub_notifications/WebhookSubscriptionsPanel.tsx:354` | **no** | **no** |
| `settings/sub_byom/ByomApiKeyManager.tsx:481` | **no** | **no** |
| `agents/.../channels/NotificationChannelCard.tsx` | **no** | **no** |
| `templates/.../QuickAddCredentialModal.tsx:336` | fused (test-then-save) | **no** |

`CredentialSchemaForm` is the one worth naming: it is the panel for **database** and
**MCP** credentials, it runs a healthcheck, it records `healthcheck_passed:
health.result?.success === true` (`:157`), and it does not gate Save on it.

### 7.5 Panels that render fewer states than the domain has

| Panel | States it can render | Missing |
|---|---|---|
| `ConnectionTestSection` + `HealthcheckResultDisplay` | 2 (+1 invisible busy) | unverifiable, untested, expired, stale |
| `playground/tabs/OverviewTab.tsx:141-150` | 2, as literal `OK:` / `FAIL:` — and it bypasses `translateHealthcheckMessage` entirely | everything else |
| `vault/sub_databases/tabs/TableActions.tsx:6-45`, `TableSearch.tsx:53-89` | 2, raw truncated message, no translator | everything else |
| `obsidian-brain/sub_setup/SetupPanel.tsx:268-290` | 2 (`connectionResult.valid`) | untested-vs-failed, stale |
| `companion/sub_setup/BrowserBridgePanel.tsx:58` | 2 (`connected ? success : dim`) | checking, never-paired, error — the status error is swallowed at `:27` |
| `gitlab/components/GitLabConnectionForm.tsx` | 3, and no failure arm at all | any failure |
| `settings/sub_api_keys/McpServerInfoPanel.tsx:79-92` | 3 (`checking`/`running`/`down`) — named honestly | a reason |
| `settings/sub_byom/ByomProviderList.tsx:73` | 4 (`idle`/`testing`/`pass`/`fail`) | unverifiable, stale |
| `CloudConnectionForm.tsx` | 5 + per-step rows | untested-vs-stale |
| `CliConnectionPanel.tsx:17-24` | **7** | — |

### 7.6 Three healthchecks that cannot fail on a wrong credential

Replayed over all 113 stored `healthcheck_config` blobs: **4** never reference a declared
field, a `{{base64(...)}}` pair, or an auth token in their endpoint, headers or body.

| Connector | Declared fields | Probe references |
|---|---|---|
| `kalshi` | `api_key` | none |
| `pubmed` | `api_key` | none |
| `semantic_scholar` | `api_key` | none |
| `arxiv` | *(none)* | none — correctly unauthenticated |

The first three show a green *"Connection successful (HTTP 200)"* for any value the user
types, including a wrong one, and — because Save is gated on that success — for a
credential that will fail at first use.

### 7.7 The Test button's busy state renders nothing

`ConnectionTestSection.tsx:43-47` is
`{isTesting ? (<LoadingSpinner />) : (<Activity className="w-4 h-4" />)}`.
`feedback/LoadingSpinner` renders `null` — read in full during composition: the body is
`if (label) return <span role="status" className="sr-only">{label}</span>; return null;`,
over a comment declaring *"Spinners are intentionally disabled app-wide. The component
stays for import compatibility but renders nothing."* No `label` is passed here, so the
component emits nothing at all. During the test the icon vanishes and nothing takes its
place. The same construction appears at
`obsidian-brain/sub_setup/SetupPanel.tsx:205,:262,:380`.

The app-wide disabling is deliberate and is *not* what is being criticised — the fix is
not to re-enable that shim but to use the primitive that already carries a real spinner
for exactly this case: `buttons/Button loading={isTesting}` or `buttons/AsyncButton`.
`playground/tabs/OverviewTab.tsx:118-125` does it correctly on the same action, in the
same feature.

This site is **not** matched by the published `null-spinner-busy-state` census rule — see
[§12.3](#123-a-correction-owed-to-manual-test-fire-the-spinner-rule-under-reports-by-35).

### 7.8 Staleness is persisted everywhere and rendered nowhere in a setup panel

`useCredentialHealth.checkStored` writes `healthcheck_last_tested_at` on every stored
test (`:176-182`), and `HealthResult.isStale` exists (`:47`). The only surface that reads
either is `ConnectorStatusBadges.tsx:102-122`, driven by `isStaleResult` /
`STALE_HEALTHCHECK_MS` (`connectorTypes.ts:31-43`). All 25 live credentials happen to
carry a same-day timestamp today, so this is currently latent — but nothing in the
panel would change if it were not.

### 7.9 `vault_status()` is typed against an orphan binding

`CredentialEditForm.tsx:77` calls `vaultStatus()`, declared
`invoke<VaultStatus>("vault_status")` (`src/api/vault/credentials.ts:100`). The Rust
command returns `serde_json::Value` (`crud.rs:427`) and **no `VaultStatus` type exists in
any `.rs` file**. The form's `FormActions` renders vault trust state off a type nothing
projects. This is one of the 29 orphan bindings the root `CLAUDE.md` records; it is named
here because it sits on the setup path.

---

## §8 — Gaps — what the primitives genuinely cannot do

**G1 — There is no "expired" or "revoked" verdict, at any layer.**
`HealthProbeState` has three variants and none of them is *the grant was withdrawn*. The
information exists — `needs_reauth`, `needs_reauth_at`, `oauth_token_expires_at`,
`oauth_refresh_fail_count`, all typed in `CredentialLedger.ts:17` — but it lives beside
the verdict, not inside it, so a panel that renders the verdict cannot reach it without
a second read. Consequence: an expired Google grant is a generic `failed`, and the panel
that owns the Authorize button is the one place that does not say so.
**This is upstream of §7.5 and of half of §7.1** — several panels have "only two states"
partly because the fourth and fifth states are not expressible in the type they are
handed.

**G2 — The engine cannot report *which step* failed, because it does not have steps.**
`execute_healthcheck_request_with_strategy` is one `request.send()` in a `match`. A
policy rejection returns `Err(AppError)` *before* the match and therefore never becomes a
`HealthcheckResult` at all — it surfaces through `useCredentialHealth.check`'s catch as
`{ success: false, message: e.message, state: 'failed' }`, indistinguishable from a
401. The shape that solves this exists one module away
(`cloud.rs` `DiagnosticStep`), and porting it is a backend change, not a panel change.

**G3 — `unverifiable` is a property of the connector, not of the credential, and is
computed per probe.** It is derivable statically — 21 of 134 connectors have no
`healthcheck_config` and no local probe — so the panel could say *"this connector cannot
be verified"* **before** the user presses Test, rather than after. Nothing exposes that
fact at form-render time; `ConnectorCredentialModal.tsx:88` computes
`hasHealthcheck` for the Save gate and never renders it.

**G4 — There is no way to declare that a healthcheck must exercise the credential.**
`HealthcheckConfig` has `endpoint`, `method`, `headers`, `body`, `expected_status`,
`skip`. Nothing requires a `{{field}}` reference, and §7.6's three connectors are the
result. A `#[serde(deny_unknown_fields)]`-style constraint cannot express it either;
it needs a validation over the *pair* (fields, template).

**G5 — `translateHealthcheckMessage` is a string classifier over a cross-language
boundary, and no instrument in the repo checks that the two sides agree.** This is the
same shape [`client-rule-mirroring`](./client-rule-mirroring.md) named: each side is
internally consistent and there is no test that fails when one moves. It is not fixable
inside the translator; it needs either a shared error-code enum crossing IPC (the real
fix) or a check that every `raw.includes(...)` literal occurs in the Rust tree.

---

## §9 — The missing gate

### 9.0 Prefer a type — and the qualification that applies here

The primary fix is a **type, not a gate**, and it is available: replace the panel's
boolean pair with a discriminated union and switch on it exhaustively, exactly as
`CliConnectionPanel:17-24` already does. That makes "we forgot the unverifiable arm" a
compile error rather than a rendered lie, and it makes A1, A2 and half of §7.5
unspellable.

Holding it against the doctrine's seven qualifications:

- **Q1 (a required prop carries only what it encodes) — applies, and it is why merely
  typing the prop `HealthcheckResult` is not enough.** `state` would then be required,
  but `success` is still sitting beside it and `HealthcheckResultDisplay` would still
  branch on the boolean. Requiredness puts the value in the room; only a union with **no
  `success` field** removes the wrong thing to branch on.
- **Q2 (requiredness ≠ closedness) — satisfied**: `HealthProbeState` is already closed;
  the work is at the panel, not the enum.
- **Q3 (a type nobody constructs constrains nothing) — satisfied**: 9 slots and 1
  renderer are the construction sites, all named in §7.1.
- **Q5/Q6 (withhold the dangerous freedom, not the answer) — this is the design
  instruction.** Withhold `success`; keep `message`.
- **Q7 — n/a.**

A type cannot reach **G1** (a variant that does not exist), **G2** (a step vector the
backend does not produce) or **G5** (a string comparison across a serialization
boundary — doctrine "where types cannot reach" item 5). So a ratchet is still worth
having on the one countable condition, and it is proposed below as the thing that holds
the line until the union lands.

### 9.1 The rule

**Condition the signal is a proxy for:** *a connection verdict is re-declared at a panel
boundary in a shape that cannot carry the probe state, so the third value is discarded
between the store and the render.* A repo adopting this path writes its own proxy — this
one keys on TypeScript inline object types and would find nothing in a Rust or Python
codebase.

Anchor: a slot that holds a connection/test verdict and may not have one yet
(`?: … | null`). **Violating** = the verdict is an inline `{ success, message }` pair.
**Compliant** = the slot is typed by the named wire type that carries `state`. The two
halves partition the anchor.

```json
{
  "id": "probe-verdict-narrowed-to-boolean",
  "goldenPath": "docs/concepts/golden-paths/connector-setup-panel.md",
  "title": "A connection verdict re-declared as {success, message} at the panel boundary",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\?\\s*:\\s*\\{\\s*success\\s*:\\s*boolean\\s*[;,]\\s*message\\s*:\\s*string\\s*[;,]?\\s*\\}\\s*\\|\\s*null",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "An optional-and-nullable connection/test verdict prop typed as an inline {success, message} pair instead of the wire type, which erases HealthProbeState."
  },
  "baseline": { "files": 6, "matches": 9 },
  "floor": 4000
}
```

```json
{
  "id": "probe-verdict-narrowed-to-boolean-positive-control",
  "goldenPath": "docs/concepts/golden-paths/connector-setup-panel.md",
  "title": "COMPLIANT: the same verdict slot typed by the wire type that carries `state`",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:HealthcheckResult|HealthResult|CredentialDesignHealthcheckResult)\\s*\\|\\s*null|:\\s*(?:HealthcheckResult|HealthResult)\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "Compliant half of the same anchor: a verdict slot declared with the named wire type."
  },
  "floor": 4000
}
```

**Validation.** Run standalone in a private scratch registry (never the full registry):
violating **6 files / 9 matches**, control **5 files / 10 matches**, 4,801 files walked,
floor 4,000, exit 0. Re-extracted from this document after writing and re-run — identical.

**Hand-verified precision: 9/9.** Every match opened. Seven are vault credential-form
props (`result`, `healthcheckResult`, `oauthPollingMessage`, `pollingMessage`); two are
`AutomationCard.tsx:29` (`testResult` for an automation test-fire, a connection verdict
for GitHub Actions / Zapier) and `OAuthSection.tsx:15`. No false positives.

**Site-level overlap against the FINAL pattern: zero**, measured against all **195**
registered rules *and* the two neighbour rules that are published but not yet merged
(`unverifiable-probe-read-as-verified` from [`connection-health-check`](./connection-health-check.md),
`null-spinner-busy-state` from [`manual-test-fire`](./manual-test-fire.md)). File-level
co-occurrence exists and is on different lines: `typo-token-overpainted` in 4 of my 6
files, `hand-rolled-disabled-state` in 3, `null-spinner-busy-state` in 1
(`AutomationCard.tsx`, and **not** `ConnectionTestSection.tsx` — see §12.3).

**Why the boolean pair, and not the render.** The broad form
(`{ success: boolean; message: string }` anywhere) is **43 sites / 32 files** and its
precision is **35/43 ≈ 81%** — `useSchemaProposal`, `TriggerExecutionHistory`,
`WebhookRequestInspector`, `useTriggerDetail`, `AutomationsSection` and
`GitOperationResult` are generic operation results, not connection verdicts. Requiring
the slot to be **optional and nullable** — the signature of *a verdict that may not have
been produced yet* — is what takes it to 9/9 without a hand-written vocabulary of
identifier names. Deriving that constraint from the shape rather than from a word list
is deliberate: the doctrine's record is that an imagined vocabulary distorts precision
and recall at the same time.

**How it fails loudly.** It inherits the census runner's structural assertions: a walk
under `floor: 4000` fails ("the matcher is broken, not the codebase clean"), zero matches
anywhere fails, and an unannounced drop fails. **When the union lands this rule must be
deleted, not baselined at 0** — the census cannot express "must be zero".

### 9.2 What the census cannot gate here, and what would

Three of this leaf's findings are **absences** and none is countable:

1. **§7.2 (dead translator arms).** The condition is *"a TS `raw.includes('literal')`
   whose literal occurs nowhere in the Rust tree"* — a cross-corpus comparison. The census
   evaluates one pattern per file. The right instrument is a small script in the shape of
   `scripts/check-csp-hosts.mjs`: collect every `includes(` / `startsWith(` literal inside
   the message-classifier functions, grep the Rust tree for each, **exit 2 if it finds no
   classifier literals at all** (the fail-loud precondition), and exit 1 on any literal
   with zero producers. Today it would report 5 (`request failed:`, `timed out`,
   `timeout`, `dns`, `connection refused`) plus one frontend-only literal
   (`Run Test Connection`). The durable fix is a shared error-code enum crossing IPC,
   which retires the instrument.
2. **§7.6 (a healthcheck that never touches the credential).** The condition is a
   *relation* between a connector's `fields[]` and its `healthcheck_config` — both JSON
   columns in a database, not source text. A census rule cannot see them. This belongs in
   the Rust seed test that already validates connector definitions.
3. **§8/G1 (no expired variant).** Nothing to count; a missing enum variant has no
   textual footprint.

---

## §10 — Convergence

**Cohort established at measurement time (2026-08-17): 0 independent witnesses for the
situation.** Not one of the five sibling checkouts contains a panel where a credential is
entered, tested against the service, and saved.

| repo | has a connection-setup panel? | what it has instead |
|---|---|---|
| `personas-web` | **no** — no password/API-key input anywhere under `src/app/dashboard` except an execution-detail modal | a read-only system-health dashboard, and a *marketing guide page* about credentials (`src/data/guide/content/credentials.ts`) |
| `personas-cloud` | **no UI at all** — `facade/routers/credentials.py`, `packages/orchestrator/src/oauth.ts` are backend |  credential storage and OAuth redemption, no panel |
| `brainiac` | **no** — its one occurrence of `unverifiable` is prose in `console/src/home/Home.tsx:808` about a leak claim | — |
| `vibeman` | **no** | — |
| `ascent` | **no** | — |

**So the spine's `convergence: "mixed"` label fails, and it fails in the mode
[`embedded-terminal-session`](./embedded-terminal-session.md) recorded: the fleet
converged on *not having the problem*.** Personas is the only repo in the cohort that
holds third-party credentials on the user's behalf, so it is the only one that needs this
panel. Silence here is not a verdict against the prescription — per doctrine it is a
strong signal that the problem is unusual, and it means **the doctrine above has no
external corroboration and rests on this repo's own best instances** (`CliConnectionPanel`,
`cloud_diagnose`, `ByomApiKeyManager`) plus engineering judgment.

**One clause does have an independent reinvention, with a different mechanism, and it is
the clause this leaf is about.** `personas-web/src/app/dashboard/settings/page.tsx:48-51`:

```ts
// rather than defaulting to Disconnected — otherwise a healthy system flashes
const isChecking = !healthChecked;
const isConnected = health?.status === "ok";
```
→ `accent={isChecking ? "cyan" : isConnected ? "emerald" : "amber"}`

A different stack, a different subject (system reachability, not a credential probe), and
the same conclusion reached with a written rationale: **"not yet known" must not paint as
"bad".** That is the neutral third arm the desktop setup panel lacks. Weight it as one
author's second arrival at the same principle by a different route — the doctrine's
strongest form of agreement short of cost or inversion, and much stronger than a count.

**The `sides: "client"` label is contradicted, and the correction is not "it was both".**
The headline defect (§7.2) has its *cause* entirely on the server — a Rust format string —
and its *symptom* entirely on the client. §7.3 and §7.6 are wholly server-side. §7.1 and
the census rule are wholly client-side. This leaf is genuinely two-sided and the spine
already says so in the same object (`twoSided: true`), which makes `sides: "client"`
internally inconsistent with its own node — the eighth `"client"` contradiction the
corpus has recorded.

---

## §11 — Cross-path interactions

**With [`connection-health-check`](./connection-health-check.md).** That path prescribes
*"refuse to hand any consumer a two-valued view of it"* and located the defect in the
probe. This path confirms the prescription and shows the refusal is not enforceable at
the producer: `HealthcheckResult` already carries `state` as a required field, and the
consumer discards it anyway, in nine places, without a type error. **A required field on
the producer does not survive a structurally-typed consumer that re-declares the shape.**
That is an addition to that path's §9, not a contradiction of it.

**With [`empty-and-demo-states`](./empty-and-demo-states.md).** Its cascade — *errored →
loading → filtered → genuinely empty* — is the same shape as this leaf's state machine,
and the two compose: a setup panel whose verdict has three values and whose surface has
four conditions has twelve cells, not seven. Compute both, then branch once.

**With [`credential-capture-form`](./credential-capture-form.md).** That path counts
**196 fields across the connector catalog**; this path measures the same 196 from the
same table on the same day. Two independent readings agreeing on a denominator is worth
recording as a confirmation.

**A caution about following two prescriptions at once.**
[`structured-logging`](./structured-logging.md) prescribes moving values out of the
message string into structured fields. Applied to `execute_healthcheck_request_with_strategy`
that would be right for queryability — and this path asks for the *opposite* at the
IPC boundary: the message is what the user reads, and §7.2 exists because the message
already carries structure implicitly (`HTTP 401`) that a classifier has to re-parse. The
reconciliation is to do **both, separately**: structured fields for the log, and a
typed `step`/`code` for the IPC payload. Do not solve the second by parsing the first —
that is what is broken today.

---

## §12 — Corrections to the brief and to published claims

### 12.1 Register entry #55 verified — the credentials are intact, the owners are gone

The brief assigned entry **#55** (*"64 credential bindings would fail to resolve right
now"*) for verification, noting the figure was measured pre-purge and that the purge
preserved credentials and connectors.

Measured 2026-08-17 against both files:

| table | backup (`purge-backup-2026-08-17/personas.db`) | live |
|---|---:|---:|
| `personas` | **78** | **1** |
| `persona_credentials` | 25 | **25** |
| `connector_definitions` | 134 | **134** |

**Plainly: the missing side of the binding is the persona, not the credential.** Entry
#55's population was 117 declared slots across 73 personas; 72 of those 73 owners no
longer exist, so the 64 failing bindings are unreproducible. **They were not fixed.** The
parse defect (`parse_design_context` failing on `connectorPipeline`, the
`credential_links` / `credentialLinks` spelling split, the nine bind-by-element-zero
sites) is entirely in code that the purge did not touch, and the first persona created
after the purge will re-enter it. Entry #55 should be retitled to date its numbers rather
than closed.

The one item in #55 that **is** still live and still checkable is the Gmail grant: the
credential survives, `needs_reauth: true`, and its `oauth_token_expires_at` is now **76
days** in the past (it was 75 when #55 was written — the two measurements agree, one day
apart).

### 12.2 The brief's `rate_limit_rpm` lead: right finding, wrong denominator

The brief primed *"`rate_limit_rpm` declared on 0 of 135 connectors"*. Measured on the
live `connector_definitions` table: **0 of 134**. The zero is confirmed; the denominator
is 134. It is a small drift and it is worth naming because a later brief will otherwise
carry 135 forward as fact — the shape the doctrine records as *"a false premise whose
conclusion survives"*.

And to answer the doctrine's demand explicitly: this is a **0% prevalence**, not a 100%
one. The proof is that the field is *readable* (`parseConnectorMetadata` accepts arbitrary
metadata keys and 39 distinct keys are populated across the catalog) and simply never
written — the compliant form is not extinct-by-universality, it has never existed. A
census rule on it would match zero files and the runner would fail it as broken, which is
the correct outcome.

### 12.3 A correction owed to `manual-test-fire`: the spinner rule under-reports by ~35%

[`manual-test-fire`](./manual-test-fire.md) publishes `null-spinner-busy-state` with
pattern `\?\s*<LoadingSpinner(?:\s[^>]{0,120})?/>\s*:\s*<` and baseline **50 files / 68
matches**. The pattern requires the `<LoadingSpinner/>` to follow the `?` with only
whitespace between them, and the false branch to open with `<`.

Measured over the same 4,801 files:

| form | files | matches | seen by the published pattern |
|---|---:|---:|---|
| `? <LoadingSpinner/> : <` | 50 | 68 | yes (the baseline) |
| `? (` … `<LoadingSpinner/>` — Prettier's wrap | **27** | **30** | **no — 30 of 30 missed** |
| `&& <LoadingSpinner/>` | 6 | 6 | **no — 6 of 6 missed** |
| any `<LoadingSpinner` | 178 | 247 | — |

The missed sites are the same defect wearing a different formatting. Among them is
`ConnectionTestSection.tsx:43` — **the repo's primary "Test connection" button**, and the
one this path's §7.7 is about. Others include `FormActions.tsx:71` (the Save button on the
same form), `autoCred/steps/ReviewActions.tsx:136,:152`, and
`sub_credentials/components/list/CredentialListColumns.tsx:83,:181`.

This is precisely the failure the contract's §9 section describes — *"a signal keys on the
markup a deviation happened to wear"* — occurring **inside one repo** rather than across
two, because Prettier wraps a ternary whose branches do not fit on one line. The
suggested amendment is to allow an optional `(` and a JSX-or-paren false branch:
`\?\s*\(?\s*<LoadingSpinner(?:\s[^>]{0,120})?/>` with a separate control, re-baselined at
the merged count. **This document does not ship that change** — it belongs to the path
that owns the rule, and re-baselining someone else's rule from here is exactly the
concurrent-registry hazard the contract warns about.

### 12.4 My own two implementations disagreed, and the safer-looking one was wrong

Both implementations of the §7.2 producer inventory were wrong, in different directions,
and the disagreement is the only reason either was caught.

- **Implementation A** (library-assisted: the shared `extractRustStrings` scanner plus a
  220-char look-behind for `HealthcheckResult::probed(`) **missed `:1142` and `:1156`** —
  the two sites that go through `let msg = format!(…); probed(false, sanitize_secrets(&msg))` —
  and instead swallowed **three `#[cfg(test)]` fixtures** at `:1827`, `:1835`, `:1845`. It
  reported 15 producers, of which 3 were tests and 2 real ones were absent.
- **Implementation B** (bespoke: brace-matched `#[cfg(test)]` stripping, balanced-paren
  argument slicing, one level of local `let` resolution, translator gates *parsed from the
  TS source* rather than transcribed) resolved the indirection correctly — and **collapsed
  the two identically-named `let msg` bindings into one**, because its lookup table was
  keyed by name and the later declaration won. It therefore lost
  `"Service returned HTTP {}"` entirely.

**B's error would have made the headline stronger and wrong**: *"zero real-probe messages
reach any diagnostic arm"*, when the truth is one. That is the doctrine's rule about a
measurement agreeing with its author's thesis, encountered live. The published inventory
is the hand-verified third pass — every `HealthcheckResult::` call site above `:1495`
listed by `grep -n` and each message read in context — and it is 13 sites, of which one
reaches an arm.

### 12.5 The enumeration pass called the translator "best-in-repo"; it is, and four of its arms are dead

A breadth pass over 32 setup surfaces reported `translateHealthcheckMessage` as the
strongest failure diagnosis in the product, listing its timeout / DNS / connection-refused
/ unreachable buckets as evidence. Both halves of that are true — it *is* the best
diagnostic layer any panel here has — and the four buckets it was praised for cannot fire.
Recorded because it is the characteristic miss of a reading pass: an arm that exists reads
as an arm that runs, and only replaying the producers against the gates separates them.

### 12.6 What held

- The spine's `risk: medium` is, if anything, understated: the defect makes an
  unverifiable credential indistinguishable from a verified one on the surface that
  certifies it.
- The brief's lead that *"'test connection' may take a shorter, more privileged path than
  the real one"* — imported from `manual-test-fire` — **holds, with a twist.** The main
  vault flow's Test is the *same* path (§6). The one that is not shorter but **entirely
  different** is `test_credential_design_healthcheck`, which is longer, slower and runs a
  language model. The lead pointed at the right question and the answer was not the
  expected shape.
- The brief's framing that the leaf is *"about states, not styling"* is confirmed by the
  measurement: every finding in §7 is a missing or collapsed state, and none is visual.
