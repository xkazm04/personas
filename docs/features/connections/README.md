# Connections and Vault

Connections is the credential, connector, resource, database, and dependency-management area. It backs template adoption, persona execution, plugin integrations, API proxying, dynamic discovery, local desktop connectors, and vector knowledge bases.

> **Module location:** the frontend code for this feature lives at `src/features/vault/` (the historical folder name predates the "Connections" UI label). The backend handlers live at `src-tauri/src/commands/credentials/`. "Vault" and "Connections" refer to the same feature.

## User surface

| Tab | Behavior | Main files |
| --- | --- | --- |
| Credentials | Credential list, cards, creation forms, import, workspace/picker flows, gateway controls | `sub_credentials/manager`, `sub_credentials/components` |
| Databases | Database cards, table browser, SQL editor, safe mode, assistant chat, schema manager | `sub_databases` |
| Catalog | Connector catalog, setup forms, auto-credential browser, desktop connectors, foraging, negotiator, schema proposal. Sort dropdown (Alphabetical / Popular / Recently Added / Most-used with recipes) and a "New" ribbon on connectors added in the last 30 days; sort + local view counts persist in `vaultStore` via `catalogPrefsSlice`. | `sub_catalog/components` |
| Dependencies | Relationship graph, blast-radius panel, simulation controls | `sub_dependencies` |
| Add new | Entry mode into credential creation/catalog flows | `CredentialAddViews.tsx`, `useCatalogHandlers.ts` |

Navigation tab definitions live in `credentialItems` in `sidebarData.ts`.

## Credential manager mechanics

The credentials manager uses `useCredentialManagerState`, `CredentialNavContext`, and `useCredentialViewFSM` to keep list/detail/create/import/catalog states explicit. It includes:

- Tags and health scoring (`useCredentialTags`, `credentialHealthScore.ts`).
- OAuth helpers (`useCredentialOAuth`, `useGoogleOAuth`).
- Rotation ticker and rotate-all flow (`useRotationTicker`, `useRotateAll`).
- Undo-delete support (`useUndoDelete`).
- Post-save resource picker flow (`resourcePickerStore.ts`, `usePostSaveResourcePicker.tsx`).

**Readiness recompute on mutation.** Deleting a credential, or editing its field
values, recomputes `setup_status` + `setup_detail` for every persona that
depends on it (union of the `credential_dependents` scan and personas whose
`design_context.credentialLinks` reference the exact id). A persona left bound
to a deleted/emptied credential flips from `ready` to `needs_credentials`, so it
no longer passes the execution gate and runs blind — the recompute reuses the
same `connector_readiness` resolver adopt/promote use (`crud.rs` → `commands::
design::connector_readiness::recompute_setup_for_credential_dependents`).

### Credential healthchecks

Healthchecks verify that a stored credential still authenticates against its provider (HTTP probe, CLI verify, or desktop-app presence — see `engine/healthcheck.rs`). They run on two paths:

- **Automated daily sweep (in-process).** The engine's `CredentialHealthcheckSubscription` (`engine/subscription.rs`, registered in `engine/background.rs`) runs `healthcheck::run_all_healthchecks` at most once per 24h — gated by the `credential_healthcheck_last` setting, with the first post-launch tick (~60s) acting as the startup catch-up. It probes every credential whose `service_type` maps to a known connector, persists each result into credential metadata (`append_healthcheck_metadata`: ring buffer + `healthcheck_last_success`/`healthcheck_last_message`/`healthcheck_last_tested_at`), and never crosses the IPC boundary. The connections table reads these persisted fields, so a freshly-launched Vault shows up-to-date health without probing on every visit.
- **Manual "Test all" button.** Calls the single `healthcheck_all_credentials` command (`credentials/crud.rs`), which runs the *same* in-process sweep server-side and returns a `BulkHealthcheckSummary`. `useBulkHealthcheck` maps the result into the per-card health cache and refreshes the store.

This replaced an earlier client-side fan-out that fired ~24 concurrent privileged `healthcheck_credential` IPC calls on every Vault visit. That stampede raced the `x-ipc-token` injection (`ipc_auth.rs`) — rejected calls surfaced as false **"degraded"** cards even though the stored keys were valid and the probe never ran. Routing the loop through the engine (daily sweep) or a single privileged call (manual button) eliminates the race; per-credential `healthcheck_credential` remains for one-off "Test connection" actions in the detail modal.

**Verified vs unverifiable (three-valued health).** Not every connector *can* be live-probed. A connector with no HTTP healthcheck config, no CLI verify probe, and no desktop-presence check (e.g. a raw connection string or an SSH key) returns a non-error "skip" — so a green "Healthy" check on such a credential would be a lie: nothing was actually verified. The probe result is therefore a typed `HealthProbeState` (`engine/healthcheck.rs`): **`verified`** (a live probe ran and passed), **`unverifiable`** (no probe of any kind exists — stored but not checkable), or **`failed`** (a live probe ran and failed). The distinction is persisted alongside `healthcheck_last_success` as a `healthcheck_last_state` metadata token (written via `persist_probe_state`), so the credentials list renders it without re-probing. The list's Health column shows `unverifiable` as a neutral/muted badge (never a green check) with a tooltip explaining the connector has no live probe, and the health filter offers it as its own option. **Gating is unchanged:** `unverifiable` is *not* a failure — `credential_is_usable` (`commands/design/connector_readiness.rs`) only demotes an explicit probe *failure*, so stored-only credentials still count as ready and never block execution.

### MCP gateway member health

Gateway members are health-checked periodically (`McpHealthcheckSubscription`, ~15min, skipped when no `mcp_gateway` credentials exist) via the existing capability ping; results persist into each member credential's healthcheck metadata ring buffer, and the gateway members modal shows a per-member ok/failed/not-checked badge with last-checked time. Dead members are no longer discoverable only as lazily-missing tools.

### CLI-captured credentials (gcloud and friends)

Connectors whose catalog metadata declares an `auth_methods` entry with `"type": "cli"` (currently **Google Cloud Platform**) show an extra tab in the add-credential form that onboards an already-authenticated local CLI session instead of a pasted secret. The flow (`CliConnectionPanel` → `cli_capture.rs`) verifies the binary is installed and authenticated, captures the active token (`gcloud auth print-access-token`, 1h TTL) plus context fields, and saves the credential with `metadata.source = "cli"`.

Lifecycle of a CLI-sourced credential:

- **Healthcheck** routes through the CLI (`cli_verify_auth`) instead of the HTTP probe.
- **Token freshness** is maintained by the OAuth refresh engine, which routes `source = "cli"` credentials through `recapture_for_credential` — re-running the capture command before expiry (proactive tick + startup sweep).
- **Execution** uses the captured token through the connector strategy. `GcpCloudStrategy` (`engine/connector_strategy.rs`) resolves the raw access token in `service_account_json` as a Bearer token and reports the credential as refresh-eligible, which arms the api_proxy 401 → force-refresh (CLI recapture) → retry path for mid-run expiry. A pasted service-account *key* (JSON shape) is not directly usable as a Bearer token — it would need a signed-JWT grant exchange, which is not implemented.
- **Dead CLI session** (revocation, password change, org session policy): recapture fails as `Unauthenticated`, which classifies as `OAuthRevoked` — the credential is flagged `needs_reauth`, a `credential-reauth-required` event + OS notification fire, and the Vault `ReauthBanner` shows the CLI login instruction (e.g. "Run `gcloud auth login`") with a **Retry capture** button (`refresh_credential_cli_now`) so the user can recover without recreating the credential.

## Revoked-grant recovery (OAuth + CLI)

When the refresh engine detects a revoked grant it does three durable things, not just fire a dismissable banner:

- **Reconnect from the banner.** For OAuth credentials the `ReauthBanner`'s **Reconnect** button (`data-testid="reauth-reconnect"`) opens the revoked credential's detail modal — its **Authentication** section (`OAuthSection`, authorize button `data-testid="oauth-authorize"`) is the re-consent surface. Completing the reconnect saves a fresh grant; `spawn_connect_seed` then emits `credential-reauth-resolved`, which clears the banner entry automatically (no manual dismiss). The CLI **Retry capture** arm is unchanged.
- **Durable healing issue.** A revocation also opens a `persona_healing_issues` row (`source = "oauth"`) for every persona that depends on the credential (reusing the delete path's dependent-persona scan), deduped per persona per credential so repeated refresh ticks don't spam duplicates. It surfaces in the existing health/attention surfaces with a **Credential** origin badge (`IssuesList`). Because the table is persona-scoped, a revoked credential with **no** dependents creates no row — the `needs_reauth` flag + banner remain its surface. Severity is `high` whenever there is ≥1 dependent.
- **Auto-resolve.** A successful OAuth refresh or CLI recapture (the recovery) clears `needs_reauth` and auto-resolves the credential's open `oauth`-sourced healing issue.

## API playground and vector KB

`shared/playground` is the credential detail modal opened when you click a saved credential. Tabs: **Overview** (test connection, edit fields, scope, services/events, intelligence, delete), **Executions**, **API Explorer** (request-builder via `useApiTestRunner` + `ResponseViewer`, custom connectors only), **MCP Tools** (mcp connectors), **Rotation**. Resource **scope editing** lives in the Overview tab's `CredentialScopeSection` ("Edit scope" reopens the shared `ResourcePicker`) — surfaced near the top so it's reachable without scrolling. The `ResourcePicker` modal is a flex-column with `min-h-0` scroll body + `shrink-0` sticky footer so the Save button stays visible regardless of how many resource specs a connector declares.

`shared/vector` provides ML-gated knowledge-base creation, ingestion, search, document listing, and deletion through `credentials/vector_kb.rs`.

**Ingestion accepts PDFs.** Alongside the text formats (md/txt/csv/json/yaml/html/source files), a `.pdf` is read one page at a time via its text layer, so every stored passage keeps the page it came from. Search results show that page as a citation, and each passage carries an *extraction confidence*: a passage read from a mostly-image page is flagged **Partial text** so an agent (or a reader) knows to hedge rather than assert. PDFs are text-layer only — there is no OCR — so a scanned document ingests with its image-only pages counted and surfaced ("N scanned pages unreadable" on the document row); a fully-scanned PDF fails ingestion with a message saying an OCR'd copy is needed, instead of silently indexing to nothing.

**Search has a relevance floor.** `kb_search` applies the same vector-distance floor the companion brain uses (`retrieval::MAX_VECTOR_DISTANCE`) to the candidate pool *before* BM25/RRF re-ranking, so small corpora no longer pad results with the least-irrelevant passages — a query with nothing genuinely close returns empty rather than noise. The response reports `floorFiltered` (how many candidates the floor removed) and the Search tab surfaces it ("N low-relevance passages hidden"); the optional `minScore` filter still applies afterward when stricter. The ambient all-KB scan behind clipboard intelligence (error detected on the clipboard → "possible fix" notification) is one shared implementation (`engine/kb_scan.rs`) that only searches KBs with `status = 'ready'` — a KB mid-creation or mid-reindex is never surfaced by ambient search.

**Re-ingest supersedes; reindex rebuilds.** Ingestion is keyed by source path: re-ingesting a file that is already indexed and *unchanged* (same content hash) is skipped, but re-ingesting one whose content changed **supersedes** the old document — its chunks and vectors are deleted in one transaction before the new content is indexed, so an edited file never double-indexes and stale passages never linger. Separately, **Rebuild index** (`kb_reindex`, on the knowledge base's Settings tab) re-embeds every stored passage from scratch: it drops and recreates the vector table with the current embedding model, re-embeds all chunks (progress on the same `kb:ingest_progress` / `kb:ingest_complete` events as ingestion), and records the new model on the KB. Use it after the default embedding model changes so an older knowledge base becomes searchable again, or to rebuild an index suspected of drift.

**Corpus map.** `kb_corpus_map` renders a knowledge base as a compact Markdown overview — the documents in it, their page and passage counts, and which parts are unreadable scans — meant to be read *before* searching so an agent orients cheaply instead of guessing query terms. It is exposed both as a Tauri command and as a connector tool ("Corpus Map") on the built-in Local Vector DB connector. In the UI it also backs a **collapsible "Corpus overview"** at the top of the knowledge base's Documents tab (lazy-loaded on expand), and — when a KB is bound to a Twin — it is prepended to the Twin's retrieval grounding so the twin knows the shape of its own corpus.

**Structured extraction (Structured Data tab).** Beyond search, a knowledge base can be turned into queryable typed rows. It runs in two passes with a review step between them: `kb_infer_schema` samples the corpus and proposes a schema of the objects the documents describe (entity types + fields); the user edits that schema; `kb_run_extraction` then processes each document against the approved schema in the background (progress on `kb-extraction-progress`) and writes `kb_entities` — each row keeping the document and page it came from and an extraction confidence. `kb_list_entities` reads them back. The rationale and data model live in `src/features/vault/shared/vector/DESIGN.md`. This is a UI-driven authoring flow; extraction is not yet exposed as an agent connector tool.

## Backend command families

| Family | Modules |
| --- | --- |
| Credential CRUD and encryption | `credentials/crud.rs`, `shared.rs` |
| Connector catalog | `connectors.rs`, `credential_recipes.rs`, `schema_proposal.rs` |
| Dynamic discovery | `discovery.rs`, `auth_detect.rs`, `cli_capture.rs`, `desktop.rs`, `desktop_bridges.rs` |
| API proxy and auth | `api_proxy.rs`, `oauth.rs`, `external_api_keys.rs`, `mcp_gateways.rs`, `mcp_tools.rs` |
| Resource scoping | `resources.rs`, `db_schema.rs`, `query_debug.rs` |
| Intelligence/autopilot | `credential_design.rs`, `auto_cred_browser.rs`, `foraging.rs`, `negotiator.rs`, `intelligence.rs`, `openapi_autopilot.rs` |
| Rotation | `rotation.rs` |
| Vector KB | `vector_kb.rs` |

## Outbound notification connectors

Four catalog entries in `scripts/connectors/builtin/` expose URL-only webhook credentials for outbound alerting: `slack-webhook` (Slack incoming webhook), `discord-webhook` (Discord channel webhook), `teams-webhook` (Microsoft Teams incoming webhook), and `generic-webhook` (any HTTPS endpoint accepting POST). They live alongside the full Slack/Discord/Teams bot connectors but expose only a `webhook_url` password field — no scopes, no resource picker — so users can grant a least-privilege "post-only" credential. The vault encrypts the URL like any other sensitive field, and the outbound dispatcher (`engine/webhook_notifier.rs`) reads it through `get_decrypted_fields`. See [events/README.md](../events/README.md#outbound-webhook-notifications) for the routing layer.

## Security constraints

Credentials are stored and read through backend commands; decrypted secrets should not be passed to the webview except for deliberate non-secret metadata. API calls that need credentials should go through backend proxy/discovery commands so auth strategy, SSRF protection, rate limiting, and audit behavior remain centralized.

**Encryption at rest is automatic and not a user-facing control.** Sensitive credential fields are AES-256-GCM encrypted at write time (`crypto::encrypt_field`). At startup the app silently assures the whole vault is encrypted: `crypto::migrate_plaintext_credentials` converts any legacy plaintext blob, and `crypto::assure_sensitive_fields_encrypted` re-encrypts any sensitive field still stored as plaintext. Both passes **exclude built-in personas-local connectors** (the bundled SQLite database, in-app messaging, the managed drive, …) which carry no external secret. There is no "encrypt now" button or unencrypted-count badge in the UI — the former `VaultStatusBadge` (a *control* + count) was removed in favour of this silent assurance, and that decision stands.

**`VaultTrustBadge` is a read-only trust *display*, not a control.** A calm, collapsible panel on the credentials list (`sub_credentials/manager/VaultTrustBadge.tsx`) surfaces the reviewer-grade `vault.vault_badge` reassurance copy — AES-256-GCM, the OS-keychain (vs machine-fallback) master key, and credentials-never-leave-device — which was authored in all 14 locales but previously rendered by zero components. It carries **no** encrypt-now action and **no** unencrypted/plaintext count (those would contradict the silent-assurance model above); it consumes `vault_status.key_source` to show the keychain-vs-fallback line accurately, and `vault_status.credential_audit_write_failures` — when any credential audit-log write has failed this session (a decrypt happened without a trail), the badge flips from the green shield to an amber "Vault needs attention" state with a row counting the missed audit entries. Decrypts are never blocked by audit failures; the gap is surfaced, not silently swallowed. The credential-entry form (`FormActions.tsx`) shows the same reassurance inline for every credential type. Both exist so a buyer / security reviewer can *see* the local-first crypto story, not to expose a control.

Resource scoping is a cross-cutting contract. See [../../architecture/resource-scoping.md](../../architecture/resource-scoping.md).
