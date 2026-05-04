# Connections and Vault

Connections is the credential and resource management area. It backs template adoption, persona execution, plugin integrations, API proxying, dynamic discovery, and local desktop connector capabilities.

## Implemented surfaces

| Surface | Purpose | Implementation |
| --- | --- | --- |
| Credentials | Store and manage encrypted credentials | `src/features/vault/sub_credentials`, `src-tauri/src/commands/credentials/crud.rs` |
| Databases | Database connection records and catalog | `src/features/vault`, `credentials/db_schema.rs` |
| Catalog | Connector catalog and setup recipes | `src/features/vault`, `scripts/connectors`, `public/icons/connectors` |
| Dependencies graph | Resource dependency view | `src/features/vault`, `credentials/resources.rs` |
| Add new | Credential creation and picker flow | `src/features/vault/sub_credentials/components` |

## Backend command families

- `credentials/connectors.rs`: connector definitions and catalog behavior.
- `credentials/resources.rs`: scoped resources bound to credentials.
- `credentials/api_proxy.rs`: authenticated proxy with SSRF protections.
- `credentials/discovery.rs`: dynamic resource discovery for adoption questions.
- `credentials/oauth.rs`, `auth_detect.rs`, `cli_capture.rs`: setup and discovery helpers.
- `credentials/vector_kb.rs`: ML-gated vector knowledge bases.

## Scoping

Resource scoping is a cross-cutting contract. See [../../architecture/resource-scoping.md](../../architecture/resource-scoping.md).

