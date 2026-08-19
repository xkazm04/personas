# External operation explorer

> Situation node: `integrations-security / external-and-host-surfaces /
> external-operation-explorer` · [situation spine](../situation-spine.json)
> `sides: "client"` · `twoSided: true` · `fusedAcrossSides: false` ·
> `recurrence: 15` · `risk: medium` · `convergence: "mixed"`.
> Dimensions: **function · security · ui · cost**.
> `mergedFrom`: *MCP tool invocation surface* · *Third-party API playground* ·
> *API spec import*.
> Spine `why`: *"Listing an external surface's operations, building typed
> inputs, firing, rendering the result."*
>
> Composed 2026-08-17 against `master @ f81e2c1df`. Sweep: the 24 files of
> `src/features/vault/shared/playground/**` (2,483 lines), `src/api/agents/mcpTools.ts`,
> `src/api/system/apiProxy.ts`, `src/lib/credentials/catalogApiEndpoints.ts` (1,625
> lines), the six `src/lib/bindings/` types they consume, `src-tauri/src/engine/mcp_tools.rs`
> (2,442 lines), `src-tauri/src/commands/credentials/{mcp_tools,api_proxy}.rs`,
> `src-tauri/src/ipc_auth.rs`, plus a whole-tree pass over 2,083 `.tsx` files and
> 963 `.rs` files. Every count below has two independent implementations; where
> they disagreed, the disagreement is written down.

---

## §0 — Headline

**The app declares 504 parameters for 472 catalog operations, records
`required: true` on 309 of them, and the request builder reads the flag in
exactly one place: a read-only detail panel. Replayed against the real catalog,
209 of 209 endpoints with a path parameter turn a blank form into a
syntactically valid, entirely fabricated URL — `/{project}/_apis/pipelines`
fires as `/project/_apis/pipelines`.**

The declaration exists. Nobody enforces it. And the failure mode is not an
error dialog — it is a request that *looks right*, addressed to somebody else's
production API, with your credential attached.

Three more measured facts from the same sweep:

- `schema_type` is set on **504 of 504** catalog parameters and its value is
  `"string"` **504 times**. The field carries zero bits. It is a type
  declaration whose only constructor (`p()`, `catalogApiEndpoints.ts:10`)
  defaults it and which no call site overrides.
- `request_body.schema_json` is **`null` on all 120** catalog endpoints that
  declare a body — so `RequestBuilder.tsx:37`'s prefill branch is dead for the
  catalog, and for a user-imported OpenAPI spec it prefills the **schema** into
  the body editor as if it were the payload.
- The MCP half *does* generate its form from the operation's own JSON Schema —
  and then throws the schema away when it builds the call:
  `McpToolsTab.tsx:54` is `try { args[key] = JSON.parse(val) } catch { args[key] = val }`.
  A tool that declares `{"type":"string"}` receives the number `123` when the
  user types `123`.

The backend of this leaf is genuinely good and should be copied, not rewritten
(§6). The defect is entirely in the seam between *what the operation declared*
and *what the form did with it*.

---

## §1 — Trigger

You are in this situation when you say, or type, any of:

1. *"Let the user browse the tools this MCP server exposes and try one."*
2. *"Add an API playground / request builder to the connector detail view."*
3. *"Import an OpenAPI spec and list its endpoints so we can test them."*
4. *"Show the tool's input schema and build a form from it."*
5. *"Render the tool result / response body."*

And the **"if you are about to write X"** test — you are in this leaf the
moment you write any of these:

- `.map(op => <Row …/>)` over a list you did **not** author,
- a `<input>`/`<textarea>` whose `name` came from a foreign schema,
- `JSON.parse(userTypedValue)` on the way *out* of the app,
- `<pre>{result.text}</pre>` where `result` came off a socket or a stdio pipe.

You are **not** in this leaf when the operations are your own — a persona
endpoint playground (`sub_deployment/components/cloud/ApiPlayground.tsx`) is
`manual-test-fire`, because there is no foreign declaration to honour.

---

## §2 — The one way

**Make the operation's declaration the only source of the form and the only
source of the payload, and refuse to fire until the declaration is satisfied.**
Concretely, in this order: (a) take the operation list from *one* merged source
and stamp each entry with where it came from, because a baked catalog entry and
a server-advertised entry are trusted differently; (b) generate every control
from the declared parameter — its name, its declared type, its `required` flag,
its `enum` if it has one — so that adding a control kind is a change to one
`switch` and never to a call site; (c) give that switch an explicit arm for the
kind you do not recognise which renders *"unsupported parameter type"* and
**blocks submit**, never a text box that silently accepts anything; (d) build
the payload from the same declaration you rendered — coerce `"123"` to a number
because the schema said `number`, not because `JSON.parse` succeeded — and
**disable the fire button while any `required` parameter is unfilled**, so the
declaration is enforced by the affordance rather than by a red border nobody
reads; (e) resolve path templates only from filled values, and when a
placeholder is unfilled **leave it unresolved and refuse**, because substituting
the parameter's own name produces a URL that a server will happily answer; and
(f) render the response by its own declared kind with the same
unknown-kind arm, so a content block the app cannot draw says so instead of
rendering blank. The two halves of the contract are: **the backend owns whether
the operation may run at all** (allowlist, rate limit, size caps, audit — §6),
and **the frontend owns whether the request is well-formed**. Neither can do
the other's job, and today the frontend is not doing its own.

If you can only do one thing: **never let an unfilled required parameter
produce a request.** Every other item on this list degrades the user's
experience; that one spends their credential on a call they did not mean to
make.

---

## §3 — Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `@/api/agents/mcpTools` → `listMcpTools(credentialId)` / `executeMcpTool(credentialId, toolName, args)` | The only two doors to a foreign MCP surface. Both go through `invokeWithTimeout`; `execute_mcp_tool` is `AuthTier::Privileged` (`ipc_auth.rs:271-274`). |
| `@/api/system/apiProxy` → `parseApiDefinition` / `saveApiDefinition` / `loadApiDefinition` / `executeApiRequest` | Spec import, at-rest encryption of the imported spec (AES-256-GCM, `api_proxy.rs:114`), and the credential-injecting request door. |
| `src/lib/bindings/ApiEndpoint.ts`, `ApiParameter.ts`, `ApiRequestBody.ts` | The declared contract: `parameters[].{name, location, required, schema_type, description}` and `request_body.{content_type, schema_json, required}`. **`required` and `schema_type` are the two fields this leaf exists to honour.** |
| `src/lib/bindings/McpTool.ts` (`input_schema: JsonValue \| null`) | The foreign JSON Schema. Treat it as untrusted *data*, not as a type. |
| `src/lib/bindings/McpToolContent.ts` (`{ type: string, text: string \| null }`) | An **open** discriminator. Anything you render off it needs an unknown arm. |
| `forms/FormField`, `forms/Listbox`, `forms/AccessibleToggle` (`src/features/shared/components/forms/`) | Label + control + error, a real listbox instead of `<select>`, a real switch. The playground hand-rolls all three. |
| `buttons/AsyncButton` | The fire control. Returns-a-promise `onClick`, real spinner, double-submit guard. |
| `display/UnifiedTable` | If the operation list is tabular: three-state body, ghost-under-chrome, id-guarded row cascade. |
| `feedback/InlineErrorBanner` | Already used correctly here (`McpToolsTab.tsx:105`, `:71`). |

Do **not** reach for: `<select>` (two live sites, §7), a raw `<button>` as the
row wrapper (§9), `LoadingSpinner` as a busy state on a control (renders `null`).

---

## §4 — Steps

1. **Decide the trust of each list source before you merge them.** There are
   three here — a baked catalog (`CATALOG_API_ENDPOINTS`, 71 connectors / 472
   endpoints), a user-imported spec (`parse_api_definition`), and a live
   server (`tools/list`). `mergeEndpoints` (`apiExplorerHelpers.ts`) currently
   folds catalog and imported into one array with no provenance field. Add one.
   A row the user pasted and a row the app shipped are not the same row.
2. **Fetch the live list through the cached door.** `list_tools` already caches
   per credential for 60 s, follows `nextCursor` for at most
   `MCP_TOOLS_LIST_MAX_PAGES = 50` (`mcp_tools.rs:64`), honours a clamped
   server `ttlMs` (5 s–3600 s, `:50-51`), and refuses to cache a degraded
   gateway merge for the full minute (`DEGRADED_TOOLS_CACHE_TTL = 5 s`, `:59`).
   Do not add a second fetch path.
3. **Generate the form from the declaration — once, in one component.**
   `McpToolInputForm.tsx` is the closer of the two attempts: it reads
   `schema.properties`, `schema.required`, and each property's `type` and
   `description`. Finish it: give the kind switch an exhaustive shape with a
   named union rather than a chain of `===` against string literals, and add
   `enum` (a foreign schema that declares three legal values should render a
   `Listbox`, not a free-text box).
4. **Add the unknown-kind arm, and make it block.** Today the final `else` at
   `McpToolInputForm.tsx:73-81` renders a text input for *any* unrecognised
   type. That is the arm that turns "I do not understand this parameter" into
   "type whatever you like".
5. **Enforce `required` at the affordance.** The word `required` is rendered at
   `McpToolInputForm.tsx:49` and at `EndpointRow.tsx:108`; neither is wired to
   anything. `ToolDetail.tsx:58-68`'s fire button is `disabled={executing}` and
   nothing else. Compute `missingRequired` from the same `required` array you
   just rendered and add it to that `disabled` expression. This is the single
   highest-value edit in the leaf.
6. **Build the payload from the declared type, not from a parse attempt.**
   Replace `McpToolsTab.tsx:51-55` with a coercion keyed on
   `properties[key].type`: `number`/`integer` → `Number(v)` with a NaN refusal,
   `boolean` → `v === 'true'`, `object`/`array` → `JSON.parse(v)` with the parse
   *failure* surfaced as a field error, everything else → the string as typed.
7. **Resolve path templates from filled values only.** `RequestBuilder.tsx:50`
   is `resolved.replace(\`{${key}}\`, encodeURIComponent(val || key))`. Delete
   the `|| key`. An unresolved `{project}` left in the URL is a *visible*
   failure; `/project/` is an invisible one.
8. **Fire through the busy primitive and stop.** `AsyncButton` owns the spinner,
   the `disabled`, the `aria-busy` and the double-submit guard. The playground's
   hand-rolled `<button>` at `RequestBuilder.tsx:85-92` owns none of them except
   `disabled`.
9. **Render the result by its own kind, with the same unknown arm.**
   `McpToolResultDisplay.tsx:45-56` prints `block.text` for every block and
   captions the type when it is not `"text"` — so an `image`, `audio` or
   `resource` block (whose `text` is `null`) renders the literal string
   `(empty)` under a caption. Give it an arm that says the block kind is not
   renderable and offers the raw JSON.
10. **And then stop.** Rate limiting, size caps, argument-depth caps, binary
    allowlisting, cycle detection and the audit row are all already implemented
    on the Rust side (§6). Do not re-implement any of them in the renderer.

**Before writing §9's gate, ask whether the signature can make this
unspellable.** Two of the seven defects can be:

- `ApiParameter.schema_type: string | null` → `schema_type: ParamKind` where
  `ParamKind` is a closed union generated from the Rust enum. Today the field is
  a `string | null` that is `"string"` 504 out of 504 times, which is Q1 in
  action — the type is closed on *nothing*. This is the same finding
  [`schema-driven-form`](./schema-driven-form.md) published: `ParamType`
  (`core/src/models/persona.rs:218`) is the repo's one real control-kind union,
  and this surface does not use it.
- `McpToolContent { type: String, text: Option<String> }` → an internally-tagged
  enum (`Text { text: String }`, `Image { data, mime_type }`, …, `Other(Value)`).
  Then "render `text` for a block that has none" stops compiling. It survives
  Q1–Q7: the discriminator *is* the thing being constrained (Q1), the enum is
  closed as well as required (Q2), it has 3 construction sites in one file (Q3),
  variants are not publicly forgeable into the wrong shape (Q4), and the caller
  is *withheld* the raw `text` on a non-text variant (Q5/Q6).

What no type reaches: **the `required` flag.** `required: boolean` is already
required and already closed. The defect is that a *different* value — the form's
current state — is never compared against it. That is doctrine §"where types
cannot reach" item 4: nothing is short a parameter and no enum is short a
variant; the failure is nobody calling anything. §9 gates that class.

---

## §5 — Anti-patterns

**5.1 — Reading a declaration to render it and ignoring it to act.**
`EndpointRow.tsx:108` prints `· required`. `EndpointRow.tsx:110-111` prints the
`schema_type`. `RequestBuilder.tsx` reads neither. Failure mode: the user is
*told* the parameter is required by the same UI that then lets them omit it —
which is worse than not telling them, because it manufactures the impression
that something is checking.

**5.2 — Substituting an identifier for a missing value.**
`encodeURIComponent(val || key)`. Failure mode: the request succeeds
syntactically and fails semantically, against a third party, on the user's
credential. A 404 from `/repos/owner/repo` is indistinguishable from a real
404, so the user debugs the API instead of the form.

**5.3 — `JSON.parse`-or-keep-raw as a type system.**
`try { args[k] = JSON.parse(v) } catch { args[k] = v }`. Failure mode: the type
of the argument is decided by whether the user's text happens to be valid JSON.
`"true"`, `"123"`, `"null"` and `"[1,2]"` all change type; `"abc"` does not.
The declared schema is sitting three lines away, unread. (Measured tree-wide:
19 `parse-or-keep-raw` sites in 18 files, of which **4** build an outbound
payload and 15 are display pretty-printers where the fallback is correct — see
§9's decline analysis.)

**5.4 — A discriminator used as a caption instead of a switch.**
`{block.type !== 'text' && <div>{block.type}</div>}` followed by
`{formatContent(block.text)}`. Failure mode: the app renders `(empty)` for
every block kind it does not support, which reads as *"the tool returned
nothing"* rather than *"we cannot draw this"*. The two are opposite debugging
instructions.

**5.5 — Deriving the same fact two ways.** Path parameters come from a regex
over the path string (`RequestBuilder.tsx:41`); query parameters come from the
declaration (`initQueryParams`, `BuilderParams.tsx:93-98`). Failure mode: the
248 declared `location: "path"` entries — every one of them
`required: true` — are never consulted, so their `description` (the field that
would tell the user what `{repositoryId}` means) is unreachable from the form.

**5.6 — A row whose primary affordance is nested inside its own disclosure
control.** `McpToolRow.tsx:28` opens a `<button>` for expand/collapse and
`McpToolRow.tsx:48` opens the **Run** `<button>` inside it. Failure mode: invalid
HTML; the inner control is not independently reachable by keyboard in several
AT/browser combinations; React logs a DOM-nesting warning; and the `Run` handler
survives only because of an `e.stopPropagation()` that a later edit can drop
without any test noticing. This is §9's gate.

**5.7 — Firing without an inline busy primitive.**
`RequestBuilder.tsx:85-92` is a hand-rolled `<button>` with a `LoadingSpinner`
inside it — and `feedback/LoadingSpinner` **renders `null`**. So the send button
shows the `Play` icon vanish and nothing replace it. `ToolDetail.tsx:61` and
`ApiExplorerTab.tsx:29` have the same import. Three sites, one shared
misconception, already documented in `CLAUDE.md`.

**5.8 — Trusting a `catch` to be a "no data" branch.**
`useApiExplorerState.ts:49` swallows a failed `loadApiDefinition` into
`silentCatch` and leaves `endpoints` empty, so a *decryption failure of the
saved spec* renders as the "no endpoints yet, upload one" empty state. The user
is invited to re-import a spec that is already there.

---

## §6 — Evidence

**Copy this one:** `src-tauri/src/engine/mcp_tools.rs`. It is the best-argued
foreign-surface driver in this repository and most of the leaf's hard problems
are already solved in it:

- **`validate_mcp_command` (`:1802-1875`)** — rejects shell metacharacters
  before tokenising (`:1809`), allowlists the *binary stem* after stripping
  directory and `.exe`/`.cmd`/`.bat` (`:1819-1839`, `MCP_ALLOWED_BINARIES` at
  `:1774`), and then — the part most implementations miss — *keeps going*,
  because `npx`/`uvx`/`docker` are universal code-execution gateways, rejecting
  remote-code specs (`is_remote_code_spec`, `:1877`) and dangerous container
  args (`:1889`). The comment at `:1847-1850` states honestly what it does
  **not** stop (a poisoned but real registry package) and names the gate that
  would. `%` and `"` were added to `SHELL_METACHARACTERS` (`:1796`) *after an
  executed experiment* because `cmd.exe` expands `%VAR%` out of the child's
  environment — which this app populates with decrypted credentials.
- **`spawn_mcp_process` (`:2051-2129`)** — `cmd /C` with each token as a
  separate argument rather than one shell string; `kill_on_drop(true)`;
  `CREATE_NO_WINDOW`; and a stderr *drain* task (`:2117-2127`) with the reason
  spelled out: without a reader the OS pipe buffer fills and blocks the child.
- **`execute_tool_guarded` (`:764`)** — rate-limits on `(credential_id, tool)`
  and says why the bare tool name was wrong (`:774-777`: the gateway `member::`
  prefix is caller-influenced, so keying on the name alone mints a fresh bucket
  per prefix).
- **Gateway recursion** — `MAX_GATEWAY_DEPTH = 8` (`:550`) *plus* per-path cycle
  detection that backtracks on unwind so a diamond still resolves (`:604-613`).
- **Caps** — `MAX_MCP_PAYLOAD_BYTES` 10 MB, `MAX_ARGUMENT_DEPTH` 20,
  `MAX_ARGUMENT_BYTES` 1 MB, `MCP_SESSION_TIMEOUT` 120 s (`:28-38`).
- **`detect_authorization_required` (`:491-538`)** — four layered AND conditions
  before treating a failed result as a JIT-auth prompt, with the conservatism
  stated as the design goal.

**Frontend sites worth copying:** `McpToolsTab.tsx:32-44` (a load handler that
distinguishes *never loaded* from *loaded and empty* via `hasLoaded`, which is
what makes `ToolEmptyList` correct); `EndpointRow.tsx:108-135` (the only place
in the leaf that renders the full declared contract).

**Frontend sites to copy *from* rather than to:** none. Every form in this leaf
is a partial implementation of §2.

---

## §7 — Deviations

Counts are as measured on 2026-08-17 at `f81e2c1df`.

| # | Where | Defect |
| --- | --- | --- |
| 1 | `RequestBuilder.tsx:50` | `encodeURIComponent(val \|\| key)` substitutes the **parameter name** for an unfilled path parameter. Replayed against the catalog: **209 of 209** endpoints with a path parameter yield a fabricated, syntactically valid URL. |
| 2 | `RequestBuilder.tsx` (whole file) | Reads `p.location` and `p.name` only. **309 of 504** declared parameters carry `required: true` and none is enforced; the fire button (`:85-92`) is `disabled={isSending \|\| !path.trim()}`. |
| 3 | `BuilderParams.tsx:93-98` | `initQueryParams` seeds `{ key, value: '' }`. `resolvedPath` filters on `q.key.trim()` only, so **61 query parameters declared `required: true`** ship as `api-version=` with an empty value. |
| 4 | `RequestBuilder.tsx:37` | Prefills the body editor with `request_body.schema_json` — the **schema**, not an instance. Dead for the catalog (`schema_json` is `null` on **120 of 120**), wrong for an imported spec. |
| 5 | `McpToolsTab.tsx:51-55` | Argument type decided by whether `JSON.parse` throws, with `tool.input_schema` unread. The same component read `properties` 20 lines earlier (`:70-73`). |
| 6 | `McpToolInputForm.tsx:73-81` | The unknown-type arm is a text input. No `enum` support; a schema declaring three legal values renders free text. |
| 7 | `McpToolInputForm.tsx:49` | `required` is rendered as a **hardcoded English literal** (`<span>required</span>`) and is not wired to submit. Also an i18n violation in a 14-locale app. |
| 8 | `McpToolInputForm.tsx:59,78` | `placeholder={\`Enter JSON ${propType}...\`}` / `` `Enter ${propType}...` `` — hardcoded English placeholders. |
| 9 | `McpToolResultDisplay.tsx:45-56` | No arm for a non-text content block. `McpToolContent.text` is `string \| null`; a block with `text: null` renders `(empty)` under a type caption. |
| 10 | `McpToolRow.tsx:28 → :48` | **Run** `<button>` nested inside the expand/collapse `<button>`. Invalid HTML; the affordance survives on one `stopPropagation`. (§9) |
| 11 | `McpToolInputForm.tsx:64`, `RequestBuilder.tsx:71` | Raw `<select>` instead of `forms/Listbox`. Already counted by the published `raw-select` rule (2 of its 63 matches). |
| 12 | `ToolDetail.tsx:61`, `RequestBuilder.tsx:90`, `ApiExplorerTab.tsx:29` | `feedback/LoadingSpinner` used as a visible busy indicator. It renders `null`. |
| 13 | `useApiExplorerState.ts:41-57` | A failed `loadApiDefinition` (including a decryption failure) is `silentCatch`-ed into the "no endpoints yet" empty state. |
| 14 | `catalogApiEndpoints.ts:10` | `schema_type` defaults to `'string'` and is never overridden: **504 of 504** parameters are `"string"`. A declared type that carries no information. |
| 15 | `CredentialPlaygroundModal.tsx:22-29` | Tab labels are hardcoded English (`'Overview'`, `'Executions'`, `'API Explorer'`, `'MCP Tools'`, `'Rotation'`) in a component whose children all use `useTranslation`. |
| 16 | `CredentialPlaygroundModal.tsx:25` | Tab availability is `category === 'custom' \|\| (category && !['mcp','database'].includes(category))` — a double-negative over an open string set. A connector with a new category silently gets the API Explorer. |

**Verified and *not* a deviation** (recorded because a reader will otherwise
re-derive it):

- **`execute_api_request` is `AuthTier::Public` at the IPC wrapper**
  (`ipc_auth.rs:243-255`, asserted at `:872`) while `execute_mcp_tool` is
  `Privileged` (`:271-274`) — two doors of one leaf, in one folder, on opposite
  sides of the gate. The compensating control named in the comment is the
  in-body async `require_privileged`, which checks only that
  `IPC_SESSION_TOKEN.get().is_some()` (`ipc_auth.rs:547-562`) and therefore
  returns `Ok(())` for every caller post-startup. **This is already published**
  by [`ipc-command-authorization`](./ipc-command-authorization.md) §§105-108 and
  [`ipc-session-token-race`](./ipc-session-token-race.md) `:248` (which quotes
  these exact lines) and registered as deferred fix **#32**. I verified it by
  reading and am citing it, not re-reporting it.
- **Deferred fix #34 does not describe this surface.** #34 concerns
  `src-tauri/src/mcp_server/tools.rs` — the app *serving* tool results **to** an
  external model. This leaf is the app *consuming* an external server's results.
  Opposite direction, different door, and the explorer renders into a `<pre>` as
  React children (safe by construction, per
  [`rendering-untrusted-content`](./rendering-untrusted-content.md) §2). The
  explorer is **not** one of the surfaces #34 would leak through. See §12.3 for
  a correction owed to #34's own citations.

---

## §8 — Gaps

**8.1 — There is no shared operation-explorer primitive, and the leaf needs
one.** Four independent implementations of "list foreign operations, build
inputs, fire, render" exist (`McpToolsTab` + `ToolDetail` + `McpToolInputForm`,
`ApiExplorerTab` + `RequestBuilder` + `BuilderParams`,
`plugins/companion/mcp/McpRequestPanel.tsx` at 262 lines, and
`agents/sub_tool_runner/components/ToolInvocationCard.tsx` at 273 lines). They
share no code. The catalog (`src/features/shared/components/CATALOG.md`) has
`FormField`, `Listbox`, `AsyncButton`, `UnifiedTable` — the parts — and nothing
that composes them into a schema-driven operation form. That composition is the
missing primitive and it is where `required` should live so no caller can forget
it (the `FacetedDecisionTable` precedent: a required prop got 3/3 real copy
while its optional-prop siblings got 5-of-20 fallthrough).

**8.2 — `ApiParameter` cannot express what an OpenAPI spec knows.** It has no
`enum`, no `format`, no `default`, no `example`, no `minimum`/`maximum`,
no `style`/`explode` for arrays. `parse_openapi_spec` therefore throws that
information away at import, and no amount of frontend work can recover it. Any
fix to §7 items 2/3/6 that stops at the renderer will hit this ceiling.

**8.3 — `schema_json: String` is a blob, and no type reaches inside it.** The
request body schema is a JSON string in a `TEXT`-shaped field. This is doctrine
§"where types cannot reach" item 5 (*no type reaches inside a serialized blob*),
reached here from the export side rather than the import side. Prefilling a body
correctly requires *generating an instance from a schema*, which is a real
piece of work and not a rendering concern.

**8.4 — The 60 s tools/list cache has no invalidation hook on the surface that
would want one.** `invalidate_tools_cache` exists (`mcp_tools.rs:212`) and is
`#[allow(dead_code)]` — **zero callers**. So the explorer's *Refresh* button
(`McpToolsTab.tsx:32`) can return the same stale list for up to a minute after a
server restart, and the button gives the user no way to know. Either wire
Refresh to it or say in the UI that the list is cached.

**8.5 — Nothing records that an operation was fired from the explorer.**
`execute_tool` writes a `tool_audit_log` row (`mcp_tools.rs:907`) but
`execute_api_request` is a different subsystem with its own
`get_api_proxy_metrics`. There is no single answer to *"what did this credential
do today, across both explorers"*, which is the question a user asks after a
surprise bill.

**8.6 — The provenance of a merged endpoint is unrecoverable after
`mergeEndpoints`.** Once catalog and imported rows are in one array there is no
field distinguishing them, so the UI cannot say *"this one shipped with the
app"* vs *"this one came from a file you pasted"* — and it cannot apply
different trust to them either.

---

## §9 — The missing gate

> **Manifestation layer.** The condition below is *"an activating control is
> nested inside another activating control"*. In this repo that condition wears
> a `<button>` inside a `<button>`. A repo that builds rows out of `<div
> role="button">` or a framework's `<Pressable>` will need a different proxy for
> the same condition — see the contract's §9 note on portability.

### 9.1 — The rule I am shipping

`McpToolRow.tsx` puts the operation's **Run** affordance inside the row's own
expand/collapse `<button>`. That is not a cosmetic problem for this leaf: the
Run control *is* the operation explorer, and it currently works only because of
an `e.stopPropagation()` that nothing tests.

The signal is `<button …>` whose body opens another activator (`<button>`,
`<Button>`, or `<a href>`) before its own `</button>`.

```json
{
  "id": "nested-activation-target",
  "goldenPath": "docs/concepts/golden-paths/external-operation-explorer.md",
  "title": "An activating control nested inside another activating control",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "<button(?![A-Za-z0-9_-])(?:\"[^\"]*\"|'[^']*'|`[^`]*`|\\{(?:[^{}]|\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\})*\\}|[^<>{}\"'`])*(?<![/-])>(?:(?!</button>|<button(?![A-Za-z0-9_-]))[\\s\\S]){0,2500}?<(?:button(?![A-Za-z0-9_-])|Button(?![A-Za-z0-9_-])|a\\s(?:=>|[^<>]){0,200}href)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A <button> whose body opens another activator (<button>, <Button>, <a href>) before its own </button>. Invalid HTML: the inner control is not independently reachable by keyboard in several AT/browser combinations, and it survives only on an e.stopPropagation() no test covers. The opening tag is matched with strings and {…} attribute expressions treated as OPAQUE — a bare `>` inside className={cond ? 'a' : 'b'} or onClick={() => i > n} is arithmetic, never a tag close. Fix: make the row a <div> with the affordances as siblings, or hoist the inner control out."
  },
  "baseline": { "files": 6, "matches": 7 },
  "floor": 1500
}
```

```json
{
  "id": "nested-activation-target-positive-control",
  "goldenPath": "docs/concepts/golden-paths/external-operation-explorer.md",
  "title": "control: a <button> that closes before any nested activator",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "<button(?![A-Za-z0-9_-])(?:\"[^\"]*\"|'[^']*'|`[^`]*`|\\{(?:[^{}]|\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\})*\\}|[^<>{}\"'`])*(?<![/-])>(?:(?!</button>|<button(?![A-Za-z0-9_-])|<Button(?![A-Za-z0-9_-])|<a\\s(?:=>|[^<>]){0,200}href)[\\s\\S]){0,2500}?</button>",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL for nested-activation-target — same anchors, the COMPLIANT form. Partitions the population: 2,808 compliant + 7 violating = 2,815 <button> elements that reach a terminator, out of 2,846 raw `<button` occurrences tree-wide (the remainder are self-closing or comment mentions). Carries no baseline; the merger skips controls."
  },
  "floor": 1500
}
```

**Measurement.**

| | files | matches |
| --- | ---: | ---: |
| violating (`nested-activation-target`) | 6 | **7** |
| compliant (positive control) | 1,094 | **2,808** |
| violating share of the partition | | **0.249 %** |

Walked 2,083 `.tsx` files; runtime 1.5 s and 1.7 s respectively (no
backtracking pathology — the brace-opaque construction is linear here, unlike
the `(?:\s|//[^\n]*)*` shape the doctrine warns about).

**Hand-verified precision: 7/7 = 100 %.** I opened all six files:
`KnowledgeGraphDashboard.tsx:278` and `:301` (a clear-filter `×` button inside a
dropdown-toggle button), `UseCaseHistory.tsx:102` (an expand button inside a row
button), `EventLogList.tsx:371` (a delete-saved-view button inside the
apply-view button), `CompanionAssignmentCards.tsx:73` (a secondary action inside
the card button), `JobRow.tsx:74` (an `<a href target="_blank">` inside the
row's toggle button), `McpToolRow.tsx:28` (this leaf's own).

**Fail-loud.** `floor: 1500` against 2,083 walked `.tsx` files; a roots/extension
drift trips the structural assertion before any drift number is believed. The
positive control is the second half of the guard: if the compliant count
collapses, the opening-tag matcher broke, not the codebase.

**Site-level overlap against the FINAL pattern** (not a draft, per doctrine): I
re-ran six published rules that could plausibly cover these sites.
`unfocusable-click-target` matches `div|span|li|tr|td|…` with an `onClick` and
therefore **cannot** match a real `<button>`; `stateless-disclosure-control`
matched **0** of my 6 files (it hit `RecipeListItem.tsx` and
`SearchResultCard.tsx`, neither in my set); `raw-select`, `asserted-definition-blob`,
`read-failure-as-empty-value` and `unverifiable-catalog-lookup` matched **0** of
my 7 sites. **Site overlap: 0/7.**

**What it cannot see.** A row built from `<div role="button" onClick>` with a
nested `<button>` — which is precisely the *correct* fix
`ConversationCards.tsx:51` already applies, and which the census can only
observe as an absence. This gate ratchets one direction; it does not certify the
other.

### 9.2 — Three gates I declined, with the numbers

**Declined A — `foreign-payload-built-by-guess`** (`JSON.parse` with a
keep-the-raw-string fallback, building an outbound argument map). Measured
tree-wide by a bespoke matcher: **19 sites in 18 files**. Hand-classified: **4**
build an outbound payload (`McpToolsTab.tsx:54`, `ApiPlayground.tsx:75`,
`useRunnerState.ts:166`, `useDesignConversation.ts:167`); **15** are display
pretty-printers (`prettyJson.ts:9`, `JsonPayloadBlock.tsx:20`,
`McpToolResultDisplay.tsx:10`, `NodePopover.tsx:12`, …) where falling back to
the raw text is *correct*. Precision **4/19 = 21 %**. Tightening the pattern to
require assignment into a keyed accumulator (`args[key] = JSON.parse(val)`)
raised precision to 100 % and dropped the population to **1 match in 1 file** —
a ratchet on a single site, which is a rule nobody will ever see move. Declined
on both counts. *A gate that fires on correct content is worse than no gate*,
and a gate with a population of one is a comment with a runner attached.

**Declined B — an `input_schema`-form-without-`required` gate.** The condition
is an **absence** (a file iterates `properties` and never reads `required`), and
per doctrine §4 the census ratchets a count of something *present*; it cannot
assert that a file omits something. The right instrument is an inventory: take
each `src/lib/bindings/*.ts` field and ask whether any `.ts/.tsx` file reads it.
I ran that for this leaf's contract and it is decisive —
`ApiParameter.required` and `ApiParameter.schema_type` are read in **exactly one
file** (`EndpointRow.tsx`, lines 108/110-111), a read-only detail panel, and in
**zero** files that build a request. That is a `check-*.mjs` in the shape of
`check-unused-bindings.sh`, not a census rule. Specified here; not written,
because the campaign is not authorised to add scripts without a home.

**Declined C — an OCR-style spawn/allowlist gate for `spawn_mcp_process`.**
`mcp_tools.rs:2063`/`:2076` are already matched by the published
`wholesale-inherited-child-env` (`:2076`) and `anonymous-deadline` (`:2172`,
`:2219`) rules, and `unbound-child-lifetime` covers the family. Site overlap
would be ~100 %. Declined, following the 83 %-overlap precedent.

---

## §10 — Convergence oracle

Cohort established **for this leaf, at measurement time** (doctrine §5): I swept
`../personas-web` (1,088 files), `../brainiac` (1,071), `../personas-cloud`
(48), `../vibeman` (2,060), `../ascent` (950) for ten probes.

| probe | personas-web | brainiac | personas-cloud | vibeman | ascent |
| --- | ---: | ---: | ---: | ---: | ---: |
| `tools/list` \| `tools/call` | 1† | 11 | 0 | 0 | 0 |
| JSON-Schema-driven input form | 0 | 1 | 5 | 16 | 2 |
| OpenAPI spec import | 0 | 12 | 1 | 0 | 4 |
| request/response playground UI | 20† | 3 | 0 | 4 | 0 |
| nested-activator awareness (in prose) | 0 | 0 | 0 | 0 | 0 |

† `personas-web`'s hits are **marketing copy about this app's features**
(`src/data/guide/content/credentials.ts`, `src/data/connectors.ts`) and its
"playground" hits are its own pricing/demo page — a **dependent**, not a witness
(doctrine §5: *a sibling that consumes your decision is not a second opinion*).
Cohort for this leaf: **5 → 2 independent** (`brainiac`, `ascent`).

Three findings:

1. **`convergence: "mixed"` holds, and it holds for a reason worth naming.**
   The list-and-invoke half is genuinely mixed: `brainiac` implements the MCP
   server side (`crates/brainiac-server/src/mcp.rs` — it *declares* an
   `inputSchema`) and `ascent` imports OpenAPI, so two independent siblings have
   pieces of this leaf. The **form** half is a silence: **0 of 4 independent
   siblings builds a UI form from a foreign schema.** They are all producers or
   parsers; none renders. So the label is right and the mix splits by *clause*,
   which is exactly the failure mode a single enum field caused on
   `cross-device-pairing`. Report it per clause, not per leaf.

2. **The nested-activator rule is a house convention, not physics.** Zero
   siblings discuss it in prose and zero have a gate for it. But — and this is
   the interesting half — **four separate source comments *inside this repo*
   state the rule and explain that the author deliberately avoided it**:
   `ConversationCards.tsx:51` (*"A div-with-role, not a `<button>`: the body
   renders markdown whose links must stay valid, clickable anchors (nested
   interactives are not)"*), `ResumeBanner.tsx:57` (*"`role="button"` span inside
   the outer `<button>` (invalid nesting that leaned on stopPropagation);
   keyboard/AT users now get two real buttons"*), `DriveFileList.tsx:798`, and
   `CommandPaletteResults.tsx:19`. **Personas is ahead of the fleet here** — the
   knowledge exists, has been applied four times, and has never been written
   down anywhere a seventh developer would find it. That is the case for a gate
   rather than against it. (Stated *as* self-comparison, per doctrine §5.3.)

3. **`brainiac` is not a port and does not corroborate by accident.** Different
   language, different transport, no shared constants, no shared error strings.
   Its MCP surface is the *server* side of ours. A producer agreeing with a
   consumer is weak evidence about the consumer, and I am not counting it as
   support for anything in §2.

---

## §11 — Two-sided contract

The spine marks this leaf `twoSided: true`, and it is correct. Stated
explicitly, because half a path is worse than none:

**The server half owns admissibility.** Whether an operation may run at all:
binary allowlist (`MCP_ALLOWED_BINARIES`), shell-metacharacter refusal, remote-
code-spec refusal, container-arg refusal, rate limit keyed on
`(credential_id, tool)`, payload/argument/depth caps, session timeout, gateway
depth and cycle guards, the credential decrypt, and the `tool_audit_log` row.
All of it exists (§6). None of it is duplicated in the renderer, correctly.

**The client half owns well-formedness.** Whether the request the user is about
to make is the request they meant: the declared type, the declared requiredness,
the resolved path template, the coercion, and the disabled fire button. **None
of it exists.** That asymmetry is this document's whole finding.

**The contract between them** is the six ts-rs bindings. It currently carries
`required` and `schema_type` across the wire and drops both on arrival. A
binding field with no reader is invisible to every gate in this repo — it
produces no diff, no untracked file, and no type error (doctrine §"where types
cannot reach", item 4).

---

## §12 — Corrections

**12.1 — To my own brief: "the operation list — baked catalog or fetched
live?" is a false dichotomy here.** It is **three** sources merged into one
array with no provenance: a baked catalog (71 connectors, 472 endpoints, 504
parameters — `catalogApiEndpoints.ts`), a user-imported OpenAPI spec (encrypted
at rest under `%APPDATA%/…/api_definitions/<credential>.json.enc`), and a live
`tools/list`. The interesting question is not which one — it is that after
`mergeEndpoints` you cannot tell them apart (§8.6).

**12.2 — To my own brief: "is the parameter form generated from a schema
(checkable) or hand-written per operation (drifts silently)?"** Neither
branch is right. It is generated from a schema **and** drifts silently, because
generation and enforcement were separated. The MCP form generates controls from
`input_schema` and then builds the payload without it; the API form generates
query-parameter *names* from `parameters` and derives path parameters from a
regex over the path string instead. A generated form is not a checked form.

**12.3 — To deferred fix #34, twice.** (a) Its premise survives:
`src-tauri/src/mcp_server/tools.rs` still contains **zero** occurrences of
`redact|scrub|mask|sanitize`, and `handle_personas_result` is still there. (b)
Its citations are stale as of today: the entry says *"3,243 lines"* and cites
`:1812`, `:1667`, `:1844-1852`; the file is now **2,407 lines** and
`handle_personas_result` is at **`:1803`**, registered at `:1139`, declared at
`:769`. The file lost 836 lines *on the same day the entry was written*. (c)
The entry does not say which surfaces would display such a result, and my brief
inferred that the explorer might be one. **It is not** — #34 is the app serving
tool results outward to a model; this leaf is the app consuming an external
server's results inward. Recording the direction so the next reader does not
re-derive it.

**12.4 — To [`schema-driven-form`](./schema-driven-form.md): its census rule
has a recall gap, and this leaf sits in it.** `declared-field-type-literal-chain`
matches 42 sites in 13 files and matches **zero** in
`src/features/vault/shared/playground/`. The reason is mechanical: the pattern
keys on a *member access* (`field.type === '…'`), and `McpToolInputForm.tsx:41`
hoists the discriminator into a local first —
`const propType = (prop.type as string) || 'string';` — then compares
`propType === 'boolean'` and `['object','array'].includes(propType)`. Same
defect, same file, invisible to the gate because the value was given a name. I
attempted a `hoisted-foreign-kind-literal` companion rule and it returned **0
matches** for a second reason worth recording: a bounded skip that forbids
crossing `const|let` is defeated by ordinary code, since the next declaration
usually sits between the hoist and the comparison. Reporting the gap rather than
shipping a rule I could not make fire.

**12.5 — To the spine: `sides: "client"` is *upheld* for this leaf, and for a
nameable mechanism.** The doctrine's ledger has seven contradictions of this
value against two upholdings, both about the DOM. This is a third upholding, and
the mechanism is different from theirs: the server half of this leaf is
**already correct** (§6, §11) — every defect in §7 is client-side, the census
rule is client-side, and the exemplar to copy is server-side *precisely because
nothing is wrong with it*. `sides: "client"` here means "the answer is needed on
the client", not "the code lives only on the client". Worth distinguishing:
`twoSided: true` and `sides: "client"` are consistent when one side is finished.

**12.6 — A matcher correction against myself, and it is the largest single
number in this document.** My §9 signal reported **17 matches / 16 files** on
its first run, **8 / 7** on the second, and **7 / 6** on the third. Nothing in
the codebase changed. Both drops were my own delimiter bugs, and both are the
exact family the doctrine's census-rules section lists:

- *Run 1 → 2 (17 → 8).* A JSX opening tag closed at the `>` of `=>` inside
  `onClick={() => …}`, and at the `>` of a self-closing `/>`. Nine phantom
  matches, every one of them plausible: they pointed at real files with real
  buttons.
- *Run 2 → 3 (8 → 7).* One survivor, `ReviewFocusFlow.tsx:408`, closed at the
  bare `>` in `className={\`… ${i > decisionIdx ? … }\`}`. A `(?<![=/])` guard
  cannot see that one, because a comparison `>` is lexically identical to a tag
  close.

The fix is not a longer character class — it is treating `{…}` attribute
expressions and string/template literals as **opaque**, which is the same
conclusion `scripts/census/lib/instruments/matchJsxTags.mjs` records in its
header. **10 of the original 17 matches (59 %) were the matcher measuring
itself.** Had I hand-verified a *sample* rather than all of them, I would have
opened two true positives and published a rule with 41 % precision.

**12.7 — My two implementations disagreed 7 vs 14, and the disagreement was the
finding.** Implementation 2 used the shared `matchJsxTags` instrument plus a
bespoke body walk. It reported **14** sites; the regex reported **7**. All
seven extras were **source comments**, which the census engine's
`ignoreCommentLines` correctly skipped (it reported 8 comment-matches skipped)
and which the instrument has no notion of. And the content of those comments is
§10's second finding: four of them are the repo telling itself the rule. The
disagreement did not change the count — it produced the convergence evidence.

**12.8 — The `parse-or-keep-raw` decline nearly went the other way.** My first
pass measured 19 sites and I was one step from baselining them. Opening them is
what turned a "19-site defect class" into "4 defects and 15 correct
pretty-printers". The doctrine's rule held exactly as written: *hand-verify a
sample regardless of whether the implementations agree* — here there was only
one implementation and no disagreement to warn me.
