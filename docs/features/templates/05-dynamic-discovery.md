# Dynamic discovery engine

Lets template adoption questions populate their option list from a real
connector API at adoption time. Instead of the user typing "my Sentry
project slug", the question shows a live list of their actual projects
pulled via the API.

Server-side: credential secrets never cross to JS. Field interpolation,
auth, and HTTP all happen in Rust via the existing `api_proxy`. Only
`{value, label, sublabel}` triples come back to the frontend.

## Architecture

```
 Template JSON question
 { dynamic_source: { service_type, operation, ... } }
            │
            ▼
 useDynamicQuestionOptions hook (frontend)
   ├── pick first healthy credential matching service_type
   ├── fingerprint (credId + op + parent answer + retry)
   ├── call discoverConnectorResources IPC
   └── expose { loading, ready, error, items } to QuestionCard
            │
            ▼
 discover_connector_resources (Tauri command)
   └── require_privileged audit log
            │
            ▼
 discover_resources (engine/discovery.rs)
   ├── REGISTRY.get((service_type, operation)) → DiscoveryOp
   ├── LocalCodebases → reads dev_projects table directly
   └── Http → load credential, interpolate path, call api_proxy
            │
            ▼
 api_proxy::execute_api_request
   ├── Resolve base URL (domain field / well-known / dynamic)
   ├── Apply connector strategy auth (Bearer / Basic / OAuth / header)
   ├── SSRF guard, rate limit (token bucket)
   └── HTTP request + bounded response read
            │
            ▼
 JSON parse → extract_path(items_path)
           → for each item: extract_string(value_path / label_path / sublabel_path)
           → Vec<DiscoveredItem> back through the chain
```

## The registry

`src-tauri/src/engine/discovery.rs` holds a compile-time `LazyLock<HashMap>`
keyed by `(service_type, operation)`. Two variants:

### `DiscoveryOp::LocalCodebases`

Special case — bypasses the HTTP path entirely. Reads `dev_projects`
table via `db::repos::dev_tools::list_projects`. Used for the
`(codebases, list_projects)` key because codebases is a desktop-bridge
connector with no HTTP API and no token.

### `DiscoveryOp::Http { ... }`

The general-purpose variant. All fields are `&'static` so the registry
can live in a `LazyLock` without allocations.

```rust
Http {
    method: &'static str,         // "GET", "POST", "PATCH"
    path: &'static str,           // with {{field}} or {{param.x}} tokens
    body: Option<&'static str>,   // static JSON body for POST/GraphQL
    headers: &'static [(&'static str, &'static str)], // e.g. Notion-Version
    items_path: Option<&'static str>,  // None = response IS the array
    value_path: &'static str,     // dotted path per item
    label_path: Option<&'static str>,
    sublabel_path: Option<&'static str>,
}
```

### Path interpolation

`interpolate()` walks `{{key}}` tokens:

- `{{organization_slug}}` → looks up `fields.get("organization_slug")`
  from the credential
- `{{param.project}}` → looks up `params.get("project")` from the
  caller (used for chained discovery via `depends_on`)

Resolved values are rejected if they contain `/`, `?`, `#`, or control
characters — this prevents a malicious credential field from breaking
out of its URL segment. Body interpolation is **not supported in v1**
(bodies are static strings); add an `interpolate_loose` helper if that
becomes a requirement.

### JSON extraction

`extract_path()` walks dotted keys against `serde_json::Value`. Two
tricks:

1. **Numeric segments walk array indices.** So `title.0.plain_text`
   drills into the first array element — needed for Notion's rich-text
   title shape: `title: [{plain_text: "...", type: "text"}]`.
2. **`extract_string` coerces strings, numbers, and booleans** to
   strings. Other types (arrays, objects) return `None`.

## Adding a new op

Minimum viable recipe:

```rust
m.insert(
    ("my_service", "list_widgets"),
    DiscoveryOp::Http {
        method: "GET",
        path: "/api/v1/widgets?per_page=100",
        body: None,
        headers: &[],
        items_path: None,        // root is an array
        value_path: "id",
        label_path: Some("name"),
        sublabel_path: None,
    },
);
```

Then in the template:

```jsonc
{
  "id": "aq_domain_1",
  "type": "select",
  "vault_category": "my-category",
  "option_service_types": ["my_service"],
  "dynamic_source": {
    "service_type": "my_service",
    "operation": "list_widgets",
    "multi": true,
    "include_all_option": true
  }
}
```

## Prerequisites for a new connector

Before adding discovery ops for a new connector, verify:

1. **Auth field name is in `TOKEN_KEYS`**
   `src-tauri/src/engine/connector_strategy.rs` has `find_auth_token()`
   with a static list: `token`, `api_key`, `api_key_v2`, `bot_token`,
   `access_token`, `api_token`, `auth_token`, `personal_access_token`,
   `personal_token`, `apiKey`, `apiToken`, `accessToken`, `botToken`,
   `bearer_token`. If the connector's field has a different name, add
   it to the list **or** write a custom strategy.
2. **Base URL is resolvable.** `api_proxy::execute_api_request`
   resolves base URLs via (in order): `base_url` / `project_url` /
   `url` / `deployment_url` / `redis_url` / `host` / `domain` fields,
   then `dynamic_base_url(service_type, fields)`, then
   `well_known_base_url(service_type)`. Add a new entry to
   `well_known_base_url` for connectors with stable API endpoints.
3. **Connector strategy matches the auth scheme.** If the connector
   needs Basic Auth, OAuth, query-string tokens, or a custom header
   name, register a dedicated strategy. See "Existing strategies"
   below.

## Existing strategies

`src-tauri/src/engine/connector_strategy.rs` registers these in
`init_registry()`:

| Strategy | Service types | Auth mechanism |
|---|---|---|
| `DefaultStrategy` | (fallback) | Bearer with `find_auth_token()` |
| `GoogleOAuthStrategy` | `google-oauth`, `gmail` (exact match), and substring match `google*` | OAuth refresh via `google_oauth` module |
| `MicrosoftOAuthStrategy` | `microsoft-oauth` | OAuth refresh via Microsoft endpoints |
| `BufferStrategy` | `buffer` | Token as `access_token` query param |
| `CircleCIStrategy` | `circleci` | `Circle-Token` header |
| `ClickUpStrategy` | `clickup` (substring) | Raw `Authorization: <token>` (not Bearer) |
| `GitHubStrategy` | `github` | Default Bearer (placeholder for future refinements) |
| `AtlassianBasicAuthStrategy` | `jira`, `confluence` | `email:api_token` → base64 → `Basic <...>` |

### Adding a custom strategy

```rust
pub struct MyConnectorStrategy;

#[async_trait]
impl ConnectorStrategy for MyConnectorStrategy {
    fn is_oauth(&self, _fields: &HashMap<String, String>) -> bool {
        false
    }

    async fn resolve_auth_token(
        &self,
        _metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<ResolvedToken>, AppError> {
        // Combine fields, return ResolvedToken::plain(...)
        let user = find_nonempty(fields, &["email", "username"])?;
        let pw = find_nonempty(fields, &["password", "api_token"])?;
        Ok(Some(ResolvedToken::plain(format!("{user}:{pw}"))))
    }

    fn apply_auth(
        &self,
        request: reqwest::RequestBuilder,
        token: &str,
    ) -> reqwest::RequestBuilder {
        // How the token gets attached to the request
        request.header("X-My-Auth", token)
    }
}
```

Register in `init_registry()`:

```rust
reg.register("my_service", Box::new(MyConnectorStrategy));
```

The registry lookup (`StrategyRegistry::get`) tries exact match first,
then metadata-based oauth_type override, then substring match for
`google*` / `clickup*`, then falls back to `DefaultStrategy`.

## Body + headers support (Notion / GraphQL)

Notion's search endpoint is POST-only and requires a version header:

```rust
m.insert(
    ("notion", "list_databases"),
    DiscoveryOp::Http {
        method: "POST",
        path: "/v1/search",
        body: Some(r#"{"filter":{"value":"database","property":"object"},"page_size":100}"#),
        headers: &[("Notion-Version", "2022-06-28")],
        items_path: Some("results"),
        value_path: "id",
        label_path: Some("title.0.plain_text"),  // walks array index 0
        sublabel_path: None,
    },
);
```

GraphQL endpoints (Linear, Monday) work identically — the `body` is a
JSON-encoded GraphQL request:

```rust
m.insert(
    ("linear", "list_teams"),
    DiscoveryOp::Http {
        method: "POST",
        path: "/graphql",
        body: Some(r#"{"query":"{ teams(first: 100) { nodes { id name key } } }"}"#),
        headers: &[],
        items_path: Some("data.teams.nodes"),
        value_path: "id",
        label_path: Some("name"),
        sublabel_path: Some("key"),
    },
);
```

`execute_api_request` auto-sets `Content-Type: application/json` when a
body is present and custom_headers doesn't already specify it.

## Domain-based base URLs (Jira / Confluence)

Atlassian Cloud APIs live at `https://{domain}/rest/api/3/...` where
`{domain}` is per-tenant. `api_proxy::execute_api_request` already
handles this via field resolution:

```rust
} else if let Some(domain) = fields.get("domain") {
    if domain.starts_with("http://") || domain.starts_with("https://") {
        domain.clone()
    } else {
        format!("https://{domain}")
    }
}
```

So Jira credentials (which carry `domain`, `email`, `api_token`)
naturally build the correct base URL. The `domain` field is NOT
interpolated via `{{domain}}` — it's resolved server-side by the
api_proxy layer before the path is appended.

## Chained discovery (`depends_on`)

A question with `dynamic_source.depends_on: "aq_domain_1"` waits for
the parent question's answer before firing its discovery call. The
parent's answer is passed as `params[parent_id]` and available to the
op's path template as `{{param.aq_domain_1}}`.

No shipped template uses chained discovery yet — the mechanism exists
for cases like Sentry "pick an org → then list projects in that org".
The Sentry op uses the credential's `organization_slug` field instead,
so chaining isn't needed.

## Frontend hook internals

`useDynamicQuestionOptions.ts` has three guards worth understanding:

1. **Fingerprint** — `[credentialId, service_type, operation,
   params[depends_on] ?? '', retryCounter]` joined with `|`. Stored in
   `lastFingerprintRef`. If a render produces the same fingerprint,
   the effect skips the fetch entirely. This prevents keystroke-level
   refetching when `userAnswers` changes for unrelated questions.
2. **Stale response guard** — `requestIdRef` increments on every
   fetch. The `.then` and `.catch` handlers check
   `requestIdRef.current[q.id] === capturedRequestId` before applying
   state — so if the user rapidly changes a parent answer, only the
   latest response wins.
3. **Codebases special case** — `service_type === 'codebases'` skips
   the credential lookup entirely and sends `'local'` as the
   credential_id. The Rust side ignores the id for `LocalCodebases`.

Error serialization: Tauri errors come back as `{error, kind}` (Rust
`AppError` serialize impl). The hook's catch handler unwraps `.error`
first, falls back to `.message`, then JSON stringify — this replaced
an earlier version that emitted `"[object Object]"`.

## UI states (`DynamicSelectBody`)

Per-question states rendered in `QuestionnaireFormGrid.tsx`:

| State | Trigger | UI |
|---|---|---|
| `!state` | First render, effect hasn't fired | "Preparing…" + neutral spinner |
| `waitingOnParent` | `depends_on` exists and parent unanswered | "Waiting for earlier answer…" |
| `loading` | Fetch in flight | "Loading options from `<service>`…" + spinner |
| `error` | Fetch rejected | Error message + Retry button + "Add credential" CTA (if blocked) + text fallback input |
| `ready && items.length === 0` | Fetch returned empty | "No `<operation>` found. Create one in `<service>` first." |
| `ready && items.length > 0` | Normal case | "Loaded live from `<service>`" indicator + `SelectPills` with real items |

The text-input fallback in the error state is intentional — adoption
should never be fully blocked behind a failed API call. Users can
always type a value manually.

## Security model

1. **Credential secrets stay in Rust.** Only `DiscoveredItem` triples
   cross the IPC boundary. The frontend never sees decrypted fields.
2. **Path interpolation rejects unsafe characters.** `/`, `?`, `#`,
   and control chars in resolved values throw `AppError::Validation`.
3. **SSRF guard.** `api_proxy::execute_api_request` calls
   `validate_healthcheck_url(&full_url)` before dispatching. Private
   IPs, link-local addresses, and loopback are blocked unless the
   connector metadata explicitly allows them.
4. **Rate limiting.** Per-credential token bucket (default 60 req/min,
   overridable via connector metadata `rate_limit_rpm`). Errors return
   `AppError::RateLimited` with retry-after.
5. **Service type sanity check.** `discover_resources` verifies
   `credential.service_type == service_type` before calling out,
   preventing a template from running a Sentry op against a GitHub
   credential by accident.
6. **Wrapper-level IPC auth intentionally skipped.**
   `discover_connector_resources` is NOT in `PRIVILEGED_COMMANDS` (the
   wrapper allowlist) because of the Windows WebView2 header race
   that intermittently drops `x-ipc-token` for newly-added commands.
   The command body calls `require_privileged` for audit logging,
   matching the pattern used by data-portability commands.

## Debugging 401s during adoption

If a discovery op returns 401 or "Authentication credentials were not
provided":

1. Check `connector_strategy::find_auth_token()` includes the
   connector's token field name. Missing = default strategy returns
   `None` = no auth header attached = 401. Fix: add to `TOKEN_KEYS`.
2. Check the connector needs a custom strategy. Basic Auth / query
   tokens / custom headers require a dedicated strategy — the default
   Bearer won't work.
3. Check `well_known_base_url` has the right host or the credential
   has a usable `base_url`/`domain`/`host` field. If not, the path
   gets resolved against an empty base and the request goes nowhere
   useful.
4. Check connector strategy registration — exact-match first, then
   substring fallback. `gmail` needs exact-match because `"gmail"`
   doesn't contain `"google"`.

The frontend hook logs structured errors via `createLogger` — inspect
the console for `dynamic-option-fetch-failed` warnings with the actual
Rust-side error string.
