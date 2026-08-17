# Golden path — validating an untrusted definition

> Situation node: `ai-agents/agent-ux/untrusted-definition-validation` · [situation spine](../situation-spine.md)
> recurrence **10** · risk **HIGH** · sides **client** · `twoSided: true` · convergence **mixed**
> dimensions: **function · resilience · security · code-quality**
> Composed 2026-08-16 against `master` @ `629a914af`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` files under `src/` (the census engine's own `walked` count) and
> **946** non-generated `.rs` files under `src-tauri/` (`bindings/`, `tests/`, `*_test.rs` excluded;
> `#[cfg(test)] mod` blocks removed by brace matching, never by a line threshold). Every `#[tauri::command]`
> in the tree parsed for its parameter list (**1,662** matches — see §12.7 on why this number has now been
> reported three different ways). Every `Deserialize` struct in the tree parsed as a brace-matched block
> (**1,123**, of which **59** have every field defaulted). Read in full: `companion/tours.rs`,
> `stores/slices/system/dynamicTours.ts`, `companion/brain/cockpit.rs`, `home/sub_cockpit/CockpitPanel.tsx`,
> `db/repos/resources/connectors.rs`, `core/models/connector.rs`, `engine/api_proxy.rs`,
> `commands/core/composition_workflows.rs`, `commands/core/data_portability.rs` (12,704 lines),
> `commands/credentials/openapi_autopilot.rs`, `engine/bundle.rs`, `ipc_auth.rs`.
>
> **Measured by executing, not reading.**
> 1. **Both halves of the tour validator were transliterated and EXECUTED** — the Rust
>    `validate_tour_spec` (byte-length semantics preserved) and the TypeScript `validateDynamicTour`.
>    The port was validated by replaying **20 of the repo's own assertions** against it (10 from
>    `tours.rs`'s `#[cfg(test)]` module, 10 from `dynamicTours.test.ts`) — **20/20 pass** — then fed
>    **38 hostile definitions** and the two halves compared, twice: once through the real pipeline and
>    once on the raw spec. §0 is that result.
> 2. **Read-only copies of both live SQLite databases** (`personas.db` 347 MB / 244 tables,
>    `personas_data.db` 17.5 MB / 71 tables, copied 2026-08-16 13:17 with their `-wal`/`-shm`) queried for
>    the definitions this install actually holds: **134 connector definitions, 316 recipe definitions,
>    155 import transactions, 74 skills, 78 personas, 14 dev projects, 1 cockpit spec, 0 composed tours.**
> 3. The §9 rule was built, run in a **private scratch registry** (filename unique to this composer),
>    counted a second time by an independent character-scanner, overlap-checked against six neighbouring
>    rules, exercised through all four of the runner's fail-loud modes, then re-extracted from this
>    document and re-run. **The full registry was NOT run**, per the doctrine.
>
> **Nothing hostile was executed.** No shell was opened, no subprocess spawned, no network call made to a
> non-local host, no file written outside the scratchpad, no live database opened for write. The path
> compositions in §7.C were *computed*, not performed. No secret value appears below.
>
> ### Sibling boundaries, settled in prose
>
> [**command-input-validation**](./command-input-validation.md) owns *a caller sent this command a bad
> scalar*. This path owns *a caller sent this command a whole configuration object that the app will
> later execute*. The discriminator is whether the payload **outlives the call** — a rejected argument is
> an error; an accepted definition becomes state.
>
> [**structured-output-extraction**](./structured-output-extraction.md) owns *the model's bytes did not
> yield a value*. This path begins one step later: the bytes **did** yield a well-formed value, and the
> question is whether that value is a legal one. Its P4 (at least one required field) is the floor this
> path builds on; §2 here is what you do above that floor.
>
> [**model-composed-ui**](./model-composed-ui.md) owns *which component may render a model's object and
> what ids it may name*. That is the render boundary. This path owns the **write** boundary — what gets
> stored — and the two meet exactly at `save_tour` / `save_cockpit` (§0).
>
> [**ipc-command-authorization**](./ipc-command-authorization.md) owns *may this caller call this command*.
> `require_auth_sync` being a no-op (`ipc_auth.rs:477`) is that path's finding, restated here only where it
> changes who can reach a definition door.
>
> [**json-blob-column**](./json-blob-column.md) owns the storage shape. [**filesystem-boundary**](./filesystem-boundary.md)
> owns path containment — §7.C is written to that seam and cites it rather than re-deriving it.
> [**rendering-untrusted-content**](./rendering-untrusted-content.md) owns the HTML escape.
>
> The **Deviations** section is a fix backlog.

---

## 0. The headline, before anything else

**This app contains the best untrusted-definition validator in any of the six codebases surveyed, and the
worst one, twenty-eight lines apart in sibling modules — for two definitions written by the same model in
the same turn. The good one has never stored a row. The bad one is on the home screen.**

```
src-tauri/src/companion/session.rs:1399   for spec_json in &dispatched.cockpits {
                                            save_cockpit_preserving_pinned(&user_db, spec_json)
src-tauri/src/companion/session.rs:1415   for spec_json in &dispatched.composed_tours {
                                            tours::validate_tour_spec(&persist)? ; tours::save_tour(...)
```

The difference is in the persister's **signature**:

| | `save_tour` (`companion/tours.rs:223`) | `save_cockpit` (`companion/brain/cockpit.rs:43`) |
|---|---|---|
| parameter | `steps: &[Value]` — the **reconstructed** steps | `spec_json: &str` — the model's raw JSON |
| doc comment | *"Insert a validated tour. `steps` MUST come from `validate_tour_spec`."* | *"`spec_json` is the already-serialized JSON body the frontend will parse."* |
| can it be called with an unvalidated definition? | **no — nothing else produces that value** | **yes — it takes a string** |
| what it writes | 9 named keys, rebuilt | the bytes it was given, to a DB row **and** to `fs::write(&abs_path, spec_json)` (`cockpit.rs:45`) |
| live rows | **0** (both databases) | **1** |

`validate_tour_spec` does not *filter* the model's object. It **rebuilds** it: `validate_step`
(`tours.rs:117-193`) reads nine named keys, checks each string against a codegen'd manifest of what the
app actually contains (**945** `data-testid`s, **269** dynamic prefixes, **11** sidebar sections, **7**
sub-tab setters — `generated_tour_anchors.rs` and its JSON twin, both emitted by
`scripts/docs/gen-tour-anchors.mjs` from one scan), and emits a fresh `serde_json::json!({...})`. Executed:

```
KEYS SURVIVING RECONSTRUCTION: ["id","title","description","hint","nav","completeOn","subSteps",
                                "highlightTestId","narration"]
completeOn value: tour:composed-step-explored          <- FORCED to a constant; the model cannot choose it
```

Fed a step carrying `onClick`, `component`, `panelWidth`, `icon`, `color` and its own `completeOn`, **none
of them survive** — not because they were blocked, but because nothing copies them.

`compose_cockpit` has no validator anywhere. The model's spec string is written to disk and to
`companion_node`, and the frontend reads it back as

```ts
persistentBody = JSON.parse(spec.specJson) as CompanionCockpitSpecBody;   // CockpitPanel.tsx:152
```

— then `CockpitWidgetCell` (`CockpitPanel.tsx:446-479`) does three different things to three fields of the
same object, in eight lines:

```ts
const span    = Math.max(1, Math.min(12, widget.span ?? 6));   // :448  CLAMPED
const actions = useMemo(() => parseWidgetActions(widget.actions), …);  // :453  RECONSTRUCTED
const Component = cockpitWidgetRegistry[widget.kind];          // :450  CLOSED MAP (39 keys)
…
<Component title={widget.title} config={widget.config} />      // :469  PASSED THROUGH
```

`widget.config` is typed `Record<string, unknown>` and documented at `widgetRegistry.ts:46` as *"Free-form
config block from Athena's compose_cockpit op."* It reaches **39** independently-written widgets. The
comment two lines above the pass-through says **"never trust a stored/composed spec's raw shape"**
(`CockpitPanel.tsx:451-452`) and it is honoured for one field of four.

### And the two-sided result, which is the thing worth carrying away

The tour path is validated **twice** — in Rust before persistence, and again in TypeScript before playback
(`dynamicTours.ts:170`, whose header calls itself *"the defense-in-depth twin"*). Two implementations,
two languages, two authors, no shared schema. Executed on **38 hostile definitions**:

```
run through the REAL pipeline (Rust reconstructs -> save_tour -> TS re-validates)
    divergences: 0 / 38

run on the RAW model spec (i.e. if either half had been the only validator)
    disagreements: 7 / 38     rust-only-accepts 4, ts-only-accepts 3
```

The two validators **genuinely disagree** — `clean_text` bounds by **bytes** and `str()` by **UTF-16 code
units**, so a 100-character Cyrillic title passes TS and fails Rust; and TS requires a sub-step `id` that
Rust defaults. Seven real behavioural differences, and **not one of them can manifest**, because the first
half hands the second half a value that is already in the closed form.

> **Reconstruction is what discharges a two-sided contract. Not a shared schema, not a shared type, not
> code review.** Had either half been a *filter* — check the fields, pass the object on — all seven would
> be live defects today: tours persisted `ready` that never play, or tours the frontend accepts that the
> backend would have refused.

Everything in §7 is a place where the app filters, casts, or does nothing, instead of rebuilding.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and every
clause carries its warrant, so an adopting repo can tell physics from local calibration. No file path,
primitive name or count appears below this line until the head ends.

> **P1 — physics, and the whole subject.** *A definition is not data; it is code you agreed to run.* The
> moment a stored object decides which component renders, which endpoint is called, which path is written,
> or which permission applies, it has the authority of the program that reads it. Whether you wrote it is
> a fact about its provenance, not about its power.
>
> **P2 — physics, and the clause everything else follows from.** *Validate by RECONSTRUCTION, not by
> inspection.* Read the fields you know by name, check each one, and emit a **new** object built only from
> what survived. A validator that examines an object and then passes the original along has verified the
> fields it thought of; a validator that rebuilds has, by construction, dropped every field it did not.
> The two are indistinguishable in review and opposite under a definition its author did not anticipate.
>
> **P3 — physics.** *Every string a definition supplies that names something in your program must be
> checked for MEMBERSHIP in a set your program derives from itself.* Not a regex, not a length, not a type
> — membership. And the set must be generated from the code it describes, or it becomes a second list to
> maintain and drifts silently into permitting things that no longer exist.
>
> **P4 — physics, the corollary that decides two-sided cases.** *Withhold the raw definition from the
> writer.* If the function that persists takes the parsed *parts*, no caller can persist an unvalidated
> definition — the validator is the only thing that produces its argument. If it takes the blob, every
> caller is one forgotten line from writing anything. This is the single edit that converts a convention
> into a guarantee, and it is a change to one signature.
>
> **P5 — physics.** *A type assertion is a claim about a value, made by the person who did not produce
> it.* Casting parsed bytes into a declared shape does not check the bytes; it silences the one tool that
> was about to insist you check them. The compiler's `unknown` is not an inconvenience — it is the only
> mechanical pressure toward a narrowing step that exists in the whole flow.
>
> **P6 — physics, and the most replicated defect in this census.** *The containment check gets applied to
> the component that is easy to reason about, and omitted from the component that decides where the
> operation lands.* A file-name guard on a path whose root the definition chose; an id guard on a request
> whose host the definition chose. Ask which field selects the *target*, and put the check there first.
>
> **P7 — physics.** *A definition may name an entity it does not own.* The interesting fields are rarely
> the values; they are the identifiers — the primary key, the parent, the match key. If the definition
> supplies the key, it decides whether it creates a row or **overwrites yours**, and no amount of
> field-level validation sees that.
>
> **P8 — ergonomics.** *The order is parse, validate, persist — and "persist" includes anything you cannot
> take back.* Validation after the write is a report, not a gate. All-or-nothing beats per-item skipping
> for anything a human will read as a whole, because a definition with silently-missing pieces teaches
> something false and looks complete.
>
> **P9 — security, and the one that changes severity.** *A flag inside a definition must never disable a
> check outside it.* The moment a stored blob can turn off a validator, the definition is not configured
> by policy — it **is** the policy, and the door that writes it is the security boundary, whether or not
> anybody modelled it as one.
>
> **P10 — ergonomics.** *A validator you built and did not wire up is worse than none*, because its
> existence is what stops the next person from looking. Count the call sites before you count the
> features.
>
> **Scale condition.** P1–P5 are correctness on the very first definition. P6 and P7 bite the first time a
> definition names a path or an id — usually the first import feature. P8 bites the first time an import
> half-succeeds. P9 bites the day a definition acquires a boolean. P10 bites at the second validator.

### Warrant evidence — the five siblings, censused independently

`personas-web` (Next.js), `brainiac` (Rust workspace + Next.js console), `personas-cloud` (TS orchestrator
+ Python facade), `vibeman` (Next.js **+ Tauri**), `ascent` (Next.js). All five reachable.

- **P2 has no external warrant, and this must be reported as silence.** Reconstruction-instead-of-filtering
  appears **nowhere else**. The closest is `ascent`'s `validateAssessment` (`src/lib/llm/provider.ts:150+`),
  which allow-lists dimension ids and pre-slices the input array to bound a hostile verbose reply — a
  rebuild in spirit for one array — and `personas-cloud`'s 18 `.strict()` zod objects
  (`packages/orchestrator/src/schemas.ts:77-199`), which *reject* unknown keys rather than dropping them.
  Everything else in five repos inspects and passes through. **Personas is ahead of its whole fleet on the
  central clause of this path**, which is the same posture the corpus recorded for the DST-correct schedule
  evaluator. An adopting repo should treat P2 as strongly-reasoned and externally untested.
- **P3 is convergent, independently, in the repo with the least reason to have discovered it.**
  `personas-web/src/components/flow-composer/data.ts:88-124` reconstructs canvas state from a base64 **URL
  hash** and validates *referential integrity* — every wire's endpoints must exist in the node set it just
  built — with the reason written down at `:105-109` (an attacker-controlled `label` *"would render
  straight into the SVG"*). A marketing site and a desktop agent runtime reached the same rule from
  opposite ends. **Physics.**
- **P4 has no external warrant and is this document's own generalisation** of an experiment the repo ran on
  itself (§0). Report as untested.
- **P5 is convergent as a defect, in all five.** `JSON.parse(…) as T` / `(await res.json()) as T`:
  `vibeman` **39**, `ascent` **33**, `personas-cloud` 7, `personas-web` 10, `brainiac/console` on *every*
  API call (`console/src/lib/api.ts:132`) plus 37 hand-guarded `.get("…")` extractions on an untyped
  `Value` in `mcp.rs`. Nobody is clean.
- **P6 is convergent and the sharpest negative result here.** `brainiac/crates/brainiac-publish/src/git.rs`
  applies a rigorous `..`/`/`/`\` guard at `:70-74` to the **slug** — and the code says so: the slug
  *"comes from our own database and is constrained by the schema"* — while `repo_path` and `docs_dir`,
  which come from the same untrusted `PublishTarget.config` blob, get **none** (`:49-57`), and
  `agent_pointers: true` then writes `AGENTS.md`/`CLAUDE.md` at that root (`:83-88`). Personas commits the
  identical inversion at `data_portability.rs:8860` (§7.C). **Two Rust codebases, two teams, the same
  guard on the same wrong half.**
- **P7 is convergent.** `vibeman/src-tauri/src/bin/vibeman-optimize.rs:32-47` deserializes a stdin
  `Request` with 5 of 7 fields `#[serde(default)]`, and `req.project_path` reaches `create_dir_all` +
  `Connection::open` with no canonicalisation (`:104-107`). Personas' analogue is
  `import_composition_workflows` (§7.B), where the caller names the primary key.
- **P8 splits three ways and the split is instructive.** parse → validate → write: `ascent`'s ingest
  (`src/app/api/integrations/ingest/route.ts:21-45`), `personas-web`'s counters
  (`src/app/api/stats/route.ts:255-272`), `vibeman`'s rules loader
  (`src/app/api/structure-scan/rules/loader.ts:216-266`), and Personas' four `*_ingest` doors. parse →
  write → **never validate**: `brainiac`'s publish targets (`publishing.rs:34-47` stores a raw `Value`;
  first interpreted at use time in a different crate). parse → **assert** → execute: `personas-cloud`'s
  permission policy, which has no validation step at any point in its lifetime.
- **P9 is convergent, and the sibling case is the worst single item in the census.**
  `personas-cloud/packages/shared/src/prompt.ts:711` parses a persona's `permissionPolicy` with a bare
  `JSON.parse(json) as PermissionPolicy`; `buildPermissionArgs` (`:725-743`) **fails open** — an
  unparseable policy, or one listing no tools, returns `['--dangerously-skip-permissions']` — and those
  strings become `args` in `spawn(command, args, { shell })` (`packages/worker/src/executor.ts:95,:133`).
  **A corrupt definition is an escalation.** The same repo carefully sanitises the env vars on the adjacent
  line. Personas' analogue is `allow_private_network` (§7.A) — milder, because it fails *closed* on
  garbage (measured, §6) and is behind a privileged command.
- **P10 is convergent and `vibeman` is the case study.** `src/lib/api/withValidation.ts:19` is a correct,
  complete zod body-validation middleware — 400 on bad JSON, 422 with structured issues — with **zero call
  sites across 261 route files**, built on a `zod` that is **absent from `package.json`** and resolves only
  as a transitive peer of the Anthropic/MCP SDKs. Personas' version is `jsonschema = "0.28"`
  (`src-tauri/Cargo.toml:208`) with **one** call site (§7.E). `ascent` inverts it deliberately: no
  validator dependency at all, by written policy (`src/lib/report/validate.ts:6`), and the strongest
  hand-rolled adversarial validation in the census.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "let the user import a template / recipe / workflow / persona from a file"
- "Athena can compose the dashboard / the tour / the walkthrough / the widget layout"
- "read the `result.json` the skill wrote and ingest it"
- "we'll store the connector definition as JSON and read it back"
- "the plugin/MCP server tells us what tools it has"
- "just parse the blob column and render it"
- **The "about to write X" test:** you are about to type `JSON.parse(row.somethingJson) as Something`,
  `serde_json::from_str::<SomeSpec>(&contents)`, `#[tauri::command] fn import_x(x: Vec<X>)`,
  `save_something(pool, spec_json: &str)`, `REGISTRY[def.kind]`, or a `#[serde(default)]` on the last
  un-defaulted field of a struct you deserialize from a file.

You are **not** in this situation when the value is a scalar argument the command rejects and forgets
(that is [command-input-validation](./command-input-validation.md)), when the model's bytes failed to
produce a value at all ([structured-output-extraction](./structured-output-extraction.md)), or when the
question is which component may render an already-legal object
([model-composed-ui](./model-composed-ui.md)). **The discriminator is that the definition outlives the
call**: it becomes a row, a file, or a registry entry, and something later executes it.

---

## 2. The one way

**Reconstruct the definition; never pass the parsed object through.** Write a validator that reads each
field you know by name, checks it, and emits a **new** object built only from what survived — the way
`tours.rs:117-193` and `dynamicTours.ts:101-161` both do — so that a key you never thought of cannot
reach storage, a renderer, or a dispatcher, because nothing copies it. **Every string the definition
supplies that names something in your program gets a membership check against a set your program
generates from itself** (`TOUR_SIDEBAR_SECTIONS`, `TOUR_TESTIDS` and their JSON twin, both emitted by
`scripts/docs/gen-tour-anchors.mjs` from one scan of `src/`) — not a regex, not a length, not a cast; and
**force the dangerous fields to constants** rather than validating them (`completeOn` is assigned, not
checked). **Then withhold the blob from the writer**: make the persister take the reconstructed parts
(`save_tour(pool, topic, title, description, steps: &[Value])`), never the raw string
(`save_cockpit(pool, spec_json: &str)`), so the validator is the only thing that can produce its argument
— this is the one edit that turns the convention into a guarantee, and it is why the tour path cannot
regress and the cockpit path never had to. **On the frontend, bind the parse result to `unknown`**
(`const parsed: unknown = JSON.parse(raw)`, the shape at `lib/channel/teamBridge.ts:42` and 25 other
files) rather than `as SomeType`, because the cast is the only thing standing between you and a narrowing
step and it removes it silently. **Reject all-or-nothing**: one bad step rejects the whole tour, because a
walkthrough with silently-missing chapters teaches wrong and looks complete. **Validate before you
persist, and treat "persist" as including the filesystem** — the four `*_ingest` doors get this right
(`ship_ingest.rs:443` validates before any write) and the bundle's skill writer does not
(`data_portability.rs:6654`, deliberately post-commit). **Put the check on the field that selects the
target, not on the field that is easy to check** — a skill's file names are guarded and the `root_path`
that decides which disk they land on is not (§7.C). **Never let a field inside a definition disable a
check outside it** (`metadata.allow_private_network` skips two SSRF validators and swaps the HTTP client
— §7.A); if a connector genuinely needs loopback access, that belongs in a registry in code beside
`GLOBAL_PROBE_CONNECTORS`, not in a caller-writable `TEXT` column. And **stamp what vocabulary you
validated against** (`manifest_hash()`, `tours.rs:67`) so an upgrade can re-prove stored definitions and
mark the drifted ones `stale` instead of playing them.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
| --- | --- |
| **`src-tauri/src/companion/tours.rs:199` — `validate_tour_spec(spec) -> Result<(String,String,Vec<Value>), String>`** · **`:117` — `validate_step`** | **The reference reconstructing validator, and the one thing in this repo to copy.** Reads 9 named keys, membership-checks 3 of them against the generated manifest, forces `completeOn` to a constant, caps 1–12 steps / ≤6 sub-steps / 160-600 char text, and returns a **freshly built** object. All-or-nothing. Errors name the offending path (`steps[2].subSteps[1]: unknown anchor …`) so a rejection is debuggable from the warning alone. |
| **`src-tauri/src/companion/tours.rs:223` — `save_tour(pool, topic, title, description, steps: &[Value])`** | **The withholding persister — P4 made real.** Its `steps` parameter can only be produced by `validate_tour_spec`. There is no way to write an unvalidated tour without changing this signature. Contrast `save_cockpit(pool, spec_json: &str)` (`brain/cockpit.rs:43`), which is the same job with the opposite signature and no validator anywhere. |
| **`src-tauri/src/companion/generated_tour_anchors.rs`** + **`src/features/onboarding/anchors/tourAnchorManifest.json`** | **The closed vocabulary, generated from the code it describes, in both languages from one scan** (`scripts/docs/gen-tour-anchors.mjs`). 945 testids · 269 dynamic prefixes · 11 sidebar sections · 7 sub-tab setters. This is what makes P3 mechanical instead of aspirational: nobody maintains a second list. |
| **`src-tauri/src/companion/tours.rs:67` — `manifest_hash()`** + **`:258` `list_tours`** | The drift answer. Every stored tour records which manifest it was proven against; `list_tours` re-proves rows whose hash changed and flips them to `status='stale'` rather than serving a spotlight at an anchor that no longer exists. **Validation with an expiry date.** |
| **`src/stores/slices/system/dynamicTours.ts:170` — `validateDynamicTour(record)`** · **`:210` `ingestComposedTour`** | The client half, written independently against the same manifest, and the only place in `src/` where a foreign definition is checked against *what the app actually contains* rather than against a shape. Returns `{ok:false, errors[]}` — the caller shows an honest failure state, never a broken tour. |
| **`src/stores/slices/system/tourSlice.ts:192` — `isSafeTourTestId`** + **`:1622` `setHighlightTestId`** | The third gate, at the store setter, with its reason at `:173-188`: the value is interpolated into `` document.querySelector(`[data-testid="${id}"]`) ``. The trust boundary lives at the setter so no call site has to remember. |
| **`src/features/home/sub_cockpit/briefing/actionTypes.ts:36` — `parseWidgetActions(raw: unknown)`** | A correct reconstructing validator on the frontend: `switch` over four literal kinds, unknown kinds dropped, each surviving action **rebuilt** from `{kind, personaId|approvalId, label}`, capped at `MAX_WIDGET_ACTIONS`. It is the compliant half of the file that also commits §0's worst pass-through. |
| **`src/features/shared/components/surface/surfaceSpec.ts:231` — `parseSurfaceSpec`** | The repo's only schema-library validator (**zod, in exactly 1 of 4,829 files**). Discriminated union over block kinds, bounded text/percent coercion (`:33-52`), closed action enum, strict-then-salvage. Stronger on *typing* than the tour validator, weaker on *closed-world* checking — it validates shape, not membership in the app's own inventory. |
| **`src-tauri/src/commands/infrastructure/dev_tools/ship_ingest.rs:199` — `validate_ship_result`** | **The reference ingest validator for an outside CLI's `result.json`.** `schema_version` gate that refuses an absent version (`:207-219`), canonicalize + `starts_with(canon_root)` path confinement (`:365-382`), kind in a 2-value closed set, rating in 1..5, text ≤1200, caps 100/8/20, **and a membership guard — the item must already belong to the milestone** (`:266-273`). Validates fully before any write (`:443`). Its sibling `triage_ingest.rs` adds the strongest idea in the family: an accepted verdict writes a *pending approval*, never the verdict itself (`:31`). |
| **`src-tauri/db/src/repos/resources/recipes.rs` + `src-tauri/src/engine/recipe_seed.rs:183,:241`** | The withholding-by-omission precedent, with the reason in a comment: *"`CreateRecipeInput` has no is_builtin (user create paths must not mint builtin rows)."* Compare `CreateConnectorDefinitionInput.is_builtin: Option<bool>` (`core/models/connector.rs:80`), which hands the caller the same flag. **Same repo, same week's problem, opposite decisions.** |
| **`src/lib/channel/teamBridge.ts:39-46`** | The one-line frontend idiom: `const parsed: unknown = JSON.parse(raw);` then `Array.isArray(parsed) ? parsed.filter(s => !!s && typeof s === 'object') : []`. 26 files do this. **16 do not** (§9). |

**Do not exist — this path names them:**

- **Any use of `#[serde(deny_unknown_fields)]`.** **0 occurrences in 946 Rust files**, confirmed twice.
  Every deserialized foreign definition in the app silently accepts unknown keys. (Convergent: `brainiac`
  0 of 58 parses, `vibeman` 0 of 6. Only `personas-cloud` has the TypeScript equivalent, 18 `.strict()`.)
- **Any inbound use of `jsonschema`.** The crate is declared (`Cargo.toml:208`) and has **one** call site,
  `engine/mcp_tools.rs:1704`, which validates *our outgoing arguments* against a *remote server's* schema —
  and fails open twice (`:1699-1702` no schema; `:1706-1711` invalid schema). §7.E.
- **Any type distinguishing "a definition we authored" from "a definition we received."** Both are
  `String` / `serde_json::Value` / `Record<string, unknown>` at every boundary. Independently named as a
  missing newtype by [structured-output-extraction](./structured-output-extraction.md) §8 gap 3 and
  [model-composed-ui](./model-composed-ui.md) §8 gap 3 — **three paths now, from three directions.**
- **A validator for `compose_cockpit`.** §0.
- **A shared "reconstruct against a generated manifest" helper.** The tour path has two hand-written
  copies (one per language) and they are correct; a third definition type would be a third copy.

---

## 4. Steps

1. **Write down where the definition comes from and who could have written it**, before you write any
   code. A file the user picked; a share link; another application's config; an outside CLI's
   `result.json`; a model's own output; your own seed file. Only the last one is trusted, and even it
   should be version-gated (`recipe_seed.rs:118`, `EXPECTED_SEED_VERSION`).
2. **Version the format, and refuse an absent version.** `ship_ingest.rs:207-219` refuses a `result.json`
   with no `schema_version`; `kpi_sim.rs` has no version field at all and is the weakest of the four
   siblings (§7.F). An absent version is not "version 1", it is "written by something you have not seen".
3. **Parse into a shape with at least one required field.** This is
   [structured-output-extraction](./structured-output-extraction.md)'s P4 and it is the floor: **59 of
   this repo's 1,123 `Deserialize` structs have every field defaulted**, so a `{}` deserializes into a
   confident value.
4. **Write the validator as a reconstruction.** For each field you support: read it by name, check it,
   assign it into a **new** object. Do not `..spread`, do not `clone()` the input, do not return the
   parsed value. If you find yourself writing `if (bad) return null;` and then returning the original,
   you have written a filter.
5. **Membership-check every string that names something in the program.** Sidebar section, testid,
   widget kind, connector name, capability, event type, action id. The set must be *generated* from the
   code — `gen-tour-anchors.mjs` is the pattern. A hand-maintained allowlist is a second source of truth
   and will drift.
6. **Force the dangerous fields; do not validate them.** `completeOn` is assigned a constant, `icon` and
   `color` are assigned constants (`dynamicTours.ts:199-200`). A field the definition must not choose is
   not a field you check — it is a field you overwrite.
7. **Ask the type question now, before §9.** Change the persister's signature to take the reconstructed
   parts. See "Can the type make the wrong call impossible?" below — for this leaf the answer is yes, and
   it is one line.
8. **Reject all-or-nothing for anything a human reads as a whole**; skip-per-item only where the items
   are genuinely independent (`workspace_harvest.rs:430-449` is a legitimate per-run skip; a tour is not).
9. **Validate before you persist — and count the filesystem as persistence.** `write_project_skills` runs
   after the DB commit by design (`data_portability.rs:6654`) and its failures become warnings.
10. **On the client, receive the definition as `unknown`.** `const parsed: unknown = JSON.parse(raw)`.
    If a shared helper hands you `T`, that helper is the deviation (`lib/utils/parseJson.ts:5`).
11. **Stamp the vocabulary version on the stored row and re-prove on read.** `manifest_hash()` +
    `list_tours`'s `stale` flip. Without it, a definition validated in March is played in August against
    a UI that has moved.
12. **And then stop.** Which component may render the surviving object, and how its text is escaped, is
    [model-composed-ui](./model-composed-ui.md) and
    [rendering-untrusted-content](./rendering-untrusted-content.md). This path ends when the object is
    legal.

### Can the type make the wrong call impossible? — asked before §9

**Yes, and it is the strongest instance of the principle this corpus has found, because the repo ran the
experiment on itself and both arms are in the same crate.**

The edit is `save_cockpit(pool, spec_json: &str)` → `save_cockpit(pool, widgets: &[Value], title: &str)`,
mirroring `save_tour`. Held against the doctrine's seven qualifications:

- **Q1 (a type carries only what it encodes).** `&[Value]` encodes "these came from the validator" only
  because nothing else constructs them. That is exactly what it needs to encode here, and nothing more.
  It does *not* encode that the validator is any good — see §9's note on the destination's defaults.
- **Q2 (requiredness ≠ closedness).** Neither applies; this is *provenance*. Making `spec_json` required
  changes nothing — it already is.
- **Q3 (a type nobody constructs constrains nothing).** `save_cockpit` has **2** call sites
  (`session.rs:1401` via the preserving wrapper, and the pin flow) and `save_tour` has **2**
  (`tours.rs:379`, `session.rs:1423`). Small, enumerable, real.
- **Q4 (a type anyone can construct authenticates nothing).** This is where the tour path is *lucky*
  rather than airtight: `&[Value]` is trivially constructible — `save_tour(pool, t, ti, d, &[json!({})])`
  compiles. The guarantee is social (the doc comment) reinforced by there being no other producer, not
  structural. **The airtight form is a newtype:** `ValidatedTourSteps(Vec<Value>)` with a private field
  and `validate_tour_spec` as its only constructor. That is the fix this path recommends for both, and it
  is the difference between "you have to try" and "you cannot".
- **Q5 (withholding beats requiring).** The qualification that fits. `save_cockpit` *requires* every
  caller to remember to validate; **0 of 2** do. `save_tour` **withholds the ability not to**: you cannot
  get the argument without going through the validator.
- **Q6 (withhold the dangerous freedom, not the answer).** The freedom to withhold is "supply arbitrary
  bytes", not "supply a spec". A caller with a legitimately pre-validated spec still passes steps.
- **Q7 (relaxing a requirement is inert when the caller supplies the bad value voluntarily).** Does not
  apply — the callers here are being *given* an unchecked door, not forced through one.

**Where the type does not reach**, and this is a finding rather than a failure:

1. **Across the IPC boundary.** `create_connector(input: CreateConnectorDefinitionInput)` receives
   `metadata: Option<String>` — the type is `String` on both sides because the column is `TEXT`. No Rust
   type reaches inside that string, which is why `allow_private_network` (§7.A) is a *parse-at-use-time*
   problem no signature can close. The fix there is not a type; it is moving the flag out of the blob.
2. **Into the frontend's `config: Record<string, unknown>`.** 39 widgets each interpret it. A type at the
   boundary would have to be a union of 39 shapes; the real fix is per-widget reconstruction at the
   consuming component, which is 39 small edits and no type at all.
3. **Through `serde_json::Value`.** 29 commands take one as a parameter. A `Value` parameter is the
   absence of a type by construction.

So: **ship the newtype for both persisters as the fix, and ship §9 as the ratchet on the dimension it
cannot reach** — the 16 client-side sites where a stored definition becomes app state by assertion.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A persister that takes the raw definition string** | `save_cockpit(pool, spec_json: &str)` — 0 of 2 callers validate, and there is no validator to call. Its twin 180 lines away takes reconstructed parts and cannot be misused. **This is the whole leaf in one signature.** |
| **Validating by inspection, then passing the original object on** | Every field you did not think of survives. Executed proof: reconstruction drops `onClick`, `component`, `icon`, `color`, `panelWidth` and a caller-chosen `completeOn` **without a single line mentioning them** (§0). |
| **`JSON.parse(row.someJson) as SomeType`** | The cast is not a check; it is the removal of the only mechanical pressure toward one. **16 sites in 15 files**, against **26 in 25 files** that bind to `unknown` — the same repo, the same operation, both idioms live (§9). |
| **`#[serde(default)]` on every field of a deserialized definition** | `{}` becomes a confident configuration. **59 of 1,123 `Deserialize` structs.** Convergent: `brainiac`'s `SectionBinding` (7/7 defaulted, `types.rs:531-561`) already caused one measured bug — a `LIMIT 0` from a `max_items` default — and the file documents it. |
| **A definition field that disables a validator** | `metadata.allow_private_network: true` skips `validate_field_values` **and** `validate_healthcheck_url` **and** swaps `SSRF_SAFE_HTTP` for `HTTP_ALLOW_PRIVATE` (`api_proxy.rs:714-725,:834`), from an unparsed `TEXT` column the create path never looks at. |
| **Letting the caller name `is_builtin`** | `CreateConnectorDefinitionInput.is_builtin: Option<bool>` — a caller-supplied definition can declare itself a builtin. The recipe seeder deliberately withholds the same flag and says why (`recipe_seed.rs:241`). |
| **An IPC command whose parameter is the persisted row model** | `import_composition_workflows(workflows: Vec<CompositionWorkflow>)` — the caller names `id`, `created_at`, `updated_at` and every JSON blob, verbatim into `INSERT OR IGNORE`. The sibling `create_composition_workflow` takes `CreateCompositionWorkflowInput`, which withholds all three. **Same table, two doors, opposite decisions.** |
| **Guarding the leaf and not the root** | `is_safe_skill_segment` rejects `..`, `/`, `\`, `:` in every skill file name; `root_path` — the field that decides which disk the tree lands on — gets `Path::is_dir()`. Convergent with `brainiac/git.rs:70-74` guarding the slug it trusts and not the `repo_path` it doesn't. |
| **Computing a signature and not gating on it** | `engine/bundle.rs:406` computes `sig_valid` and `:497` stores it as provenance metadata. Nothing branches on it. **CORRECTED 2026-08-16 by [portable-export-bundle](./portable-export-bundle.md): the enclave path does NOT refuse either.** `verify` returns an `Ok(EnclaveVerifyResult{...})` with no `if` on any flag, and its only caller hands the struct to React; `:278` is a comment inside a ZIP reader. There is no enclave importer at all — only seal and verify. It is the same defect with one more field computed. |
| **Validating a re-serialized copy of what you verified** | `bundle.rs:405,:540` verify the signature over a *re-serialized* manifest rather than the bytes that were signed — a canonicalisation gap the enclave path does not have. |
| **Per-item skipping on a definition a human reads as a whole** | A tour with silently-dropped chapters teaches wrong and looks complete. `validate_tour_spec` rejects the whole spec on any bad step, and says so at `tours.rs:12-14`. |
| **A validator dependency with no call sites** | `jsonschema = "0.28"`: one use, outbound, fails open twice. Convergent: `vibeman`'s `withValidation` middleware, 0 of 261 routes; `ascent`'s `app-passport.schema.json`, 0 enforcing readers; `personas-cloud`'s Pydantic models, 0 enforcing (`facade/proxy.py:29-34` forwards the raw body). **Four repos, four unwired validators.** |
| **Trusting `require_auth_sync` to mean anything** | It is `Ok(())` (`ipc_auth.rs:477`), as is `require_auth` (`:537`). Only `#[requires(privileged)]` / `require_privileged_sync` gate. Six of the definition doors in §7 are guarded by the no-op. |

---

## 6. Evidence

### The one site to copy: `src-tauri/src/companion/tours.rs:117-193` (`validate_step`) with `:223` (`save_tour`)

Read them together — the validator is only half the pattern:

```rust
let mut out = serde_json::json!({                    // a NEW object, not the input
    "id": id, "title": title, "description": description, "hint": hint,
    "nav": nav_out,
    "completeOn": COMPOSED_STEP_EVENT,               // FORCED, not validated
    "subSteps": [],
});
if let Some(anchor) = clean_text(obj.get("highlightTestId"), 120) {
    if !is_known_anchor(&anchor) {                   // MEMBERSHIP in a generated set
        return Err(format!("{path}: unknown anchor `{anchor}`"));
    }
    out["highlightTestId"] = Value::String(anchor);
}
```

…and then `pub fn save_tour(pool, topic, title, description, steps: &[Value])`, whose doc comment is one
line — *"Insert a validated tour. `steps` MUST come from `validate_tour_spec`."* — and whose parameter
list is what makes the comment true.

Its client twin, `src/stores/slices/system/dynamicTours.ts:101-161`, is the same shape in TypeScript
against the same generated manifest, and its module header (`:1-18`) is the clearest statement of the
doctrine anywhere in the tree.

Also exemplary:

- **`src-tauri/src/commands/infrastructure/dev_tools/triage_ingest.rs:31,:211-227`** — an outside CLI's
  verdicts are validated (verdict ∈ {accept, reject}, reason required, idea must exist, be `pending`, and
  **belong to this project**) and then written as a **pending human approval**, never as the verdict. The
  file cannot decide anything; it can only ask.
- **`src-tauri/src/commands/infrastructure/dev_tools/ship_ingest.rs:266-273`** — the membership guard: an
  ingested item must already be a member of the milestone. The definition may describe rows it does not
  get to create.
- **`src-tauri/src/commands/infrastructure/workspace_harvest.rs:529`** — `origin_project_id` is
  **overwritten** by the app with a comment saying it is *"not trusted from the skill"*. That is step 6
  (force, don't validate) applied to an ingest.
- **`src/features/home/sub_cockpit/briefing/actionTypes.ts:36-61`** — the frontend reconstruction: a
  closed `switch`, unknown kinds dropped, each action rebuilt, capped.
- **`src/lib/channel/teamBridge.ts:42`** — `const parsed: unknown = JSON.parse(raw);` The one-line
  compliant idiom, in the file where my first regex produced a false positive *on the exemplar of the
  compliant pattern* (§9).

### The differential execution (the measurement, not a reading)

Both validators were transliterated to JS — the Rust half with byte-length semantics preserved
(`clean_text` bounds by `s.len()`, i.e. bytes; `str()` bounds by `.length`, i.e. UTF-16 units) — and the
port validated by replaying the repo's own assertions before any new input was tried:

```
PORT VALIDATION: 20 passed, 0 failed
  (10 from tours.rs #[cfg(test)] :412-495, 10 from dynamicTours.test.ts :56-113)
```

Then 38 hostile definitions. Selected rows, both halves:

| input | Rust (decides persistence) | TS (decides playback) |
|---|---|---|
| `{}` / no `steps` / `steps` an object / a step is a string or an array | REJECT | — |
| unknown extra keys (`onClick`, `component`, `icon`, `color`) | **accepted and dropped** | accepted and dropped |
| the definition asserts its own `completeOn: "tour:credential-created"` | **accepted and overwritten** | overwritten |
| anchor `x"] , [data-testid="fleet-kill-process-1` (selector breakout) | REJECT | — |
| anchor = a bare dynamic prefix, no suffix | REJECT | — |
| anchor = `fleet-kill-process-1` (a real dynamic prefix + suffix) | **OK** — see §8.2 | OK |
| `nav.subTabSetter` present, `subTab` missing | REJECT | — |
| `nav.subTabSetter` valid, `subTab` = `not-a-real-tab` | **OK** — see §7.G | OK |
| 13 sub-steps, the 7th hostile | **OK — silently truncated to 6** — see §8.3 | OK |
| `__proto__` injected into a step object | accepted, not copied | accepted, not copied |
| 12 steps, the 12th with an unknown section | REJECT (whole tour) | — |

**Through the real pipeline: 0 divergences in 38.** On the raw spec, the two halves disagree on **7**:

```
  CYRILLIC title x100 (200 bytes / 100 UTF-16)   rust=REJECT  ts=OK
  CYRILLIC step title x100                       rust=REJECT  ts=OK
  EMOJI step title x50                           rust=REJECT  ts=OK
  SUBSTEP WITHOUT id                             rust=OK      ts=REJECT
  SUBSTEP with empty-string id                   rust=OK      ts=REJECT
  SUBSTEP id is a number                         rust=OK      ts=REJECT
  highlightTestId is a number                    rust=OK      ts=REJECT
  agree on raw: 31/38   rust-only-accepts 4   ts-only-accepts 3
```

**A prediction of my own, disproved and recorded as such.** Reading the two sources side by side, I
expected the sub-step-`id` difference to be a live defect — a tour persisted `ready` that the frontend
refuses to play. It is not, and the reason is the finding: Rust's reconstruction *fills in*
`{id}-sub-{i+1}`, so the frontend never sees the missing field. **The reconstruction closes the
divergence it did not know about.** Had the Rust half been a filter, this would be a real bug today.

### What the live databases hold

Read-only copies, 2026-08-16:

- **`companion_tours`: 0 rows, in both databases.** And **0** tour-composition turns among the **1,779**
  rows of `companion_turn` (top kinds: `deliberation_moderate` 770, `deliberation_turn` 555,
  `deliberation_proposal` 117). The best-validated definition surface in the app has never run — the same
  shape [external-url-opening](./external-url-opening.md) found for `execute_open_test_env`, and worth
  saying plainly: **validation quality in this repo is currently anti-correlated with usage.**
- **`companion_node` where `kind='cockpit'`: 1 row.** The unvalidated one is live.
- **`connector_definitions`: 134 rows, `is_builtin = 1` on all 134. Zero imported connector definitions
  have ever existed on this install.** 113 carry a `healthcheck_config` (keys: `method` 113, `endpoint`
  112, `headers` 111, `body` 4, `url` 1). **3 carry `metadata.allow_private_network: true`** — `langfuse`,
  `langsmith`, `tracklight`, all genuinely self-hosted, all seeded in Rust
  (`db/src/builtin_connectors.rs:985,:999,:1755`), none created through the door that would accept the
  flag from a caller (§7.A). The `metadata` key census across all 134: `template_enabled` 134,
  `summary` 134, `auth_type` 133, `docs_url` 125, `oauth_scopes` 16, `capabilities` 4, `mcp_server` 3.
- **`recipe_definitions`: 316 rows, 315 builtin, and all 316 carry a `source_template_id`** — every recipe
  on this install descends from a template definition.
- **`import_transactions`: 155 rows, all `committed`, all with `entity_results = '[]'`.** The persona
  import path is heavily used and records nothing about what it did.
- **`dev_projects`: 14 rows, and all 14 `root_path` values are absolute `C:` paths** — so the bundle
  importer's UNIQUE match key (§7.C) is a live absolute path on every row.
- **`personas`: 78 rows, 75 with a non-empty `design_context`** — the model-authored blob that 3 of the 16
  census sites in §9 parse by assertion.
- **`skill_registry`: 74 rows, `origin = 'authored'` on all 74.** No skill on this install arrived through
  the bundle importer.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every item below is one question never asked:
> **"what does this object get to decide?"** Asked downward it produces the pass-throughs — `config` to 39
> widgets, `metadata` to the SSRF gate, `spec_json` to the disk. Asked upward it produces the missing
> membership checks — a `kind` that names a component, an `id` that names a row, a `root_path` that names
> a disk. The app asks it well exactly once, for tours, in both languages, and the answer there is a
> generated manifest.

### 7.A — P0: a boolean inside an unvalidated `TEXT` column turns off two SSRF validators and swaps the HTTP client

| Path | Fact |
|---|---|
| `src-tauri/src/engine/api_proxy.rs:265-270` | `connector_allows_private_network(metadata)` — `serde_json::from_str::<Value>(m)` then `.get("allow_private_network").and_then(as_bool)` |
| `…/api_proxy.rs:722-725` | `if !allow_private { validate_field_values(&fields)?; validate_healthcheck_url(&full_url)?; }` |
| `…/api_proxy.rs:834-838` | `let client = if allow_private { HTTP_ALLOW_PRIVATE } else { SSRF_SAFE_HTTP }` — the connect-time DNS/redirect private-IP filter is what is being swapped out |
| `src-tauri/db/src/repos/resources/connectors.rs:84-154` | `create` validates: name non-empty, label non-empty, `services` and `events` are JSON arrays, name not already taken. **`metadata`, `fields`, `healthcheck_config` and `icon_url` are never parsed, never validated, never looked at.** |
| `src-tauri/core/src/models/connector.rs:80` | `is_builtin: Option<bool>` — the caller declares whether the definition is a builtin |
| `src-tauri/core/src/models/connector.rs:240-260` | `classify_connector` derives `ConnectorClass::ZeroConfig` — *"Always ready … No setup gate"* — from `metadata.always_active`, the same unvalidated blob |

So a connector definition's `metadata` blob decides (a) whether the SSRF guard runs, (b) whether the
connector counts as always-ready with no credential gate, and (c) its own rate limit
(`parse_rate_limit_from_metadata`, `:251` — at least clamped to 1..10,000), and the write door parses none
of it.

**Reachability, measured, and it is narrower than it looks — which is the finding, not a reprieve.**
`create_connector` is `#[requires(privileged)]` (`commands/credentials/connectors.rs:30`), so this is not
remote. Its live callers are `useCredentialDesign.ts:85` and `CredentialSchemaForm.tsx:135`, and
**`useCredentialDesign` builds `metadata` itself from three app-chosen keys**
(`template_enabled`, `setup_instructions`, `summary`) and hardcodes `is_builtin: false` — i.e. it already
*reconstructs the one field that matters*, while passing `fields` and `healthcheck_config` through
verbatim from the model's design result. **The safe behaviour of the live surface is a property of two
call sites, not of the door**, and the third caller — `openapi_generate_connector`
(`openapi_autopilot.rs:702`) — takes the **already-parsed** `OpenApiParseResult` as an IPC parameter, so
the SSRF-safe fetch and the parser in `openapi_parse_from_url` (`:642-685`) are not on its path at all.

**Fix, in order:** (1) move `allow_private_network` out of `metadata` into a `const` registry beside
`GLOBAL_PROBE_CONNECTORS` in `core/models/connector.rs` — it describes three connectors whose names are
already known at compile time, and a policy flag has no business in a caller-writable column; (2) drop
`is_builtin` from `CreateConnectorDefinitionInput`, exactly as `CreateRecipeInput` already does; (3) parse
`metadata`, `fields` and `healthcheck_config` in `connectors::create` and reject non-objects/non-arrays,
which is four lines beside the two `validate_json_array` calls already there.

### 7.B — P0: an import command takes the persisted row model, so the caller names the primary key

```rust
#[tauri::command]                                    // commands/core/composition_workflows.rs:65
pub fn import_composition_workflows(state, workflows: Vec<CompositionWorkflow>) -> Result<u32, AppError> {
    require_auth_sync(&state)?;                      // a no-op — ipc_auth.rs:477
    repo::bulk_import(&state.db, workflows)          // db/src/repos/resources/composition_workflows.rs:146
}
```

`bulk_import` runs **no validation of any kind** — no length caps, no count cap, no enum check, no
JSON-shape check on `nodes_json` / `edges_json` / `input_schema_json` — and binds `wf.id`,
`wf.created_at`, `wf.updated_at` straight into `INSERT OR IGNORE` (`:154-168`). The caller therefore
decides whether the row it plants collides with an existing workflow (silently ignored) or lands at an id
another feature will resolve.

The contrast is in the same file: `create_composition_workflow` takes `CreateCompositionWorkflowInput`
(`core/models/composition_workflow.rs:28-36`), which has **no `id`, no `created_at`, no `updated_at`**.
The withholding type already exists; the import door declines to use it.

**Fix:** give `import_composition_workflows` a `Vec<CreateCompositionWorkflowInput>` and mint ids
server-side, or — if id preservation is genuinely required for the localStorage migration this was
written for — validate the three JSON columns and cap the count. The command's own doc comment says
*"Called once during the localStorage → SQLite migration"*, and the live table has **0 rows**, so the
cheapest fix is deletion.

### 7.C — P1: the bundle names the directory its skills are written to, and only the file names are guarded

`data_portability.rs:8838-8983` — `write_project_skills(root_path, skills, overwrite, result)`:

| Component | Guard |
|---|---|
| `skill.name` (a directory segment) | `is_safe_skill_segment` (`:8783`) — rejects empty, `.`, `..`, `/`, `\`, `:` |
| `file.rel_path` (nested segments) | `is_safe_skill_rel_path` (`:8795`) — not absolute, every segment safe, never the provenance sidecar |
| **`root_path`** (which disk, which tree) | **`Path::new(root_path).is_dir()` (`:8848`) — existence, nothing else** |

`root_path` is `DevProjectExport.root_path` (`:526`), an arbitrary string from the bundle. It is also the
**UNIQUE match key** for project conflict resolution (`:6796-6800`), so under the `replace` resolution the
import **UPDATEs an existing `dev_projects` row** (`:6995`) — P7. All 14 live projects carry an absolute
path, so the match surface is real.

The composition, computed (not performed):

```
root_path = "C:/Users/<user>/dolla/personas"   ->   .../personas/.claude/skills/<name>/SKILL.md
```

`.claude/skills/` is where this repo's own CLI agents read their instructions from. **A bundle can name
any existing directory on the machine and drop agent instruction files into it**, and — because
`write_project_skills` is called after the DB commit, deliberately (`:6654`) — a failure there is a
warning, not a rollback.

This is P6, and [filesystem-boundary](./filesystem-boundary.md) owns the containment primitive
(`drive.rs:1414-1422`'s `managed_root` → `resolve_safe` → `exists` is the shape). What belongs here is
that **the definition chose the root**, and the guard was written for the half that was easier to reason
about — the identical inversion measured in `brainiac/crates/brainiac-publish/src/git.rs:49-74`, where
the guarded field is the one the code itself notes *"comes from our own database"*.

**Fix:** resolve `root_path` against the set of projects that already exist rather than accepting it as a
location — the bundle should name a project the user already has, or create one whose root the *user*
picks. A bundle should not be able to name a directory.

### 7.D — P1: a signature is computed and never gated on

`src-tauri/src/engine/bundle.rs:406` computes `sig_valid`; `:497` stores it as
`signature_verified: sig_valid` in the import's provenance metadata. **No branch reads it.** An unsigned
bundle, or one signed by an untrusted key, imports normally and records that it was not verified.

Four files away, `engine/src/enclave.rs:213,:278` verifies an Ed25519 signature over the **exact raw
manifest bytes** and refuses. `bundle.rs:405,:540` verifies over a **re-serialized** manifest, which is a
canonicalisation gap on top of the missing gate.

The frontend does surface the fact — `BundleImportDialog.tsx:59,:90-92` invalidates a `dangerConfirmed`
consent whenever `bundle_hash` / `signer_trusted` / `signature_valid` changes — so the *user* is told and
the *backend* is not. That is the [informed-consent-gate](./informed-consent-gate.md) seam working while
this one does not.

### 7.E — P1: the schema-validation dependency validates nothing inbound

`jsonschema = "0.28"` (`src-tauri/Cargo.toml:208`) has **one** call site in the workspace:
`engine/mcp_tools.rs:1704`, inside `validate_arguments_against_schema` (`:1695`), which validates **our
outgoing arguments** against **a remote MCP server's advertised schema**. It protects the server, not the
app.

> **Corrected 2026-08-17 by [schema-driven-form](./schema-driven-form.md): the crate has one call site,
> but the helper wrapping it has FOUR callers** — `mcp_tools.rs:1193`, `:1197`, `:1534`, `:1539`. The
> conclusion below is unaffected (all four are the same outbound direction), and the distinction is worth
> keeping: *"the crate is called once"* and *"the validation runs once"* are different claims, and only
> the first one was measured. It fails open twice — `:1699-1702` (no schema → `Ok(())`) and `:1706-1711` (the server's schema is
itself invalid → `warn!` → `Ok(())`).

Nothing else uses it. Not the portability bundle, not the four `result.json` ingests, not the tour spec,
not the connector definition, not a template. **Every inbound validator in this repo is hand-written.**

The tour path is the argument that this is *fine* — a generated closed-world manifest is stronger than a
JSON Schema, which can express "a string" but not "one of the 945 testids this build actually contains".
The deviation is not "we should use the library"; it is that **the library's presence reads as coverage**
(P10) — the same trap as `vibeman`'s unwired middleware and `ascent`'s unread `app-passport.schema.json`.

**Fix:** either wire it to something inbound or drop the dependency and put a comment where it was.

### 7.F — P2: three of the four outside-CLI ingest doors are excellent and the fourth has no version field

| Door | version gate | all-or-nothing | what an ingested row can do |
|---|---|---|---|
| `ship_ingest.rs:401` | **yes**, absent ⇒ refuse (`:207-219`) | **yes** (`:443`) | set a description/rating on an **existing member** |
| `triage_ingest.rs:345` | **yes** (`:134-146`) | **yes** | create a **pending approval** a human must confirm |
| `workspace_harvest.rs:365` | no | no (per-run skip, deliberate) | insert `observed` knowledge; names `extends` (a parent id) and `harvest_scope` |
| **`kpi_sim.rs:257`** | **none** | no | **create new `dev_kpis` rows** with a caller-chosen `category`, `measure_kind`, arbitrary `measure_config` JSON, and **`needed_connector`** — a capability name from the file (`:451`) |

All four confine the path (canonicalize + `starts_with(canon_root)`), cap at 1 MiB, and write an
idempotency marker. `kpi_sim` is the odd one out on both version-gating and on what its rows can name; it
is budget-capped (8/run, 10 pending) and its `kpi_id` references are project-scoped (`:345`), which
contains the damage. The live table holds **21 `proposed`** KPIs.

`kpi_sim` is also the door exposed over the unauthenticated loopback HTTP bridge
(`commands/infrastructure/dev_tools_http.rs:96` → `local_http/mod.rs:77`, no token middleware), which is
[second-transport-exposure](./second-transport-exposure.md)'s territory and is named here only because it
changes who the ingest's caller set is.

**Fix:** add `schema_version` to the kpi-sim contract and refuse an absent one, matching its two siblings.
Four lines, copied.

### 7.G — P2: a validated tour still smuggles one unvalidated string into app state

`validate_step` membership-checks `nav.subTabSetter` against `TOUR_SUBTAB_SETTERS` (7 entries) but only
length-checks `nav.subTab` (≤60). Executed: `{subTabSetter: "setSettingsTab", subTab: "not-a-real-tab"}`
is **accepted by both halves**. `GuidedTour.tsx:123-149` then does
`setSettingsTab(step.nav.subTab as Parameters<typeof setSettingsTab>[0])` — a cast into a closed union,
which [cross-surface-deep-link](./cross-surface-deep-link.md)'s `unchecked-destination-id-assertion` rule
already counts (19 files / 54 matches). The consequence is benign (the page falls back or renders empty),
and it is the one place the reconstruction is incomplete: **the setter is membership-checked and its
argument is not.**

The generator would have to emit the valid tab values per setter for this to be closable the same way —
which is the honest reason it was not done, and belongs in §8.

### 7.H — P2: the frontend's shared JSON helper hands back `T`

`src/lib/utils/parseJson.ts:5` — `parseJsonOrDefault<T>(json, fallback): T` is `JSON.parse(json) as T`.
Two functions further down the same file (`:32`, `:46`) bind to `unknown` and narrow — the file contains
both idioms. Any caller reaching for the shared helper gets the assertion by default. This is the
contract's fifth failure mode in miniature: **routing people to a shared primitive is only as good as the
primitive's default**, and here the primitive has two and exports the weaker one first.

### 7.I — what this path CLEARED

Four things the brief, a subagent, or the obvious reading predicts, which measurement refutes:

- **"`instant_adopt_template` lost its integrity check."** The removal is **correct and documented**
  (`template_adopt.rs:238-242`): built-in template integrity is enforced at catalog load
  (`templateCatalog.ts:158-199`, per-file checksum → shape validation → id-collision refusal), which drops
  a tampered template before it can be seeded and therefore before it can be adopted; *"the check that
  used to sit on this line could not fire."* The same function then adds a real defense-in-depth
  assertion (`first_unhydrated_recipe_ref`, `:287-295`) that refuses a partially-hydrated adoption. **This
  is one of the better-reasoned validation surfaces in the repo and I nearly reported it as a gap.**
- **"A hostile connector definition is reachable."** Not on this install and not through the live UI: 134
  of 134 connector definitions are builtin, the door is `#[requires(privileged)]`, and both live callers
  reconstruct `metadata` themselves. The defect in §7.A is that the *door* permits it, not that anything
  does it.
- **"The composed-tour `steps_json` is 'validated JSON in the frontend `TourStepDef` shape'."** It is much
  more than that — it is validated against a generated manifest, twice, in two languages — and §0 is the
  correction.
- **"`__proto__` in a definition is a prototype-pollution risk."** Executed: `JSON.parse` gives
  `__proto__` as a plain own property, and reconstruction never copies it. Both halves accept the input
  and neither propagates the key.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **A generated manifest cannot express a *relationship* between two fields.** `TOUR_SUBTAB_SETTERS`
   knows the 7 setter names; nothing knows which `subTab` values each setter accepts, because they are
   union types on 7 different store actions. Closing §7.G means teaching `gen-tour-anchors.mjs` to read
   those unions out of the TypeScript — real work, and the reason the gap exists.
2. **A dynamic-prefix allowlist admits everything under the prefix, by design.** Executed:
   `fleet-kill-process-1` is a *known anchor* because `fleet-kill-process-` is one of the 269 declared
   prefixes. That is correct — the spotlight only highlights — but it means the manifest bounds the
   *namespace*, not the *element*, and any future consumer of a validated anchor that does more than
   highlight inherits a weaker guarantee than the testid list suggests.
3. **Reconstruction silently truncates rather than rejecting, in one place.** `.take(MAX_SUB_STEPS)`
   (`tours.rs:171`) / `.slice(0, MAX_SUB_STEPS)` (`dynamicTours.ts:154`): executed, a 13-sub-step step
   whose 7th entry is hostile is **accepted**, because the hostile entry was truncated away. Consistent
   between the halves, so no divergence — but it is a cap that hides a rejection, in a validator whose
   stated contract is all-or-nothing.
4. **The census cannot assert the absence that matters.** *"No definition reaches storage without being
   reconstructed"* is a statement about data flow. §9 counts a different, countable thing, and §9's own
   note says so.
5. **No type can reach inside a `TEXT` column.** `metadata: Option<String>` is `String` on both sides of
   the IPC boundary because the column is `TEXT`. The `allow_private_network` channel is closable only by
   moving the flag out of the blob, not by any signature.
6. **A per-widget `config` schema would be 39 schemas.** There is no single type for
   `CockpitWidgetProps.config` that is both accurate and useful; the honest fix is reconstruction at each
   consuming widget, which no primitive can concentrate.
7. **`is_dir()` on `root_path` is TOCTOU-racy and cannot not be** — the check and the write are separate
   syscalls. Low value here (a local attacker who wins that race has better options), named so the next
   reader does not mistake it for the containment boundary it is not.

---

## 9. The missing gate

### First, the contract's prior question: prefer a type over a gate

**Yes — and the type is the persister's parameter, not the parser's return type.** §4's "Can the type make
the wrong call impossible?" holds it against all seven qualifications and lands on **Q5 with a Q4
caveat**: `save_tour(…, steps: &[Value])` withholds the ability to persist an unvalidated definition, but
`&[Value]` is trivially constructible, so the guarantee is social until it becomes
`ValidatedTourSteps(Vec<Value>)` with a private field. **Ship the newtype for `save_tour` and
`save_cockpit` as the fix.** The gate below ratchets the dimension no signature reaches: the client side,
where a stored definition becomes app state.

### The condition this signal is a proxy for

> *A definition the app did not author is turned into app state by a type assertion — the declared type is
> the only validation it receives.*

**An adopting repo must re-derive its own proxy and must NOT port this pattern.** The precondition here is
specific and measured: this repo stores definitions as JSON `TEXT` columns on entities, ships them over
IPC as record fields, and spells the defect as `JSON.parse(record.field) as Type`. In Rust the same
condition wears `serde_json::from_str::<Value>` + `.get("…")` (37 such sites in `brainiac/mcp.rs` alone);
in a Python service it wears a Pydantic model that is never fed the body
(`personas-cloud/facade/proxy.py:29-34`); in a Next.js app it wears
`(await res.json()) as T`. **This pattern scores zero on all of them.**

### Not already gated — the neighbours I checked

All **110** rules in `scripts/census/rules.json` were read. The six that share `roots: ["src"]` and could
plausibly collide were run against my match set:

| rule | goldenPath | file overlap with my 15 |
|---|---|---:|
| `raw-web-storage` | client-state-persistence | **0** |
| `unchecked-destination-id-assertion` | cross-surface-deep-link | **0** |
| `raw-inner-html` | rendering-untrusted-content | **0** |
| `unnamed-cast-at-navigation-door` | cross-surface-deep-link | **0** |
| `ipc-payload-typed-inline` | bridge-type-contract | 1 (`api/devTools/devTools.ts`, different line and condition) |
| `discarded-toast-copy` | i18n-string-authoring | 1 (`hooks/design/core/useDesignConversation.ts`, ditto) |

The zero against `raw-web-storage` is **by construction and was the design intent**: requiring the parse
argument to be a *member expression* excludes the localStorage-hydration arm, which always binds to a
local variable first. Measured: of 68 `JSON.parse(…) as NamedType` sites in `src/`, **14 are
localStorage** and every one of them is excluded by that requirement. On the Rust side,
`model-reply-parser-without-a-reason` (structured-output-extraction) and `untyped-command-payload`
(new-ipc-command) are the near neighbours; both are `.rs`-only and key on function *signatures*, so there
is no pattern overlap at all.

### Precision and recall

**Precision: 15 of 16 hand-read.** Every match parses a blob field carrying a definition the app did not
author in that form — a model-composed cockpit spec (×2), a model hypothesis, a model design result (×2),
a model AgentIR, a model conversation, a composition file loaded from disk (×2), an outside-CLI kpi-sim
`evidence` blob, a KPI `measure_config`, an importable recipe's `sample_inputs`, a persona's
`design_context`, a triage rule's `conditions`, a model-composed action's `paramsJson`. The one borderline
is `useEngineCapabilities.ts:60` (`savedResult.value`, an app-written settings value), and it is still a
definition-shaped blob asserted into `Partial<EngineCapabilityMap>`.

**Recall is deliberately partial and stated.** The pattern requires a *member expression* argument, so it
does not see `JSON.parse(content) as Record<string, unknown>` in the three n8n import hooks
(`useFileUpload.ts:121`, `usePasteImport.ts:28`, `useUrlImport.ts:62`) — the file/paste/URL door, which
binds the text to a local first. Those are genuine instances of the condition and this rule misses them.
Widening the argument to any expression raises the count to 68 and drops precision to ~44% by pulling in
the whole localStorage arm; **the narrow form was chosen for precision over recall and the trade is stated
here so the next reader does not "fix" it.**

### Two implementations — exact agreement on count *and* membership, after a false-positive class was caught

A first pass used a **consuming** window (`JSON\.parse\s*\([\s\S]{0,300}?\)\s*as\s+…`) and reported 70
matches. An independent character-scanner (paren-matched, string- and comment-aware) reported 68. The four
disagreements were all the doctrine's composition failure, reproduced:

```
useTeamStudioData.ts:80   JSON.parse(config) as { preset_role?: string }   <- an INLINE object type; the
                          window then slid to line 90's `as DesignContextShape` and merged two statements
teamBridge.ts:42          const parsed: unknown = JSON.parse(raw);         <- the window reached the NEXT
                          line's `as ChannelSpecLike[]`, so the regex flagged the exemplar of the
                          COMPLIANT pattern as a violation
bridge.ts:1667            same shape, four lines apart
```

Rewriting the argument as a **non-consuming member-expression alternation** made both implementations
agree at **16 matches / 15 files with identical membership**. *Agreement is not soundness — but a
disagreement that names its own cause is.*

### The positive control partitions the anchor

Both rules key on `JSON.parse`. The violating arm counts the sites that assert into a named type; the
control counts the sites that bind to `unknown`, forcing a narrowing step. **Disjoint by construction**
(`as unknown` vs `as <not-unknown>`), and together they are the decision every parse site makes:

```
319  JSON.parse( occurrences in src/
 16  asserted into a named type          <- violating
 26  bound to `unknown`                  <- compliant (the control)
277  neither (destructured, immediately consumed, inferred, or inside a test)
```

A control returning ~0 would mean the repo has no compliant form and the rule is measuring a house style
rather than a choice. It returns 26 in 25 files.

```json
{"rules":[{"id":"asserted-definition-blob","goldenPath":"docs/concepts/golden-paths/untrusted-definition-validation.md","title":"A definition stored as a blob on an entity is turned into app state by a type assertion","roots":["src"],"extensions":[".ts",".tsx"],"signal":{"pattern":"\\bJSON\\.parse\\s*\\(\\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\\??\\.[A-Za-z_$][A-Za-z0-9_$]*)+\\s*(?:\\?\\?[^)]{0,40})?\\)\\s*as\\s+(?!unknown\\b|any\\b|const\\b)[A-Z][A-Za-z0-9_]*","flags":"g","ignoreCommentLines":true,"description":"JSON.parse of a blob field on an entity or IPC record, asserted straight into a named type — the cast IS the validation. PROXY FOR the stack-free condition: a definition the app did not author becomes app state without being reconstructed against a closed vocabulary. Measured 2026-08-16 at 629a914af: 16 matches / 15 files, against 26 matches / 25 files for the compliant form (`: unknown = JSON.parse(`) — same anchor, disjoint by construction, 319 JSON.parse occurrences total in 4,829 files. PRECISION 15/16 hand-read (each parses a model-composed spec, an imported definition, an outside-CLI ingest blob, or a persona design_context; the one borderline is useEngineCapabilities.ts:60). RECALL is deliberately partial: requiring a MEMBER-EXPRESSION argument excludes the localStorage-hydration arm by construction (0 file overlap with raw-web-storage, verified) at the cost of missing the three n8n file/paste/URL import hooks, which bind the text to a local first. Widening to any expression gives 68 matches at ~44% precision. THE ARGUMENT MATCH MUST NOT BE A CONSUMING WILDCARD: a `[\\s\\S]{0,300}?` window slid across statement boundaries and flagged lib/channel/teamBridge.ts:42 — the exemplar of the COMPLIANT pattern — as a violation. CORRECT END STATE is 0, at which point DELETE this rule rather than baselining it at zero. PRECONDITION (re-derive per repo, do NOT port): this repo spells the defect as a TS type assertion on a parsed JSON blob column. In Rust it wears serde_json::Value + .get(), in Python a Pydantic model never fed the body, in Next.js `(await res.json()) as T` — this pattern scores ZERO on all three."},"baseline":{"files":15,"matches":16},"floor":4000},{"id":"asserted-definition-blob-positive-control","goldenPath":"docs/concepts/golden-paths/untrusted-definition-validation.md","title":"POSITIVE CONTROL — the compliant half: the parse result is bound to unknown","roots":["src"],"extensions":[".ts",".tsx"],"signal":{"pattern":"(?::\\s*unknown\\s*=\\s*JSON\\.parse\\s*\\()|(?:JSON\\.parse\\s*\\([^)]{0,120}\\)\\s*as\\s+unknown\\b)","flags":"g","ignoreCommentLines":true,"description":"POSITIVE CONTROL: the same JSON.parse anchor, compliant form — the result is typed `unknown`, so the compiler forces a narrowing step before use (lib/channel/teamBridge.ts:42 is the exemplar). Disjoint from the violating pattern by construction. Must be non-zero: a control near zero would mean the repo has no compliant form and the violating rule is measuring house style rather than a choice."},"floor":4000}]}
```

### Validation — run 2026-08-16 via `node scripts/census/run-census.mjs --rules <scratch> --check`

The rule was validated in a **private scratch registry with a filename unique to this composer**. The full
registry was **not** run.

| # | Scenario | Expected | Observed | Exit |
|---|---|---|---|---|
| 1 | Rule + control as shipped, `--check` | baseline holds; control non-zero | `OK asserted-definition-blob 15/15 files, 16/16 matches, 4829 walked, floor 4000` · `OK …-positive-control 25 files, 26 matches` | **0** |
| 2 | Fault: **rise** — baseline claims 14/15 | must fail | `files rose 14 -> 15 (+1)` · `matches rose 15 -> 16 (+1)` | **1** |
| 3 | Fault: **silent drop** — baseline claims 16/17 | must fail | `files dropped 16 -> 15 (-1) without the baseline moving. A silent drop is a broken matcher more often than fixed code` | **1** |
| 4 | Fault: **broken matcher** — `roots` narrowed to one directory | must fail structurally | `walked 54 files but floor is 4000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` | **1** |
| 5 | Fault: **zero match** — pattern replaced with a nonexistent token | must fail structurally | `matched zero files anywhere … DELETE the rule rather than baselining it at zero` | **1** |
| 6 | **Re-extracted from this document** and re-run | identical | identical to #1 | **0** |

### Where it executes

**`npm run census:check`, which is chained inside `npm run check` AND is a `pre-push` lefthook job**
(`lefthook.yml:74-75`, `golden-path-census`). Per the brief's calibration, that matters: the hook was
added on 2026-08-16 with the reason written in the file — *"Added because it was enforced NOWHERE:
`census:check` lives only inside `npm run check`, which nothing runs automatically, so a rule could rise
or silently drop and the commit — and the push — went through."* It is **not** in `ci.yml`, deliberately.
The runner's own fail-loud contract (floor, zero-match, stale-exclude, rise, silent drop) is what makes
this a gate rather than a report; rows 2–5 above are that contract exercised.

### What this gate does NOT catch — the contract's fifth failure mode, named

It ratchets the *client* half and nothing else. It will go green on a codebase where all 16 sites bind to
`unknown` and every one of them then does `if (typeof x === 'object') return x as SomeType` — arriving at
`unknown` is not the same as reconstructing. **The gate on the destination's defaults is the newtype on
the two persisters, and it is not a ratchet; it is one signature each.** It also cannot see §7.A (a flag
in a `TEXT` column), §7.B (a command's parameter type), §7.C (a path from a bundle), or §7.D (a signature
nobody reads — the honest §9 for that is a Rust test asserting `sig_valid` gates `apply_import`, which the
census structurally cannot express because it is an absence).

Ship all of it, and ship the newtypes first.

---

## 12. Corrections to the brief

The brief made five priming claims and set one calibration. **Three were right, one was the wrong frame,
one pointed at the largest finding without knowing it, and one number is now reported three ways.**

1. **"A model emits `OPEN_URL:<url>` and it reaches an OS handler prefix-checked only."** **Correct when
   written; fixed since.** `HEAD` is `629a914af` — *"fix(security): URLs were being opened through
   cmd.exe, which expands %VAR%"* — i.e. [external-url-opening](./external-url-opening.md)'s §7.A landed
   between that path's composition and this one. The clause this path inherits is the *general* one, and
   it is P1: model output is an untrusted definition. The `OPEN_URL` case is that path's §7.B and is not
   re-derived here.

2. **"`ModeratorDecision` has all seven fields `#[serde(default)]` … `deny_unknown_fields` appears 0
   times — check that."** **Both confirmed, and the second generalises much further than the brief
   implies.** `deny_unknown_fields`: **0 in 946 Rust files**, and **0 in `brainiac` across 58 parses** and
   **0 in `vibeman`'s Rust**. Of **1,123** `Deserialize` structs in this repo, **59** have every field
   defaulted. But the real correction is that `deny_unknown_fields` is **the wrong instrument for this
   leaf**: it rejects a definition with a stray key, which is brittle for a format that must accept
   forward-compatible additions. **Reconstruction gives you the property `deny_unknown_fields` promises,
   plus forward compatibility, plus a normalized output** — and this repo already built it, twice, and
   the brief did not know that.

3. **"11 of 11 protocol parsers return `Some` unconditionally: `{"user_message":{}}` is a delivered empty
   report."** **True and already owned.** [structured-output-extraction](./structured-output-extraction.md)
   §7.G measured it, established it is latent (0 empty channel posts, 0 empty `event_type` in 4,972 rows,
   0 empty memories in 6,535), and holds the fix. Not re-derived.

4. **"134 connector definitions live in the live DB, 3 with `allow_private_network`. Templates and recipes
   are importable. What validates them?"** **The counts are exact and the framing needs one correction
   each.** All 134 connector definitions are `is_builtin = 1` — **zero foreign connector definitions have
   ever existed on this install** — and the 3 `allow_private_network` rows are hardcoded Rust seeds
   (`builtin_connectors.rs:985,:999,:1755`). So the *data* is clean and the *door* is not (§7.A): the
   flag's location, not its current values, is the defect. On recipes: all **316** carry a
   `source_template_id` and 315 are builtin, and the template import path's integrity check is real —
   it lives at catalog load in `templateCatalog.ts`, and the backend's removed checksum re-check is
   documented as unreachable (§7.I). **The brief's implied gap there does not exist.**

5. **"`compose_tour` writes a tour composed by a model into a table; `steps_json` is 'validated JSON in
   the frontend `TourStepDef` shape' — check what validates it and what a bad step can do."**
   **This is where the brief's hedge turned out to be the headline, in the opposite direction.** The
   answer to "what validates it" is: a reconstructing validator in Rust against a 945-entry generated
   manifest, and an independently-written twin in TypeScript against the same manifest, and a third gate
   at the store setter — the best answer to this leaf in six codebases. The answer to "what can a bad step
   do" is: **nothing, executed against 38 hostile definitions, on both halves.** And the finding is what
   sat next to it: `compose_cockpit`, the *other* definition the same model composes in the same turn,
   has **no validator at any layer**, is persisted by a function that takes the raw string, is read back
   by a cast, and is the one with a live row. **The brief's instruction — "let the measurement lead" — is
   the only reason this was found**, because reading `tours.rs` alone produces a clean bill of health and
   the next question (what happens to the *other* thing in that loop?) needed the sibling module and a row
   count.

6. **A prediction of my own, disproved and recorded.** I expected the two halves of the tour validator to
   diverge in production — a tour persisted `ready` that the frontend refuses to play. They diverge on
   **7 of 38** inputs in isolation and on **0 of 38** in the real pipeline, because reconstruction hands
   the second validator a value already in the closed form. The effort spent trying to prove a defect is
   what produced this document's central claim (§0), which was not in the brief.

7. **On the command count.** The brief notes *"three composers produced three counts; 1,661 is the one
   with a stated method."* Mine is **1,662**, and here is its method so the next composer can reconcile
   rather than re-guess: a whole-file regex `#\[tauri::command\] … \bfn\s+([a-z0-9_]+)\s*\(…\)\s*->` over
   **946** `.rs` files under `src-tauri/`, excluding any path containing `/bindings/` or `/tests/` and any
   file matching `*_test.rs` / `*_tests.rs`, with `#[cfg(test)] mod` blocks removed by **brace matching**
   (never a line threshold — `dev_tools_backlog_tests.rs` is why). The ±1 against 1,661 is almost
   certainly one command inside a `#[cfg(...)]` arm counted once by one method and twice by another; it
   is not worth a third measurement, and **the useful output is the method, not the number.**

**Scratch artifacts.** The transliteration harness, the three scanners, the scratch rule registry and the
database copies live in the session scratchpad and were not written into the working tree. The only file
this composition adds is this document. `scripts/census/rules.json` was **not** edited — both rules ship
as the fenced JSON above, per the contract's concurrent-composer rule.
