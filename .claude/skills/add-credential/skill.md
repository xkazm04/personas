# Add Connector to Credential Catalog

You are adding a new connector to the Personas Desktop credential catalog. The user will provide a tool/service name and you will research it thoroughly and create all required artifacts.

## Input

Ask the user: **"What tool or service would you like to add to the credential catalog?"**

Wait for the user's response. Once you have the name, proceed with the following steps.

## Step 1: Research the Service

Use WebSearch and WebFetch to research the following about the service. **Important: always include the current year (2026) in search queries to get the latest information.**

1. **Official API documentation URL** — find the developer docs
2. **Authentication methods** — what auth does the API support? Common types:
   - `pat` — Personal Access Token (most common)
   - `api_key` — API Key
   - `oauth` — OAuth 2.0
   - `basic` — Basic Auth (email + token or username + password)
   - `basic_api_token` — Basic Auth with API token (like Jira: email + api_token)
   - `bot_token` — Bot Token (like Slack, Discord)
   - `connection_string` — Database connection string
   - `service_token` — Service Token with ID (like PlanetScale)
3. **API base URL** — is it a fixed well-known URL (like `https://api.github.com`) or user-specific (like `https://your-instance.example.com`)?
4. **Brand color** (hex) — the official brand color for the logo
5. **Category** — one of: `productivity`, `development`, `database`, `messaging`, `automation`, `monitoring`, `analytics`, `design`, `cloud`, `crm`, `support`, `social`, `commerce`, `finance`, `scheduling`, `cms`, `search`, `video`, `auth`, `hr`, `ai`, `storage`, `forms`, `email`
6. **Healthcheck endpoint** — a simple GET (or POST) endpoint to validate credentials (like `/user`, `/me`, `/users/me`, `/whoami`)
7. **Key API endpoints** — 5-8 most useful endpoints for the API Explorer
8. **MCP server availability** — check if there's an official or popular MCP server package (npm) for this service
9. **Pricing tier** — `free`, `freemium`, or `paid`
10. **SVG icon** — search for the service's SVG icon from Simple Icons (https://simpleicons.org/) or the service's brand assets

Present your research findings to the user in a summary table before proceeding. Ask them to confirm or correct anything.

## Step 2: Create the Connector JSON

Create a file at `scripts/connectors/builtin/{name}.json` following this exact structure.

### 2a. Standard (PAT/API Key) Connector

```json
{
  "id": "builtin-{name}",
  "name": "{snake_case_name}",
  "label": "{Display Name}",
  "color": "#{hex_color}",
  "icon_url": "/icons/connectors/{name}.svg",
  "category": "{category}",
  "fields": [
    {
      "key": "{field_key}",
      "label": "{Field Label}",
      "type": "password|text|url",
      "required": true|false,
      "placeholder": "...",
      "helpText": "Where to find this value"
    }
  ],
  "healthcheck_config": {
    "endpoint": "https://api.example.com/endpoint",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer {{field_key}}"
    },
    "description": "Validates {auth_type} via {endpoint_name}"
  },
  "services": [],
  "events": [],
  "resources": [],
  "metadata": {
    "template_enabled": true,
    "summary": "One-line description of the service.",
    "auth_type": "{auth_type_id}",
    "auth_type_label": "{Auth Type Label}",
    "docs_url": "https://docs.example.com/api",
    "setup_guide": "1. Step one\n2. Step two\n3. ...",
    "pricing_tier": "free|freemium|paid",
    "auth_methods": [
      {"id": "{auth_id}", "label": "{Auth Label}", "type": "credential", "is_default": true}
    ]
  }
}
```

### 2b. OAuth 2.0 Connector (Authorization Code Flow)

For services that use OAuth 2.0 (e.g., LinkedIn, Spotify, Dropbox OAuth), use this structure instead:

```json
{
  "id": "builtin-{name}",
  "name": "{name}",
  "label": "{Display Name}",
  "color": "#{hex_color}",
  "icon_url": "/icons/connectors/{name}.svg",
  "category": "{category}",
  "fields": [
    {
      "key": "client_id",
      "label": "Client ID",
      "type": "text",
      "required": true,
      "placeholder": "...",
      "helpText": "From the {Display Name} developer portal"
    },
    {
      "key": "client_secret",
      "label": "Client Secret",
      "type": "password",
      "required": true,
      "placeholder": "",
      "helpText": "From the {Display Name} developer portal"
    }
  ],
  "healthcheck_config": {
    "endpoint": "https://api.example.com/userinfo",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer {{access_token}}"
    },
    "description": "Validates OAuth token via {endpoint_name}"
  },
  "services": [],
  "events": [],
  "metadata": {
    "template_enabled": true,
    "summary": "One-line description of the service.",
    "auth_type": "oauth",
    "auth_type_label": "OAuth",
    "oauth_provider_id": "{provider_id}",
    "oauth_scopes": ["scope1", "scope2"],
    "docs_url": "https://docs.example.com/oauth",
    "setup_guide": "1. Go to developer portal and create an app\n2. Copy Client ID and Client Secret\n3. Add http://127.0.0.1 as an authorized redirect URL\n4. Paste credentials here, then click Authorize with {Display Name}",
    "pricing_tier": "free|freemium|paid",
    "auth_methods": [
      {"id": "oauth", "label": "OAuth", "type": "oauth", "is_default": true}
    ]
  }
}
```

**Key differences for OAuth connectors:**
- Fields are `client_id` (text) + `client_secret` (password) — user provides their OAuth app credentials
- `healthcheck_config` uses `{{access_token}}` — the token obtained from the OAuth flow
- `metadata.auth_type` is `"oauth"`
- `metadata.oauth_provider_id` must match a provider in the Rust `PROVIDER_REGISTRY`
- `metadata.oauth_scopes` lists default scopes to request
- `metadata.auth_methods` uses `"type": "oauth"` (not `"credential"`)
- `setup_guide` must include step to add `http://127.0.0.1` as redirect URL

### OAuth Provider Registration (Rust)

For OAuth connectors, you MUST also add the provider to the `PROVIDER_REGISTRY` in `src-tauri/src/commands/credentials/oauth.rs`:

```rust
OAuthProviderConfig {
    id: "{provider_id}",
    name: "{Display Name}",
    authorize_url: "https://example.com/oauth/authorize",
    token_url: "https://example.com/oauth/token",
    supports_pkce: true,  // check the provider's docs
    extra_auth_params: &[],  // e.g., &[("access_type", "offline")] for refresh tokens
    default_scopes: &["scope1", "scope2"],
},
```

Research the service's OAuth documentation to find:
- Authorization URL (where users consent)
- Token URL (where the app exchanges code for token)
- Whether PKCE is supported (most modern providers do)
- Required scopes for basic profile + key functionality

### Field type rules:
- `password` — for secrets (tokens, keys, passwords). These get encrypted in the vault.
- `text` — for non-secret identifiers (email, domain, org slug, account ID)
- `url` — for URLs (instance URL, project URL). Used for self-hosted services.

### Auth header patterns:
- Bearer token: `"Authorization": "Bearer {{api_key}}"`
- Basic auth: `"Authorization": "Basic {{base64(email:api_token)}}"`
- Bot token: `"Authorization": "Bot {{bot_token}}"`
- Custom header: `"X-Api-Key": "{{api_key}}"`
- Query param auth: append to endpoint URL `?key={{api_key}}`
- OAuth (after flow): `"Authorization": "Bearer {{access_token}}"` — handled automatically

### Healthcheck endpoint patterns:
- Use field template vars like `{{field_key}}` in headers
- Use `{{domain}}` prefix for user-specific base URLs: `"endpoint": "https://{{domain}}/api/me"`
- Use `{{base_url}}` prefix for self-hosted: `"endpoint": "{{base_url}}/api/health"`
- Use `{{host|https://default.com}}` for optional host with default
- For OAuth connectors, use `{{access_token}}` in the Bearer header

## Step 3: Create SVG Icon

Create `public/icons/connectors/{name}.svg`.

**CRITICAL**: The SVG MUST use `fill="currentColor"` (not a hardcoded color) so it works with the theme-aware CSS mask-image rendering. Follow this pattern:

```svg
<svg fill="currentColor" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>{Name}</title><path d="..."/></svg>
```

If Simple Icons has the icon, use that path data. If not, create a recognizable simplified icon or use the first letter of the service name as a stylized glyph.

If the service already has an icon on `cdn.simpleicons.org` that works well, you can use the CDN URL instead of a local SVG (set `icon_url` in the JSON to the CDN URL like `https://cdn.simpleicons.org/{name}/{color}`). But local SVGs are preferred for reliability.

## Step 4: Add to Rust Seed Data

Add a new `BuiltinConnector` entry in `src-tauri/src/db/mod.rs` inside the `seed_builtin_connectors` function's `connectors` array. Place it in alphabetical order or near similar connectors.

The entry must match the JSON exactly — the fields JSON, healthcheck_config, and metadata are inline strings in Rust:

```rust
BuiltinConnector {
    id: "builtin-{name}",
    name: "{snake_case}",
    label: "{Display Name}",
    color: "#{hex}",
    icon_url: "/icons/connectors/{name}.svg",
    category: "{category}",
    fields: r#"[...]"#,
    healthcheck_config: Some(r#"{...}"#),
    metadata: Some(r#"{...}"#),
},
```

For the inline JSON strings: compact them (no newlines) and use `r#"..."#` raw strings.

## Step 5: Add to Frontend Imports

### 5a. `src/lib/credentials/builtinConnectors.ts`

Add the import and array entry:
```typescript
import {name} from '../../../scripts/connectors/builtin/{name}.json';
// ... in the BUILTIN_CONNECTORS array:
  {name},
```

### 5b. `src/features/shared/components/ConnectorMeta.tsx`

**First check** if the connector already has an entry in `CONNECTOR_META` (many tools are pre-listed with CDN icons). If it exists, update the `iconUrl` to the local SVG and verify `color` matches. If it doesn't exist, add it under the appropriate category section:

```typescript
{name}: { label: '{Display Name}', color: '#{hex}', iconUrl: '/icons/connectors/{name}.svg', Icon: {LucideIcon} },
```

Choose the most appropriate Lucide icon as fallback. Check existing imports at the top of the file.

### 5c. `src/lib/credentials/catalogApiEndpoints.ts`

Add a new endpoint array and export it:
```typescript
// -- {Display Name} ---
const {snake_case}: EP[] = [
  ep('GET', '/endpoint', 'Summary', [params], ['Tag']),
  // ... 5-8 curated endpoints
];
```

Add to the `CATALOG_API_ENDPOINTS` export object.

### 5d. `src/lib/credentials/connectorLicensing.ts`

Add the connector to `LICENSE_OVERRIDES` with the appropriate tier:
```typescript
{name}: 'personal',  // or 'paid' or 'enterprise'
```

### 5e. `src/lib/credentials/connectorRoles.ts`

Add the connector to the appropriate role's `members` array (e.g., `social_media`, `project_tracking`, `database`, etc.).

## Step 6: Add Well-Known Base URL (if applicable)

If the service has a fixed API base URL (not user-specific), add it to the `well_known_base_url()` function in `src-tauri/src/engine/api_proxy.rs`:

```rust
"{snake_case}" => Some("https://api.example.com"),
```

Skip this step if the service requires a user-provided URL (self-hosted instances).

## Step 7: Sync to Supabase Catalog

Upsert the new connector to the `connector_catalog` table in Supabase so it's available for web exposure.

Use the Supabase REST API (PostgREST) to upsert a single row. Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`) env vars.

```bash
# Extract the row data from the JSON file and upsert via curl
node -e "
const c = require('./scripts/connectors/builtin/{name}.json');
const m = c.metadata || {};
const row = {
  id: c.id, name: c.name, label: c.label,
  summary: m.summary || null,
  category: c.category,
  auth_type: m.auth_type || null,
  auth_type_label: m.auth_type_label || null,
  pricing_tier: m.pricing_tier || 'free',
  icon_url: c.icon_url || null,
  color: c.color || null,
  docs_url: m.docs_url || null,
  is_active: true,
};
console.log(JSON.stringify(row));
" | curl -s -X POST \
  '\$SUPABASE_URL/rest/v1/connector_catalog' \
  -H 'Content-Type: application/json' \
  -H 'apikey: \$SUPABASE_KEY' \
  -H 'Authorization: Bearer \$SUPABASE_KEY' \
  -H 'Prefer: resolution=merge-duplicates,return=minimal' \
  -d @-
```

Alternatively, run the full seed script which processes all connectors:
```bash
node scripts/connectors/seed-supabase-catalog.mjs
```

If the env vars are not configured, skip this step and inform the user they can run the seed script later.

## Step 8: Verify

Run these checks:
1. `cargo check` in `src-tauri/` — Rust compilation
2. `npx tsc --noEmit` in project root — TypeScript type checking
3. Verify the JSON file is valid JSON
4. Verify the SVG renders (check `fill="currentColor"` is present)

Report any errors and fix them before completing.

## Step 9: Summary

Print a completion summary:
```
Connector Added: {Display Name}
  Name:       {snake_case}
  Category:   {category}
  Auth:       {auth_type_label}
  Base URL:   {base_url or "user-provided"}
  Endpoints:  {N} API Explorer endpoints
  Icon:       {local SVG or CDN URL}
  MCP:        {package name or "none available"}
  Supabase:   {synced | skipped (no env vars)}

Files created/modified:
  + scripts/connectors/builtin/{name}.json
  + public/icons/connectors/{name}.svg  (if local)
  ~ src-tauri/src/db/mod.rs
  ~ src-tauri/src/engine/api_proxy.rs         (if well-known URL)
  ~ src-tauri/src/commands/credentials/oauth.rs  (if OAuth — add to PROVIDER_REGISTRY)
  ~ src/lib/credentials/builtinConnectors.ts
  ~ src/features/shared/components/ConnectorMeta.tsx
  ~ src/lib/credentials/catalogApiEndpoints.ts
  ~ src/lib/credentials/connectorLicensing.ts
  ~ src/lib/credentials/connectorRoles.ts
  → Supabase connector_catalog (upsert)
```

---

## Step: Resource scoping (2nd-level selection)

**Mandatory question to ask when authoring a new connector:**

> Does this service expose user-scopable sub-resources (repos, projects, tables, folders, voices, workspaces, buckets, etc.) that templates might want to pin to a specific instance?

If **yes**, populate `resources[]` on the connector JSON. If **no**, leave `"resources": []`.

The full schema + pagination modes + templating rules live in `docs/resource-scoping-spec.md`. Copy the GitHub example as your starting point. One spec per user-pickable resource type; chain via `depends_on` for hierarchies (e.g. Figma teams → projects → files).

**Minimum viable `resources[]` entry checklist:**

1. `id` — stable snake_case (e.g. `repositories`, `projects`, `tables`, `voices`).
2. `label` — pluralized user-facing (e.g. `"Repositories"`).
3. `selection` — `"single"`, `"multi"`, or `"single_or_all"` based on how templates will consume.
4. `list_endpoint.{method,url,headers}` — prefer a single, authenticated "list mine" endpoint. Use `{{field_key}}` templating to pull auth from credential fields. Include `User-Agent` where APIs require it.
5. `list_endpoint.pagination` — pick from `none`, `link_header`, `page_param`, `cursor`. Set `max_pages` to a safe bound (3–10 typical).
6. `response_mapping` — `items_path` (usually `$`), plus `id`, `label`, optional `sublabel` and `meta`. Values are JSONPath-lite into a single item.
7. `search.mode` — `client` for lists ≤500 items, `server` for larger services.
8. `cache_ttl_seconds` — default `600`. Longer (3600+) for slow-moving things like orgs.

**Verify before committing:**
- Paste the `url` + `headers` into curl with a real token. Confirm shape of response.
- Check that every `response_mapping` path actually exists in a real item.
- If pagination mode is `page_param` or `cursor`, test with an account that has >1 page of results.

**Do NOT populate `resources[]` for:**
- Connectors whose usage is single-endpoint (search APIs like arXiv, PubMed, news APIs).
- Fire-and-forget notification channels (Novu, Knock, ntfy, Twilio SMS).
- Built-in local services (personas_database, personas_messages, personas_vector_db).
- Wrappers like Zapier, n8n, MCP gateways (users target specific workflows/servers by ID in template params, not via resource scoping).

**After adding `resources[]`:**
- Re-run `node scripts/generate-connector-seed.mjs` to refresh `builtin_connectors.rs`.
- Test in dev: add the credential, confirm picker opens, confirm picks persist in `persona_credentials.scoped_resources`.
