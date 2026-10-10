# `features/agents/sub_*` — Module Ownership Map

This folder uses a `sub_<concern>/` naming convention to split the sprawling
agent feature into per-concern modules. The convention is implicit in the
directory layout but was previously undocumented, causing duplicated logic
across closely-related sub-modules.

Use this map before adding a file: if the concern already has a home, put it
there. If it legitimately spans two modules, the shared helper belongs in
`features/agents/shared/` or `features/shared/`, NOT inside either `sub_` dir.

## This map is checked

`node scripts/check-agents-sub-boundaries.mjs` (run by
`src/__tests__/structural/agents-sub-boundaries.test.ts`, so `npm test` and the
CI test step fail on it) does two things:

- It counts every production import that crosses from one `sub_` module into
  another and holds the count to `scripts/agents-sub-boundaries.baseline.json`.
  A new crossing or a rise fails. A drop also fails until the baseline is
  re-recorded with `--update`. That is how you bank a fix, and it lands in the
  diff for review. `--verbose` lists every crossing site.
- It fails when the table below and the `sub_*` directories on disk disagree:
  a module with no row, or a row with no module.

Recorded 2026-10-10: 27 crossing imports in 20 pairs. Most are the editor shell
mounting tabs (`sub_editor -> sub_activity/design/lab/settings`) and the Design
hub composing panels (`sub_design -> …`). Two crossings were undone that day:

- `sub_connectors -> sub_lab` is gone. The `design_context` parser
  (`parseDesignContext`, `serializeDesignContext`, `mergeCredentialLink`) moved
  out of the `sub_lab/use-cases/UseCasesList` component into
  `shared/designContext.ts`, which every reader now imports directly.
- The `sub_brain <-> sub_life` cycle is gone. `sub_life` owns the episode and
  attention surfaces that `sub_brain`'s tiles read, so `sub_brain -> sub_life`
  stays. `sub_life/BrainSection` no longer imports `sub_brain`; it takes the
  dashboard as a `renderDashboard` prop, and `sub_design/components/DesignLifePanels`
  composes the two.

## Naming rule

- Folder name: `sub_<noun>`, lowercase, underscores. The noun names the
  **surface** the module owns (tools, connectors, chat, …), not the data
  structure behind it.
- One module = one tab or one right-rail panel in the agent editor, with a
  handful of exceptions called out below.

## Ownership boundaries

| Module                  | Owns                                                                          | Does NOT own                                                                      |
| ----------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `sub_activity`          | Activity matrix, per-execution drill-down.                                    | Top-level observability charts (those live in `features/overview`).               |
| `sub_brain`             | The persona brain dashboard tiles (episode volume, memory tiers, pressure, anomalies, consolidation yield, coverage) and their math. | Episode and attention data surfaces (`sub_life`).                                  |
| `sub_connectors`        | Agent↔connector bindings, automation setup (n8n/Zapier/GitHub Actions), per-agent tool list (rendered via `ToolsSection` inside the connectors tab). | Credential storage — that's `features/vault`.                                      |
| `sub_deployment`        | Deployment dashboard, deployment history, cloud deploy panels and their hooks. | Cloud connection settings outside the agent (`features/cloud`).                   |
| `sub_design`            | `DesignHub`, the design tab, which composes connector, tool-runner, manifest, responsibilities and life panels. | The content of the panels it composes — each stays in its own module.             |
| `sub_editor`            | Outer agent-editor shell, tab bar, draft save/restore, focus trap.            | Any single-tab content.                                                           |
| `sub_executions`        | Execution list, execution detail, trace inspectors, replay and pipeline waterfall. | App-wide execution state (`lib/execution`, the execution store slice).            |
| `sub_glyph`             | The glyph layout, compose config, contact-sheet cinema, command panel and promote/refine previews. | The matrix build entry that mounts it (`components/matrix`).                      |
| `sub_health`            | Health checks: scoring (`healthScoring`), `useHealthCheck` and the digest scheduler (`useHealthDigestScheduler`), read by the editor tab bar and the arena. | Top-level observability (`features/overview`).                                    |
| `sub_lab`               | The Lab tab: arena, versions table, use cases (`use-cases/`), diff viewers, quality badge. | Model presets and the price table (`sub_model_config`).                           |
| `sub_life`              | Life panels: episodes timeline, attention ledger strip, proposal inbox, `BrainSection`. | The brain dashboard tiles (`sub_brain`).                                           |
| `sub_manifest`          | The manifest tab, manifest proposals and the manifest document/cache.         | Responsibilities and charters (`sub_responsibilities`).                           |
| `sub_model_config`      | Only `libs/`: Ollama Cloud presets and the model tier/price table, read by the editor, the arena and `lib/models`. The model selector UI and A/B compare were never mounted and were deleted 2026-09-25. | Global model profile (`settings_keys::GLOBAL_MODEL_PROFILE`).                     |
| `sub_responsibilities`  | The responsibilities tab and charters (`libs/useCharters`).                   | The manifest (`sub_manifest`).                                                    |
| `sub_settings`          | Per-agent settings (twin binding, visibility, workspace).                     | App-wide settings (that's `features/settings`).                                   |
| `sub_tool_runner`       | Live tool-invocation surface inside a chat turn.                              | Tool DEFINITION authoring.                                                        |

Two rows this map used to carry described directories that no longer exist.
The check above now fails on a stale `sub_` row:

- `sub_use_cases`: use cases now live in `sub_lab/use-cases/`.
- `health/` (a sibling that was not a `sub_` module): its scoring and hooks now
  live in `sub_health/`.

## When adding a new `sub_` module

1. Does the concern already fit in an existing module? If yes, put it there.
2. Is it backed by its own tab or right-rail panel? If no, it probably belongs
   under an existing module's `libs/` or `components/`.
3. Add an entry to this table in the same PR that creates the folder. The
   boundary check fails until you do.
