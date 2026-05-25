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

## API playground and vector KB

`shared/playground` is the credential detail modal opened when you click a saved credential. Tabs: **Overview** (test connection, edit fields, scope, services/events, intelligence, delete), **Executions**, **API Explorer** (request-builder via `useApiTestRunner` + `ResponseViewer`, custom connectors only), **MCP Tools** (mcp connectors), **Rotation**. Resource **scope editing** lives in the Overview tab's `CredentialScopeSection` ("Edit scope" reopens the shared `ResourcePicker`) — surfaced near the top so it's reachable without scrolling. The `ResourcePicker` modal is a flex-column with `min-h-0` scroll body + `shrink-0` sticky footer so the Save button stays visible regardless of how many resource specs a connector declares.

`shared/vector` provides ML-gated knowledge-base creation, ingestion, search, document listing, and deletion through `credentials/vector_kb.rs`.

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

**Encryption at rest is automatic and not a user-facing control.** Sensitive credential fields are AES-256-GCM encrypted at write time (`crypto::encrypt_field`). At startup the app silently assures the whole vault is encrypted: `crypto::migrate_plaintext_credentials` converts any legacy plaintext blob, and `crypto::assure_sensitive_fields_encrypted` re-encrypts any sensitive field still stored as plaintext. Both passes **exclude built-in personas-local connectors** (the bundled SQLite database, in-app messaging, the managed drive, …) which carry no external secret. There is no "encrypt now" button or unencrypted-count badge in the UI — the former `VaultStatusBadge` was removed in favour of this silent assurance.

Resource scoping is a cross-cutting contract. See [../../architecture/resource-scoping.md](../../architecture/resource-scoping.md).
