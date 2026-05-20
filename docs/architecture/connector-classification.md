# Connector Classification & Readiness

## Why this exists

Personas connect to the outside world through *connectors*. Until now the
code modelled connectors as a binary — "needs a vault credential" or
"doesn't." That binary is wrong: it has no slot for builtin connectors
whose "is this configured?" signal lives somewhere other than the
`persona_credentials` table.

The 50-template adoption marathon (2026-05-20) surfaced the failure
concretely. A persona whose only connector was `codebase` — a builtin
that binds to a registered Dev Tools project, not a vault API key — was
flagged `setup_status='needs_credentials'` at promote time and then
refused execution, with an error misdirecting the user to *Settings →
Vault* (where `codebase` cannot be configured at all).

Root causes:

1. **Two byte-identical `BUILTIN_LOCAL_CONNECTORS` allowlists** —
   `build_sessions.rs` and `template_adopt.rs` — each just four names
   (`local_drive`, `personas_database`, `personas_messages`,
   `personas_vector_db`). A drift trap, and both omit every
   binding-backed builtin.
2. **Adoption and promote disagree.** `check_persona_runnability`
   (adopt) has five escape hatches; `vault_missing_connectors` (promote)
   has one. A persona can pass adoption and then fail promote.
3. **The readiness check only knows `persona_credentials`.** It has no
   way to ask "is there a Dev Tools project?" so it either guesses via a
   category synonym (`codebase` → `source_control` — a false positive)
   or flags `needs_credentials`.

## The three-class model

Every connector belongs to exactly one class. Class is **derived from
the connector definition's metadata**, never from a hardcoded name list.

### Class A — Zero-config

Always ready. No credential, no binding. Backed by a local service that
exists from first launch.

`local_drive`, `personas_database`, `personas_messages`,
`personas_vector_db`, `codebases` (the all-projects aggregate — works
even with zero projects).

Derivation: `is_builtin == true` AND `always_active == true` AND the
connector declares no picker / no required binding.

### Class B — Credential

Needs a row in `persona_credentials`. The row's payload is either an API
secret (Gmail, Notion, …) **or a reference to a local entity** the
persona is bound to. Readiness = the row exists AND, for reference-style
rows, the referenced entity still resolves.

`gmail`, `notion`, … (secret payload); `mcp_gateway`; `twin` (payload
references a `twin_profiles` row, chosen via a picker); `codebase`
(payload references a `dev_projects` row — **new** with this redesign).

Derivation: anything not Class A or Class C.

### Class C — Global-singleton binding

Ready iff a single global configuration exists. There is no per-persona
choice because there is only ever one such configuration.

`obsidian_memory` — ready iff the `obsidian_brain_config` settings blob
exists with a non-empty vault path.

Derivation: `is_builtin == true` AND `connection_mode ==
"desktop_bridge"` AND the connector is registered in the
global-singleton probe table.

## The unified readiness resolver

A single function is the *only* place that answers "is connector X ready
for persona P?":

```
connector_readiness(conn, persona_id, connector_name) -> Readiness
```

`Readiness` is `Ready` or `NeedsSetup { kind, remediation }` where `kind`
distinguishes a missing vault credential from a missing Dev Tools
project from a missing Obsidian vault, and `remediation` is the
UI-routable hint (which screen fixes it).

Dispatch:

- **Class A** → `Ready`.
- **Class B** → look up `persona_credentials` by `service_type`. For
  reference-style payloads, additionally probe that the referenced
  entity is alive (project not deleted, twin profile not deleted).
- **Class C** → run the connector's global-singleton probe.

`check_persona_runnability` (adoption pre-flight), the promote path, and
the frontend `ConnectorReadinessStatus` computation all call this one
function. The two `BUILTIN_LOCAL_CONNECTORS` lists and
`vault_missing_connectors` are deleted.

## Binding-probe registry

Class C connectors — and the reference-validation half of Class B — need
connector-specific "is the binding live?" checks. These live in one
registry rather than scattered `if name == "codebase"` branches:

| Connector | Probe |
|---|---|
| `codebase` | the persona's credential payload `project_id` resolves to a live `dev_projects` row |
| `codebases` | none — Class A, always ready |
| `obsidian_memory` | `settings.obsidian_brain_config` present, vault path non-empty |
| `twin` | the credential payload `twin_profile_id` resolves to a live `twin_profiles` row |

Adding a new builtin connector means registering one probe — no
allowlist edits, no logic duplicated across adopt/promote.

## Picker-backed bindings — `codebase` joins the `twin` pattern

`twin` already works the way the redesign wants: the connector declares
`requires_picker`, the credential modal renders a picker hydrated from
`twin_profiles`, and the chosen id is stored in the credential row. The
engine reads that row at execution time.

`codebase` is migrated to the same pattern: `requires_picker:
"dev_project"`, a `project_id` field, a picker hydrated from
`dev_projects`. After this change `codebase` *is* "a connector like any
other" — it just happens to bind to a local project instead of a remote
API.

`codebase` is also no longer seeded `always_active: true` — that flag
implied "needs nothing," which was never true for the single-project
variant.

`codebases` (all-projects) stays Class A.

`obsidian_memory` stays Class C — there is only ever one Obsidian vault
configuration, so there is nothing to pick.

## Adoption auto-bind

For a connector that needs a binding, adoption mirrors the existing
vault auto-detect (`matchVaultToQuestions`):

- exactly one candidate (one Dev Tools project; one configured vault) →
  auto-create the binding, no question asked;
- zero candidates → surface a blocked setup task pointing at the right
  remediation screen;
- multiple candidates → surface a picker adoption question.

## Runtime binding resolution

`execute_persona` resolves a `codebase` persona to its bound project by
reading the `project_id` from the persona's `codebase` credential row,
and scopes the codebase toolset to that project. `codebases` continues
to resolve globally across all projects.

## Rollout

| Layer | Delivers | Touches |
|---|---|---|
| 1 | `ConnectorClass` + `classify_connector` | new Rust module |
| 2 | `connector_readiness` resolver + probe registry; deletes the dual allowlists | `build_sessions.rs`, `template_adopt.rs` |
| 3 | honest `setup_status` kind + remediation routing | Rust + `SetupStatusBadge`, error messages |
| 4 | picker-backed `codebase`, adoption auto-bind, runtime resolution | connector seed JSON, credential modal, execution engine |

Layers 1–2 alone end the false `needs_credentials` flagging. Layers 3–4
make builtin connectors first-class through adoption and execution.
