# Connector Classification & Readiness

## Why this exists

Personas connect to the outside world through *connectors*. Until now the
code modelled connectors as a binary — "needs a vault credential" or
"doesn't." That binary is wrong: it has no slot for a builtin connector
whose "is this configured?" signal lives somewhere other than the
`persona_credentials` table.

The 50-template adoption marathon (2026-05-20) surfaced the failure
concretely. A persona whose only connector was `codebase` — a builtin
backed by a registered Dev Tools project, not a vault API key — was
flagged `setup_status='needs_credentials'` at promote time and then
refused execution, with an error misdirecting the user to *Settings →
Vault* (where `codebase` cannot be configured at all).

Root causes:

1. **Two byte-identical `BUILTIN_LOCAL_CONNECTORS` allowlists** —
   `build_sessions.rs` and `template_adopt.rs` — each just four names
   (`local_drive`, `personas_database`, `personas_messages`,
   `personas_vector_db`). A drift trap, and both omit every builtin
   connector backed by something other than a vault credential.
2. **Adoption and promote disagree.** `check_persona_runnability`
   (adopt) had five escape hatches; `vault_missing_connectors` (promote)
   had one. A persona could pass adoption and then fail promote.
3. **The readiness check only knew `persona_credentials`.** It had no
   way to ask "is there a Dev Tools project?" so it either guessed via a
   category synonym (`codebase` → `source_control` — a false positive)
   or flagged `needs_credentials`.

## The three-class model

Every connector belongs to exactly one class. Class is derived from the
connector definition's `metadata` blob, plus one small registry for
connectors whose nature metadata cannot express.

### Class A — `ZeroConfig`

Always ready. No credential, no backing entity needed. Backed by a local
service that exists from first launch.

`local_drive`, `personas_database`, `personas_messages`,
`personas_vector_db`, `codebases` (the all-projects aggregate — works
even with zero projects).

Derivation: `always_active == true`, or `auth_type == "none"` with
`connection_mode == "local"`.

### Class B — `Credential`

Needs a row in `persona_credentials` carrying an API secret. Readiness =
a credential of that `service_type` exists in the vault (or a
category-synonym of it). The vault is global — `persona_credentials` is
keyed by `service_type`, not scoped per persona.

`gmail`, `notion`, …, and `mcp_gateway`.

Derivation: anything not Class A or Class C.

**Fallback: an authenticated provider CLI.** For hosting / VCS providers
the vault credential is not the only real capability — see
[CLI-auth readiness](#cli-auth-readiness-the-credential-class-fallback)
below.

### Class C — `GlobalProbe`

A builtin connector that is ready iff a **backing local entity** exists.
There is no credential and no per-persona binding — the connector
resolves its backing entity *globally* at runtime (the connector seed
declares no picker). Readiness is a connector-specific probe.

| Connector | Backing entity | Probe |
|---|---|---|
| `codebase` | a Dev Tools project | `dev_projects` has an active row |
| `twin` | a Twin profile | `twin_profiles` has a row |
| `obsidian_memory` | an Obsidian vault | `app_settings.obsidian_brain_config` has a non-empty vault path |

`codebase` and `twin` are seeded `always_active: true` (the seed
authors' "exposed automatically" intent), but they do nothing useful
until their backing entity exists — so they must NOT fall through to
`ZeroConfig`. The `GLOBAL_PROBE_CONNECTORS` registry is therefore
consulted *before* the metadata-derived `ZeroConfig` rule.

> **Note on an earlier draft.** A first pass of this design assumed
> `codebase`/`twin` were picker-backed (`requires_picker`) and stored a
> per-persona binding in a `persona_credentials` row, mirroring an
> assumed `twin` pattern. Reading the actual connector seed JSON
> (`scripts/connectors/builtin/*.json`) disproved that: **no connector
> declares `requires_picker`**, and `twin`'s own seed says "the active
> twin is resolved automatically — no per-persona attach step needed."
> These connectors resolve globally. The picker / per-persona-binding
> layer was dropped as unnecessary.

## The unified readiness resolver

A single function is the *only* place that answers "is connector X
ready?":

```
connector_readiness(conn, connector_name) -> Readiness
```

`Readiness` is `Ready` or `NeedsSetup { connector, kind }` where `kind`
(`SetupKind`) distinguishes a missing vault credential from a missing
Dev Tools project / Twin profile / Obsidian vault — so the UI can route
the user to the *right* remediation screen, not always "Settings →
Vault."

Dispatch:

- **`ZeroConfig`** → `Ready`.
- **`Credential`** → `persona_credentials` lookup by `service_type`,
  with a category-synonym fallback; then, for the connectors listed
  under [CLI-auth readiness](#cli-auth-readiness-the-credential-class-fallback),
  a provider-CLI auth probe.
- **`GlobalProbe`** → the connector's probe (table / settings check).

`check_persona_runnability` (adoption pre-flight) and the build promote
path both call this one function — they can no longer disagree. The two
`BUILTIN_LOCAL_CONNECTORS` lists and `vault_missing_connectors` are
deleted.

Native runtime capabilities (`web_search`, `bash`, `filesystem`, …) are
not connectors at all — the resolver returns `Ready` for them up front.
The adoption pre-flight keeps two template-payload-specific escape
hatches (a connector whose template `category` is a native capability;
a connector whose template entry declares a credential-free `auth_type`)
because those depend on the raw template JSON the resolver never sees.

## CLI-auth readiness (the `Credential`-class fallback)

Hosting and VCS providers are not normally authenticated by pasting an
API token anywhere. The user runs the vendor's own CLI once — `vercel
login`, `gh auth login` — and the CLI stores a token in its own config.
Demanding a *second*, hand-copied credential in the Vault before the
connector counts as ready is friction users reliably refuse: they skip
the connector, and the persona ships unwired. That is a false
`needs_credentials` of the same family as the `codebase` bug above,
just with a different backing store.

So for the connectors in `CLI_PROBE_CONNECTORS` (`personas-core`,
`models/connector.rs`) readiness has a second path. Classification does
**not** change — these stay Class B:

| Connector | Auth probe | Login command |
|---|---|---|
| `vercel` | `vercel whoami` | `vercel login` |
| `netlify` | `netlify status` | `netlify login` |
| `cloudflare` | `wrangler whoami` | `wrangler login` |
| `fly_io` | `flyctl auth whoami` | `flyctl auth login` |
| `railway` | `railway whoami` | `railway login` |
| `github` | `gh auth status` | `gh auth login` |

Resolution order inside the `Credential` arm is strict:

1. A uniquely bound, *usable* vault credential → `Ready`. **This always
   wins.** It is the only mode that survives leaving this machine — CI,
   a second device, a headless run. The CLI path is a local convenience,
   not an equal.
2. No credential resolves → run the (cached) provider-CLI probe:
   - exit 0 → `Ready`
   - binary present, probe fails → `NeedsSetup { CliLogin }`
   - binary absent → `NeedsSetup { VaultCredential }` (unchanged)

`SetupKind::CliLogin` is the new remediation token. Its blocker detail
names the connector's actual login command, because a generic "run its
login command" defeats the purpose of having a distinct kind.

### Why the probe is cached and bounded

Readiness is recomputed on every adopt, promote, credential mutation and
run gate — a single user action can resolve dozens of connectors. A
naive probe would spawn a process each time. So:

- **TTL cache** (process-wide, 5 minutes). A fresh entry never spawns
  anything. Five minutes is short enough that a `vercel login` the user
  just ran is picked up without an app restart.
- **4-second hard timeout with kill.** A CLI sitting at an interactive
  prompt can never wedge the UI's critical path; a timeout is reported
  as "needs login", which is actionable.
- **Windows goes through `cmd /C`.** The npm-installed provider CLIs are
  `.cmd` shims that `CreateProcess` — and therefore
  `Command::new("vercel")` — cannot execute. `CREATE_NO_WINDOW` keeps a
  console from flashing. Because `cmd` always spawns successfully, the
  "binary absent" signal is then read from exit code 9009 or the shell's
  stderr text rather than a spawn error.
- **The probe function is injectable** (`connector_readiness_with_probe`)
  so unit tests never touch a real binary and can count invocations.

`connector_cli_probe_status` / `connector_cli_probe_refresh` expose the
cache to the UI — the latter is what a user hits after authenticating in
a terminal, instead of waiting out the TTL.

## Probe registry

Class C connectors each get a probe in `connector_readiness`. Adding a
new builtin connector backed by a local entity means: add its name to
`GLOBAL_PROBE_CONNECTORS` and add one probe arm — no allowlist edits, no
logic duplicated across adopt / promote.

## Rollout

| Layer | Delivers | Touches |
|---|---|---|
| 1 | `ConnectorClass` + `classify_connector` | `db/models/connector.rs` |
| 2 | `connector_readiness` resolver + probes; deletes the dual allowlists | new `connector_readiness.rs`, `build_sessions.rs`, `template_adopt.rs` |
| 3 | honest `SetupKind` → remediation routing in the UI + the `execute_persona` error message | Rust error text, `SetupStatusBadge`, setup surfaces |

Layers 1–2 end the false `needs_credentials` flagging and the
adopt/promote divergence. Layer 3 makes the remaining "needs setup"
states point the user at the correct screen.

A per-persona binding / picker layer is intentionally **not** part of
this design: the connectors in scope resolve their backing entity
globally, by their own seed declaration.
