# Codebase Connector Redesign + 7-Repo Team Adoption — Plan

**Status:** design approved-pending → execution
**Goal:** Adopt the SDLC team preset for each of 7 repos in `C:\Users\mkdol\xprice`, each team working its OWN repo. Requires redesigning the codebase connector from a single global probe into a per-project, per-persona-bindable connector.

## The 7 repos (local, all git + node)
`C:\Users\mkdol\xprice\{ai-bookkeeper, ai-paralegal, apprenticeship-placement, grant-writing-nonprofits, immigration-paperwork, local-seo-agency, medical-bill-negotiator}`
GitHub org: https://github.com/xkazm04/ (repos prefixed `xprize-`). ai-paralegal team already adopted.

## Findings (investigation)
- **Athena chat** can emit approval-gated actions `register_project` + `enqueue_dev_job(scan_codebase)`, but `register_project` writes to `companion_known_project` (companion registry), NOT `dev_projects`, and `scan_codebase` is a shallow file-walk. Neither makes the codebase connector ready or populates `dev_contexts`.
- **Real Dev Tools project** = `dev_projects` row via `dev_tools_create_project(name, root_path, description, status, tech_stack, github_url, team_id)` (commands/infrastructure/dev_tools.rs:49; repo insert dev_tools.rs:251). `dev_projects` has an (unused) `team_id` column.
- **Real context scan** = `dev_tools_scan_codebase` (context_generation.rs:412) — spawns Claude CLI, populates `dev_context_groups`/`dev_contexts`/`dev_context_file_hashes`. **Required** for codebase tools to return anything.
- **codebase connector** = `GlobalProbe` (connector.rs:119 `GLOBAL_PROBE_CONNECTORS = ["codebase","twin","obsidian_memory"]`). Readiness = any active `dev_projects` row (connector_readiness.rs:192 `has_dev_project`). Runtime resolution = `resolve_context_project` (mcp_server/tools.rs:197): explicit `project_id`/`project_root` arg → else FIRST/oldest project. **No per-persona binding.**
- **Twin precedent (the model to mirror):** `twin` is also a GlobalProbe, but a persona pins `design_context.twin_id` and `twin_get_active_profile(state, persona_id)` (twin.rs:149-189) resolves the pinned profile first, global default otherwise. `DesignContextData.twin_id: Option<String>` (persona.rs:412).
- SDLC template `aq_target_codebase` ALREADY uses `dynamic_source: {service_type: development, operation: list_credentials, source: vault}` — authored expecting per-project codebase options to select. The global-probe model is the mismatch.

## Design (user-directed): one codebase connector per Dev Tools project, assigned per persona

Mirror the twin pattern exactly:

1. **Per-persona pin** — add `dev_project_id: Option<String>` to `DesignContextData` (persona.rs, next to `twin_id`). When set, the persona's codebase tools resolve THAT dev_project.
2. **Enumerate dev_projects as codebase connector options** — the adoption questionnaire's `dynamic_source` for the codebase question (service_type `development`/codebase, `list_credentials`/`list_scope_picks`) returns one option per active `dev_project` (id = project_id, label = name/repo). This is "1 connector per Dev Tools project" from the user's POV.
3. **Adoption sets the pin** — the `aq_target_codebase` answer (a project_id) is written to the persona's `design_context.dev_project_id`. Must work in BOTH single-template adoption AND the preset combined questionnaire (per-member). New `maps_to` target: `persona.design_context[dev_project_id]` (or a dedicated handler), since current `maps_to: use_cases[..].sample_input..` doesn't bind anything.
4. **Runtime resolution** — `resolve_context_project` resolves the executing persona's `design_context.dev_project_id` first (mirror twin). The runner injects the persona's pinned project (env var e.g. `PERSONAS_DEV_PROJECT_ID`, or pass `project_root` to `install_mcp_sidecar` which is currently `None` at runner/mod.rs:832) so the MCP sidecar defaults to it. Fall back to global/first for unpinned personas (back-compat).
5. **Readiness per-persona** — `connector_readiness`/adoption pre-flight: a persona with a pinned `dev_project_id` is ready iff that project exists+active; unpinned falls back to the global probe. So a team pinned to a not-yet-created project shows `needs_credentials` until its project exists.

## Phases

### Phase 1 — Codebase connector redesign (foundation)
1. `DesignContextData.dev_project_id` field (+ ts-rs regen).
2. `resolve_context_project` (mcp_server/tools.rs) + runtime: resolve persona's pinned project; runner injects it.
3. `connector_readiness` codebase probe: honor per-persona pin.
4. Adoption (`template_adopt.rs`): map the codebase question answer → `design_context.dev_project_id` (single + preset paths).
5. Dynamic-source: enumerate `dev_projects` as codebase options for the questionnaire.
- Commit per coherent unit. ts-rs bindings regen.

### Phase 2 — Athena creates real Dev Tools projects + scans (chat, dev_tools toggle ON)
1. Replace/augment Athena's `register_project` so it (also) creates a real `dev_projects` row via the `dev_tools_create_project` path (set `team_id` later if known), and/or add a `create_dev_project` action. Add `scan_codebase` mapping to the REAL `dev_tools_scan_codebase` (not the shallow companion walk) — or a new `enqueue_dev_job` kind.
2. Teach Athena (prompt.rs dev_tools block) to create a project + scan per repo path.
3. Acceptance for Phase 2: from chat, "set up dev project for <path>" → `dev_projects` row + context scan populating `dev_contexts`.

### Phase 3 — Live test, iterate until replicable
- Test against running app (:17321, honor `PERSONAS_BASE`). Drive Athena chat (companion) to create a dev_project + scan for one repo; verify `dev_projects` row + `dev_contexts` populated. Iterate. Then replicate for all 7.

### Phase 4 — Adopt 7 SDLC teams, each assigned its repo
- For each repo: ensure its `dev_project` exists (Phase 2/3) → adopt the `sdlc-lifecycle` preset → in the combined questionnaire, assign that repo's codebase connector to the members (sets `dev_project_id`). Link `dev_projects.team_id = <team>` for clarity.
- Verify each team: 5 members, structured_prompt, home_team, connections, event_subscriptions, AND each persona's `dev_project_id` = its repo's project; setup_status ready.

### Acceptance
7 teams, full 5-persona roster each, setup_status ready, each persona pinned to its own repo's dev_project, context scanned → ready to provide value on that repo. Plus one persona executed per team to confirm it reads the RIGHT repo.

## Risks / notes
- Multi-process env plumbing (runner → Claude CLI → personas-mcp sidecar → resolve_context_project) is the trickiest part of runtime resolution; the `PERSONAS_DRIVE_ROOT` env (runner/mod.rs:987) is the precedent for passing per-run roots to the sidecar.
- Preset adoption currently only honors `persona.parameters[..]` maps; need a path for `design_context.dev_project_id` per member (extend the override pipeline).
- Keep global-probe fallback so existing unpinned personas (the already-adopted ai-paralegal team) keep working.
- ts-rs binding regen required for the DesignContextData change.
- Each `dev_tools_scan_codebase` spawns Claude CLI (cost + ~minutes); budget for 7 scans.
