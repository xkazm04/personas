# Langfuse

Langfuse is the observability plugin that ships executions to a [Langfuse](https://langfuse.com/) instance for inspection and analysis. Personas can run it in two modes:

- **Managed self-host** — the desktop app spawns and supervises a local Docker Compose stack (Postgres + ClickHouse + Langfuse server) and auto-signs the user in via a one-time nonce flow.
- **Manual** — the user provides their own host + API keys (cloud or self-hosted) and the desktop app only ships traces to it.

Detailed design rationale (path A → A+ probe → decision B) lives in `docs/concepts/langfuse-observability.md`. This document is the implemented-product reference.

## User surface

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Plugin page | Two-section layout: managed-stack panel above, manual-connection form below | `LangfusePage.tsx` |
| Connection form | Manual host + public/secret key entry, test-connection action | `ConnectionForm.tsx` |
| Managed stack panel | Start/stop/reset the local Docker stack, view admin credentials, port editor, install Docker if missing | `ManagedStackPanel.tsx` |
| Stack progress | Phase-aware progress bar driven by streaming events | `StackProgress.tsx` |
| Status panel | Compact status surface for sidebar/footer use | `StatusPanel.tsx` |
| Open-in-Langfuse | Button that opens the user's default browser to the Langfuse UI, auto-signed-in via nonce | `OpenInLangfuseButton.tsx` |

`LangfusePage.tsx` collapses the manual section by default for first-run users (when `config.host` is empty), and expands it when an existing manual config is detected.

## State

| Hook | Source of truth |
| --- | --- |
| `hooks/useLangfuseSettings.ts` | Manual config (host, public/secret key, managed flag, preferred port) |
| `hooks/useLangfuseStack.ts` | Managed-stack lifecycle — info polling (`POLL_INTERVAL_MS = 4_000`), job-in-flight state, fraction/ETA, last outcome, admin credentials |
| `useLangfuseStackEvents.ts` | Subscribes to streaming progress events and feeds the global `useLangfuseStackStore` |
| `src/stores/langfuseStackStore.ts` | Cross-component store for stack state (so the status panel and full page agree) |

## Backend command surface — `commands/infrastructure/langfuse.rs`

| Family | Commands |
| --- | --- |
| Manual config | `langfuse_test_connection`, `langfuse_save_config`, `langfuse_get_config`, `langfuse_clear_config`, `langfuse_save_preferred_port` |
| Managed stack | `langfuse_stack_get_info`, `langfuse_stack_start`, `langfuse_stack_stop`, `langfuse_stack_get_admin_credentials`, `langfuse_stack_open_ui`, `langfuse_stack_reset`, `langfuse_stack_refresh_images` |
| Docker bootstrap | `langfuse_docker_download_installer`, `langfuse_docker_run_installer` (used when Docker isn't installed) |
| Auth | `langfuse_open_authenticated_ui` (single-use nonce-based auto-login) |

The frontend wrappers live in `src/api/langfuse.ts`.

## Engine — `src-tauri/src/langfuse/`

| File | Concern |
| --- | --- |
| `mod.rs`, `lifecycle.rs` | Stack lifecycle (start/stop/reset) and job tracking |
| `config.rs`, `types.rs` | Config persistence + bindings |
| `docker.rs` | Docker / Compose process management |
| `compose.yml.tmpl` | Templated Compose definition (Postgres + ClickHouse + server) |
| `templates.rs` | Compose-template rendering with port substitution |
| `client.rs` | Langfuse HTTP client (test connection, fetch admin credentials) |
| `exporter.rs` | Trace exporter shipped with each persona execution |

## Auto-login flow (`local_http/langfuse_routes.rs`)

When the user clicks Open Langfuse:

1. The frontend calls `langfuse_open_authenticated_ui` with an optional `return_to`.
2. The backend mints a single-use nonce (60 s TTL) and opens the user's default browser to `http://localhost:<local-http-port>/langfuse/auto-login?nonce=…&return_to=…`.
3. The local HTTP route validates and consumes the nonce, reads saved Langfuse host + admin credentials from the keyring, fetches a CSRF token from `<host>/api/auth/csrf`, and renders a self-submitting HTML form that POSTs credentials to NextAuth's credentials callback. The form also sets the csrf cookie with `Domain=localhost` so the browser ships it on the cross-port POST.
4. NextAuth sets the session cookie scoped to `localhost:<langfuse-port>` and redirects to `return_to` (or `/`).

No embedded webview, no manual sign-in form — the user lands inside Langfuse already logged in.

## Storage

- Manual config: persisted via the existing settings storage (host stored in plaintext, secret key in keyring).
- Managed admin credentials: stored in keyring under the langfuse-admin key.
- Stack state: in-process job tracker; on restart the stack is rediscovered via `langfuse_stack_get_info`.

## Known gaps

- Manual mode currently relies on the user typing their secret API key once. There is no OAuth flow for cloud Langfuse.
- The managed stack assumes Docker Engine is available; on Windows/macOS the bootstrap commands open Docker Desktop's installer.
- Trace export from personas is wired through the engine exporter; per-persona enable/disable is not yet a first-class control.
