# Vault Credential Creation — E2E Test Scenarios

End-to-end test coverage for all 9 credential creation flows available in the Vault "Add new" type picker menu. Covers the 7 primary options plus 2 bonus flows (Workspace Connect, Auto-Discover).

## Prerequisites

```bash
npx tauri dev --features test-automation
# Wait for bridge ready:
curl http://127.0.0.1:17320/health
# Expected: {"status":"ok","server":"personas","version":"..."}
```

- App running with `test-automation` feature flag
- Health check at `http://127.0.0.1:17320/health` returns `status: "ok"`
- No existing test credentials (or run Cleanup first)
- Network access for OAuth and API-based flows (Scenarios 4, 8, 9)

Bridge API base: `http://127.0.0.1:17320`

---

## Test Matrix

| # | Option | Picker testid | Flow type | Key testids | Expected outcome |
|---|--------|--------------|-----------|-------------|-----------------|
| 1 | AI-Built Connector | `vault-pick-ai-connector` | AI design → schema generation | `vault-design-*` | Credential with AI-generated schema |
| 2 | AI Tool Server (MCP) | `vault-pick-mcp` | Schema form | `vault-schema-*` | MCP server credential saved |
| 3 | Web Service (Custom) | `vault-pick-custom` | Schema form | `vault-schema-*` | Custom REST credential saved |
| 4 | Database | `vault-pick-database` | Schema form (subtype) | `vault-schema-*` | Database connection credential saved |
| 5 | Desktop App | `vault-pick-desktop` | Local scan → approve | `vault-desktop-*` | Desktop app credential created |
| 6 | AI Setup Wizard | `vault-pick-wizard` | Guided multi-step | `vault-wizard-*` | Wizard-provisioned credential(s) |
| 7 | API Autopilot | `vault-pick-autopilot` | URL → auto-generate | `vault-autopilot-*` | Auto-generated API credential |
| 8 | Workspace Connect | `vault-pick-workspace` | OAuth → bulk import | `vault-workspace-*` | Multiple workspace credentials |
| 9 | Auto-Discover (Foraging) | `vault-pick-foraging` | FS scan → import | `vault-foraging-*` | Discovered credentials imported |

---

## Scenario 1: Navigate to Add New Menu

### Intent

Verify that the credentials section loads, the "Add new" button is present, and clicking it shows the type picker with all 9 options.

### Steps

#### 1.1 Navigate to Credentials

```
POST /navigate        {"section": "credentials"}
POST /wait            {"selector": "[data-testid='credential-manager']", "timeout_ms": 5000}
```

**Assertions:**
- Response `{success: true}` from both calls
- `GET /state` returns `sidebarSection: "credentials"`

**Expected:** Credentials section loads with the manager container visible.

#### 1.2 Open Type Picker

```
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
```

**Assertions:**
- Type picker container becomes visible
- `GET /snapshot` shows no errors or modals blocking

**Expected:** A card grid or menu appears showing all credential creation options.

#### 1.3 Verify All Options Present

```
POST /query           {"selector": "[data-testid^='vault-pick-']"}
```

**Assertions:**
- Response contains exactly 9 elements
- Each has `visible: true`
- testids match: `vault-pick-ai-connector`, `vault-pick-mcp`, `vault-pick-custom`, `vault-pick-database`, `vault-pick-desktop`, `vault-pick-wizard`, `vault-pick-autopilot`, `vault-pick-workspace`, `vault-pick-foraging`

**Expected:** All 9 option cards rendered and visible. Each card should have an icon, title, and brief description.

#### 1.4 Verify Back Button Present

```
POST /query           {"selector": "[data-testid='vault-back-btn']"}
```

**Assertions:**
- Element exists (may be visible or hidden depending on whether we're at root level)

**Potential issues:**
- Back button might only appear after entering a sub-flow, not at the top-level picker
- If the picker is a modal, check `GET /snapshot` for `modals` array

### Success Criteria

- [ ] Credentials section navigable via sidebar
- [ ] "Add new" button visible and clickable
- [ ] Type picker shows all 9 options
- [ ] No console errors or toasts on load

---

## Scenario 2: AI-Built Connector (Happy Path)

### Intent

Create a credential by describing what you need in natural language. The AI designs the connector schema, the user confirms, and the credential is saved.

### Steps

#### 2.1 Open AI-Built Connector Flow

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /click-testid    {"test_id": "vault-pick-ai-connector"}
POST /wait            {"selector": "[data-testid='vault-design-container']", "timeout_ms": 5000}
```

**Assertions:**
- Design container visible
- Type picker hidden or replaced
- `vault-design-input` and `vault-design-submit` present

**Expected:** A text area or input field appears asking the user to describe the service they want to connect to.

#### 2.2 Enter Service Description

```
POST /fill-field      {"test_id": "vault-design-input", "value": "Stripe payment processing API — I need to manage customers, create charges, and list invoices"}
POST /click-testid    {"test_id": "vault-design-submit"}
```

**Assertions:**
- Submit button click returns `{success: true}`
- A loading/spinner state appears (check via `GET /snapshot` or query for a loading indicator)

**Expected:** The AI begins designing the connector. A progress indicator or "Designing..." message appears. This step involves an LLM call.

**Timing:** AI design typically takes 10-30 seconds depending on complexity. Use a generous timeout.

#### 2.3 Wait for AI Design Completion

```
POST /wait            {"selector": "[data-testid='vault-schema-form'], [data-testid='vault-schema-save']", "timeout_ms": 60000}
```

**Assertions:**
- Schema form appears with pre-filled fields (name, auth type, base URL, etc.)
- `vault-schema-name` field is populated (AI should have named it something like "Stripe" or "Stripe API")

**Expected:** The AI generates a credential schema with sensible defaults: name, authentication method (likely API key for Stripe), base URL (`https://api.stripe.com`), and relevant headers.

#### 2.4 Verify Generated Schema and Save

```
GET /snapshot
POST /query           {"selector": "[data-testid='vault-schema-name']"}
POST /click-testid    {"test_id": "vault-schema-save"}
POST /wait-toast      {"text": "created", "timeout_ms": 10000}
```

**Assertions:**
- Toast confirms credential creation (text contains "created" or "saved")
- `GET /state` shows updated credential count
- No error toasts

**Expected:** Credential saved to vault. User returns to credential list or detail view. The new credential appears in the list.

#### 2.5 Verify Credential Exists

```
POST /navigate        {"section": "credentials"}
POST /fill-field      {"test_id": "credential-search", "value": "Stripe"}
POST /wait            {"selector": "[data-testid='credential-list']", "timeout_ms": 5000}
POST /query           {"selector": "[data-testid='credential-list'] [data-testid^='credential-']"}
```

**Assertions:**
- At least 1 credential matches the search
- Credential has expected name containing "Stripe"

**Potential issues:**
- AI might name the credential differently — search broadly
- LLM call might fail or time out — check for error toasts
- Rate limiting on AI provider could cause intermittent failures

### Success Criteria

- [ ] AI design flow completes without errors
- [ ] Generated schema has reasonable name and auth type
- [ ] Credential saved and searchable in vault
- [ ] Total time < 60 seconds

---

## Scenario 3: AI Tool Server (MCP)

### Intent

Create a credential for an MCP (Model Context Protocol) server by entering the server address and configuration.

### Steps

#### 3.1 Open MCP Flow

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /click-testid    {"test_id": "vault-pick-mcp"}
POST /wait            {"selector": "[data-testid='vault-schema-form']", "timeout_ms": 5000}
```

**Assertions:**
- Schema form visible
- Form contains name field (`vault-schema-name`)

**Expected:** A form appears pre-configured for MCP server type. Fields likely include: name, server URL/command, transport type (stdio/SSE), and optional authentication.

#### 3.2 Fill MCP Server Details

```
POST /fill-field      {"test_id": "vault-schema-name", "value": "Test MCP — File Browser"}
POST /query           {"selector": "[data-testid='vault-schema-form'] input, [data-testid='vault-schema-form'] select"}
```

**Assertions:**
- Name field accepts input
- Query reveals additional form fields for server configuration

**Expected:** Form shows fields for server address or command. For an MCP server, this is typically a command like `npx @modelcontextprotocol/server-filesystem /tmp` or a URL for SSE transport.

#### 3.3 Fill Server-Specific Fields and Save

```
# Fill additional fields revealed by query in 3.2
# Example: server command or URL field
POST /fill-field      {"test_id": "vault-schema-name", "value": "Test MCP — File Browser"}
POST /click-testid    {"test_id": "vault-schema-save"}
POST /wait-toast      {"text": "created", "timeout_ms": 10000}
```

**Assertions:**
- Save succeeds
- Toast confirms creation
- No validation errors shown

**Expected:** MCP credential saved. The credential stores the server configuration so agents can connect to this MCP server later.

#### 3.4 Verify Credential

```
POST /fill-field      {"test_id": "credential-search", "value": "Test MCP"}
POST /query           {"selector": "[data-testid='credential-list'] [data-testid^='credential-']"}
```

**Assertions:**
- Credential appears in search results
- Credential type indicates MCP

**Potential issues:**
- MCP form fields vary by transport type — the form may change dynamically when selecting stdio vs SSE
- Validation may require a reachable server URL — test with a known-good or mock server
- Some MCP fields may use custom input components rather than standard inputs

### Success Criteria

- [ ] MCP schema form loads with correct fields
- [ ] Credential saves with name and server config
- [ ] Credential searchable in vault
- [ ] No validation errors for well-formed input

---

## Scenario 4: Web Service (Custom)

### Intent

Create a credential for a generic REST API / web service with custom fields.

### Steps

#### 4.1 Open Custom Flow

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /click-testid    {"test_id": "vault-pick-custom"}
POST /wait            {"selector": "[data-testid='vault-schema-form']", "timeout_ms": 5000}
```

**Assertions:**
- Schema form visible
- Form has name field and likely auth-type selector

**Expected:** A blank schema form appears for defining a custom web service credential. Fields: name, base URL, auth type (API key, Bearer token, Basic auth, OAuth2), and custom headers.

#### 4.2 Fill Service Details

```
POST /fill-field      {"test_id": "vault-schema-name", "value": "Test Custom — Acme API"}
# Query for available form fields
POST /query           {"selector": "[data-testid='vault-schema-form'] input, [data-testid='vault-schema-form'] select, [data-testid='vault-schema-form'] textarea"}
```

**Assertions:**
- Name accepted
- Form exposes URL, auth, and optional header fields

**Expected:** User fills in API base URL (e.g., `https://api.acme.com/v2`), selects auth type (e.g., "API Key"), enters the key name and value.

#### 4.3 Save Custom Credential

```
POST /click-testid    {"test_id": "vault-schema-save"}
POST /wait-toast      {"text": "created", "timeout_ms": 10000}
```

**Assertions:**
- Toast confirms creation
- No validation errors

**Expected:** Custom credential saved. Available for agent connector assignment.

#### 4.4 Verify

```
POST /fill-field      {"test_id": "credential-search", "value": "Acme"}
POST /query           {"selector": "[data-testid='credential-list'] [data-testid^='credential-']"}
```

**Assertions:**
- Credential found by name search

**Potential issues:**
- Custom forms may require at least one auth field — test with empty auth to verify validation fires
- URL validation may reject non-HTTPS URLs

### Success Criteria

- [ ] Custom form loads with flexible field set
- [ ] Credential saves with name, URL, and auth config
- [ ] Validation rejects empty required fields (name)
- [ ] Credential visible in vault list

---

## Scenario 5: Database

### Intent

Create a database connection credential. The flow includes selecting a database subtype (Postgres, MySQL, SQLite, etc.) and filling connection parameters.

### Steps

#### 5.1 Open Database Flow

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /click-testid    {"test_id": "vault-pick-database"}
POST /wait            {"selector": "[data-testid='vault-schema-form']", "timeout_ms": 5000}
```

**Assertions:**
- Schema form visible
- Form likely includes a database type selector (dropdown or radio group)

**Expected:** Form appears with a database engine selector as the first choice. Options may include PostgreSQL, MySQL, SQLite, MongoDB, Redis, etc. Selecting a type populates type-specific fields.

#### 5.2 Select Database Type and Fill Connection

```
POST /fill-field      {"test_id": "vault-schema-name", "value": "Test DB — Local Postgres"}
# Look for subtype selector
POST /query           {"selector": "[data-testid='vault-schema-form'] select, [data-testid='vault-schema-form'] [role='listbox']"}
# Fill connection fields (host, port, database, user, password)
# These field testids depend on the dynamic form — use query to discover them
POST /query           {"selector": "[data-testid='vault-schema-form'] input"}
```

**Assertions:**
- Subtype selector present and has multiple options
- Connection fields appear after subtype selection
- Fields include host, port, database name, user, password

**Expected:** After selecting "PostgreSQL", fields appear: Host (`localhost`), Port (`5432`), Database (`testdb`), Username (`postgres`), Password (masked input).

#### 5.3 Save Database Credential

```
POST /click-testid    {"test_id": "vault-schema-save"}
POST /wait-toast      {"text": "created", "timeout_ms": 10000}
```

**Assertions:**
- Toast confirms creation
- Password field was masked (not visible in plaintext in snapshot)

**Expected:** Database credential saved with connection string components. The vault stores the password encrypted.

#### 5.4 Verify

```
POST /fill-field      {"test_id": "credential-search", "value": "Postgres"}
POST /query           {"selector": "[data-testid='credential-list'] [data-testid^='credential-']"}
```

**Assertions:**
- Credential found, type indicates database

**Potential issues:**
- Database form fields are dynamic based on subtype — different engines show different fields
- SQLite may only need a file path, not host/port/user/password
- Connection test button may exist — clicking it against a non-existent DB should show a graceful error, not a crash

### Success Criteria

- [ ] Database subtype selector works
- [ ] Type-specific fields appear after selection
- [ ] Credential saves with all connection parameters
- [ ] Password stored securely (masked in UI)

---

## Scenario 6: Desktop App

### Intent

Create a credential for a locally installed desktop application. The flow scans the system for installed apps, the user selects one, and a credential record is created.

### Steps

#### 6.1 Open Desktop Flow

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /click-testid    {"test_id": "vault-pick-desktop"}
POST /wait            {"selector": "[data-testid='vault-desktop-container']", "timeout_ms": 5000}
```

**Assertions:**
- Desktop container visible
- Scan button (`vault-desktop-scan`) present

**Expected:** A view appears explaining that the system will scan for installed desktop apps. A "Scan" button is prominently displayed.

#### 6.2 Trigger System Scan

```
POST /click-testid    {"test_id": "vault-desktop-scan"}
POST /wait            {"selector": "[data-testid='vault-desktop-container'] [data-testid^='desktop-app-']", "timeout_ms": 30000}
```

**Assertions:**
- Scan initiates (loading state appears)
- After scan completes, a list of discovered apps is shown

**Expected:** The system scans for installed applications (browsers, IDEs, productivity tools, etc.). Results appear as a selectable list. Scan may take 5-15 seconds depending on the system.

**Timing:** System scan involves filesystem traversal. Allow 30 seconds.

#### 6.3 Select an App and Confirm

```
# Query discovered apps
POST /query           {"selector": "[data-testid='vault-desktop-container'] [data-testid^='desktop-app-']"}
# Click the first discovered app
POST /click           {"selector": "[data-testid='vault-desktop-container'] [data-testid^='desktop-app-']:first-child"}
POST /wait-toast      {"text": "created", "timeout_ms": 10000}
```

**Assertions:**
- At least one app discovered
- Selection triggers credential creation
- Toast confirms

**Expected:** User clicks on a discovered app (e.g., VS Code, Chrome). A credential is created that represents access to that desktop app for agent automation.

**Potential issues:**
- Scan results vary by machine — test environment may have minimal apps installed
- Windows vs macOS vs Linux scan paths differ — ensure test runs on the target OS
- If no apps found, verify a graceful "No apps found" message appears instead of an empty list

### Success Criteria

- [ ] Scan discovers at least one desktop app
- [ ] App selection creates a credential
- [ ] Credential appears in vault list
- [ ] Scan completes in < 30 seconds

---

## Scenario 7: AI Setup Wizard

### Intent

Use the AI-powered provisioning wizard that detects available services and guides the user through a multi-step setup process.

### Steps

#### 7.1 Open Wizard Flow

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /click-testid    {"test_id": "vault-pick-wizard"}
POST /wait            {"selector": "[data-testid='vault-wizard-container']", "timeout_ms": 5000}
```

**Assertions:**
- Wizard container visible
- Start button (`vault-wizard-start`) and cancel button (`vault-wizard-cancel`) present

**Expected:** Wizard landing screen appears explaining the AI-guided setup process. Shows a "Start" button to begin service detection.

#### 7.2 Start Wizard

```
POST /click-testid    {"test_id": "vault-wizard-start"}
POST /wait            {"selector": "[data-testid='vault-wizard-container']", "timeout_ms": 60000}
```

**Assertions:**
- Wizard transitions from landing to detection/analysis phase
- A progress indicator or step counter appears

**Expected:** The wizard begins analyzing the user's environment. It may check for running services, examine config files, or ask clarifying questions. This involves AI inference and may take 15-45 seconds.

**Timing:** AI-driven detection + multi-step flow. Allow 60 seconds for initial detection phase.

#### 7.3 Follow Wizard Steps

```
# The wizard is multi-step — exact flow depends on what it detects.
# Poll for interactive elements at each step:
GET /list-interactive
# Respond to each step (select services, confirm settings, etc.)
# Example: if wizard shows detected services as checkboxes
POST /query           {"selector": "[data-testid='vault-wizard-container'] input[type='checkbox'], [data-testid='vault-wizard-container'] button"}
```

**Assertions:**
- Each wizard step presents clear options
- Navigation between steps works (next/back)
- Final step has a confirm/create action

**Expected:** The wizard walks through 2-5 steps: detect services, select which to configure, enter any missing credentials/tokens, review, and create. Each step has clear instructions.

#### 7.4 Complete Wizard

```
# Click through to completion — look for a "Create" or "Finish" button
POST /find-text       {"text": "Create"}
POST /wait-toast      {"text": "created", "timeout_ms": 15000}
```

**Assertions:**
- One or more credentials created
- Toast(s) confirm creation
- Wizard closes or shows completion summary

**Expected:** Wizard creates one or more credentials based on detected services. A summary shows what was created.

**Potential issues:**
- Wizard flow is non-deterministic — depends on what the AI detects
- May create 0 credentials if no services are found
- Multi-step flows are harder to automate — each step may need different interaction patterns
- Cancel button should work at any step without side effects

### Success Criteria

- [ ] Wizard launches and detects environment
- [ ] Steps are navigable (next/back/cancel)
- [ ] At least one credential created (or graceful "nothing found" state)
- [ ] Cancel at any step returns to type picker without creating anything

---

## Scenario 8: API Autopilot

### Intent

Auto-generate a credential by providing an OpenAPI/Swagger specification URL. The system parses the spec and creates a fully configured API credential.

### Steps

#### 8.1 Open Autopilot Flow

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /click-testid    {"test_id": "vault-pick-autopilot"}
POST /wait            {"selector": "[data-testid='vault-autopilot-container']", "timeout_ms": 5000}
```

**Assertions:**
- Autopilot container visible
- URL input (`vault-autopilot-url-input`) present
- Submit button (`vault-autopilot-submit`) present

**Expected:** A focused view with a URL input field and a "Generate" or "Import" button. Instructional text explains that the user should paste an OpenAPI spec URL.

#### 8.2 Enter OpenAPI URL

```
POST /fill-field      {"test_id": "vault-autopilot-url-input", "value": "https://petstore3.swagger.io/api/v3/openapi.json"}
POST /click-testid    {"test_id": "vault-autopilot-submit"}
```

**Assertions:**
- URL field accepts the value
- Submit triggers a fetch + parse operation
- Loading state appears

**Expected:** The system fetches the OpenAPI spec, parses it, and generates a credential configuration. A preview may appear showing the detected endpoints, auth scheme, and base URL.

**Timing:** Fetching and parsing an external spec takes 3-10 seconds. AI analysis may add 10-20 seconds.

#### 8.3 Wait for Generation and Confirm

```
POST /wait            {"selector": "[data-testid='vault-schema-form'], [data-testid='vault-schema-save']", "timeout_ms": 45000}
GET /snapshot
POST /click-testid    {"test_id": "vault-schema-save"}
POST /wait-toast      {"text": "created", "timeout_ms": 10000}
```

**Assertions:**
- Generated schema form appears with pre-filled data
- Name field populated (e.g., "Swagger Petstore")
- Base URL extracted from spec
- Auth type detected from spec's `securityDefinitions`
- Save succeeds

**Expected:** A review screen shows the auto-generated credential: name from spec title, base URL, auth method, and available endpoints. User confirms and saves.

#### 8.4 Verify

```
POST /fill-field      {"test_id": "credential-search", "value": "Petstore"}
POST /query           {"selector": "[data-testid='credential-list'] [data-testid^='credential-']"}
```

**Assertions:**
- Credential found by searching spec-derived name

**Potential issues:**
- External URL may be unreachable in CI — consider using a local mock server or a well-known stable spec URL
- Spec parsing may fail on non-standard OpenAPI docs — test with a known-good spec (Petstore)
- CORS issues if the spec URL doesn't allow cross-origin fetches — the Tauri backend should handle this server-side

### Success Criteria

- [ ] URL input accepts and submits spec URL
- [ ] Spec fetched and parsed successfully
- [ ] Credential auto-populated with correct name, URL, auth
- [ ] Credential saved and searchable

---

## Scenario 9: Workspace Connect

### Intent

Connect to a workspace provider (Google, Microsoft, etc.) via OAuth and bulk-import credentials for workspace services.

### Steps

#### 9.1 Open Workspace Connect Flow

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /click-testid    {"test_id": "vault-pick-workspace"}
POST /wait            {"selector": "[data-testid='vault-workspace-container']", "timeout_ms": 5000}
```

**Assertions:**
- Workspace container visible
- Connect button (`vault-workspace-connect`) present
- Provider options (Google, Microsoft, etc.) may be shown

**Expected:** A view showing available workspace providers with their logos. Each has a "Connect" button that initiates an OAuth flow.

#### 9.2 Initiate OAuth Connection

```
POST /click-testid    {"test_id": "vault-workspace-connect"}
```

**Assertions:**
- OAuth flow initiates — this may open a system browser or an embedded webview
- A loading/waiting state appears in the app

**Expected:** Clicking "Connect" opens the provider's OAuth consent screen (e.g., Google sign-in). In a test environment, this flow cannot complete without real credentials. The test should verify:
1. The OAuth URL is well-formed
2. The app enters a "waiting for authorization" state
3. Cancel/timeout handling works

**Timing:** OAuth is interactive and requires real user input. For automated tests, verify the initiation only, or use `eval_js` to simulate a successful OAuth callback.

#### 9.3 Simulate OAuth Callback (Test Mode)

```
POST /eval            {"js": "window.__TEST__.simulateOAuthCallback({provider:'google', access_token:'test-token-123', email:'test@example.com'})"}
POST /wait            {"selector": "[data-testid='vault-workspace-container']", "timeout_ms": 15000}
```

**Assertions:**
- App processes the simulated callback
- Workspace services are detected (Gmail, Drive, Calendar, etc.)
- A list of importable credentials appears

**Expected:** After OAuth succeeds, the app queries the workspace API and shows available services. The user can select which services to create credentials for.

#### 9.4 Select Services and Create

```
# Select all or specific services
POST /query           {"selector": "[data-testid='vault-workspace-container'] input[type='checkbox']"}
POST /find-text       {"text": "Import"}
POST /wait-toast      {"text": "created", "timeout_ms": 15000}
```

**Assertions:**
- Multiple credentials created (one per selected service)
- Toasts confirm bulk creation

**Expected:** User selects services (e.g., Gmail API, Google Drive API, Google Calendar API) and clicks Import. Multiple credentials are created in batch.

**Potential issues:**
- OAuth cannot complete in headless test environments without mocking
- The simulated callback test helper (`window.__TEST__.simulateOAuthCallback`) may not exist yet
- Bulk creation may produce multiple toasts — verify all or just the last
- Token refresh handling — stored OAuth tokens expire, verify refresh logic exists

### Success Criteria

- [ ] Workspace connect UI loads with provider options
- [ ] OAuth initiation triggers correctly
- [ ] (With mock) Bulk credential import works
- [ ] Multiple credentials created and visible in vault

---

## Scenario 10: Auto-Discover (Foraging)

### Intent

Scan the local filesystem for existing credential files (`.env`, config files, SSH keys, API token files, etc.) and import them into the vault.

### Steps

#### 10.1 Open Foraging Flow

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /click-testid    {"test_id": "vault-pick-foraging"}
POST /wait            {"selector": "[data-testid='vault-foraging-container']", "timeout_ms": 5000}
```

**Assertions:**
- Foraging container visible
- Scan button (`vault-foraging-scan`) present

**Expected:** A view explaining the auto-discovery process. May show a directory picker or default scan paths. A "Scan" button starts the discovery.

#### 10.2 Trigger Filesystem Scan

```
POST /click-testid    {"test_id": "vault-foraging-scan"}
POST /wait            {"selector": "[data-testid='vault-foraging-container']", "timeout_ms": 45000}
```

**Assertions:**
- Scan begins — loading/progress indicator appears
- After completion, discovered items are listed

**Expected:** The forager scans common paths (`~/.ssh`, `~/.config`, project `.env` files, `~/.aws/credentials`, etc.) and presents found credential sources. Each item shows the file path, detected type, and a preview of what will be imported.

**Timing:** Filesystem scan can take 10-30 seconds depending on disk speed and number of files.

#### 10.3 Review and Import Discovered Credentials

```
# Query discovered items
POST /query           {"selector": "[data-testid='vault-foraging-container'] [data-testid^='foraged-']"}
# Select items to import (if checkbox-based)
# Or click an "Import All" / "Import Selected" button
POST /find-text       {"text": "Import"}
POST /wait-toast      {"text": "imported", "timeout_ms": 15000}
```

**Assertions:**
- At least one credential source discovered (most dev machines have SSH keys or `.env` files)
- Import creates credentials from selected sources
- Imported credentials appear in vault

**Expected:** User reviews the discovered credentials, deselects any they don't want, and imports. Each imported item becomes a vault credential with the source file's contents stored securely.

**Potential issues:**
- Scan results are machine-dependent — CI may have very few or no discoverable credentials
- Sensitive files (SSH private keys) require careful handling — verify they're encrypted in the vault
- Permission errors on certain directories should be handled gracefully (logged, not crashed)
- Duplicate detection — if credentials from the same source already exist, the UI should warn or skip

### Success Criteria

- [ ] Foraging scan completes without errors
- [ ] Discovered credential sources are displayed with useful metadata
- [ ] Import creates valid vault credentials
- [ ] Sensitive data is stored encrypted

---

## Scenario 11: Back Navigation from Each Flow

### Intent

Verify that the back button returns the user to the type picker from every sub-flow, without creating any credentials or leaving stale state.

### Steps

For each of the 9 flows, execute this pattern:

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /click-testid    {"test_id": "<vault-pick-OPTION>"}
POST /wait            {"selector": "[data-testid='<flow-container>']", "timeout_ms": 5000}
POST /click-testid    {"test_id": "vault-back-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
```

#### Flow-specific containers and cancel alternatives:

| Option | Picker testid | Container to wait for | Cancel testid (if back not available) |
|--------|--------------|----------------------|--------------------------------------|
| AI-Built Connector | `vault-pick-ai-connector` | `vault-design-container` | `vault-design-cancel` |
| AI Tool Server | `vault-pick-mcp` | `vault-schema-form` | `vault-schema-cancel` |
| Web Service | `vault-pick-custom` | `vault-schema-form` | `vault-schema-cancel` |
| Database | `vault-pick-database` | `vault-schema-form` | `vault-schema-cancel` |
| Desktop App | `vault-pick-desktop` | `vault-desktop-container` | — |
| AI Setup Wizard | `vault-pick-wizard` | `vault-wizard-container` | `vault-wizard-cancel` |
| API Autopilot | `vault-pick-autopilot` | `vault-autopilot-container` | — |
| Workspace Connect | `vault-pick-workspace` | `vault-workspace-container` | — |
| Auto-Discover | `vault-pick-foraging` | `vault-foraging-container` | — |

**Assertions (for each flow):**
- Back/cancel returns to type picker
- Type picker shows all 9 options again
- No credential was created (verify count unchanged via `GET /state`)
- No orphaned state (no loading spinners, no partial forms persisted)
- `GET /snapshot` shows no error toasts

**Potential issues:**
- Some flows may use `vault-back-btn`, others may use flow-specific cancel buttons (`vault-design-cancel`, `vault-schema-cancel`, `vault-wizard-cancel`)
- If a flow starts an async operation (AI design, scan), canceling mid-operation should abort cleanly
- Back from the schema form (shared by MCP, Custom, Database) should not retain field values when re-entering a different flow

### Success Criteria

- [ ] All 9 flows support back/cancel navigation
- [ ] Type picker restores correctly after each back
- [ ] No credentials created during back navigation tests
- [ ] No state leakage between flows

---

## Scenario 12: Consolidation Analysis

### Intent

Identify functional overlaps between the 9 credential creation flows and assess whether any could be merged or share components. This is an analytical scenario — the test verifies UX consistency rather than creating credentials.

### Steps

#### 12.1 AI-Built Connector vs AI Setup Wizard

```
# Enter AI-Built Connector
POST /click-testid    {"test_id": "create-credential-btn"}
POST /click-testid    {"test_id": "vault-pick-ai-connector"}
POST /wait            {"selector": "[data-testid='vault-design-container']", "timeout_ms": 5000}
GET /snapshot
POST /click-testid    {"test_id": "vault-back-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}

# Enter AI Setup Wizard
POST /click-testid    {"test_id": "vault-pick-wizard"}
POST /wait            {"selector": "[data-testid='vault-wizard-container']", "timeout_ms": 5000}
GET /snapshot
POST /click-testid    {"test_id": "vault-back-btn"}
```

**Comparison points:**
- Both use AI inference — do they share the same LLM backend?
- AI-Built Connector: single credential from a text description (targeted, user-driven)
- AI Setup Wizard: multi-credential from environment detection (broad, system-driven)
- **Verdict:** Distinct enough to remain separate. Connector is "I know what I want," Wizard is "help me find what I have."

#### 12.2 Web Service (Custom) vs API Autopilot

```
# Enter Custom
POST /click-testid    {"test_id": "create-credential-btn"}
POST /click-testid    {"test_id": "vault-pick-custom"}
POST /wait            {"selector": "[data-testid='vault-schema-form']", "timeout_ms": 5000}
GET /snapshot
POST /click-testid    {"test_id": "vault-back-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}

# Enter Autopilot
POST /click-testid    {"test_id": "vault-pick-autopilot"}
POST /wait            {"selector": "[data-testid='vault-autopilot-container']", "timeout_ms": 5000}
GET /snapshot
POST /click-testid    {"test_id": "vault-back-btn"}
```

**Comparison points:**
- Custom: manual form entry, full control, no external dependencies
- Autopilot: automated from OpenAPI spec, less control, needs a spec URL
- Both produce the same credential type (REST API)
- **Verdict:** Complementary. Autopilot could be a "quick fill" option within the Custom form rather than a separate flow. Consider adding an "Import from OpenAPI" button to the Custom form.

#### 12.3 Desktop App vs Auto-Discover (Foraging)

```
# Enter Desktop
POST /click-testid    {"test_id": "create-credential-btn"}
POST /click-testid    {"test_id": "vault-pick-desktop"}
POST /wait            {"selector": "[data-testid='vault-desktop-container']", "timeout_ms": 5000}
GET /snapshot
POST /click-testid    {"test_id": "vault-back-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}

# Enter Foraging
POST /click-testid    {"test_id": "vault-pick-foraging"}
POST /wait            {"selector": "[data-testid='vault-foraging-container']", "timeout_ms": 5000}
GET /snapshot
POST /click-testid    {"test_id": "vault-back-btn"}
```

**Comparison points:**
- Desktop: scans for installed applications (executables, .app bundles)
- Foraging: scans for credential files (.env, SSH keys, config files)
- Both scan the local filesystem but look for different artifacts
- **Verdict:** Could potentially merge into a single "Local Discovery" flow with two tabs/modes. Currently separate because the scan logic and result handling differ significantly.

### Summary Table

| Pair | Overlap | Recommendation |
|------|---------|---------------|
| AI Connector + AI Wizard | Low (different intent) | Keep separate |
| Custom + Autopilot | Medium (same output type) | Consider merging Autopilot as import option in Custom |
| Desktop + Foraging | Medium (both scan locally) | Consider unified "Local Discovery" with sub-modes |
| MCP + Custom | Low (different schema) | Keep separate — MCP has unique transport config |

---

## Scenario 13: Visual/UX Consistency Checks

### Intent

Verify that all 9 options in the type picker have consistent styling, and all sub-flows follow the same UX conventions for loading, errors, and navigation.

### Steps

#### 13.1 Card Styling Consistency

```
POST /navigate        {"section": "credentials"}
POST /click-testid    {"test_id": "create-credential-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
POST /query           {"selector": "[data-testid^='vault-pick-']"}
```

**Assertions:**
- All 9 elements have similar bounding box dimensions (`rect.width`, `rect.height`)
- Width variance < 20% across all cards
- All cards are `visible: true`
- Cards are arranged in a grid (verify `rect.y` values suggest rows)

**Expected:** Uniform card grid. Each card has an icon, a title, and a short description. No card is significantly larger or smaller than others.

#### 13.2 Cancel/Back Navigation Consistency

Verify every sub-flow has at least one way to exit without saving:

| Flow | Primary exit | Secondary exit |
|------|-------------|---------------|
| AI-Built Connector | `vault-back-btn` | `vault-design-cancel` |
| AI Tool Server | `vault-back-btn` | `vault-schema-cancel` |
| Web Service | `vault-back-btn` | `vault-schema-cancel` |
| Database | `vault-back-btn` | `vault-schema-cancel` |
| Desktop App | `vault-back-btn` | — |
| AI Setup Wizard | `vault-back-btn` | `vault-wizard-cancel` |
| API Autopilot | `vault-back-btn` | — |
| Workspace Connect | `vault-back-btn` | — |
| Auto-Discover | `vault-back-btn` | — |

For each flow, enter it and verify at least one exit testid is present:

```
# Template for each flow:
POST /click-testid    {"test_id": "<vault-pick-OPTION>"}
POST /wait            {"selector": "[data-testid='<flow-container>']", "timeout_ms": 5000}
POST /query           {"selector": "[data-testid='vault-back-btn'], [data-testid$='-cancel']"}
# Assert: at least 1 result
POST /click-testid    {"test_id": "vault-back-btn"}
POST /wait            {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 3000}
```

**Assertions:**
- Every flow has at least one exit mechanism
- Exit mechanism is visible and clickable (not hidden or disabled)

#### 13.3 Loading State Consistency

For flows that trigger async operations (AI Connector, Desktop Scan, Wizard, Autopilot, Foraging), verify loading indicators follow a consistent pattern:

```
# After triggering an async action in each flow, check:
GET /snapshot
# Look for consistent loading indicators in the snapshot
```

**Assertions:**
- Loading states use the same component (spinner, skeleton, progress bar)
- Loading text follows a consistent pattern ("Designing...", "Scanning...", "Generating...")
- No flow shows a blank screen during loading

#### 13.4 Error State Uniformity

For each flow, trigger an error condition and verify handling:

```
# AI-Built Connector: submit empty description
POST /click-testid    {"test_id": "vault-pick-ai-connector"}
POST /wait            {"selector": "[data-testid='vault-design-container']", "timeout_ms": 5000}
POST /click-testid    {"test_id": "vault-design-submit"}
# Expect: validation error or disabled submit

# API Autopilot: submit invalid URL
POST /click-testid    {"test_id": "vault-pick-autopilot"}
POST /wait            {"selector": "[data-testid='vault-autopilot-container']", "timeout_ms": 5000}
POST /fill-field      {"test_id": "vault-autopilot-url-input", "value": "not-a-url"}
POST /click-testid    {"test_id": "vault-autopilot-submit"}
# Expect: validation error or toast with error message

# Schema form: submit with empty required fields
POST /click-testid    {"test_id": "vault-pick-custom"}
POST /wait            {"selector": "[data-testid='vault-schema-form']", "timeout_ms": 5000}
POST /click-testid    {"test_id": "vault-schema-save"}
# Expect: validation errors on required fields
```

**Assertions:**
- Validation errors appear inline (not just toasts)
- Error messages are user-friendly (not stack traces)
- Submit buttons are either disabled when form is invalid, or show validation on click
- Errors do not crash the flow — user can fix and retry

### Success Criteria

- [ ] All 9 cards have consistent visual styling
- [ ] Every flow has a cancel/back exit
- [ ] Loading states are visually consistent
- [ ] Error states are handled uniformly across all flows
- [ ] No flow leaves the user stuck without navigation options

---

## Expected Credential Counts

After running all happy-path scenarios (2 through 10), verify the total credential count:

```
GET /state
# Check credentialCount or equivalent field

# Alternative: query the credential list directly
POST /navigate        {"section": "credentials"}
POST /fill-field      {"test_id": "credential-search", "value": ""}
POST /query           {"selector": "[data-testid='credential-list'] [data-testid^='credential-']"}
```

**Expected counts:**

| Scenario | Credentials created | Notes |
|----------|-------------------|-------|
| Scenario 2: AI-Built Connector | 1 | "Stripe" or similar |
| Scenario 3: AI Tool Server | 1 | "Test MCP — File Browser" |
| Scenario 4: Web Service | 1 | "Test Custom — Acme API" |
| Scenario 5: Database | 1 | "Test DB — Local Postgres" |
| Scenario 6: Desktop App | 1 | Machine-dependent name |
| Scenario 7: AI Setup Wizard | 1-3 | Depends on detected services |
| Scenario 8: API Autopilot | 1 | "Swagger Petstore" or similar |
| Scenario 9: Workspace Connect | 2-5 | Depends on mock services |
| Scenario 10: Auto-Discover | 1-10 | Depends on local filesystem |
| **Total** | **10-24** | **Range due to variable flows** |

**Assertions:**
- Total credential count >= 10 (minimum: one per deterministic flow)
- No duplicate credentials with the same name
- All credentials have a valid `type` field
- All credentials have a non-empty `name` field

---

## Cleanup

Remove all test credentials to restore the vault to a clean state.

```
# Option A: Delete by search (safe, targeted)
POST /navigate        {"section": "credentials"}
POST /fill-field      {"test_id": "credential-search", "value": "Test"}
POST /query           {"selector": "[data-testid='credential-list'] [data-testid^='credential-']"}
# For each result, click delete and confirm

# Option B: Delete via eval_js (fast, bulk)
POST /eval            {"js": "window.__TEST__.deleteTestCredentials()"}
POST /wait            {"selector": "[data-testid='credential-manager']", "timeout_ms": 5000}

# Option C: Delete by known names
POST /eval            {"js": "window.__TEST__.deleteCredentialByName('Test MCP — File Browser')"}
POST /eval            {"js": "window.__TEST__.deleteCredentialByName('Test Custom — Acme API')"}
POST /eval            {"js": "window.__TEST__.deleteCredentialByName('Test DB — Local Postgres')"}
```

**Assertions:**
- All test credentials removed
- `GET /state` shows credential count returned to pre-test value
- Vault list is empty (or contains only pre-existing credentials)
- No orphaned references (agents pointing to deleted credentials)

**Potential issues:**
- `deleteTestCredentials` helper may not exist — fall back to manual deletion loop
- Credentials created by AI flows have unpredictable names — search broadly
- Foraging-imported credentials may not have "Test" prefix — need alternative identification

---

## Appendix: Test Helper Functions

If the test bridge exposes `window.__TEST__` helpers, the following would simplify automation:

| Helper | Purpose |
|--------|---------|
| `simulateOAuthCallback(payload)` | Mock OAuth return for Workspace Connect |
| `deleteTestCredentials()` | Bulk-delete credentials created during test run |
| `deleteCredentialByName(name)` | Delete a single credential by name |
| `getCredentialCount()` | Return current vault credential count |
| `resetVaultState()` | Clear all credentials and reset to empty state |

These may need to be added to the test automation bridge if not already present.
