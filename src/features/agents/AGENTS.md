# `features/agents/sub_*` — Module Ownership Map

This folder uses a `sub_<concern>/` naming convention to split the sprawling
agent feature into per-concern modules. The convention is implicit in the
directory layout but was previously undocumented, causing duplicated logic
(notably credential-availability gating appearing in both `sub_tools` and
`sub_connectors`).

Use this map before adding a file: if the concern already has a home, put it
there. If it legitimately spans two modules, the shared helper belongs in
`features/agents/libs/` or `features/shared/`, NOT inside either `sub_` dir.

## Naming rule

- Folder name: `sub_<noun>`, lowercase, underscores. The noun names the
  **surface** the module owns (tools, connectors, chat, …), not the data
  structure behind it.
- One module = one tab or one right-rail panel in the agent editor, with a
  handful of exceptions called out below.

## Ownership boundaries

| Module                  | Owns                                                                          | Does NOT own                                                                      |
| ----------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `sub_prompt`            | System prompt editor, custom sections, persona voice.                         | Connector/credential checks; use-case authoring.                                  |
| `sub_tools`             | Per-agent tool selector, tool grouping, tool-credential **gating UX**, undo.  | Credential CRUD itself — that's `features/vault`. Connector metadata discovery.   |
| `sub_connectors`        | Agent↔connector bindings, automation setup (n8n/Zapier/GitHub Actions).       | Credential storage; per-tool credential-requirement checks (those live next to the tool list in `sub_tools`). |
| `sub_use_cases`         | Use-case cards, editing, activation toggles in the agent editor.              | Free-form chat; execution history.                                                |
| `sub_chat`              | Chat tab UI: bubbles, composer, streaming render.                             | Session storage/event bus.                                                        |
| `sub_activity`          | Activity matrix, per-execution drill-down.                                    | Top-level observability charts (those live in `features/overview`).               |
| `sub_editor`            | Outer agent-editor shell, tab bar, draft save/restore, focus trap.            | Any single-tab content.                                                           |
| `sub_settings`          | Per-agent settings (twin binding, visibility, workspace).                     | App-wide settings (that's `features/settings`).                                   |
| `sub_model_config`      | Per-agent model profile, A/B compare, model override UI.                      | Global model profile (`settings_keys::GLOBAL_MODEL_PROFILE`).                     |
| `sub_tool_runner`       | Live tool-invocation surface inside a chat turn.                              | Tool DEFINITION authoring.                                                        |
| `sub_health`            | Health-check panel rendered **inside the agent editor**.                      | Cross-agent digest/scoring — that's `health/` (sibling dir).                      |
| `health/` (NOT sub_)    | Cross-agent health-check logic, scoring, digest scheduler, proposal engine.   | Editor-pane rendering (`sub_health` does that).                                   |

## Why `health/` isn't `sub_health/`

Historical: health scoring is consumed by the dashboard + digest notifications
outside the agent editor too. Hook modules (`useHealthCheck`, `useHealthDigestScheduler`)
live at the top level so non-agent-editor surfaces can import them without
reaching into a `sub_` module. `sub_health/` is strictly the editor-tab's render
layer plus its adaptors.

## Why tool-credential gating is in `sub_tools` not `sub_connectors`

A tool without a credential is still a tool in the selector — it just renders
with a disabled check + an "Add credential" CTA. The UX decision is about
**how the tool looks in the list**, which `sub_tools` owns. The credential
LOOKUP data still comes from the vault store, shared by both modules.

## When adding a new `sub_` module

1. Does the concern already fit in an existing module? If yes, put it there.
2. Is it backed by its own tab or right-rail panel? If no, it probably belongs
   under an existing module's `libs/` or `components/`.
3. Add an entry to this table in the same PR that creates the folder.
