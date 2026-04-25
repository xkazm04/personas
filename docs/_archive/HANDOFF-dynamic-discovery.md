# Handoff — Dynamic Discovery + Adoption Questionnaire UX (Apr 13–14, 2026)

Session accomplishments and open threads for the "templates + adoption
process" track. Next session will continue from here.

## High-level context

The **template adoption questionnaire** is the form the user fills in when
they click "Adopt" on a template from the gallery. Each question is declared
in the template's `payload.adoption_questions` array and rendered by a React
component hierarchy rooted at `MatrixAdoptionView` → `QuestionnaireFormFocus`.

Over this session we built a **dynamic discovery engine** that lets any
question pull its option list from a real connector API at adoption time,
rather than asking the user to type identifiers. Instead of "What's your
Sentry project slug?" you get a live picker populated from the user's
actual Sentry org.

We also rebuilt the questionnaire UI (Focus + Live Preview variant), fixed
several latent bugs surfaced along the way, and swept the template catalog
for upgrade candidates.

---

## Commit status

### Already on master

| Commit | What |
|---|---|
| `c95d0523` | Wave 1 — vault-aware adoption (`option_service_types`, blocking, filteredOptions) |
| `ac33ecc5` | Wave 2 — adoption resume + runtime project probe |
| `9cf6cd92`–`156d8436` | Modal portal fixes, multi-round questions, UI rounds 3–4 |
| `1200b729` | Discovery engine foundation: Rust `engine/discovery.rs`, Tauri command, frontend hook, Sentry + codebases ops, Sentry template upgrade, inline questionnaire rendering fix, info-tip collapse |
| `0d89a2c8` | 13 more connector ops (github, slack, airtable, asana, clickup, netlify, vercel, cloudflare, neon, betterstack, posthog), 33 template upgrades via regex patcher, `auth_token` TOKEN_KEYS fix, `ipc_auth` adjustment |

### Uncommitted (Waves 3–6, pending user commit)

- **Wave 3** — service_type alias map (`gcp_cloud↔google_cloud`, `aws_cloud↔aws`, `azure_cloud↔azure`), HubSpot discovery ops (`list_deal_pipelines`, `list_ticket_pipelines`), 2 more template upgrades, audit script
- **Wave 4** — engine extensions: `body` + `headers` fields on `DiscoveryOp::Http`, `AtlassianBasicAuthStrategy` for Jira/Confluence Basic Auth, `api_key_v2` in TOKEN_KEYS (Monday), `gmail → google-oauth` strategy routing, 13 new ops (Jira, Confluence, Notion, Linear, Monday, Google Drive, Google Sheets, Gmail), 11 more template upgrades
- **Wave 5** — `QuestionnaireFormFocus` variant + `QuestionnaireFormCarousel` variant with tab switcher, shared `QuestionCard`/`SelectPills`/`CATEGORY_META` exports from Grid, Budget Spending Monitor `allow_custom: true` for currency, multi-select + custom input pattern in `SelectPills`
- **Wave 6** — Variant switcher removed, Focus becomes the only variant with centered max-w-5xl layout, Carousel file deleted, `invalidateTemplateCatalog()` export for dev-mode template JSON reloads, TestReportModal z-index bumped to `z-[10001]` so it overlays the Adoption Wizard's `z-[10000]` portal

All uncommitted work is TS-clean (`npx tsc --noEmit` returns 0 errors) and
Rust-clean (`cargo check --features desktop`).

---

## Architecture overview

### Discovery engine (Rust)

`src-tauri/src/engine/discovery.rs` — compiled-in registry of `DiscoveryOp`
entries keyed by `(service_type, operation)`. Two variants:

- **`Http`** — proxies an HTTP call through `api_proxy::execute_api_request`
  (which handles auth via the connector strategy, rate limiting, SSRF, and
  metrics). Fields:
  - `method`, `path` (with `{{field}}` / `{{param.x}}` interpolation)
  - `body: Option<&'static str>` (static JSON body for POST/GraphQL)
  - `headers: &'static [(&'static str, &'static str)]` (e.g. `Notion-Version`)
  - `items_path`, `value_path`, `label_path`, `sublabel_path` (dotted JSON paths)
- **`LocalCodebases`** — reads from the local `dev_projects` table (codebases
  is a built-in bridge connector with no HTTP API).

The `extract_path` helper walks numeric segments as array indices so paths
like `title.0.plain_text` work for Notion rich-text shapes.

Entry point: `pub async fn discover_resources(pool, credential_id,
service_type, operation, params) -> Result<Vec<DiscoveredItem>>`.

### Tauri command

`src-tauri/src/commands/credentials/discovery.rs` — exports
`discover_connector_resources`. Calls `require_privileged` in-body for
audit logging but is **not** in `PRIVILEGED_COMMANDS` wrapper list because
of the Windows WebView2 header race (same reason `export_credentials` isn't
listed). Registered in `lib.rs` invoke_handler.

### Connector strategies (relevant changes)

`src-tauri/src/engine/connector_strategy.rs`:

- `TOKEN_KEYS` now includes `"auth_token"` (Sentry, Twilio SMS) and
  `"api_key_v2"` (Monday). The default strategy's `find_auth_token()` was
  silently missing credentials stored under these field names.
- New `AtlassianBasicAuthStrategy` — combines `email` + `api_token` into
  base64-encoded `Basic <...>` header, registered for `"jira"` and
  `"confluence"` service_types.
- `"gmail"` registered as exact-match alias for `GoogleOAuthStrategy`
  (the substring fallback `service_type.contains("google")` doesn't match
  `"gmail"`).

### Frontend

`src/api/templates/discovery.ts` — invoke wrapper returning
`Promise<DiscoveredItem[]>`.

`src/features/templates/sub_generated/adoption/useDynamicQuestionOptions.ts`
— hook driving per-question state (`{loading, ready, error, items,
waitingOnParent}`). Handles chained `depends_on` via fingerprint-based
refetch, stale response guards, retry, codebases special case.

`TransformQuestionResponse` (`src/api/templates/n8nTransform.ts`) has a new
optional `dynamic_source` field:

```ts
dynamic_source?: {
  service_type: string;
  operation: string;
  depends_on?: string;
  multi?: boolean;
  include_all_option?: boolean;
};
```

### Vault matcher

`src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts`:

- Handles `dynamic_source` questions by blocking them if no matching
  credential exists (so the top "credentials required" banner lights up).
- Alias-aware via `SERVICE_TYPE_ALIASES` map:
  ```ts
  gcp_cloud: ['gcp_cloud', 'google_cloud'],
  aws_cloud: ['aws_cloud', 'aws'],
  azure_cloud: ['azure_cloud', 'azure'],
  ```
  Fixes the Budget Spending Monitor case where CLI-probed credentials
  (`auth_detect.rs`, `foraging.rs`, `healthcheck.rs` all emit short names)
  silently failed to match templates that only list canonical names.

### UI — Focus + Live Preview variant

`QuestionnaireFormFocus.tsx` is the only adoption questionnaire variant.
Two-column layout centered in a `max-w-5xl` shell so wide screens don't
pull the halves apart:

- **Left column**: one question at a time (big), arrow-key navigation,
  direction-aware slide transitions, clickable top stepper strip.
- **Right column**: live "persona brief" card grouped by template category.
  Every row is clickable to jump to that question. Auto-detected values
  show an `auto` badge. Unanswered rows show muted italic placeholders.

Shared sub-components are exported from `QuestionnaireFormGrid.tsx` and
reused by Focus: `QuestionCard`, `SelectPills`, `PillOption`,
`CATEGORY_META`, `FALLBACK_CATEGORY`, `groupByCategory`.

`SelectPills` supports multi-select + `allow_custom` in one component:
custom values appear as dismissable primary-colored pills alongside
preset pills, Enter commits / Escape cancels / blur commits in
single-select mode, `+ Custom…` button reveals an input in multi-select.

---

## Connector discovery registry — full list

### Simple Bearer-auth HTTP ops
- **sentry** · `list_projects`, `list_environments` (needs `organization_slug` field)
- **github** / **github_actions** · `list_repos`, `list_orgs`
- **slack** · `list_channels`
- **airtable** · `list_bases`
- **asana** · `list_workspaces`, `list_projects`
- **clickup** · `list_teams`
- **netlify** · `list_sites`
- **vercel** · `list_projects`
- **cloudflare** · `list_zones`
- **neon** · `list_projects`
- **betterstack** · `list_monitors`
- **posthog** · `list_projects`
- **hubspot** · `list_deal_pipelines`, `list_ticket_pipelines`

### POST with body + custom header
- **notion** · `list_databases` — `POST /v1/search` with filter body + `Notion-Version: 2022-06-28`

### Domain-based base URL + Basic Auth
- **jira** · `list_projects` (uses `domain` field + `email:api_token`)
- **confluence** · `list_spaces` (same)

### GraphQL (POST body with inline query)
- **linear** · `list_teams`, `list_projects`
- **monday_com** / **monday** · `list_boards`

### Google OAuth
- **google_workspace_oauth_template**, **google_sheets**, **gmail** ·
  `list_drive_folders`, `list_sheets` (all share Drive API)
- **gmail**, **google_workspace_oauth_template** · `list_gmail_labels`

### Local
- **codebases** · `list_projects` (reads `dev_projects` table)

**Total**: ~30 operations across ~20 service types.

---

## Template sweep status

Final audit from `node scripts/audit-adoption-questions.cjs`:

| Bucket | Count | Notes |
|---|---|---|
| A. `dynamic_source` | **49** | Started at 0, 3 in Wave 1, +33 in Wave 2, +2 Wave 3, +11 Wave 4 |
| B. `option_service_types` (vault-aware select) | 8 | Covered by alias map for cloud credentials |
| C. text (remaining) | 65 | Vast majority are genuine free-form — see below |
| D. plain static select | 493 | Fine as-is |
| E. boolean | 38 | Fine as-is |

**106 templates total**, checksums regenerated for all.

### Remaining text questions (65) — breakdown

Run `node scripts/audit-adoption-questions.cjs` to see them all. Rough
categories:

- **Should stay text** (~50): numeric thresholds, email recipients, stock
  tickers, brand names, industries, localhost URLs, memory rules, custom
  categories, file paths, deal stage definitions, user profile questions
  ("What's your role?"), free-form keyword lists
- **Could be upgraded but requires new engine work**:
  - **HubSpot custom properties** (1 template) — works today but labels
    are nested under `properties.*`, works via existing dot-path walker
  - **Telegram chat IDs** (2 templates) — would need a new "bot.getUpdates"
    polling strategy
  - **Supabase project URL** (1 template) — needs custom JWT auth strategy

None of these are high-priority — the genuine upgrade candidates were all
shipped in Waves 1–4.

---

## Verified fixes / latent bugs caught this session

1. **`auth_token` TOKEN_KEYS omission** — the default connector strategy's
   `find_auth_token()` missed credentials stored under `auth_token` (Sentry,
   Twilio SMS). Added to `TOKEN_KEYS`. Silently broke `execute_api_request`
   for these connectors before the fix.
2. **`ipc_auth` WebView2 header race** — new privileged commands hit the
   known Windows race where the token header isn't forwarded. Followed
   the existing pattern: keep `discover_connector_resources` OUT of the
   wrapper allowlist, keep in-body `require_privileged` for audit.
3. **Cloud credential aliasing** — `auth_detect.rs` / `foraging.rs` /
   `healthcheck.rs` emit short names (`aws`, `google_cloud`, `azure`) but
   templates reference canonical names (`aws_cloud`, `gcp_cloud`,
   `azure_cloud`). `vaultAdoptionMatcher` now expands via a single alias
   map. Add to this map if other connectors surface similar mismatches.
4. **Stacked modal portals** — `AdoptionWizardModal`'s BaseModal uses
   `z-[10000]`. `TestReportModal` was using `z-[100]`, so even though it
   portalled to body AFTER the wizard, it rendered visually below. Bumped
   to `z-[10001]`.
5. **Template catalog caching in dev** — `_cached` in `templateCatalog.ts`
   is module-level and survives Vite HMR when the templateCatalog.ts file
   itself doesn't change. Added `invalidateTemplateCatalog()` export that
   `useDesignReviews` now calls on every seed in dev mode, so JSON edits
   flow through without a dev server restart. **Rust-side caveat**:
   `template_checksums.rs` is compiled in via `LazyLock`, so the running
   Tauri binary still needs `Ctrl-C` + restart after template edits for
   `check_template_integrity` to accept the new content.
6. **Error extraction** — Tauri serializes `AppError` as `{error, kind}`.
   The hook's catch handler now extracts `.error` first, falling back to
   `.message` then JSON stringify, instead of emitting `"[object Object]"`.
7. **SelectPills custom in multi-select** — previously Custom… was hidden
   entirely in multi-select mode; now both modes share one code path with
   dismissable custom-value pills.

---

## Scripts shipped

| Path | Purpose |
|---|---|
| `scripts/find-discovery-candidates.cjs` | Regex-based scanner for text questions matching connector keywords. First-pass sweep tool. |
| `scripts/apply-discovery-upgrades.cjs` | First-wave patcher (Slack/GitHub/Airtable). Idempotent — skips already-upgraded questions. |
| `scripts/audit-adoption-questions.cjs` | Full hand-auditable dump of every question across every template, grouped by A/B/C/D/E buckets and flagging cloud alias mismatches. This is the authoritative status-of-the-catalog tool. |
| `scripts/apply-wave4-upgrades.cjs` | Wave-4 hand-specified patcher (Jira, Notion, Linear, Google Drive/Sheets, Gmail). Each target is an explicit (file, question_id, patch) tuple. |

All four are Node CJS, run from repo root. `audit-adoption-questions.cjs`
is the most useful going forward — keep it around as the reproducible way
to measure sweep progress.

---

## Files touched (uncommitted as of handoff)

### Rust
- `src-tauri/src/engine/discovery.rs` — registry + engine
- `src-tauri/src/engine/connector_strategy.rs` — `TOKEN_KEYS`,
  `AtlassianBasicAuthStrategy`, gmail exact match
- `src-tauri/src/engine/template_checksums.rs` — regenerated

### Frontend
- `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx`
- `src/features/templates/sub_generated/adoption/QuestionnaireFormGrid.tsx`
- `src/features/templates/sub_generated/adoption/QuestionnaireFormFocus.tsx` (new)
- `src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts`
- `src/features/templates/sub_generated/gallery/matrix/TestReportModal.tsx`
- `src/lib/personas/templates/templateCatalog.ts`
- `src/lib/personas/templates/templateChecksums.ts` — regenerated
- `src/lib/commandNames.generated.ts` — regenerated
- `src/hooks/design/template/useDesignReviews.ts`

### Template JSONs (Waves 3+4+5 uncommitted upgrades)
- `scripts/templates/finance/budget-spending-monitor.json` — `allow_custom: true`
  on currency, "Other" removed
- `scripts/templates/productivity/appointment-orchestrator.json` — HubSpot deal pipelines
- `scripts/templates/sales/sales-pipeline-autopilot.json` — HubSpot deal pipelines
- `scripts/templates/development/autonomous-issue-resolver.json` — Jira + Notion
- `scripts/templates/content/content-approval-workflow.json` — Notion
- `scripts/templates/development/design-handoff-coordinator.json` — Linear teams
- `scripts/templates/support/customer-feedback-router.json` — Linear teams
- `scripts/templates/content/ai-document-intelligence-hub.json` — Google Drive folders
- `scripts/templates/finance/expense-receipt-processor.json` — Google Sheets
- `scripts/templates/sales/outbound-sales-intelligence-pipeline.json` — Google Sheets
- `scripts/templates/research/website-market-intelligence-profiler.json` — Google Sheets
- `scripts/templates/sales/sheets-e-commerce-command-center.json` — Google Sheets
- `scripts/templates/legal/ai-contract-reviewer.json` — Gmail labels

### Docs
- `docs/HANDOFF-dynamic-discovery.md` (this file)

---

## Known issues / open threads

### Needs user action before next session
1. **Commit the uncommitted work.** Rust-side changes to
   `template_checksums.rs` require a `tauri dev` restart to take effect
   once committed.
2. **Manually verify the Focus variant on a wide screen** — the
   `max-w-5xl` centering was added based on reasoning, not measurement.
   Screenshot-test Budget Spending Monitor and Sentry Production Monitor
   to confirm the two halves feel close enough.

### Deferred (not in scope this session)
- **HubSpot custom properties** — the one remaining "real" upgrade
  candidate. Would work with existing engine via `properties.firstname`
  style dot paths.
- **Telegram chat discovery** — `bot.getUpdates` polling pattern, would
  need a new `DiscoveryOp::Polled` variant. Low priority.
- **Supabase** — needs custom JWT auth strategy. Low priority (1 template).
- **Pre-existing `credentials.rs` test-compile errors** — `create()`
  function references at line 1075 and 1146 in tests break
  `cargo test --features desktop`. Unrelated to this work but blocks
  running my 4 discovery unit tests as part of the regular test suite.
  Can be verified manually by checking `cargo test --lib engine::discovery::tests`
  after fixing the test helpers.

### Known pre-existing gotchas

- **Two BaseModals, same name**: `@/lib/ui/BaseModal` and
  `sub_generated/shared/BaseModal`. The latter re-exports the former.
  Always pass `portal={true}` when a modal is rendered inside a container
  with `overflow-hidden`.
- **Module-level `_cached` in `templateCatalog.ts`** — now invalidated on
  seed in dev mode. Production still uses first-load cache semantics.
- **LLM template transformation path** — `template_adopt.rs` has a path
  via `run_unified_adopt_turn1` that sends seed questions to an LLM. For
  templates that ship with `payload.adoption_questions` already populated,
  the adoption flow reads from `review.design_result` (which is the raw
  template payload, via `seedTemplates.ts`), NOT from the LLM path. So
  `dynamic_source` and `vault_category` fields flow through unchanged.
  The LLM path is only used for "raw" templates without pre-curated
  questions.

---

## Suggested next session starting points

Pick whichever fits your goals:

### Track A — More template polish (short)
1. Verify Focus variant centering in real browser with multiple templates
2. Convert the ~14 "stay text" questions that should really be `directory_picker`
   or `devtools_project` type (search the audit output for file path / project id
   placeholders)
3. Migrate all `adoption_questions` to the standardized `vault_category`
   + `option_service_types` shape where applicable (the audit's bucket B
   is only 8, suggesting many static selects that SHOULD be vault-aware)
4. Delete the temporary sweep scripts (`find-discovery-candidates.cjs`,
   `apply-discovery-upgrades.cjs`, `apply-wave4-upgrades.cjs`) now that
   their work is done. Keep `audit-adoption-questions.cjs`.

### Track B — Adoption flow UX deepening (medium)
1. **Smart defaults from profile** — auto-populate configuration questions
   from the user's previous template adoptions (e.g. if they always set
   threshold=5 for error monitors, pre-fill that)
2. **Inline credential healthcheck status** — when a vault credential
   auto-matches, show its healthcheck state next to the auto-detect badge
   (green if healthy, amber if stale, red if failed)
3. **Chained discovery** — `depends_on` support exists in the hook but
   no template uses it. Good example would be Sentry: pick project first,
   then environments filtered to that project instead of all org-wide
   environment tags.
4. **Discovery cache** — the hook refetches on every mount. Add a short
   session-level cache (5-minute TTL) so rapid back-and-forth through the
   gallery doesn't hammer third-party APIs

### Track C — New engine capabilities (larger)
1. **POST body with interpolation** — Notion filter bodies and GraphQL
   queries are currently static. Support `{{param.x}}` inside body
   templates too (would need to relax the URL-safe character check; use
   a separate `interpolate_body` helper).
2. **Paginated results** — every op currently fetches one page. Slack
   channel lists over 200 channels, GitHub repo lists over 100 get
   truncated. Add a `follow_pagination: true` flag that walks cursor /
   `next` links up to N pages.
3. **Cross-op enrichment** — e.g. Sentry project list returns slugs, but
   we could parallel-fetch each project's most-recent-release to show in
   the sublabel. Out of scope for v1 but an obvious extension.

### Track D — Telemetry + observability
1. Per-discovery-op success/failure metrics in
   `get_api_proxy_metrics` (currently bucketed by credential, not by
   operation)
2. Instrument `useDynamicQuestionOptions` with a client-side log so we
   can tell which templates/ops are actually being exercised

---

## Verification commands for next session

```bash
# Frontend typecheck
npx tsc --noEmit

# Rust check (feature-gated build)
cd src-tauri && cargo check --features desktop

# Discovery unit tests (pre-existing test compile errors elsewhere make
# cargo test fail, but the tests themselves should pass in isolation)
cargo test --features desktop --lib engine::discovery::tests

# Catalog audit — authoritative status of all adoption questions
node scripts/audit-adoption-questions.cjs

# Regenerate template checksums after editing any template JSON
node scripts/generate-template-checksums.mjs

# Regenerate command name union if adding/removing Tauri commands
node scripts/generate-command-names.mjs

# Template checksum validation — browser console after reload
# Look for "Integrity mismatch for built-in template" warnings from
# template-catalog logger; any hit means regenerate-checksums + tauri
# dev restart needed.
```

---

## Entry point for the next session

Read this file first, then check `git log --oneline | grep -E
"discovery|templates"` to see what's landed. Run the audit script to
see current catalog state. If any template shows stale content in the
questionnaire, first suspect is the Rust-side compiled-in checksum — a
`tauri dev` restart rebuilds `template_checksums.rs` into the binary.
