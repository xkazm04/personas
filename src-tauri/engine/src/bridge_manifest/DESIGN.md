# bridge_manifest — declarative desktop bridges

> Source: `/research` run 2026-05-09 ("Printing Press" walkthrough by Nate Herk).
> Sibling pattern to `engine/desktop_bridges.rs` (typed Rust enums, hand-coded).

## Why this exists

`engine/desktop_bridges.rs` today wraps native CLI binaries (`vscode`, `docker`,
`terminal`, `obsidian`) as typed Rust enums. The pattern works but doesn't
scale: each new bridge is ~150 lines of hand-written Rust + a `cargo build`,
which is why personas has 4 bridges while Printing Press's library has 50+
CLIs.

This module introduces a **manifest-driven runtime dispatcher**: a CLI bridge
becomes a `*.json` file in `scripts/bridges/` (or app-data `bridges/` for
user-added ones). The dispatcher reads the manifest at startup, materialises
typed action descriptors, and at invocation time interpolates parameters into
the `args` template and spawns the binary via `tokio::process::Command`.

Manifest authors do not write Rust. The same JSON file documents the bridge
for the LLM (via the description fields), constrains the action set, and
drives runtime dispatch.

## Manifest schema

```json
{
  "id": "gh",
  "label": "GitHub CLI",
  "description": "Wraps the gh CLI for GitHub operations.",
  "binary": "gh",
  "actions": [
    {
      "name": "auth_status",
      "description": "Show authentication status for gh.",
      "args": ["auth", "status"],
      "params": {}
    },
    {
      "name": "issue_create",
      "description": "Create an issue in a repository.",
      "args": ["issue", "create", "--repo", "$repo", "--title", "$title",
               "--body", "$body"],
      "params": {
        "repo":  { "type": "string", "required": true,
                   "description": "owner/name" },
        "title": { "type": "string", "required": true },
        "body":  { "type": "string", "required": false, "default": "" }
      }
    }
  ]
}
```

### Field semantics

- **id** — stable manifest identifier. Used as the bridge name in dispatch
  calls and as the manifest filename: `<id>.json`.
- **label** — human-readable display name. Surfaces in UI and tool descriptors.
- **description** — multi-sentence summary of what this CLI does.
- **binary** — the binary name, looked up on `PATH`. On Windows the dispatcher
  also tries `<binary>.exe` and `<binary>.cmd` if the bare name is not found.
- **actions** — array of named operations. Each action has its own `args`
  template and `params` schema.
- **action.args** — array of CLI arguments. Strings starting with `$` are
  interpolated from the `params` map at invocation time. Literal strings
  pass through unchanged.
- **action.params** — map from parameter name to a `{ type, required,
  description, default }` shape. Supported types: `string`, `integer`,
  `boolean`. Required params with no provided value reject the dispatch with
  `AppError::Validation`. Optional params with a `default` substitute the
  default when not provided; without a default, the matching `$param` argument
  is dropped along with any preceding flag-style argument (single-arg drop —
  see `Interpolation rules` below).

## Interpolation rules

For each `args` entry:
1. Strings without a leading `$` are literals — emit unchanged.
2. Strings of the form `$name` look up `params[name]`:
   - Required param missing → reject the whole dispatch.
   - Optional param missing without default → drop this argument.
     If the immediately preceding argument starts with `--` or `-`, drop it
     too (so `--body $body` collapses cleanly when `body` is omitted).
   - Param present → stringify and emit.

Booleans are emitted as `"true"` / `"false"`. Integers via `to_string()`.

## Out of scope (v1)

- **Streaming / long-running commands.** The dispatcher captures whole-output
  via `cmd.output()`, mirroring `desktop_bridges::run_cli`. Streaming is a
  future addition, gated on a real use case.
- **Capability gating.** The manifest dispatcher does NOT enforce
  `engine::desktop_security::DesktopConnectorManifest` approval in v1. Like
  the typed bridges today, gating is a higher-layer concern. Wiring it in is
  the natural next step but would expand the v1 surface; tracked separately.
- **Stdin piping.** Some CLIs (e.g. `gh issue create --body-file -`) accept
  stdin payloads. The v1 schema has no `stdin` field; add one when a real
  bridge needs it.
- **Per-action timeouts.** v1 uses the same 30s default as `run_cli`. A
  `timeout_ms` field can land in the schema later without breaking existing
  manifests because all schema fields are optional except `id`/`binary`/
  `actions`.

## What this is NOT

- **Not a replacement for the typed bridges.** The `vscode` / `docker` /
  `terminal` / `obsidian` modules in `engine/desktop_bridges.rs` keep their
  shape. The manifest dispatcher is parallel infrastructure, not a migration.
  Once it's proven, individual typed bridges can be migrated bridge-by-bridge.
- **Not a connector.** Connectors live in `scripts/connectors/builtin/*.json`
  and represent HTTP-API integrations. Manifests live in `scripts/bridges/`
  and represent local-binary CLI wrappers. The two catalogs are siblings.
- **Not user-extensible at runtime in v1.** Manifests are baked-in via
  embedded resources. Dropping a JSON file into `<app_data>/bridges/` is the
  natural follow-up but requires capability-gating infrastructure that v1
  does not include.

## Testing

- `parse_manifest_round_trip` — JSON ↔ struct.
- `interpolate_required_param_present` — substitution works.
- `interpolate_required_param_missing` — rejects.
- `interpolate_optional_param_with_default` — default applied.
- `interpolate_optional_param_missing_drops_flag` — `--body $body`
  collapses when `body` absent.
- `interpolate_boolean_and_integer` — type stringification.
- `dispatch_returns_action_result` — happy-path with a fake binary.
