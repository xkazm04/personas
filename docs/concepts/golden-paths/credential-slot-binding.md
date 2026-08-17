# Golden path — Credential slot binding

> **Topic path:** `integrations-security` › `credential-readiness` › `credential-slot-binding`
> [situation spine](../situation-spine.md) · recurrence 12 · risk **medium** · sides: **client**
> (spine label — **see §12.2, it is inverted**) · `twoSided: true` (**holds**) ·
> convergence: **mixed** (**see §12.3 — it holds, on a cohort of two**) ·
> dimensions: **ui · function · security · code-quality**
> `mergedFrom`: *Connector slot binding* + *Credential-to-slot matching*
> Composed 2026-08-17 against `master` @ `6c97502d3`.
>
> **Subject — the binding itself.** A persona declares a capability slot (`github`, `codebase`,
> `image_generation`). The vault holds credentials. This leaf owns the *record that connects them*:
> where it lives, who writes it, how it is resolved at run time, what happens when it is absent or
> ambiguous, and whether the readiness a surface displays is the readiness the runtime computes.
>
> **Not this path.** *Is connector X ready* is
> [credential-readiness-resolution](./credential-readiness-resolution.md) — it owns the resolver, its
> `SetupKind` verdict, and the invalidation hooks. *The second implementation of any rule in the other
> language* is [client-rule-mirroring](./client-rule-mirroring.md). *Choosing* a credential in a
> dropdown is [entity-picker](./entity-picker.md). *Capturing* one is
> [credential-capture-form](./credential-capture-form.md); *replacing* one is
> [credential-rotation-and-revocation](./credential-rotation-and-revocation.md); *what authority it
> carries* is [least-privilege-scope-grant](./least-privilege-scope-grant.md); *how a declaration
> becomes a form* is [schema-driven-form](./schema-driven-form.md).
>
> **Sweep.** Read end to end: `commands/design/connector_readiness.rs` (1,922 lines),
> `engine/runner/credentials.rs`, `core/src/models/persona.rs` (the `design_context` envelope),
> `core/src/models/connector.rs`, `engine/runner/{mod,team_context}.rs`,
> `commands/design/template_adopt.rs`, `commands/infrastructure/twin.rs`,
> `db/src/repos/resources/credentials.rs`, `db/src/macros.rs`, plus the client half:
> `shared/components/display/connectorRunnability.ts`, `agents/sub_connectors/libs/
> {useConnectorStatuses,useUnfulfilledCredentials}.ts`, `hooks/design/core/useDesignContextMutator.ts`,
> `templates/sub_n8n/edit/connectorHealth.ts`. Census walk: **963** `.rs` under `src-tauri`.
>
> **Measured by executing, not reading.** Every number below was **replayed** against a read-only
> **copy** of the operator's live 347 MB `personas.db`, copied 2026-08-17 14:53 UTC with the app
> running. The live file was never opened for write; the copies were deleted afterwards. Corpus:
> **78 personas, 25 credentials, 42 credential fields, 134 connector definitions, 14 dev projects,
> 8 teams**.
>
> Five things were executed rather than argued:
> 1. **`parse_design_context` was transliterated from `persona.rs:711` and run over all 78 personas**,
>    with serde's deserialization semantics modelled field by field (§0.1).
> 2. **All three resolvers were replayed over all 117 live slots** and their verdicts compared
>    pairwise (§0.4, §0.5).
> 3. **`persona_live_blockers` was recomputed for every persona** and compared against the persisted
>    `setup_status` column (§0.6).
> 4. **The anchor of the §9 rule was enumerated exhaustively** — every call site, partitioned (§9).
> 5. `gh auth status` was run once, read-only, exit 0, because the resolver's `github` arm depends on
>    it. No other process was spawned.
>
> **`cargo` was NOT run.** Every Rust claim is static or replayed in SQL/Python.
> **Nothing was bound, re-bound, rotated, revoked or decrypted.** No provider API was called. **No
> secret value, prefix, partial or length appears below** — shape, key, count and credential *id
> prefix* only.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. The effective independent cohort is **2** (§6).
>
> **Settles:** where a slot→credential binding lives, and what has to be true for it to survive.

---

## 0. The headline

**A slot binding in this app is a key in a JSON object in a TEXT column, and the app's own typed
reader of that column cannot parse it for 63 of the operator's 78 personas. The parse fails on a
sibling field, so every binding in the same blob is discarded silently and the reader falls through
to a legacy branch that looks for a different spelling of the key. Of 117 declared slots, 4 carry an
explicit binding; the other 113 are guessed at run time by taking the first credential of a matching
service type — while the authority that exists to answer this exact question refuses to guess, and
is not on the runtime's path.**

### 0.1 — 63 of 78 personas' `design_context` fails its own typed parse, and the binding goes with it

`parse_design_context` (`core/src/models/persona.rs:711`) tries the typed envelope first and falls
back to a legacy branch. Transliterated and run over all 78 live personas:

| `parse_design_context` outcome | personas |
|---|---:|
| **`legacy` — reached only after the typed parse ERRORED** | **63** |
| `typed` | 12 |
| `default` (column empty) | 3 |

**Every one of the 63 fails at the same field**, `connectorPipeline[0]`.
`DesignContextData.connector_pipeline` is declared `Option<Vec<ConnectorPipelineStep>>`
(`persona.rs:485`), and `ConnectorPipelineStep` (`:458`) requires three fields:

```rust
pub struct ConnectorPipelineStep { pub connector_name: String, pub action_label: String, pub order: i32 }
```

The live data is **154 bare strings** — `["Codebase", "Messages"]` — across those 63 personas.
**0 of 154 elements satisfy the struct.** `#[serde(default)]` does not rescue it: `default` applies
to an *absent* key, not to a present key holding the wrong shape. One bad element rejects the whole
`DesignContextData`.

The legacy branch (`:740-790`) reads only `files`/`references`, **`credential_links` (snake_case)**,
`use_cases` (snake_case) and `summary`. The live data writes **`credentialLinks` (camelCase)**. So:

| field present in the raw column but ABSENT from the parsed envelope | personas |
|---|---:|
| `devProjectId` — the codebase binding | **63** |
| `connectorPipeline` | 63 |
| `credentialLinks` — an explicit slot binding | **1** |

The one `credentialLinks` casualty is **`T: QA Guardian`**, whose explicit `github` → `aab5e74b`
binding is invisible to every reader that goes through `parsed_design_context()`. It is the only
persona in the install carrying both a `credentialLinks` entry and a `connectorPipeline`.

> **The comment that documents this defect names the wrong cause, which is why it was never
> generalised.** `engine/runner/mod.rs:1167-1171` works around it at exactly one site:
>
> > *"Extract the pin from the raw JSON, NOT via `from_str::<DesignContextData>`: a persona's
> > design_context carries extra/loosely-typed fields (mapped useCases, builderMeta, …) that fail the
> > strict struct parse, which would silently drop the pin. Reading the `devProjectId` key directly
> > is robust."*
>
> **Extra fields do not fail this struct.** `DesignContextData` carries no `deny_unknown_fields`, and
> the three personas that *do* parse `typed` all carry `builderMeta` — the field the comment blames.
> Measured: the discriminator is `connectorPipeline` and nothing else. The author found a real
> defect, fixed it locally, and wrote down a cause that made it look unfixable. **Five other readers
> still go through the typed parse and still lose the binding**: `team_context.rs:247`, `:354`,
> `twin.rs:261`, `team_assignment_matching.rs:92`, `management_api.rs:1579`.

### 0.2 — The codebase pin is lost 63 of 63 times, and 18 of those point at a project that no longer exists

`design_context.dev_project_id` is documented at `persona.rs:493-502` as the per-persona repo
binding — *"the `codebase` connector resolves THIS `dev_projects.id` instead of the globally-first
project … so a team adopted for repo X reads repo X."*

| | value |
|---|---:|
| personas carrying a pin | **63** |
| distinct projects pinned | **7** (9 personas each) |
| pins whose `dev_projects` row is **gone** | **18** (2 of the 7 projects) |
| pins carried by a persona whose typed parse **fails** | **63 of 63** |

So the binding fails twice over: it is unreadable by five of its six readers, and even where it is
read, 2 of 7 targets are deleted. Meanwhile `has_dev_project` (`connector_readiness.rs:263-270`) is

```sql
SELECT 1 FROM dev_projects WHERE status = 'active' LIMIT 1
```

— **any** active project (there are 14) makes `codebase` report `Ready` for **every** persona,
regardless of which repo it is pinned to. The verdict is decoupled from the binding it is a verdict
about.

### 0.3 — One slot has six vocabularies, and exactly one of them is read

A persona's connector declaration is an object in `last_design_result.suggested_connectors`.
Measured across all 117:

| key | present on | who reads it |
|---|---:|---|
| **`name`** | **117** | **`persona_declared_connectors` (`connector_readiness.rs:686`) and the runtime injector — the only key that resolves anything** |
| `role` | 98 | **nobody** |
| `label` | 98 | **nobody** (display only) |
| `required` | 98 | **nobody** |
| `category` | 98 | nobody in this path |
| `service_type` | 19 | nobody in this path |
| `design_context.connectorPipeline[]` | 154 entries / 63 personas | **nobody — and it breaks the typed parse (§0.1)** |
| `design_context.credentialLinks` keys | **4** | the runtime, and 4 client resolvers |
| `persona_tool_definitions.requires_credential_type` | **3** | a different client resolver |

Two consequences, both live:

- **`role` is the field a function named `normalize_connector_role` was built for, and it is never
  passed one.** The declarations carry `role` values `code_analysis` (63), `vcs` (21),
  `image_generation` (7), `image_evaluation` (7). The normalizer (`connector_readiness.rs:948`) is
  called with `name` instead. **`name` differs from `role` on 91 of the 98 declarations that carry
  both.** This is the [schema-driven-form](./schema-driven-form.md) §0.3 shape exactly — that leaf
  measured `sensitive` on **184 of 196** connector-field declarations, read on **one** side only
  (`db/src/repos/resources/credentials.rs:104-108`, where it decides encryption at rest) and by **no
  renderer**, so **37 fields declared sensitive render a visible control.** Same disease, one layer
  up: *a declaration key that exists, is populated, decides something by its name, and has no reader.*
- **`required` is declared and ignored.** 63 declarations say `required: true`, **35 say
  `required: false`**, 19 omit it. `persona_declared_connectors` reads `required_connectors` and
  `suggested_connectors` into one flat list and `missing_connectors` (`:620`) blocks on all of them
  equally. On this install `required_connectors` is **empty on all 78 personas** — **every one of the
  117 slots is a *suggestion* being enforced as a *requirement*.**

### 0.4 — 4 of 117 slots are actually bound; the other 113 are guessed

| | value |
|---|---:|
| declared slots (persona × connector) | **117** over 73 personas |
| distinct slot labels | **11** |
| slots carrying an explicit `credentialLinks` binding | **4** (3.4 %) |
| personas with any binding | **4 of 78** |
| **dangling bindings** (value is not a live credential id) | **0** |

The four are well-formed: each key matches a slot the persona declares, each value is a live
credential. **The explicit binding mechanism is not broken — it is unused.** 113 of 117 slots reach
run time with nothing recorded, and get whatever the fallback finds.

> **The brief asked whether credential bindings are as clean as the FK-bearing tables. Control
> re-measured here: `persona_triggers` 0 dangling, `persona_team_members` 0 dangling,
> `credential_fields` 0 dangling.** The binding held in JSON is *also* 0 dangling — but that is not
> the same as healthy, because there are only four of them, one of the four is unreadable (§0.1), and
> the 63 *project* pins in the same blobs are 18/63 dangling. **A namespace with no foreign key does
> not fail by dangling; it fails by not existing.**

### 0.5 — The three resolvers, replayed over every slot

| slot label | slots | server `connector_readiness` | client `resolveConnectorRunnability` | runtime injector |
|---|---:|---|---|---|
| `codebase` | **69** | Ready — *GlobalProbe, no credential* | satisfied — **credential `0da023d9`** | **INJECTS `0da023d9`** |
| `github` | 22 | Ready — bound `aab5e74b` | satisfied `aab5e74b` | INJECTS `aab5e74b` |
| `image_generation` | **7** | **NeedsSetup** — *ambiguous, category `ai` ×2* | **satisfied — ElevenLabs** | injects nothing |
| `vision` | 7 | NeedsSetup | needs_setup | injects nothing |
| `local_drive` | 4 | Ready | satisfied | INJECTS |
| `personas_messages` / `personas_database` | 2 / 2 | Ready | satisfied | INJECTS |
| `leonardo_ai` | 1 | Ready | satisfied | INJECTS (explicit link) |
| `notion` | 1 | Ready | satisfied | INJECTS (explicit link) |
| **`email`** | **1** | **NeedsSetup** — *bindable but not usable* | **satisfied — Gmail** | **INJECTS Gmail** |
| `all relevant sources` | 1 | NeedsSetup | needs_setup | injects nothing |

- **Client and server disagree on 8 of 117 (6.8 %)**, from two distinct causes: 7 × ambiguity, 1 ×
  usability. The client implements neither rule.
- **`codebase` is the whole install's centre of gravity and all three answers differ in kind.** The
  vault holds **three** credentials with `service_type = 'codebase'`. The server classifies the
  connector `GlobalProbe` and reports Ready **without binding anything**. The client takes an exact
  `service_type` match and **displays one of the three**. The runtime reaches
  `get_by_service_type("codebase").first()` and **injects one of the three into all 69 slots**.
  Client and runtime happen to agree on *which* — `0da023d9`, `Codebase — gravitone` — because both
  list paths carry `ORDER BY created_at DESC` (`db/src/macros.rs:185` via `credentials.rs:124`, and
  `credentials.rs:230`). **That agreement is an accident of the newest row, not a decision: adding a
  fourth `Codebase` credential silently re-points every one of the 69 slots**, and the per-persona
  pin that was supposed to decide this was dropped at parse.
- **`email` is the sharpest single instance.** `Product Scout (4)` carries an explicit, correct,
  non-dangling binding to `77ec7d66` — the operator's Gmail OAuth grant, which
  [credential-rotation-and-revocation](./credential-rotation-and-revocation.md) §0.4 measured as
  **expired 75 days ago, `needs_reauth: true` since 2026-06-09, 49 consecutive refresh failures**.
  The server refuses it (`healthcheck_last_success = false`). The client renders it satisfied. **The
  runtime honours the link and injects it**, because the link path (`runner/credentials.rs:455-457`)
  tests only that the row exists. One binding, three verdicts, and the two that act are the two that
  are wrong.

### 0.6 — What the surface shows is not what the runtime computes, on 24 of 78 personas

`persona_live_blockers` recomputed for every persona and compared against the persisted
`personas.setup_status`:

| | value |
|---|---:|
| column agrees with a live recompute | **54 of 78** |
| **column disagrees** | **24 of 78 (30.8 %)** |
| …says `needs_credentials`, live says **ready** | **22** |
| …says `ready`, live says **needs_credentials** | **2** |

The 22 are hidden from the team-member picker (`teamStudioShared.tsx:128` filters
`setup_status === 'ready'`) for a reason that no longer holds. The 2 —
`Visual Brand Asset Factory (3)` (blocker `all relevant sources`) and `Product Scout (4)` (blocker
`email`) — **would be hard-blocked at the run gate right now while every surface says they are
ready.**

And there is no account anywhere:

| | value |
|---|---:|
| personas at `needs_credentials` | **29** |
| personas carrying a `setup_detail` account | **10** |
| `SetupBlocker` rows in the entire database | **1** (`github` / `vault_credential`) |

**28 of 29 blocked personas cannot say what is blocking them.** `setup_detail` is the structured
account [credential-readiness-resolution](./credential-readiness-resolution.md)'s
`detached-readiness-verdict` rule exists to protect; measured at runtime, the column has won.

### 0.7 — Nothing records which binding was used

Zero rows anywhere say *"this run resolved slot S to credential C."*
[least-privilege-scope-grant](./least-privilege-scope-grant.md) §0.6 measured the same absence one
layer up — `BrokerGrant`, the type whose whole job is to name which grant authorised a use, has **0
rows against 9,431 `decrypt` audit rows naming no grant.** The slot layer inherits it: the runtime
logs `credCount`, never `credId`, and `credential_consumer_edges` (the only observed-usage table)
holds **0 rows**. So the answer to *"which credential did this persona actually use last Tuesday"* is
unrecoverable, and the answer to *"what will it use tomorrow"* is *whichever row is newest.*

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant so an adopting repo can tell physics from local
calibration.

> **P1 — physics, and the whole subject. *A binding is a record, not an inference. If the system
> cannot name which credential backs a slot without re-deriving it, there is no binding.*** Matching
> rules are conveniences for *proposing* a binding; the binding is what you wrote down. The test is
> mechanical: delete every matching rule and ask what the system still knows. If the answer is
> "nothing", every surface that said "configured" was reporting a coincidence.
> *Warrant: measured here as 4 recorded bindings against 117 slots, with the other 113 re-derived
> independently by three resolvers that disagree; and externally as the one repo in the cohort with a
> genuine slot binding storing it as an explicit named reference on the owning row.*
>
> **P2 — physics, 2 of 2 independent siblings, and the one clause the fleet is unanimous on. *When
> more than one credential could satisfy a slot, refusing to choose is the correct behaviour, and it
> must be refused everywhere or nowhere.*** An ambiguous binding resolved silently is worse than an
> unresolved one, because the unresolved one asks a question. The dangerous version is not a system
> that guesses — it is a system where **one** component refuses and the others guess, because then
> the refusal reads as a bug in the strict component.
> *Warrant: the authority in this repo refuses at 2+ candidates and says why in its doc comment,
> while nine call sites on the runtime path take element zero; the two independent siblings avoid the
> question entirely by making the binding 1:1 by construction, which is the same answer arrived at by
> a different route.*
>
> **P3 — physics. *A binding stored inside a serialized blob is only as durable as the strictest
> parse of that blob, and the failure is total, silent, and attributed to the wrong field.*** Every
> value in one envelope shares one fate. A sibling field with a shape the reader did not expect
> discards the binding beside it, and nothing distinguishes "the binding was dropped" from "there was
> no binding". This is where types cannot reach — not because the type is wrong, but because it is
> upstream of nothing and downstream of everything.
> *Warrant: measured here as 63 of 78 envelopes rejected on one sibling field, 63 of 63 bindings in
> them lost, with a workaround already written at one of six read sites blaming a cause that
> demonstrably does not produce the failure.*
>
> **P4 — physics, and the discriminator worth stealing. *A fallback must be narrower than the thing
> it replaces, never wider.*** A resolution that fails should degrade to *nothing* — a refusal a human
> can act on — not to *something else*. Falling back from "the credential this persona was bound to"
> to "any credential of roughly this kind" converts a visible failure into an invisible wrong answer,
> and the wrong answer is stable, so nobody reports it.
> *Warrant: measured here as a link that fails to resolve falling through to first-of-service-type —
> re-introducing, by deletion, the exact bug the link was added to fix, with the fix's own rationale
> still in the comment above it. Externally: 2 of 3 independent siblings fail closed on an
> unresolvable binding and one of them wrote a paragraph explaining why it removed the fallback.*
>
> **P5 — physics. *The vocabulary a slot is declared in must be the vocabulary it is bound in, and
> if it is not, the translation must be a named, total function with one implementation.*** Display
> label, machine name, role and category are four different strings for one concept; the moment two
> of them can be the key, the binding namespace has no membership test and a typo is a new slot.
> *Warrant: measured here as six coexisting slot vocabularies on one persona, of which one resolves
> anything, one silently breaks the parse, and a normalizer named for the third is never called with
> it.*
>
> **P6 — physics, and the reason this leaf recurs. *Readiness must be computed by the code that
> resolves, or it is a second opinion about a different question.*** Any surface that answers "is this
> configured" with its own matching rule is not reporting on the binding; it is reporting on its own
> rule. Two implementations do not drift *eventually* — they are already different the day the second
> one is written, because they were written to answer slightly different questions.
> *Warrant: measured here as three resolvers disagreeing on 8 of 117 slots from two distinct causes,
> and a persisted verdict disagreeing with a live recompute on 24 of 78 personas; externally as the
> one sibling with a separate readiness surface having it disagree with its own runtime by
> construction, and the one sibling with a single code path having no disagreement to measure.*
>
> **P7 — ergonomics, security-load-bearing. *A declaration key with no reader is not documentation;
> it is a false promise the next author will believe.*** Someone wrote `role`, `required` and
> `label` onto every declaration because those facts matter. A reader that ignores them is
> indistinguishable, from the outside, from one that honours them — and the author of the *next*
> field has no way to tell which kind of format they are writing into.
> *Warrant: measured here as `role` on 98 declarations with zero readers while a function named for
> it resolves something else, and `required: false` on 35 slots enforced as required; convergent with
> the same repo's connector-field format, where a key on 184 of 196 declarations decides encryption
> at rest and no renderer reads it.*
>
> **P8 — function. *A binding must have a defined answer for "the credential is gone" and for "there
> are several", and those two answers must be different from each other and from "there is one".***
> Three inputs, three outputs. Collapsing any two is how a deleted credential becomes an arbitrary
> live one.
> *Warrant: measured here as a link path with one arm — the row exists — so a deleted credential and
> an ambiguous match take the identical fallback.*
>
> **P9 — function, cheapest to satisfy and the only one that survives an incident. *Record which
> binding a run actually used, at the moment it is used.*** Declared bindings answer what you intended.
> Only a usage record answers what happened, and it is the only artifact that survives the binding
> being changed afterwards.
> *Warrant: 1 of 2 independent siblings keeps a publication ledger naming the target that was used
> and describes it as letting an operator prove what left the building; measured here as zero rows
> anywhere naming a resolved binding, against a runtime that logs only a count.*
>
> **Scale condition.** P1, P4 and P8 are correctness on the first binding. P3 bites the first time
> anyone adds a field to the envelope. P2 and P5 bite the first time a user owns two credentials of
> one kind — which is the first day they have a staging account. P6 bites the first time a surface is
> added. P7 bites on the second author. P9 costs nothing on day one and is unpayable after the
> incident.

---

## 1. Trigger

- "let the user pick which credential this connector uses" / "wire this agent to my GitHub"
- "auto-match the credentials it needs" / "figure out which key goes with which connector"
- "show a green tick when the connector is wired up"
- "it says configured but the run had no credentials" / "it used the wrong account"
- "which persona breaks if I delete this key?"
- "store the connector config on the persona" / "add a field to `design_context`"

**If you are about to write** a `connectorName -> credentialId` map, a `credentialLinks` /
`connections` / `bindings` key inside a JSON column, a `.find(c => c.service_type === name)`, a
`creds.first()` / `.into_iter().next()` / `[0]` after a credential query, a `LIMIT 1` over candidate
credentials, a second `ROLE_SYNONYMS`-style alias table, or a `hasCredential` boolean on a card —
**you are in this situation.**

**You are especially in it when you are about to add a field to a struct that is already serialized
into a TEXT column**, because that is the edit that silently invalidates every binding already
stored beside it (§0.1).

---

## 2. The one way

**Store the binding as a row, not as a key in a blob; resolve it through one function that returns a
three-way answer; and never let a failed resolution fall back to a different credential.**
Concretely: (a) **give the binding its own table** — `(owner_id, slot, credential_id)` with a real
foreign key and `ON DELETE` semantics you chose on purpose — so a deleted credential is a database
event rather than a discovery at run time. (b) **Make resolution total and three-valued**:
`Bound(id) | Ambiguous(candidates) | Unbound`, never `Option`, because `None` collapses the two
answers a user needs to tell apart. (c) **Refuse to guess on 2+ candidates** and surface the
candidates — the authority in this repo already does this and states why; the job is to put it on
the runtime's path rather than to write it again. (d) **When a binding does not resolve, resolve to
nothing** — an injected wrong credential is a worse outcome than an absent one, and a fallback that
is *wider* than the binding is how that happens. (e) **Declare the slot in exactly one vocabulary**
and, if a second exists for display, make the translation one named total function called with the
field it was named for. (f) **Compute every readiness surface from the resolver**, and if you must
cache the verdict, write the verdict and its account in one statement so a badge can always say what
is blocking. (g) **Record the resolved binding on the execution** at the moment of use. (h) **Never
put a binding inside a serialized envelope with unrelated fields**; if it is already there, read it
by key defensively *and* fix the field that breaks the parse, because the defensive read only helps
the reader that has it.

If you must get one right first: **(a)**. Every other clause is cheaper once the binding is a row —
(b) and (c) become a query, (d) becomes a `NULL`, (f) becomes a join, and (h) stops being a question.

---

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
|---|---|
| `commands/design/connector_readiness.rs:923-967` `resolve_one_credential` | **The authority, and the one correct cardinality rule in the repo.** `if exact.len() == 1 { Some } if exact.len() > 1 { None }`, then the same for the category match. Its doc comment (`:919-922`) is the sentence to copy: *"Returns None when there is no candidate OR more than one — an ambiguous bind must be a user choice, not a guess."* **Copy the refusal, and note it is not on the runtime path (§7 D2).** |
| `commands/design/connector_readiness.rs:976-983` `resolve_ready_credential` | The liveness refinement layered *on top of* the bind rather than mixed into it — bindable and usable are two questions and this keeps them two. The comment records the bug that earned it (*"bug-hunt 2026-06-07 #4"*). |
| `commands/core/persona_icon_gen.rs:108-118` | **The exemplar for the ambiguous case.** `for cred in cred_repo::get_by_service_type(&state.db, connector)?` — it collects *every* candidate into a `Vec<ImageGenCredential>` and lets the caller choose. Nine sites on the runtime path take element zero; this one does the thing they should. |
| `commands/design/connector_readiness.rs:1089-1109` `resolve_credential_links` | The **writer** of the binding map: classifies first, skips non-`Credential` connectors, and leaves a slot unbound rather than guessing. Correct — it just runs at build time only. |
| `commands/design/connector_readiness.rs:837-912` `recompute_setup_for_credential_dependents` + `credential_dependent_persona_ids` | The invalidation hook, and the only place that treats `credentialLinks` as a first-class index — it parses the JSON and confirms the id appears as a *value*, not an incidental substring. |
| `commands/design/connector_readiness.rs:758-764` `persona_live_blockers` | Recomputes from current state and explicitly refuses to trust the column. **Gate on this.** |
| `core/src/models/connector.rs:240-260` `classify_connector` + `:124` `GLOBAL_PROBE_CONNECTORS` | The three-class model that lets `codebase` mean *a project*, not *a credential*. The client has no concept of the third class (§7 D4). |
| `engine/runner/mod.rs:1167-1179` | **The defensive raw-JSON read of a binding**, with the incident in the comment. Copy the technique; **do not copy the stated cause, which is wrong (§0.1)**. |
| `engine/runner/credentials.rs:753-765` | Re-reads the credential *inside* the per-credential lock, so a binding resolved at injection time sees a concurrent refresh. This is why resolve-at-use is achievable here. |
| `db/src/repos/resources/credentials.rs:230` + `db/src/macros.rs:185` | Both credential list paths carry `ORDER BY created_at DESC`. Determinism is real — **it is what makes the arbitrary choice reproducible and therefore invisible** (§0.5). |
| `hooks/design/core/useDesignContextMutator.ts:156` `mutateCredentialLink` | The single client writer of a binding. All four live bindings are well-formed; the write path is not the problem. |

**Do not exist — this path names them:**

- **A binding table.** No `(persona, slot, credential)` row exists anywhere; the binding is a key in
  `design_context.credentialLinks`, a JSON object in a TEXT column, with no FK and no membership test.
- **A three-valued resolution type.** `resolve_one_credential -> Option<String>` collapses *no
  candidate* and *several candidates* into one `None`, which is why every caller that wants to be
  helpful re-derives the difference and gets it wrong.
- **Any consumer of the slot's `role` field**, on either side of the boundary.
- **Any enforcement of `required: false`** — 35 optional slots block execution.
- **Any record of which binding a run used.** No column, no log field, no table.
- **Any control that lists the ambiguous candidates to the user.** The server refuses the bind
  correctly and the refusal renders as `SetupKind::VaultCredential` — *"add the credential in
  Settings → Vault"* — advice that cannot fix a vault that already has two.

---

## 4. Steps

1. **Decide what the slot is keyed by, once, and write it into the schema.** A machine name, not a
   label. If templates emit a role vocabulary, translate it at the boundary with one total function
   and store the translated value.
2. **Create the binding table.** `(owner_id, slot, credential_id)`, unique on `(owner_id, slot)`,
   foreign key on `credential_id`. Choose `ON DELETE SET NULL` (the binding survives as *unbound*,
   which is the honest state) or `ON DELETE RESTRICT` (deletion is refused while bound). Do not
   choose `CASCADE` — that deletes the slot along with the credential.
3. **Write the resolution function and give it a three-armed return type** (below). One function.
   Everything else calls it.
4. **Put it on the runtime path first, and the display path second.** The runtime is where a wrong
   answer costs something.
5. **Make the ambiguous arm reach the user.** A `SetupKind` that says *"two credentials match — pick
   one"* with the candidates attached, not *"add a credential"*.
6. **Make the unresolvable arm inject nothing.** No fallback to first-of-kind. **And then stop** — do
   not add a "helpful" second lookup below it; that is the whole defect.
7. **Record the resolved binding on the execution row** at injection time. One column.
8. **Compute every badge, filter and card from the resolver.** If a verdict must be cached, write it
   and its structured account in one statement.
9. **If a binding must live in a JSON envelope, read it by key defensively at every reader** — and
   fix the field that breaks the strict parse, because the defensive read protects one reader and the
   broken field breaks all of them.

### Can the type make the wrong call impossible? — asked before §9

**Yes for the ambiguity half, decisively, and it is one enum. Partly for the storage half. No for the
envelope half, and P3 is why — which is exactly what §9 gates.**

**T1 — make "I could not decide" unrepresentable as "there is nothing".**

```rust
// today — connector_readiness.rs:923
fn resolve_one_credential(conn: &Connection, connector_name: &str) -> Option<String>;
//   None means "no candidate" at :966 AND "2+ candidates" at :943 — two different user situations.

// the fix
pub enum SlotBinding {
    /// Exactly one credential is bound to this slot.
    Bound(CredentialId),
    /// Several credentials could satisfy it. Carries them so the UI can ask.
    Ambiguous(Vec<CredentialId>),
    /// Nothing matches. The user must add one.
    Unbound,
}
fn resolve_slot(conn: &Connection, slot: &str) -> SlotBinding;
```

Held against the corpus's seven qualifications:

- **Q3 — count the construction sites.** `resolve_one_credential` has **2** callers
  (`resolve_ready_credential:977`, `resolve_credential_links:1104`); `resolve_ready_credential` has
  **1** (`connector_readiness:568`). Four edits, one file. **Passes comfortably** — and note it passes
  *because* the surface is tiny, which is also why the defect survived: the strict function is
  correct and almost nothing calls it.
- **Q5 — withholding beats requiring.** The load-bearing half. Do not *require* callers to check
  cardinality; **withhold the ability to express "nothing matched" when something did.** The dangerous
  freedom is a single `None` that two different remediations both have to guess at.
- **Q6 — withhold the dangerous freedom, not the answer.** `Ambiguous` still carries the candidate
  ids, so the picker can offer them. Withholding the candidate list would break the feature.
- **Q1 — a type carries only what it encodes.** `SlotBinding` encodes *how many credentials match*.
  It does **not** encode whether the matched credential is alive, whether the slot was ever declared,
  or whether the runtime honoured it. `resolve_ready_credential` stays a separate layer for exactly
  that reason, and §0.5's `email` case is a liveness failure this enum cannot touch.
- **Q2 — requiredness is orthogonal to closedness.** The return type is already non-optional in the
  sense that matters; **closing it into three arms is the entire win.**
- **Q4 — a type anyone can construct authenticates nothing.** A caller can return `Bound(id)` from a
  function that never counted. Real residue, and smaller than today's: the wrong arm is a line
  somebody wrote on purpose, and `Ambiguous` has no cheaper spelling.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.** This
  decides the runtime half. `runner/credentials.rs:494` calls `get_by_service_type(...).first()`
  **voluntarily** — nothing forces it, and no change to `resolve_one_credential`'s signature reaches
  it. **The fix there is withholding the construction**: make `get_by_service_type` return a
  `CandidateSet` whose only accessors are `exactly_one() -> Option<_>` and `all() -> &[_]`, with no
  `first()`. That makes all nine sites a compile error and makes the compliant exemplar
  (`persona_icon_gen.rs:111`) still compile unchanged.

**T2 — make the binding a row.** This is not a Rust type change, it is a schema change, and it is
what P1 asks for. It converts §0.4's "0 dangling because there are only four" into a real invariant,
gives §0.2's project pin a foreign key, and makes §0.1 irrelevant for bindings because they stop
living in the envelope.

**T3 — NO for the envelope, and this is where the type ends.** No Rust type prevents a struct field
from being serialized into a TEXT column and read back by a *different build* of the program. The
doctrine's fifth and sixth "where types cannot reach" items are both live here at once: the value is
inside a serialized blob (so no type reaches into it), and its writer and reader are different
builds (so the type the writer used may not be the type the reader expects). `connectorPipeline` is
the proof — the struct is well-formed, the column is well-formed, and they have never agreed. **A
tolerant `deserialize_with` on that one field would fix today's 63 and does nothing for the next
field somebody adds.** The durable answer is T2: take the binding out of the envelope.

**Propose T2 first (the schema, and it is the leaf), T1 second (four edits, the ambiguity lie), the
`CandidateSet` withholding third (nine sites), and §9's census rule as the ratchet that holds the
runtime path until they land.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A binding stored as a key in a JSON blob beside unrelated fields** | One sibling field with an unexpected shape discards every binding in the envelope, silently. **Measured: 63 of 78 personas, 63 of 63 project pins, 1 of 4 credential links.** §0.1 |
| **`Option<CredentialId>` as a resolution result** | *No candidate* and *several candidates* become one value, so every consumer re-derives the difference and picks differently. §0.5 |
| **`creds.first()` / `.into_iter().next()` / `[0]` after a credential query** | Binds a slot to whichever row sorted first. **9 sites; 69 slots on this install all resolve to the newest `codebase` credential, and adding a fourth re-points all 69.** §9 |
| **A fallback that is wider than the binding it replaces** | `runner/credentials.rs:455-480`: a link whose credential is gone falls *through* to first-of-service-type — re-introducing by deletion the exact bug the link was added to fix, with the fix's rationale still in the comment at `:408-422`. §7 D3 |
| **A readiness probe that is decoupled from the binding** | `has_dev_project` asks whether **any** active project exists; the pin says **which**. 14 projects, 7 pinned, one answer. §0.2 |
| **A declaration key with no reader** | `role` on 98 declarations, `required: false` on 35, `label` on 98 — all inert. Convergent with `sensitive` on 184 of 196 connector fields deciding encryption at rest with no renderer reading it ([schema-driven-form](./schema-driven-form.md) §7.C). §0.3 |
| **A synonym table maintained on one side** | `ROLE_SYNONYMS` (25 keys, `connectorRunnability.ts:31`) vs `normalize_connector_role` (21, `connector_readiness.rs:232`). The four extra all map `codebase\|source_code\|vcs\|git → source_control`, which Rust deleted deliberately with the reason in the comment. §7 D4 — **and see §12.1: neither side reaches it.** |
| **`.find()` where the authority refuses** | `connectorRunnability.ts:147,:160` takes the first match where `resolve_one_credential` returns `None`. Live: the client displays **ElevenLabs**, a voice API, as satisfying `image_generation` on 7 slots. §0.5 |
| **A cached verdict without its account** | 29 personas at `needs_credentials`, 10 with a `setup_detail`, **1 `SetupBlocker` row in the whole database**. §0.6 |
| **Treating every declared connector as required** | `required: false` on 35 of 98 declarations, and `required_connectors` empty on all 78 — **every slot on this install is a suggestion enforced as a requirement.** §0.3 |
| **Injecting a credential the app has already diagnosed as dead** | `Product Scout (4)`'s explicit `email` link resolves to a grant that expired 75 days ago with 49 consecutive refresh failures. Server refuses; client shows satisfied; runtime injects. §0.5 |
| **Logging the count instead of the identity** | `runner/credentials.rs` records how many credentials were injected, never which. With `credential_consumer_edges` at 0 rows, no run's binding is recoverable. §0.7 |

---

## 6. Evidence

**The ONE site to copy: `src-tauri/src/commands/design/connector_readiness.rs:923-967`.**

```rust
/// Returns `None` when there is no candidate OR more than one — an ambiguous
/// bind (e.g. role `ai` with both ElevenLabs and Leonardo in the vault) must
/// be a user choice, not a guess. The build surfaces that as a
/// scope-clarifying question rather than picking arbitrarily.
fn resolve_one_credential(conn: &Connection, connector_name: &str) -> Option<String> {
    …
    if exact.len() == 1 { return Some(exact[0].clone()); }
    if exact.len() > 1  { return None; }          // ambiguous — user must pick
    …
    if by_category.len() == 1 { return Some(by_category[0].clone()); }
    None
}
```

Four things to copy: (1) **the cardinality test is explicit and comes before the bind**, not after;
(2) **the doc comment names a real ambiguous pair from this vault** (`ai` → ElevenLabs + Leonardo),
which is the case that is live today on 7 slots; (3) **it states what the system does instead of
guessing** — surface a question; (4) the two match rules are ordered and the second only runs when
the first found nothing, so precedence is a property of the function rather than of the caller.

**The one thing NOT to copy** is its return type: the two `None`s at `:943` and `:966` mean different
things and the difference is what §4 T1 recovers.

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `commands/core/persona_icon_gen.rs:108-118` | **The ambiguous case done right** — enumerate every candidate into a list the user chooses from, instead of collapsing to one. The compliant half of §9's partition. |
| `engine/runner/mod.rs:1167-1179` | **Reading a binding defensively out of a blob**, with the incident recorded at the site. Copy the technique, not the stated cause. |
| `commands/design/connector_readiness.rs:837-912` | **Treating a JSON binding map as an index** — parse it and confirm the id is a *value*, never a substring match on the blob. |
| `engine/runner/credentials.rs:753-765` | **Resolve at use, inside the lock.** What makes a per-run binding decision correct under concurrency. |
| `db/src/repos/resources/credentials.rs:1264-1275` | A write-shape autopsy at the site of its own fix — the model for how to record why a primitive was replaced. |

### Convergence — 5 sibling repos, effective cohort 2

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. All five exist and all five were opened.

**Denominator discipline, and it removes three.** `personas-cloud` is an **explicit port** — four
*"Ported from desktop …"* docstrings (`eventProcessor.ts:30`, `triggerScheduler.ts:87`,
`prompt.ts:268`), `types.ts:2` *"mirroring desktop Tauri models"*, and the column name
`requires_credential_type` verbatim. `personas-web` has **no credential domain at all** — no schema,
no ORM, no persistence; its rotation UI self-declares as a port over static mock data
(`mock-dashboard-data.ts:1688-1690`). `vibeman` has **no credential table** — its only secret store
is a singleton `remote_config` row. **Independent cohort with a credential-slot concept: 2 —
`brainiac` and `ascent`.** `vibeman` is retained for clause 6 only, where a config *is* the thing
being bound.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **A binding record naming (owner, slot) → credential exists** | **1 of 2 — and it is the cleanest design in the sweep** | `brainiac/migrations/0020_kb_publishing.sql:32-33` — `-- The NAME of the env var / vault key holding the token. Never the token.` / `secret_ref text,` on `publish_targets(org_id, kind)`. The binding is an explicit named reference on the owning row. `ascent` has **no slot dimension**: `prisma/schema.prisma:746` `@@unique([orgId])` means one config per org, so there is nothing to choose between. **Personas has the concept and stores it in a blob.** |
| 2 | **Ambiguity is refused rather than guessed** | **2 of 2 — but by avoidance, which is itself the finding** | Neither sibling can have two candidates: `brainiac` resolves one `secret_ref` per target (`publish/src/lib.rs:133-136`); `ascent` does `findUnique({ where: { orgId } })` (`db/org-llm.ts:91`). **Nobody in the fleet solved the ambiguity problem, because nobody built a system that can have it.** Personas is the only repo where a user can own three credentials of one kind — and it is the only repo with a function that refuses correctly. **Personas is ahead on the rule and behind on its reach.** |
| 3 | **Candidate ordering is deterministic** | **2 of 2 where applicable** | `brainiac/store/src/publishing.rs:52-53` `ORDER BY created_at`; `vibeman/lib/remote/config.server.ts:32` `ORDER BY created_at DESC LIMIT 1`. Personas also orders (`macros.rs:185`). **Convergent, and it is the least valuable of the clauses** — every repo made the arbitrary choice reproducible, which is what stops anyone noticing it is arbitrary. |
| 4 | **A binding that cannot resolve fails closed** | **2 of 2 — PHYSICS, and the fleet is AHEAD of Personas** | `brainiac/publish/src/lib.rs:133-139` errors with the binding named: `.context("confluence target has no secret_ref naming its PAT env var")?` and `format!("env var \`{secret_ref}\` (this target's PAT) is not set")`. `ascent/src/lib/llm/index.ts:218-233` removed its fallback and wrote a paragraph saying why — *"FAIL CLOSED: when BYOM is still active but unresolvable, throw a clear, actionable error rather than falling back to the platform"*, explicitly naming the conflation of "not configured" with "configured but unresolvable". **That is P4, discovered independently, in another language, with the reasoning written down. Personas falls through to a different credential.** |
| 5 | **One vocabulary from declaration to binding** | **2 of 2 clean; the PORT is the counter-example** | `brainiac`: `secret_ref` is the env var name verbatim, no synonym map. `ascent`: one `provider` discriminant, kept honest by a discriminated union (`org-llm.ts:55-57`). `personas-cloud` — the port — declares on `serviceType` (`httpApi.ts:2236`) and binds on `name` (`dispatcher.ts:695`, `` `CONNECTOR_${cred.name.toUpperCase()…}` ``), so a persona reads configured while the tool's expected env var never exists. **The port inherited the two-vocabulary problem and made it worse; Personas has six vocabularies and reads one.** |
| 6 | **Readiness is computed by the code that resolves** | **1 of 3 — and the one that got it right did it by not having a second surface** | `brainiac` has **no separate readiness surface**: `publisher_for` is the only place that asks. `ascent` has two (`org-llm.ts:77` `hasCredentials: Boolean(c.credentialsEncrypted)` vs `resolveByomProvider:239`) but bridges them with a stamped test-connection result (`recordOrgLlmValidation:186-195`, and `:153-154` *"A new credential invalidates any prior validation result."*) so "ready" degrades to "unvalidated" rather than lying. `vibeman` has two that read different sources (`config.server.ts:148` DB vs `:155` env-first) and they disagree. **The physics: the number of readiness implementations should be zero or one, and the repo with one code path has nothing to measure.** |
| 7 | **A typed envelope's parse failure is loud** | **1 of 2 loud, 1 of 2 lossless — Personas is alone in being both silent AND lossy** | `brainiac` errors with context: `serde_json::from_value(config.clone()).context("confluence target config")?` (`publish/src/confluence.rs:40`, `git.rs:50`). `ascent` returns `null` on a parse failure (`org-llm.ts:264-267`) but checks every field first, so nothing is silently dropped — only the *reason* is lost, and its caller re-checks (clause 4). `personas-cloud` — the port — has a `catch` that **renames the env var** (`dispatcher.ts:712-721`), which is the same disease. **Personas discards nine sibling fields on one bad element and reports nothing.** |
| 8 | **Something records which binding was USED** | **1 of 2 — and the minority is right** | `brainiac/migrations/0020_kb_publishing.sql:41-53` `document_publications` records `target_id` + `revision_id` + `external_ref`, described at `:17-20` as *"the ledger that lets a publish be idempotent … and lets an operator prove what left the building."* `ascent` records `Scan.engineProvider` / `engineModel` (`schema.prisma:302-303`) — partial. `personas-cloud` declares `last_used_at` (`db.ts:286`) and `credentialIds` (`types.ts:255`) and **writes neither**. **Personas: nothing, at either layer — which is `BrokerGrant`'s 0-against-9,431 one level down.** |

**Physics — keep as doctrine:** clauses 4, 6, 7 and 8. **Personas is AHEAD** on exactly one thing and
it is real: it is the only repo in the fleet that *has* the ambiguity problem and the only one with a
correct refusal for it (clause 2). It is **behind** on everything that happens after a binding fails
to resolve.

### The composition defects with the neighbouring paths — offered upward

**(i) with [`credential-readiness-resolution`](./credential-readiness-resolution.md).** Its §2 says
*"Ask the resolver. Never re-derive the answer"* and its §7 A lists five binding rules that do. That
is right and it is not sufficient here: **the runtime injector is a sixth, it is not in that list,
and it is the only one whose answer is loaded into a subprocess's environment.** Following that
path's prescription — route every surface through `connector_readiness` — leaves the nine
`get_by_service_type(...).first()` sites untouched, because they are not surfaces. **The clause both
paths need: the resolver must be adopted by the code that ACTS before the code that DISPLAYS.**

**(ii) with [`client-rule-mirroring`](./client-rule-mirroring.md).** Its §2 (b) prescribes *fetch the
value at startup instead of copying it*. Applied to slot binding that would have the client fetch the
resolver's verdict — correct, and it would have made §0.5's 8 disagreements zero. But its census rule
keys on *"the comment that says so"*, and **the runtime injector carries no such comment**, so the
gate that enforces the prescription cannot see the copy that matters most. Its own §7 D2 measures the
client mirror; this leaf measures the third implementation neither of them names.

**(iii) with [`entity-picker`](./entity-picker.md).** Its P4 — *a chooser must be able to say "the
thing you chose is gone"* — is exactly what §7 D3 needs, and its `.some(x => x.id === value)`
membership idiom (50 sites in 38 files) is the client-side answer. **The Rust half has no equivalent
and no picker**: `runner/credentials.rs:455-457` asks `get_by_id(...).ok()` and treats the error as
"try something else". Same condition, opposite layer, and the good idiom did not cross.

**(iv) with [`schema-driven-form`](./schema-driven-form.md).** Its P10 — *a declaration may carry a
key that decides a security property and the renderer will not know* — generalises here past
rendering: **`role`, `required` and `label` are keys on a declaration whose only consumer ignores
them.** Its prescribed test (*ask, of every key in the declaration, which consumer reads this*) is the
right instrument for §0.3 and costs one query.

---

## 7. Deviations

Every entry is live on `master` @ `6c97502d3`, verified by reading the file and — where a number is
quoted — by replay against a read-only copy of the operator's database. All ship green under
`npm run check` and a green census. **Per the campaign's no-destructive-applies rule, nothing here
was applied — this leaf touches real credentials and the app is in daily use.**

> **Second pass — what is upstream of all of this.** Every entry reduces to one omission: **the
> binding has no identity.** It is not a row, it has no key constraint, it has no type, and nothing
> records it being used. Once that is true, `parse_design_context` can drop it without anyone
> noticing (D1), the runtime has nothing to honour so it guesses (D2), the guess needs a fallback so
> the fallback is wider than the binding (D3), and four surfaces re-derive it because there is
> nothing to read (D4). **D1 and D2 are the two halves of the same missing row**, and T2 is the edit
> that makes every other entry addressable.

### P0 (A) — the typed envelope cannot parse 63 of 78 `design_context` columns · **executed**

`core/src/models/persona.rs:711` `parse_design_context`. Typed branch errors at
`connectorPipeline[0]` for 63 personas; falls to the legacy branch at `:740`, which reads
`credential_links` (snake) where the data writes `credentialLinks` (camel), and never reads
`dev_project_id`, `twin_id`, `connector_pipeline`, `archetype_id` or `memory_strategy_id` — its own
comment at `:719-724` says so. Full replay in §0.1.

Three facts with no defence:

- **`ConnectorPipelineStep` (`:458`) has never matched its data.** 154 live elements, all bare
  strings, 0 satisfying. The `ts-rs` binding (`src/lib/bindings/ConnectorPipelineStep.ts`) is
  generated correctly from a struct nothing writes.
- **The comment at `runner/mod.rs:1167-1171` blames "extra/loosely-typed fields".** Measured false:
  the struct has no `deny_unknown_fields`, and all three `typed`-parsing personas carry `builderMeta`.
- **Five of six readers still take the typed path.** `team_context.rs:247`, `:354`, `twin.rs:261`,
  `team_assignment_matching.rs:92`, `management_api.rs:1579`. `twin.rs:261-264` reads
  `credential_links["twin"]` through it — **the explicit-binding path is disabled for exactly the
  personas whose envelope fails.**

**Fix (note):** the minimum is a tolerant `deserialize_with` on `connector_pipeline` accepting a
string or a struct; the durable fix is T2 — bindings stop living in the envelope. Do **not** "fix" it
by writing well-formed `ConnectorPipelineStep`s into the 63 columns: that repairs today's data and
leaves the next added field with the same trap.

### P0 (B) — the runtime binds by taking the first candidate, nine times · **executed, 9 sites**

`get_by_service_type(...)` has **12 call sites**; **9** reduce the candidate set to element zero
(`engine/runner/credentials.rs:214`, `:289`, `:299`, `:494`, `:527`;
`engine/build_session/tool_tests.rs:343`; `gitlab/converter.rs:68`;
`commands/companion/approvals/approval_exec_core.rs:1089` and `companion/jobs/connector_use.rs:69`,
the last two spelled `.into_iter().next()`). The authority that refuses at 2+ candidates
(`connector_readiness.rs:939-944`) is on **none** of them.

Live: `service_type = 'codebase'` has 3 credentials; 69 of 117 slots name that connector; all 69
resolve to `0da023d9` because it is the newest. §0.5. **§9 is the ratchet for this entry.**

### P0 (C) — a link that fails to resolve falls through to a *different* credential

`engine/runner/credentials.rs:455-480`:

```rust
let linked_cred = credential_links
    .get(&name_lower)
    .and_then(|cred_id| cred_repo::get_by_id(pool, cred_id).ok());
if let Some(cred) = linked_cred { … continue; }
// No explicit link — fall back to catalog connector lookup, then
// direct service_type lookup (matches the old behaviour).
```

There is one arm. A deleted credential, a mistyped id and an absent link are the same input, and all
three fall to `creds.first()`. The comment 40 lines above (`:408-422`) records that this fallback
*was the bug*: *"when a persona had multiple credentials of the same service type … this function
always picked `creds.first()` — which often wasn't the credential the user explicitly linked … the
runtime would inject the wrong account's tokens."* **Deleting the linked credential re-arms the
documented bug, silently, and the app already knows how to recompute dependents on delete
(`crud.rs:276`) — it just recomputes a `setup_status` nobody gates on.**

**Fix (note):** a dangling link must resolve to nothing and produce a blocker, never to another
credential.

### P1 (D) — four client resolvers, three server paths, one question · **8 of 117 disagree**

Beyond the five client rules [credential-readiness-resolution](./credential-readiness-resolution.md)
§7 A enumerates, this leaf measures the outcome on live data. `connectorRunnability.ts:118`:

- **no cardinality test** — `.find` at `:147` and `:160` where `resolve_one_credential` returns
  `None`. Live: 7 `image_generation` slots render **ElevenLabs** (a voice API) as satisfying image
  generation, while the server blocks the persona.
- **no usability test** — never calls anything like `credential_is_usable`. Live: 1 `email` slot
  renders the Gmail grant that expired 75 days ago as satisfied.
- **a dangling link falls through** (`:138-144`) into the service-type and category rules, so a
  broken binding silently displays a different credential — the client mirror of D-C.
- **no concept of `GlobalProbe`.** `classify_connector` returns a third class the client cannot
  represent; `BUILTIN_LOCAL_CONNECTORS` (`:79`) hardcodes 4 names where the server derives 6 from
  connector metadata.
- **`ROLE_SYNONYMS` has 25 keys against the server's 21** (`:31` vs `connector_readiness.rs:232`),
  the four extra being `codebase|source_code|vcs|git → source_control`, which Rust removed
  deliberately (`:229-231`). **See §12.1 — measured, this one is unreachable on both sides, and the
  8 live disagreements come from the two rules above instead.**

### P1 (E) — the persisted verdict disagrees with a live recompute on 24 of 78 personas · **executed**

§0.6. 22 personas are filtered out of the team-member picker (`teamStudioShared.tsx:128`) while a
live recompute says they are fine; 2 render as ready and would be blocked at
`executions.rs:222-250`. And **29 personas are at `needs_credentials` with 1 `SetupBlocker` row
between them** — the account that would say *why* exists for one persona in the entire install.

### P1 (F) — the slot declaration carries three keys nobody reads · **98 of 117**

`role` (98), `label` (98), `required` (98 — **35 of them `false`**). Zero readers each.
`normalize_connector_role` is called with `name`, which differs from `role` on **91 of 98**. §0.3.

The `required` half is the one with a user-visible cost: a design that marked 35 connectors optional
has them enforced as mandatory, and `required_connectors` — the list that *is* meant to be mandatory
— is empty on all 78 personas.

### P2 (G) — the codebase probe answers a different question from the codebase pin

`has_dev_project` (`connector_readiness.rs:263-270`) returns true if **any** of 14 active projects
exists; `design_context.dev_project_id` names **which** of 7. The verdict cannot fail while the
binding is wrong, which is the worst combination: it is never a blocker and never correct. Add the 63
lost pins (D-A) and 18 dangling ones (§0.2) and the connector reports Ready for every persona while
the repo it reads is decided by whichever `Codebase` credential is newest.

The fallback below it is also unordered — `team_context.rs:250-258`,
`SELECT id FROM dev_projects WHERE team_id = ?1 LIMIT 1` with no `ORDER BY`. **Currently inert: all 5
teams with projects have exactly one**, so the ambiguity is latent rather than live.

### P2 (H) — the slot namespace is unvalidated free text

`all relevant sources` is a live slot on `Visual Brand Asset Factory (3)` — an LLM-authored English
phrase that became a connector name, is classified `Credential`, resolves to nothing, and blocks the
persona at the run gate. Nothing validates a declared slot against `connector_definitions`, and
`persona_declared_connectors` (`:686-693`) only trims and de-duplicates. A slot that names no
connector is indistinguishable from one whose credential is missing, and both render as *"add the
credential in Settings → Vault"*.

### P2 (I) — the ambiguous refusal renders as advice that cannot work

`resolve_one_credential` returning `None` on 2+ candidates produces
`SetupKind::VaultCredential` → *"add the credential in Settings → Vault"* (`:104`). For the 7
`image_generation` slots the vault already has **two** matching credentials; adding a third makes it
worse. The information the user needs — *which two, pick one* — is computed at `:949-962` and
discarded by the `Option`. This is T1's user-facing half.

### P3 (J) — small, live, one line each

- **`resolve_credential_links` runs only at build time** (`build_sessions.rs:2862`), so a credential
  added after a persona is built never becomes a binding, only a lucky match.
- **`credentialLinks` keys are case-normalised on read and not on write** — the runtime lowercases
  the map (`credentials.rs:428`), the client tries exact-then-lower (`connectorRunnability.ts:138`),
  and `resolve_credential_links` inserts the connector's original case (`:1105`). Currently harmless:
  all 4 live keys are already lowercase.
- **`T: QA Guardian`'s `design_context` carries both `useCases` and `use_cases`.**
  `pick_use_cases_array` (`engine/src/design_context.rs:36-40`) prefers snake and the two are not
  asserted equal anywhere.
- **`persona_tool_definitions.requires_credential_type` is a seventh slot vocabulary** with 3 live
  rows and its own client resolver (`useConnectorStatuses.ts:32`), joined to nothing.
- **`credential_consumer_edges` has 0 rows and no FK** — the table that would answer §0.7 exists and
  nothing writes it (also recorded in
  [credential-rotation-and-revocation](./credential-rotation-and-revocation.md) §0.5).

---

## 8. Gaps

**Gap 1 — There is no binding entity, so no instrument can be built on one.** Not a table, not a
type, not an id. Every measurement in this document had to reconstruct the binding from a JSON key,
and every consumer in the app does the same. A `persona_credential_bindings(persona_id, slot,
credential_id)` table would make §0.4, §0.2 and §0.7 queryable and would let the census gate a
*relation* instead of a call shape. **Every deviation except D-E and D-I is downstream of this.**

**Gap 2 — The census can count a call shape; it cannot see that a declaration key has no reader.**
§0.3's finding — `role` populated on 98 declarations with zero consumers — was found by enumerating
the keys in the data and grepping for each. No regex relates a JSON key in a database column to the
absence of a reader in another language. The instrument that owns this is a **test that enumerates
every key present in the live declaration corpus and asserts each is named somewhere in the tree** —
the same shape [`schema-driven-form`](./schema-driven-form.md) P8 specifies for renderer coverage,
and equally inexpressible as a count.

**Gap 3 — Nothing can express "this slot is optional".** `required` is declared and ignored, and
`missing_connectors` has no notion of severity, so a suggestion and a requirement produce the same
blocker. Until `Readiness` carries it, the honest options are to stop emitting `required: false` or
to stop blocking on the suggested list — and both are behaviour changes.

**Gap 4 — `SetupKind` has no `Ambiguous` arm.** Six arms cover "you never set this up". The case
where the user set it up *twice* has no arm, so the correct refusal at `connector_readiness.rs:943`
renders as advice to add a third credential (D-I). One enum variant plus one i18n key, and it is
blocked behind T1 because the candidate list is thrown away before the arm could carry it.

**Gap 5 — The `Option` that loses the ambiguity is thrown away one frame below where it is known.**
`resolve_one_credential` counts the candidates at `:939` and `:963` and returns a value that cannot
express the count. Everything downstream — the blocker, the badge, the picker, the runtime — is
reconstructing information the function had and discarded. That is T1, and it is the cheapest
high-value edit in this document.

**Gap 6 — The census rule keys on one repository function name, and the doctrine's warning applies
directly.** *A vocabulary-based signal's recall is bounded by its author's word list.* A future
`get_candidates_for_slot`, `find_credentials_by_role` or a raw `SELECT … LIMIT 1` is invisible to §9
until someone adds it. I mitigated this by taking the anchor from the **repository layer's actual
export**, by **enumerating every call site of it** rather than searching for the shape I expected —
which is how the two `.into_iter().next()` sites were found after a first pass reported 7 — and by
making the positive control share the identical anchor so a stale anchor degrades both halves
symmetrically. The recall bound is real and an adopting repo must re-derive its own.

---

## 9. The missing gate

**The condition to enforce:** *a capability slot is bound to a concrete credential by taking one
element of a candidate set without asking how many candidates there were, so an ambiguous binding is
silently resolved to whichever record sorted first and the choice is invisible.* Not "the binding is
missing" (that is Gap 1, a schema change); not "the readiness verdict has no account" (that is
[credential-readiness-resolution](./credential-readiness-resolution.md)'s `detached-readiness-verdict`);
not "the declaration key has no reader" (Gap 2, a test). **The one thing in this leaf that is a
countable call shape and that this repo gets wrong nine times on the path that actually injects
secrets.**

### The condition, stack-free

> **A binding is made by picking, and the picking does not count. The system therefore cannot
> distinguish "this credential is the one" from "this credential is the first one", and because the
> ordering is deterministic the wrong answer is stable and nobody reports it.**

There is no runtime signal. The chosen credential works, or fails in a way that looks like the
credential's fault. §0.5 is what it looks like from outside: 69 personas pinned to 7 different repos,
all injected with the same credential, and every surface green.

### Existing rules checked first

I read all **167** rules in `scripts/census/rules.json`. **83** can reach a `.rs` file under
`src-tauri`. Every one of the 83 was **replayed over the same file list** and intersected against my
**final** pattern at `file:line` (±1 line for attribution differences):

| | value |
|---|---:|
| registry rules total | 167 |
| …that can reach a `.rs` under `src-tauri` | **83** |
| …sharing at least one **file** with my pattern | **11** |
| …sharing at least one **site** | **0** |

The eleven file-sharers, all at zero sites: `unqueryable-log-record` (2 files),
`persistence-handle-in-command-tree`, `hand-rolled-emptiness-refusal`, `unverified-effect-dispatch`,
`redirect-portable-credential-header`, `unkeyed-billable-spawn`, `anonymous-deadline`,
`ledger-field-addressed-by-string-key`, `unbounded-foreign-decode`, `version-only-build-stamp`,
`adhoc-statement-verb-vocabulary` (1 each). File overlap is expected —
`engine/runner/credentials.rs` is a busy file — and it is not overlap.

The three nearest by **subject** are disjoint by construction: `detached-readiness-verdict` matches an
`UPDATE` over `personas` and asks whether a verdict carries its account;
`ledger-field-addressed-by-string-key` matches a credential-ledger field name and asks whether a typed
record was bypassed; `missing-current-entity-rendered-as-unset` ([entity-picker](./entity-picker.md))
matches a TS `.find(x => x.id === v)?.name ??` and asks whether a chooser can say a record is gone.
**This asks whether a binding was made without counting the alternatives.**

### Signals I designed, measured, and rejected

| Candidate | Result | Why rejected |
|---|---|---|
| **a slot/binding key addressed by a raw string literal** (D-A's mechanism) | **45 matches / 20 files** in Rust; **99 / 42** in TS | The right *concept* and the wrong *instrument*: `.get("credentialLinks")` at `connector_readiness.rs:895` is the **compliant** defensive read, and so is `runner/mod.rs:1173`. The pattern cannot separate "reaching into a blob because there is no type" from "reaching into a blob **because the type is broken**", and after D-A the second is correct. A gate that fires on the workaround is worse than none. |
| **`Option<...>` returned from a resolve function** (T1's shape) | no regex form | Requires knowing that the two `None`s mean different things, which is a fact about the call sites, not the signature. **Carried as T1.** |
| **a `Vec<T>` element type with required fields inside a `#[serde(default)] Option<Vec<T>>`** (D-A) | **not countable** | The defect is a relation between a struct definition in one crate and the *live contents of a database column*. No pattern spans that. **Gap 1's schema change removes it; the interim instrument is a test that round-trips every live `design_context` through `parse_design_context` and asserts the typed branch is taken — which is a test, not a rule.** |
| **client `.find(c => c.service_type === …)`** (the TS half of the shipped condition) | **11 matches / 10 files** | Hand-opened all 11: **2 are false positives** — `CredentialTemplateForm.tsx:146` and `ReauthBanner.tsx:141` search a static **CLI-spec array**, not credentials. 9 of 11 = 82 %. Tightening the receiver to `credentials` would be a word list chosen from imagination, which the doctrine warns distorts both ends of the measurement. **Declined, with the count.** |
| **the shipped rule — a credential candidate set reduced to element zero** | **9 / 5 files, 9/9 hand-verified** | **Shipped.** The compliant half is 3 in 3 files and 9 + 3 = 12 = the whole anchor. |

### The signal, and its precision

**9 matches in 5 files. All 9 hand-opened. Precision 9/9.**

| site(s) | what it binds | why violating |
|---|---|---|
| `engine/runner/credentials.rs:494` | a `design_context` slot with no explicit link | The main injection fallback. **69 `codebase` slots and 22 `github` slots reach production through this line.** |
| `engine/runner/credentials.rs:527` | a catalog connector's credential | `inject_connector_credentials`, called from the branch above and from the tool pass. |
| `engine/runner/credentials.rs:214`, `:289`, `:299` | a tool's `requires_credential_type` | The tool-driven pass. `:299` binds the seventh slot vocabulary (§7 J). |
| `engine/build_session/tool_tests.rs:343` | a connector under test | The build-session tool test binds by first-of-kind, so a test can pass against a different credential than the run will use. |
| `gitlab/converter.rs:68` | a GitLab connector | Same shape, different feature. |
| `commands/companion/approvals/approval_exec_core.rs:1089`, `companion/jobs/connector_use.rs:69` | a connector named by an approval / a companion job | **Spelled `.into_iter().next()`.** Byte-identical defect; invisible to a `.first()`-only pattern. |

**The two `.into_iter().next()` sites are the ones worth defending**, because they are why the anchor
was enumerated rather than searched. A first pass keyed on `.first()` reported **7**, and 7 is what I
would have published if I had looked for the shape I expected instead of listing every call site of
the function. The doctrine's *"fixing every instance of a defect is not the same as covering every
place that needs the behaviour"* has a smaller cousin: **searching for a spelling is not the same as
enumerating an anchor.**

### The positive control — it partitions the anchor exhaustively

The anchor is "a credential-candidate collection obtained from `get_by_service_type`". The rule
matches the half reduced to element zero; the control matches the half used as a collection — same
root, same extension, same 963-file walk.
**9 + 3 = 12 = the whole anchor call-site population** (13 occurrences minus the definition at
`db/src/repos/resources/credentials.rs:220`), with **zero shared `file:line`**.

```
  rule                                              files   base  matches   base  walked  floor
  OK  slot-bound-to-first-candidate                     5      5        9      9     963    700
  OK  slot-bound-to-first-candidate-positive-control    3      —        3      —     963    700
```

The three compliant shapes, all hand-opened: **enumerate every candidate for the user** —
`commands/core/persona_icon_gen.rs:111`, which is §6's exemplar; **ask only whether any exists
without binding one** — `engine/src/capability_contract.rs:278`, `Ok(creds) if !creds.is_empty()`;
**iterate the whole set to act on all of it** — `engine/mcp_tools.rs:2361`. **So the rule
discriminates on whether the collection was counted, not on "files that query credentials"** — a
vocabulary-keyed rule with no reduction test would report all 12.

### Verified by a second independent implementation — and the two disagreed

The verifier is a private file-content walker with its own directory traversal, its own quote-state
comment stripper (URL-safe, and it **preserves newlines** — the doctrine's own line-number trap), its
own brace-matched `#[cfg(test)]` excision and its own regex assembly, importing nothing from
`scripts/census/lib/engine.mjs`.

- **First run: the two implementations disagreed, 7 vs 9, and the disagreement was the finding.** My
  first pattern keyed only on `.first()`. Enumerating the anchor exhaustively surfaced
  `.into_iter().next()` at two sites. Both implementations then reported **9 / 5** with identical
  membership and identical line numbers.
- **A second, smaller correction, recorded because it nearly shipped.** The first draft bounded the
  gap after the call with `[^;]{0,240}`, which keeps a match inside one statement — and **misses
  `gitlab/converter.rs:68` and `runner/credentials.rs:527`**, where a `;` separates the query from the
  reduction. Widening to a bounded `[\s\S]{0,200}` recovers both; all 9 were then hand-opened to
  confirm none ran into an unrelated reduction.

### Fail-loud properties — executed, exit codes captured directly, never through a pipe

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 1926 file-visits, 12 surviving violation(s) across 8 file(s)` |
| baseline deflated (a rise) | **1** | `[drift] matches rose …` |
| baseline inflated (a silent drop) | **1** | `[drift] … dropped … without the baseline moving` |
| `floor` raised to 9000 | **1** | `[structural] walked 963 files but floor is 9000` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 700` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 700` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath" …` |
| **CONTROL given a baseline** | **1** | `must NOT carry a baseline — it exists to fail` |
| **CONTROL pattern → a token appearing nowhere** | **1** | `[structural] matched zero files anywhere` |
| **shared ANCHOR broken in BOTH halves** | **1** | `[structural] matched zero files anywhere` |

**The control's limit, stated rather than hidden.** A rule with no baseline cannot drift, so
repointing the control at the violating form exits 0. Its liveness guarantee is that it **fails
structurally on zero matches**, which is what the last two rows verify: a broken control pattern and
a broken shared anchor both exit 1. It is expected to **rise** as the 9 violations are converted,
which is exactly why it must never be baselined.

### Where this runs

`npm run census:check` — a step of **`npm run check`** (the PR self-review ritual in
`.claude/CLAUDE.md`) **and** the `golden-path-census` **pre-push** lefthook job. **Deliberately not
CI-only:** per the brief's calibration `ci.yml` is red on 10 pre-existing failures, so a CI-only gate
would run nowhere.

### How this gate could still fail, stated so the next repo can re-derive it

The signal keys on **one Rust repository function name** and **three Rust reduction idioms**. A repo
that binds a slot with `SELECT … LIMIT 1`, an ORM `findFirst`, a JS `.find(`, or a Python `[0]` will
**match nothing while the condition is present at scale** — the exact portability failure
`golden-path-contract.md:34-60` documents, and the client half measured here (9 of 11 sites, declined
above) is proof the condition already wears a second costume inside this very repo. And per Gap 6 the
anchor bound is real. **An adopting repo must re-derive its own proxy and should check the positive
control's population before trusting a green run.**

```json
{
  "id": "slot-bound-to-first-candidate",
  "goldenPath": "docs/concepts/golden-paths/credential-slot-binding.md",
  "title": "A capability slot is bound to a concrete credential by taking one element of a candidate set without asking how many candidates there were",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\bget_by_service_type\\s*\\([^;{}]{0,160}?\\)[\\s\\S]{0,200}?(?:\\.first\\(\\)|\\.into_iter\\(\\)\\s*\\.next\\(\\)|\\.iter\\(\\)\\s*\\.next\\(\\)|\\[\\s*0\\s*\\])",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A credential-candidate collection - every stored credential sharing one service_type - is reduced to a single binding by taking element zero, with no test of how many candidates there were. PROXY FOR the stack-free condition: a capability slot is bound to a concrete credential by picking one of several without asking how many were eligible, so an ambiguous binding is silently resolved to whichever record sorted first and the choice is invisible to the user, to the surface that displays readiness, and to any later audit. THE PARTITION IS EXHAUSTIVE: get_by_service_type has 12 call sites (13 occurrences minus its own definition at db/src/repos/resources/credentials.rs:220); this rule matches the 9 that reduce, the positive control matches the 3 that do not, and 9 + 3 = 12. THREE SPELLINGS OF ONE DEFECT, all matched deliberately: `.first()` (7 sites), `.into_iter().next()` (2 sites - commands/companion/approvals/approval_exec_core.rs:1089 and companion/jobs/connector_use.rs:69), and indexing. An earlier draft keyed only on `.first()` and reported 7; the two `.into_iter().next()` sites are byte-for-byte the same defect and were found only by enumerating every call site of the anchor rather than searching for the shape I expected. WHY IT IS A DEFECT AND NOT STYLE, MEASURED BY REPLAY 2026-08-17 against a read-only copy of the operator's live 347 MB personas.db: the authority for this question, resolve_one_credential (commands/design/connector_readiness.rs:923-967), DELIBERATELY REFUSES to guess - `if exact.len() == 1 { return Some(..) } if exact.len() > 1 { return None }` at :939-944, with the reason in its doc comment at :919-922: 'Returns None when there is no candidate OR more than one - an ambiguous bind must be a user choice, not a guess.' The runtime injector does not consult it. Live consequence: service_type 'codebase' has THREE credentials in this vault; 69 of 117 declared slots across 78 personas name that connector; connector_readiness classifies `codebase` as GlobalProbe and reports Ready without binding anything, while inject_design_context_credentials (engine/runner/credentials.rs:484-493) reaches get_by_service_type('codebase').first() and injects ONE of the three into all 69 - the most recently created, because both list paths carry ORDER BY created_at DESC (db/src/macros.rs:185 via credentials.rs:124, and credentials.rs:230). Adding a fourth Codebase credential silently re-points every one of those 69 slots, and no surface reports which credential is in use. Separately, role `ai` has two candidates (ElevenLabs and Leonardo): the server refuses the bind and blocks 7 image_generation slots, while the client's mirror takes the first and displays ElevenLabs - a voice API - as satisfying image generation. LEGAL FIX, and it already exists in this tree: commands/core/persona_icon_gen.rs:108-118 iterates EVERY credential of each candidate connector into a Vec the user chooses from - `for cred in cred_repo::get_by_service_type(&state.db, connector)? { out.push(ImageGenCredential { .. }) }`. Where a single value is genuinely required, test the cardinality first and return None on 2+, as resolve_one_credential does. DO NOT silence a match by sorting the candidates more carefully, by hoisting the `.first()` into a helper whose caller still ignores the count, or by adding an ORDER BY - a deterministic arbitrary choice is still an arbitrary choice, and the determinism is what makes it invisible. RELATIONSHIP TO NEIGHBOURS, measured SITE BY SITE against the final pattern over all 167 registry rules: of the 83 that can reach a .rs under src-tauri, 11 share a FILE and ZERO share a SITE. The three nearest by subject are disjoint by construction - detached-readiness-verdict (credential-readiness-resolution) matches an UPDATE statement over personas and asks whether the verdict carries its account; ledger-field-addressed-by-string-key matches a credential-ledger field name and asks whether a typed record was bypassed; missing-current-entity-rendered-as-unset (entity-picker) matches a TS `.find(x => x.id === v)?.name ??` and asks whether a chooser can say a record is gone. This asks whether a BINDING was made without counting the alternatives. KNOWN BLIND SPOTS, stated because they bound the gate: (a) the anchor is one repository function name, so a slot bound through raw SQL, through a different repo helper, or on the client is invisible - the client half of this same condition is 11 `.find(c => c.service_type === ..)` sites in 10 files, declined for the gate at 9 of 11 precision because 2 of them search a static CLI-spec array rather than credentials; (b) `[\\s\\S]{0,200}` deliberately crosses a statement boundary, which is what catches gitlab/converter.rs:68 and runner/credentials.rs:527 where a `;` separates the query from the reduction - the bound is what keeps it from running into an unrelated reduction, and all 9 matches were hand-opened to confirm none did. PRECONDITION (re-derive per repo, do NOT port): this keys on one Rust repository function and three Rust reduction idioms. A repo that resolves a binding with `SELECT .. LIMIT 1`, an ORM `findFirst`, a JS `.find(`, or a Python `[0]` has the identical condition wearing something this pattern cannot see. END OF LIFE: this rule is designed to reach zero. When it does the runner fails structurally on a zero-match rule BY DESIGN - DELETE the rule then, do not baseline it at 0.",
    "$measured": "2026-08-17 @ 6c97502d3 - 963 .rs files walked under src-tauri; 9 matches in 5 files, ALL 9 HAND-OPENED, precision 9/9. Anchor enumerated exhaustively: 13 occurrences of get_by_service_type, 1 of which is its own definition, leaving 12 call sites; this rule takes 9 and the positive control takes the other 3, with zero file:line overlap between them. Membership reproduced by a structurally independent walker (own directory traversal, own quote-state-tracking comment stripper that preserves newlines, own brace-matched #[cfg(test)] excision) importing nothing from scripts/census/lib/engine.mjs. The two implementations disagreed once, at 7 vs 9, and the disagreement was the finding: the first pattern keyed only on `.first()` and could not see `.into_iter().next()`. Validated standalone in a private scratch registry (census-slotbind-7c31.json) through the real runner, plus an 11-row fault-injection table; re-extracted from the finished document and re-run: identical (9/5, 3/3, 963, floor 700, exit 0). The full registry was NOT run."
  },
  "baseline": { "files": 5, "matches": 9 },
  "floor": 700
}
```

```json
{
  "id": "slot-bound-to-first-candidate-positive-control",
  "goldenPath": "docs/concepts/golden-paths/credential-slot-binding.md",
  "title": "POSITIVE CONTROL - not a gate. The same anchor where the candidate collection is used AS a collection instead of being reduced to element zero.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "(?:\\bfor\\s+[A-Za-z_]\\w*\\s+in\\s+[^;{}]{0,80}?\\bget_by_service_type\\s*\\(|\\bget_by_service_type\\s*\\([^;{}]{0,160}?\\)[\\s\\S]{0,200}?\\.is_empty\\(\\))",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE - carries no baseline by design. Same root, same extension, same 963-file walk, same anchor (a credential-candidate collection obtained from get_by_service_type), pointed at the COMPLIANT half: the collection is iterated or tested for emptiness rather than collapsed to element zero. EXHAUSTIVE AND DISJOINT BY CONSTRUCTION: the anchor has 12 call sites, the rule matches 9 and this matches 3, with zero shared file:line. THE THREE COMPLIANT SHAPES, all hand-opened: enumerate every candidate for the user - commands/core/persona_icon_gen.rs:111, `for cred in cred_repo::get_by_service_type(&state.db, connector)?` building a Vec<ImageGenCredential> the caller chooses from, which is the exemplar this golden path names; ask only whether ANY candidate exists without binding one - engine/src/capability_contract.rs:278, `Ok(creds) if !creds.is_empty()`; and iterate the whole set to act on all of it - engine/mcp_tools.rs:2361, probing every MCP gateway. Run both halves together whenever the rule's pattern or its anchor is edited: if this control's count collapses, the walk or the anchor broke rather than the codebase being fixed. LIMIT, STATED HONESTLY: a control with no baseline cannot drift, so repointing it at the violating form exits 0. Its liveness guarantee is that it FAILS STRUCTURALLY ON ZERO MATCHES, verified by two induced faults (control pattern replaced with a token appearing nowhere; the shared anchor broken in both halves), both exit 1. It is expected to RISE as the 9 violations are converted, which is exactly why it must never be baselined.",
    "$measured": "2026-08-17 @ 6c97502d3 - 3 matches in 3 files via the real runner; 9 + 3 = 12 = the full anchor call-site population, reproduced by the independent walker with identical membership."
  },
  "floor": 700
}
```

### Three conditions in this leaf I am refusing to gate, with the measurement that justifies each

1. **The typed envelope cannot parse 63 of 78 columns** (§0.1, D-A) is the leaf's largest finding and
   it is **a relation between a struct definition and the live contents of a database column.** No
   pattern spans that. The instrument is a **test that round-trips every `design_context` in the
   database through `parse_design_context` and asserts the typed branch was taken** — cheap, exact,
   and it fails today at 63. That is a test, not a rule, and it needs a fixture corpus the census
   cannot hold.
2. **A declaration key with no reader** (§0.3, D-F) is an **absence**, which the census cannot assert
   by construction. Gap 2 specifies the instrument.
3. **The client half of the shipped condition** is declined **with numbers**: 11 matches, 9 genuine,
   **2 false positives that search a static CLI-spec array**. 82 % precision, and every tightening I
   could construct required a receiver-name word list chosen from imagination — the exact move the
   doctrine records as distorting both ends of a measurement at once.

---

## 12. Corrections to the brief

**12.1 — The brief's headline lead is `client-rule-mirroring` D2's, and D2 measured a field the
normalizer is never called with.** The brief primed me with *"`ROLE_SYNONYMS` has 25 keys client-side
against the server's 21, and 5 of 5 distinct connector labels across 154 live persona-connector pairs
normalize differently on the two sides; `Codebase` is declared by 63 of 78 personas."*

The key counts are **confirmed** (25 vs 21, the four extra being `codebase|source_code|vcs|git`). The
corpus is not.

- **The 154 pairs and the 5 labels are `design_context.connectorPipeline`** — I reproduced it exactly:
  154 entries over 63 personas, 5 distinct values, `Codebase` 63, `Messages` 56, `GitHub` 21,
  `Image AI` 7, `Multimodal AI` 7. That array is a **display-label list**. It is not read by
  `persona_declared_connectors`, not read by the runtime injector, and **not read by anything at all**
  (§0.3) — its only live effect is breaking the typed parse (§0.1).
- **The corpus the resolvers actually see is `last_design_result.suggested_connectors[].name`: 117
  pairs over 73 personas, 11 distinct labels, of which 1 — `codebase` — normalizes differently.** Not
  5 of 5; **1 of 11**.
- **`Codebase` is declared by 63 of 78 as a pipeline label; `codebase` is declared by 69 of 78 as a
  resolvable slot name.** Different fields, different counts.
- **And the one surviving divergence is unreachable on both sides.** Server: `classify_connector`
  returns `GlobalProbe` for `codebase` and short-circuits **before** `resolve_one_credential`, so
  `normalize_connector_role` is never called with it. Client: the vault holds three credentials with
  `service_type = 'codebase'`, so step 4 (exact service-type match) returns satisfied **before**
  `ROLE_SYNONYMS` is consulted at step 5. Replayed: both sides say ready, for different reasons, on
  all 69 slots. **The measured client/server disagreement on this install is 8 of 117, and none of it
  is `codebase`.**

This is the doctrine's *"a false premise whose conclusion survives"* in its purest form: D2's
conclusion — the client map has drifted from the server's and nothing would catch it — **is true**,
and its evidence measures a call that never happens. The numbers are load-bearing beyond that
document: they are quoted verbatim inside the shipped `comment-kept-cross-language-mirror` rule's
`description`. **A composer citing that rule would carry the corpus forward as fact.**

**12.2 — The spine's `sides: client` does NOT hold; `twoSided: true` does.** Of the ten §7
deviations, **seven are Rust** (A, B, C, G, H, and both halves of J) including all three P0s; the
census rule, its control and its floor are Rust-only; the exemplar is Rust; the type fix is Rust. The
client half is real and not an afterthought — D-D's 8 live disagreements and D-E's picker filter are
both genuine and both invisible from the backend. **The honest label is `twoSided` with the *server*
carrying the P0s** — the eighth consecutive `sides: "client"` contradiction, and the mechanism is the
one `credential-rotation-and-revocation` §12.1 and `least-privilege-scope-grant` §12.1 both named:
**the leaf was labelled from the surface a user sees, and the subject is what the engine does when
nobody is looking.**

**12.3 — The spine's `convergence: mixed` HOLDS, and it is the second label in the corpus to survive.**
Measured per clause on an effective independent cohort of **2** (§6): four clauses are **physics**
(fail-closed on an unresolvable binding, 2 of 2; readiness computed by the resolver, where the repo
with one code path has nothing to disagree with; a loud parse failure; a usage record, 1 of 2 with
the minority right), two are **silence** (nobody in the fleet has a slot-ambiguity problem, because
nobody else built a system where a user can own three credentials of one kind), and on one clause
**Personas is ahead of the entire fleet** — it is the only repo with a correct ambiguity refusal. A
mixed verdict is exactly what that distribution is. **It holds because I measured the cohort before
counting**, which is the same reason `ai-draft-preview-apply`'s held.

**12.4 — The lineage check removed three of five, and one exclusion is itself a finding.**
`personas-cloud` is an explicit port (four *"Ported from desktop …"* docstrings, `requires_credential_type`
verbatim); `personas-web` has no credential domain; `vibeman` has no credential table. **Cohort 5 → 2.**
The port is worth reporting anyway: it carried the slot concept across and **lost the vocabulary**,
declaring readiness on `serviceType` (`httpApi.ts:2236`) and binding at run time on the user-typed
`name` (`dispatcher.ts:695`). A persona reads fully configured while the env var the tool expects
never exists. **A port that inherits a two-vocabulary problem and makes it worse is evidence about
how easy the mistake is, not about how common the answer is.**

**12.5 — Four primed leads confirmed, two sharpened, one re-scoped.**

- *"`BrokerGrant` has 0 rows against 9,431 decrypt audit rows naming no grant."* **Confirmed, and it
  extends downward.** The slot layer has the same absence one level up: nothing records which
  *binding* a run resolved either (§0.7). Cited, not re-derived —
  [least-privilege-scope-grant](./least-privilege-scope-grant.md) owns it.
- *"`sensitive` is declared on 184 of 196 connector field declarations, decides encryption at rest,
  and no renderer reads it — 37 fields render visible."* **Cited as instructed and confirmed as the
  same shape one layer up**: `role` on 98 of 117 slot declarations, named for a function that is
  never called with it. [schema-driven-form](./schema-driven-form.md)'s P10 generalises past
  rendering and this leaf is the second instance.
- *"`gmail` and `google_calendar` grants expired 75 and 98 days ago."* **Confirmed and it produced the
  leaf's sharpest single instance**, which the brief did not anticipate: `Product Scout (4)`'s
  *explicit, correct, non-dangling* `email` binding points at the dead Gmail grant, and the three
  resolvers give three different answers about it — refuse, display satisfied, inject. **A binding
  being well-formed is not the same as a binding being resolvable, and this install has exactly one
  place where those two facts separate.**
- *"`persona_triggers` and `persona_team_members` hold zero dangling ids — measure whether credential
  bindings are."* **Confirmed as a control (0, 0, and `credential_fields` 0), and the answer to the
  question is that the framing does not transfer.** The 4 credential links are also 0-dangling — but
  4 of 117 slots have one, 1 of the 4 is unreadable, and the 63 *project* pins in the same blobs are
  **18/63 dangling and 63/63 unreadable**. **A namespace with no foreign key does not fail by
  dangling. It fails by not existing, and a dangling-id query returns a clean bill of health.**
- *"What a slot is and how many exist per persona."* **Answered and the answer is the leaf**: a slot
  is a string key with six competing spellings and no row; 117 exist, 1–3 per persona (38 personas
  with 1, 26 with 2, 9 with 3, 5 with none).
- *"Whether the readiness a surface displays is the readiness the runtime computes."* **Answered: no,
  on 24 of 78 personas**, and the two directions fail differently (22 over-block, 2 under-block).

**12.6 — The brief did not name the sibling leaf that owns half this territory.** It listed five paths
to read; **`credential-readiness-resolution.md` was not among them**, and it owns the resolver, its
`SetupKind` verdict, the five client re-derivations and the invalidation hooks. I found it only by
grepping for `ROLE_SYNONYMS`. Worse, `least-privilege-scope-grant` §12.4 had already **failed to
reproduce** the same primed lead this brief handed me and **explicitly reassigned it** to that file —
so the campaign had already recorded, in writing, that this lead needed re-measuring, and the brief
carried it forward unqualified anyway. **A lead that one composer could not reproduce should reach
the next composer with that fact attached.**

**12.7 — A correction to my own instrument, recorded because it is the kind that hides.** My first
replay of the client resolver read the credential list in raw table order; both real list paths carry
`ORDER BY created_at DESC` (`db/src/macros.rs:185`, `credentials.rs:230`). Fixing it **changed no
verdict** — the counts in §0.5 are identical — but it changed *which credential id* the client and the
runtime were shown to pick, and I had been about to report those as divergent. They are not: both
pick `0da023d9`, and the agreement is an accident of recency rather than a shared rule. **I nearly
published a divergence that does not exist, in a document whose thesis is that these resolvers
diverge** — which is precisely when a measurement most needs re-running.

**12.8 — And the finding the brief did not ask for, which turned out to be the headline.** The brief
asked how a binding is resolved at runtime and how many resolutions fail. The answer is that **most
of them never had a binding to resolve**, and the ones that did are read through a parser that
rejects 63 of 78 columns on a field unrelated to credentials. I found it by transliterating
`parse_design_context` and running it, not by reading it — the failure is invisible in the source
because both branches return the same type, the fallback is silent by construction, and somebody had
already written a workaround at one call site with a plausible, wrong explanation attached. **The
dangerous thing in a binding leaf is not the binding that is missing. It is the one that is present,
correct, and unreadable.**
