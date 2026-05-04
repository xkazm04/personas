# Handoff — Resource Scoping (next session)

**Status as of 2026-04-25:** Foundation + 24 connectors + template `requires_resource` filter shipped. All save flows wired. Verified end-to-end against a live GitHub PAT (65 repos listed, 2 picks persisted, filter narrows from 5 → 1 credential).

This handoff covers three axes of follow-up work:

1. **Connector coverage gaps** — services not yet covered, with the engineering each one needs
2. **2-level chain improvements** — the `depends_on` machinery exists but is untested; specific chains to wire and the missing helpers (base64 auth, host-fallback templating)
3. **Deferred items** — known gaps from this session (caching, stale-resource detection, persona-build auto-fill, Phase 3 runtime enforcement)

Read `docs/resource-scoping-spec.md` first for the schema; this doc references but does not repeat it.

---

## 1. State of play (one-screen reference)

**Files you'll touch most often:**
- `scripts/connectors/builtin/*.json` — per-connector `resources[]` definitions
- `scripts/add-resources-batch.mjs` — script that bulk-injects specs (run after editing)
- `src-tauri/src/engine/resource_listing.rs` — HTTP dispatcher (template substitution, pagination, JSONPath-lite)
- `src-tauri/src/commands/credentials/resources.rs` — three Tauri commands: `get_scoped_resources`, `save_scoped_resources`, `list_connector_resources`
- `src-tauri/src/ipc_auth.rs` — `PRIVILEGED_COMMANDS` list (the two write-side commands are gated)
- `src/features/vault/sub_credentials/components/picker/` — `ResourcePicker.tsx`, `ResourcePickerHost.tsx`, `resourcePickerStore.ts`, `usePostSaveResourcePicker.tsx`
- `src/features/templates/sub_generated/adoption/useDynamicQuestionOptions.ts` — `requires_resource` filter at line ~101
- `src/api/credentials/scopedResources.ts` — bridge functions (get/save/listConnectorResources)
- `src/lib/types/types.ts` — `ResourceSpec`, `CredentialMetadata.scopedResources`

**Coverage matrix:**

| Tier | Connectors | Status |
|---|---|---|
| Tier 1 — done | github, gitlab, notion, airtable, google-drive, slack, linear, jira, elevenlabs, sentry, discord, dropbox, confluence, asana, monday, hubspot, pipedrive, posthog, vercel, netlify, attio, clickup, neon, azure-devops | 24 |
| Tier 2 — gaps below | mongodb, postgres, supabase tables, microsoft-teams, sharepoint, figma, mixpanel, gmail, microsoft-outlook, youtube-data, stripe, twilio_sms, calendar connectors | 13 |
| Tier 3 — skip on purpose | aws_s3, cloudflare_r2, backblaze_b2 (SigV4), arxiv/pubmed/news_api/firecrawl/apify (single-endpoint search), zapier/n8n (user targets workflows by ID), twin, personas_messages/database/vector_db (local) | ~14 |

The remaining 119 − 24 − 13 − 14 ≈ 68 connectors don't have meaningful sub-resources to scope (single-endpoint APIs, fire-and-forget notification channels, etc.) — leave them with `resources` absent.

---

## 2. Connector coverage gaps (Tier 2)

Each row tells you what to add, the engineering risk, and the verification path. Implement in the order shown — easiest first.

### 2.1 — Quick wins (single endpoint, no chain, no missing helper)

| Connector | Resources | Endpoint sketch | Notes |
|---|---|---|---|
| **mongodb** | `databases` | Use Atlas Admin API `GET /groups/{groupId}/databases` if `connection_string` is Atlas; else introspect via `listDatabases` admin command. Probably skip for direct mongodb URLs and only support Atlas-backed. | Auth field is `connection_string`. For Atlas: also need `public_key` + `private_key` (digest auth — needs basic-auth helper). **Wait until §3.3 lands.** |
| **gmail** | `labels` | `GET https://gmail.googleapis.com/gmail/v1/users/me/labels` with OAuth `Bearer {{access_token}}`. Response: `{labels: [{id, name, type}]}` filtered by `type==='user'`. | OAuth — same auth pattern as google-drive. Easy. |
| **microsoft-outlook** | `folders` | `GET https://graph.microsoft.com/v1.0/me/mailFolders?$top=100` with `Authorization: Bearer {{access_token}}`. Response: `{value: [{id, displayName, parentFolderId, totalItemCount}]}`. | OAuth via Microsoft Graph. Easy. |
| **youtube-data** | `channels` | `GET https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true` with `Bearer {{access_token}}`. Returns the user's own channels. | OAuth. Easy. |
| **mixpanel** | `projects` | `GET https://mixpanel.com/api/app/projects/` with service-account auth `Authorization: Basic {{base64(service_account_username:service_account_secret)}}`. **Needs §3.3 base64 helper.** | Wait for base64 helper. |
| **stripe** | `accounts` (Connect) or `products` | `GET https://api.stripe.com/v1/products?limit=100` with `Authorization: Bearer {{api_key}}`. List of products on the account. For Connect, list connected accounts via `GET /v1/accounts`. | Pick whichever the user actually wants to scope by — most users want products. Easy. |
| **twilio_sms** | `phone_numbers` | `GET https://api.twilio.com/2010-04-01/Accounts/{{account_sid}}/IncomingPhoneNumbers.json` with Basic auth. **Needs §3.3.** | Wait for base64. |

### 2.2 — Medium (single endpoint but unusual response shape or auth)

| Connector | Resources | Engineering notes |
|---|---|---|
| **calendly** | `event_types` | `GET https://api.calendly.com/event_types?user={{user_uri}}` — but `user_uri` requires a /me lookup first. Either fetch user_uri at credential save time and store as a non-sensitive field, or do a 2-call list (call /me, then /event_types). Two-call lists aren't supported by the current dispatcher; skip until you need it. |
| **google-calendar** | `calendars` | `GET https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250` with OAuth bearer. Easy if you already added Gmail. |
| **microsoft-calendar** | `calendars` | `GET https://graph.microsoft.com/v1.0/me/calendars?$top=100`. Same pattern as Outlook folders. |
| **buffer** | `channels` | `GET https://api.bufferapp.com/1/profiles.json?access_token={{access_token}}` (token in query, not header). Verify Buffer's current API — newer Buffer uses GraphQL at `https://graph.buffer.com/v1/graphql`. |
| **shopify** (not in catalog yet, but candidate) | `products`, `collections`, `locations` | Per-shop auth via shop subdomain — needs `{{shop_subdomain}}.myshopify.com` URL. Probably not worth adding until a Shopify connector exists. |

### 2.3 — Hard / chained (need §3.4 chain testing first)

| Connector | Chain | Why it's hard |
|---|---|---|
| **supabase** | `projects → tables` | Tables endpoint is `https://api.supabase.com/v1/projects/{ref}/tables` (Management API, separate token). Most users have only the data-plane creds (`project_url` + `anon_key`), which can't list tables. Solution: skip tables, just scope at project level — but `project_url` is already a field, so scoping is already done. Unless we want to surface tables via the data plane's `GET /rest/v1/?apikey=…` (returns OpenAPI spec where keys-of-`paths` are tables). That requires a `response_mapping.items_path` extension to support "object keys as items" (currently we only support arrays). |
| **microsoft-teams** | `teams → channels` | `GET /me/joinedTeams` then `GET /teams/{id}/channels`. Standard 2-level chain — works once §3.4 verifies the depends_on plumbing. |
| **sharepoint** | `sites → lists` | `GET /sites?search=*` then `GET /sites/{id}/lists`. Same shape. |
| **figma** | `teams → projects → files` | 3-level chain. Plus `/v1/me/teams` is Enterprise-only — for free/Pro plans the user has to manually paste a team_id. Defer until 2-level is solid. |
| **clickup** | `workspaces → spaces → lists` | Already have workspaces. Add spaces (depends_on workspaces) and lists (depends_on spaces). 3-level. |
| **asana** | already have workspaces + projects (independent) — make projects depend on workspace_id | Refactor existing Asana spec. |

---

## 3. Picker / dispatcher gaps (engineering work)

The current `engine/resource_listing.rs` has the basic shape but several known holes. Each subsection below is a self-contained task.

### 3.1 — Cache layer (currently every picker open hits the API)

The spec carries `cache_ttl_seconds` on every resource, and the picker shows a Refresh button — but the dispatcher doesn't actually cache. Every render of the modal re-fires the list call.

**File:** `src-tauri/src/engine/resource_listing.rs`

**Approach:** in-memory LRU keyed by `(credential_id, resource_id, hash(depends_on_context))`, TTL from spec. Use `once_cell::sync::Lazy` + `Mutex<HashMap<…, (Instant, Vec<ResourceItem>)>>`. Force-refresh from the picker's `RefreshCw` button by passing a `bypass_cache: bool` arg (extend the Tauri command signature).

**Rough shape:**
```rust
static CACHE: Lazy<Mutex<HashMap<CacheKey, CacheEntry>>> = Lazy::new(|| Mutex::new(HashMap::new()));
struct CacheEntry { fetched_at: Instant, ttl: Duration, items: Vec<ResourceItem> }

pub async fn list_resources(..., bypass_cache: bool) -> Result<Vec<ResourceItem>, AppError> {
    if !bypass_cache {
        if let Some(hit) = cache_get(...) { return Ok(hit); }
    }
    let items = /* fetch + map as today */;
    cache_put(..., items.clone(), ttl);
    Ok(items)
}
```

Update the picker hook to call with `bypass_cache: true` only when the user clicks Refresh.

### 3.2 — Stale-resource detection

When a user's stored `scoped_resources` references a deleted upstream resource (e.g. they deleted a GitHub repo), the chip in the picker should show a warning.

**File:** `src/features/vault/sub_credentials/components/picker/ResourcePicker.tsx`

After fetch, compute `stalePicks = picks.filter(p => !items.some(i => i.id === p.id))`. Render those chips with `isUnknown` styling (already used by the gallery's TemplateCategoryPills as precedent). Offer a one-click "Drop stale picks" action.

### 3.3 — Missing template helpers

The dispatcher's `resolve_template` (reused from `engine/healthcheck.rs::resolve_template`) only does flat `{{key}}` substitution. Several connectors need:

**`{{base64(field1:field2)}}` helper** — for HTTP Basic auth (Jira, Confluence, Mixpanel, Twilio, Azure DevOps). Currently those connectors have `Authorization: Basic {{base64(email:api_token)}}` in their spec but the substitution is literal — so the request goes out with the unresolved template string in the header.

Implementation: extend `resolve_template` to recognize `{{base64(a:b)}}` syntax. Look up `a` and `b` in the field map, concat with `:`, base64-encode, substitute.

**`{{host|default}}` fallback syntax** — PostHog has `{{host|https://us.posthog.com}}` to handle EU vs US clouds. Currently the dispatcher leaves the template literal in place, which fails URL validation.

Implementation: extend `resolve_template` to parse `{{key|fallback}}` — if `key` is missing or empty, use everything after the `|`.

Both of these are 20-line additions. Add tests in `engine/healthcheck.rs::tests` since `resolve_template` lives there. (Don't move it — keep it where it is to avoid touching healthcheck mid-flight.)

### 3.4 — Verify the `depends_on` chain end-to-end

The dispatcher already accepts a `depends_on_context` parameter and the spec supports `depends_on: [...]`, but no current connector exercises it. To test:

1. Refactor **asana** so `projects` declares `depends_on: ["workspaces"]` and the URL becomes `https://app.asana.com/api/1.0/workspaces/{{selected.workspaces.id}}/projects?archived=false&limit=100`.
2. Open the picker with a real Asana PAT. Select a workspace; verify projects list refreshes against that workspace.
3. The picker UI's `topoSortSpecs` already orders dependencies; it should show the `projects` section gated by `Pick a workspaces first` until the user picks one.

**Bug to check during this:** the dispatcher only flattens `selected.<id>` (scalar) and `selected.<id>.<prop>` (one-level object). For chains where `id.full_name` matters (GitHub: pick a repo, then list its branches), it works. For nested object access (`selected.team.organization.id`), it doesn't. Either widen the flattener or document the limitation.

After Asana verifies, do **microsoft-teams** as a second proof — it's the cleanest 2-level chain (`/me/joinedTeams` → `/teams/{id}/channels`) and unlocks a high-value connector.

### 3.5 — Object-keys-as-items mapping

`response_mapping.items_path` only supports paths to arrays. Some APIs return objects whose keys are the resources (Supabase OpenAPI's `paths`, generic JSON Schema enums). Add a sentinel like `items_path: "$keys:paths"` that takes the keys of `paths` as a synthetic array of strings, then `id` and `label` both default to `$value`.

Don't bother until you have a connector that needs it (currently only Supabase tables).

### 3.6 — Validation on save

`save_scoped_resources` validates only that the JSON parses. It doesn't check that picked resource ids match the connector's spec definitions, or that selection-mode constraints (`single` → max 1 pick) are honored.

**File:** `src-tauri/src/commands/credentials/resources.rs`

Before persist: load the connector, parse `resources[]`, for each key in the incoming blob check that the spec exists, the picked count fits the `selection` mode, and each pick has `id` + `label`. Reject malformed payloads at the IPC boundary.

---

## 4. Template-side gaps

### 4.1 — Persona-build auto-fill from scoped resources

Currently `requires_resource` filters credentials but doesn't consume the picks. If a user scopes a GitHub credential to one repo and uses a template that asks "Which repo?", the template should auto-fill `xkazm04/personas` instead of asking again.

**Approach (sketch):**

When the build compiler materializes `sample_input` and template parameters, look up the chosen credential's `scoped_resources[<requires_resource>]`. If exactly one pick exists, inject it as the default for any param whose name maps to that resource (convention: param named `repo_name` ↔ resource `repositories`). If multiple picks exist, render a sub-question "Which one of your scoped repositories?" with the picks as options.

**Touch points:**
- `src-tauri/src/engine/build_session/` (the compiler — your in-flight area; coordinate before editing)
- `src/features/templates/sub_generated/adoption/` — possibly a new question type like `scoped_resource_pick`
- Convention map of resource id → likely template-param names, or an explicit `auto_fill_param` field on the connector slot

This is the highest-value follow-up — without it, users have to type their picked repo name into the agent again, which defeats half the point of scoping.

### 4.2 — Slot-level `requires_resource` (currently only at question level)

Right now templates declare `requires_resource` on the `dynamic_source` of an adoption question. It would be cleaner to declare it on the **connector slot** (`payload.persona.connectors[].requires_resource`) so the relationship is visible at the slot definition, and the question's `dynamic_source` derives it from the slot.

**Impact:** zero functional change today — the question-level field works. But for template authors, slot-level is more discoverable. Add it as a parallel field; if both are present, slot wins.

**File to extend:** template type definitions in `scripts/templates/*.json` schema docs (and the `/add-template` skill).

### 4.3 — Author one real template that uses `requires_resource`

The filter is implemented but no template actually uses it yet. Pick one of the GitHub-using templates (e.g. `scripts/templates/development/autonomous-issue-resolver.json`) and add `requires_resource: "repositories"` to its source-control adoption question. Re-run adoption → confirm only the scoped credential surfaces.

This is the smoke test that proves the template-side flow works end-to-end.

### 4.4 — Update `/add-template` skill

After 4.2 and 4.3 land, document `requires_resource` in `.claude/skills/add-template/skill.md` so any new template authored via the skill automatically picks up the pattern when relevant.

---

## 5. Phase 3 — runtime enforcement (deferred decision)

Today: scoping changes who shows up in the credential picker, and which picks the agent receives at start. But once the agent is running with valid credentials, there's nothing stopping it from making API calls to a non-scoped resource (e.g. user scoped to repo A, but the agent calls `GET /repos/owner/B`).

**Phase 3 plan (sketch — not started):**

Block tauri-invoke calls in real time when the target resource isn't in the credential's `scoped_resources`. Practically: extend `commands/credentials/api_proxy.rs::execute_api_request` (the centralized HTTP relay agents go through) to look up the credential's scope, parse the request URL, and reject if the URL's resource segment isn't allow-listed.

**Big questions to answer before implementing:**

1. **URL parsing per service** — extracting "the repo segment" from `/repos/{owner}/{repo}/issues` is service-specific. Need a per-connector matcher in the spec, e.g. `enforce.url_pattern: "/repos/{repository}/.*"` mapping to `requires_resource: "repositories"`.
2. **What about MCP / desktop bridges** — they don't go through `execute_api_request`. Need an analogous gate.
3. **User opt-in** — runtime enforcement could break existing agents that were running broad-scoped before. Default to "warn-only" mode (log violations, don't block) until the user explicitly toggles enforcement on per-credential.

This is a 2–3 day effort. Treat as Phase 3 and leave for a focused session.

---

## 6. Concrete checklist for the next session

A starting prompt for the next session:

> Read `docs/HANDOFF-resource-scoping.md`. Pick a numbered subsection from §2, §3, or §4 and execute it end-to-end (code + test against a real credential where possible). Keep changes additive and don't touch `engine/build_session/` or `engine/runner/` (in-flight). Verify with `cargo check` + `npx tsc --noEmit` + a live test-automation drive.

Recommended order of attack:

1. **§3.3** — base64 + host-fallback template helpers (unblocks 5 connectors)
2. **§3.4** — verify depends_on with refactored Asana (unblocks 6 chained connectors)
3. **§2.1** — gmail, outlook-mail, youtube, stripe, mixpanel (5 quick wins after helpers land)
4. **§4.1** — persona-build auto-fill (highest user-facing value but largest scope; needs coordination on `engine/build_session/`)
5. **§3.1** — cache layer (perf nice-to-have)
6. **§3.2** — stale-resource detection (UX polish)
7. **§4.3** — author one real template using `requires_resource` (smoke test)
8. **§5** — Phase 3 runtime enforcement (only after the user has actively scoped credentials in production for a while)

---

## 7. Mechanical reminders

- **After editing any connector JSON:** `node scripts/generate-connector-seed.mjs` to refresh the Rust seed.
- **After adding new resource specs in bulk:** extend `scripts/add-resources-batch.mjs` rather than editing each file by hand.
- **After Rust struct changes:** `cargo test --lib --no-run` triggers ts-rs binding regeneration. (Test-suite is currently broken on master from in-flight `runner/build_session` work — manual binding edits in `src/lib/bindings/*.ts` are okay until that clears.)
- **Privilege gate:** when adding a new write-side Tauri command, add it to `PRIVILEGED_COMMANDS` in `src-tauri/src/ipc_auth.rs` AND register it in `src-tauri/src/lib.rs::invoke_handler!`. Async commands should call `require_privileged(...).await` (not `require_privileged_sync`).
- **Test automation testids on the picker:** `resource-picker`, `resource-picker-skip`, `resource-picker-cancel`, `resource-picker-save`, `resource-pick-{specId}-{itemId}`. Catalog form: `vault-test-connection`, `vault-schema-save`, `vault-schema-cancel`, `vault-field-{key}-input`.
- **End-to-end smoke flow** once running: Catalog → GitHub → fill PAT → Test Connection → Save → ResourcePicker opens → pick repos → Save scope → re-edit credential → picker reopens with current picks pre-selected.
