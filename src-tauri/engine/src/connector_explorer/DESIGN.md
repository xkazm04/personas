# connector_explorer — reverse-engineering CLI factory (v1)

> Source: `/research` run 2026-05-09 ("Printing Press" walkthrough by Nate
> Herk). The video's distinguishing feature is auto-generating a typed CLI
> for sites with no public API (Skool, Domino's, Craigslist) by exploring
> the site live in a browser session. This module is the v1 personas
> equivalent — a much narrower static-fetch path that demonstrates the
> pipeline shape and produces a usable draft manifest.

## Goal

Take a URL, return a `ConnectorManifestDraft` describing observable
endpoints and likely action shapes. The draft is reviewed by a human (or by
a downstream design-review persona) and accepted into the catalog
(`scripts/connectors/builtin/`) or the bridge catalog
(`scripts/bridges/`) as appropriate.

The draft is intentionally rough. v1 cannot replace a hand-written
manifest; it's a starting point that captures public surface area without
the user having to read HTML.

## What v1 does

```
URL → reqwest GET → parse HTML body
                  → extract <a href> patterns
                  → extract <form action method> shapes
                  → cluster paths by stem (e.g. /api/v1/posts/{id})
                  → emit ConnectorManifestDraft JSON
```

Specifically:

1. **Static fetch.** `reqwest::get(url)` with a 10-second timeout and a
   browser-mimicking User-Agent. Follows redirects. Captures status, body,
   final URL.
2. **HTML scan (regex-based).** v1 deliberately does NOT add a DOM parser
   (`scraper`/`select`) — keeps the dependency graph thin and the analysis
   transparent. Simple regex extracts `href="..."`, `action="..." method="..."`,
   and `<title>` for label inference. This is cheap and good enough for the
   "produce a starting draft" goal; sites with heavy JS rendering won't
   surface much, which is documented behavior.
3. **Endpoint clustering.** Discovered URLs are grouped by path stem.
   `/posts/123` and `/posts/456` collapse to `/posts/{id}` with `id` as a
   numeric param. Variants per stem are recorded for the human reviewer.
4. **Manifest draft emission.** Returns `ConnectorManifestDraft`:
   - `id` — slugified hostname (`api.example.com` → `api-example-com`)
   - `label` — `<title>` text or hostname fallback
   - `base_url` — origin
   - `discovered_endpoints` — list of `DiscoveredEndpoint`
   - `notes` — free-text observations the human should review

## What v1 does NOT do

- **Drive a browser.** No CDP / Playwright integration in v1. Sites that
  require JS to render their main content (most modern SPAs) will produce
  thin drafts. Browser-driven exploration is the natural v2 — it would
  reuse `auto_cred_browser.rs` and `desktop_browser` connector.
- **Capture XHR / fetch traffic.** v2 territory. Requires a CDP session
  and network event observers.
- **Infer authentication.** v2 territory. Requires interacting with the
  site, observing 401/403 responses, recognising auth-flow surface
  (login forms, OAuth redirects).
- **Generate executable code (Go / Rust).** Printing Press emits Go
  binaries. Personas emits manifests for the runtime dispatcher
  (`engine/bridge_manifest/`) — no per-bridge code generation needed
  because the dispatcher is generic.
- **Validate the draft against the live site.** v2 territory.
- **Persist to the catalog.** Caller decides what to do with the draft
  (`/add-credential` flow, `/add-template`, manual review).

## Out-of-scope vs deferred

- **Out of scope permanently:** generating Go/Rust code per bridge.
  Personas's runtime dispatcher renders that work obsolete (one
  manifest, one dispatcher, no per-CLI binary).
- **Deferred to v2:** browser-driven exploration, XHR capture, auth
  inference, draft validation. These are the path to feature parity with
  Printing Press's factory but each is a sizable subsystem.

## Module surface

- `src-tauri/src/engine/connector_explorer/mod.rs`
  - `ConnectorManifestDraft` (struct, ts-export)
  - `DiscoveredEndpoint` (struct, ts-export)
  - `ExplorerError` (enum, transparent over reqwest / parse errors)
  - `ExplorerOptions` (struct: timeout, max_body_bytes, follow_redirects)
  - `pub async fn explore_url(url, opts) -> Result<ConnectorManifestDraft>`
  - `pub fn extract_endpoints_from_html(body, base_url)` (pure, tested)
  - `pub fn cluster_endpoints(endpoints)` (pure, tested)
  - `pub fn slugify_host(host)` (pure, tested)

- `src-tauri/src/commands/design/connector_explorer.rs`
  - `#[tauri::command] async fn connector_explorer_explore(url) -> Result<ConnectorManifestDraft>`

## Testing

- `extract_endpoints_finds_href_and_form` — regex extraction on a
  fixture HTML body.
- `cluster_collapses_numeric_path_segments` — `/posts/123` + `/posts/456`
  → `/posts/{id}`.
- `cluster_keeps_distinct_stems` — `/posts` + `/users` stay separate.
- `slugify_host_handles_dots_and_ports` — `api.example.com:8080` →
  `api-example-com-8080`.
- `extract_handles_relative_urls` — `/foo/bar` resolves against base.
- `extract_ignores_non_http_schemes` — `mailto:` / `tel:` / `javascript:`
  dropped.

The full HTTP path (`explore_url`) is not unit-tested here — it would
require a mock HTTP server. Integration tested via the Tauri command
when the user invokes it on a real URL. v2 should add a `mockito`-based
integration test.
