# Connector Catalog — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Healthcheck / api_proxy discard the provider-rotated refresh_token returned by an in-place OAuth exchange — permanent credential death
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/healthcheck.rs:486-497 (same pattern: src-tauri/src/engine/api_proxy.rs:803-806; exchange in src-tauri/src/engine/connector_strategy.rs:589-630)
- **Scenario**: A Microsoft (or rotation-enforcing Google) OAuth credential's stored `access_token` passes its local `oauth_token_expires_at` while the background refresh tick hasn't run yet. The user clicks "Test connection" (or any persona run hits api_proxy). `resolve_oauth_token` sees the expired token and performs a real refresh-token exchange; the provider returns a new access_token AND a rotated `refresh_token`, invalidating the old one server-side. Both call sites then do `.map(|r| r.token)` — the rotated refresh_token (and the new access_token/expiry) are thrown away.
- **Root cause**: `ResolvedToken.refresh_token` exists precisely because "Must be persisted to avoid credential death when providers enforce refresh token rotation (RFC 6749 §6)" (connector_strategy.rs:26-29), and `oauth_refresh.rs` has an atomic retry-persist block for it — but the healthcheck and api_proxy resolve paths call `resolve_auth_token` directly and assume it is read-only, when for expired OAuth credentials it has a state-changing side effect at the provider.
- **Impact**: The DB keeps the now-revoked old refresh_token; the next refresh (background tick or 401-retry) fails with `invalid_grant` → `needs_reauth`, bricking the credential until the user manually re-authorizes. Secondary: because the fresh access_token is also unpersisted, every healthcheck/proxy call during the expired window burns another exchange (needless token churn against provider quotas).
- **Fix sketch**: When the resolve path detects the stored token expired, route through `oauth_refresh::refresh_single_credential` (which already persists atomically under the per-credential lock) instead of a raw exchange; or, at minimum, persist `resolved.refresh_token`/token/expiry via the same atomic block whenever `resolve_auth_token` returns a rotated token.

## 2. Rotate's restore-on-failure writes back a pre-snapshot refresh_token without holding the refresh lock — race clobbers a concurrently rotated token
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/connector_strategy.rs:84-152 (trait default `rotate`), :405-431 (`DefaultStrategy::rotate` API-key arm)
- **Scenario**: The user triggers rotation on an OAuth-bearing credential handled by the default `rotate`. It snapshots `original_fields` at T0, then runs a healthcheck. Between T0 and the verdict, the background oauth_refresh tick (which the rotate path never locks against — it acquires no `oauth_refresh_lock`) commits a provider-rotated refresh_token. The healthcheck then fails transiently (network blip, 500), and rotate "restores" by `save_fields(&original_fields)` — overwriting the freshly rotated refresh_token with the old, provider-invalidated one.
- **Root cause**: The restore assumes the snapshot is still the latest committed state, i.e. that nothing else mutates credential fields during the healthcheck round-trip; the background refresh tick violates that assumption. Additionally the restore is unconditional even for non-OAuth credentials whose fields the healthcheck never modified, so a failed probe rewrites identical fields with a fresh `credential_fields.updated_at` — which the readiness staleness rule (connector_readiness.rs:752-777) reads as "fields edited after last success".
- **Impact**: Same credential-death end state as finding 1 (dead refresh_token persisted, `invalid_grant` on next refresh), triggered by an ordinary transient healthcheck failure racing the refresh tick. The no-op rewrite also skews field-edit timestamps used by readiness.
- **Fix sketch**: Hold `oauth_refresh_lock::acquire(credential_id)` across snapshot→healthcheck→restore, and only restore fields the rotation path actually changed (diff against snapshot) instead of a blanket `save_fields`; skip restore entirely on the API-key path, which never mutates fields.

## 3. Builtin-connector seed silently reverts user edits and resurrects deleted builtins on every app launch
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/mod.rs:1359-1390 (seed upsert); src-tauri/src/db/repos/resources/connectors.rs:157-248 (no `is_builtin` guard on update/delete)
- **Scenario**: A privileged user edits a builtin connector — e.g. points `healthcheck_config` at a self-hosted instance, or tweaks `fields`/`metadata` via `update_connector` (nothing in the repo or command blocks editing `is_builtin = 1` rows). The edit works for the session. On the next app start, `seed_builtin_connectors` runs an unconditional `UPDATE ... WHERE name = ?, is_builtin = 1` for every builtin, overwriting label/icon/fields/healthcheck/metadata/category/services/events/resources with the shipped seed. Likewise `delete_connector` on a builtin "succeeds" but `INSERT OR IGNORE` re-seeds it at next launch.
- **Root cause**: Two writers own the same rows with no arbitration: the app exposes builtin rows as mutable/deletable through the normal CRUD surface, while the seeder assumes builtin rows are exclusively seed-owned and force-refreshes them each startup. Neither side records "user-modified", so the revert is silent. (Side effect: `updated_at` on all ~100 builtin rows is bumped to `now` on every launch, making that column meaningless.)
- **Impact**: Silent loss of user configuration — a customized builtin healthcheck/field schema reverts without any notice, changing classification/readiness behavior the user thought they'd fixed; deleted builtins reappear. Debugging is painful because the state only flips across restarts.
- **Fix sketch**: Reject `update_connector`/`delete_connector` on `is_builtin = 1` rows (steer users to clone-as-custom), or add a `seed_version`/`user_modified` column and have the seeder skip rows the user touched. Bump `updated_at` only when the seeded content actually changed.

## 4. Relationship graph swallows dependents-fetch failures and renders a confident zero-impact blast radius
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:44-53
- **Scenario**: The user opens the credential relationship graph to check what depends on a credential before revoking it. One or more `getCredentialDependents(cred.id)` IPC calls fail (backend error, transient DB issue). The `catch` maps the credential to `[]` and the component proceeds: `loading` clears, the graph renders, and the Blast Radius panel / revocation simulation report no dependents for that credential — indistinguishable from a genuinely unused credential. No error state, toast, or retry exists anywhere in the component.
- **Root cause**: The fetch fan-out treats "failed to load dependents" and "has no dependents" as the same value (`[]`), and the component has loading + empty states but no error state — a trust-boundary result (the whole point of the feature is pre-revocation impact analysis) is silently defaulted to the safest-looking answer.
- **Impact**: Success theater on a decision-support surface: a user can revoke or delete a credential believing nothing depends on it, breaking personas that in fact bind to it. Edges from the audit-log dependents scan silently vanish from the graph.
- **Fix sketch**: Track failed credential ids in the fan-out; if any failed, render a non-blocking error banner ("dependency data incomplete for N credentials — retry") and mark affected credential nodes visually. Never conflate a failed fetch with an empty dependents list in `analyzeBlastRadius`/`simulateRevocation` inputs.

## 5. Graph nodes are mouse-only: no keyboard access, no accessible names, hover-gated highlighting
- **Severity**: Low
- **Category**: ui
- **File**: src/features/vault/sub_dependencies/GraphCanvas.tsx:183-218
- **Scenario**: A keyboard or screen-reader user opens the relationship graph. Every node is a `<motion.g>` with `onClick`/`onMouseEnter` only — no `tabIndex`, `role="button"`, `aria-label`, or key handler — so nodes cannot be focused, selected, or announced; neighbor-highlighting is reachable only via hover. Labels are also hard-truncated at 16 characters with no `<title>`/tooltip, so two credentials named "Google Workspace…" are visually indistinguishable until clicked (mouse-only).
- **Root cause**: The SVG visualization was built as a pointer-first canvas; interactivity (select node → detail panel, hover → adjacency emphasis) was attached exclusively to mouse events, with no parallel keyboard/AT path and no full-name affordance for truncated labels.
- **Impact**: The entire dependencies feature (blast radius, revocation simulation, node details) is unusable without a mouse and invisible to assistive tech; truncated labels cause misidentification in vaults with similarly named credentials.
- **Fix sketch**: Add `tabIndex={0}`, `role="button"`, `aria-label={node.label}`, and Enter/Space handlers to `GraphNodeCircle` (focus can drive the same `onHover` highlighting), plus an SVG `<title>` with the untruncated label. GraphCanvas already receives unused `filteredNodes`/`filteredEdges` props — drop or use them while touching this file.
