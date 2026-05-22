# Team Presets — Multi-template adoption bundles

> Read this when authoring a new preset for the gallery, or when
> debugging the bulk-adoption flow.

A **team preset** is a filesystem-shipped manifest that bundles N
persona templates plus the team wiring (PersonaTeam metadata +
members + connections, optionally a PersonaGroup binding) needed to
land them as a working multi-agent setup in one click. Presets live
parallel to single-template `.json` files but in a private folder
(`scripts/templates/_team_presets/`) so the existing template loader
skips them — they're a separate primitive, not a template variant.

## Lifecycle at a glance

```
scripts/templates/_team_presets/<id>.json   (source of truth, hand-authored)
        │
        ▼ engine::team_preset_loader (validates schema + role uniqueness)
list_team_presets / get_team_preset (Tauri IPC)
        │
        ▼ PresetLibraryPage (templates → presets sub-tab)
PresetPreviewModal — graph preview + per-member rows
        │
        ▼ user clicks "Adopt all"
adopt_team_preset IPC
        │
        ├─ groups::create               (optional)
        ├─ teams::create                (always — kept on partial failure)
        ├─ FOR each member:
        │    instant_adopt_template_inner
        │    UPDATE personas.group_id   (if bound)
        │    teams::add_member
        │    emit `team-preset-adopt-progress` (queued | adopting | done | failed)
        └─ FOR each connection:
             skip if either endpoint role failed
             teams::create_connection
        │
        ▼ AdoptedTeamPresetResult
PresetPreviewModal renders per-row status, "Open team" CTA
```

## Manifest schema (v1)

See `src-tauri/src/db/models/team_preset.rs` for the canonical typed
shape. Authoring guide:

```jsonc
{
  "id": "backlog-execution",       // matches filename minus .json
  "schema_version": 1,             // bumped if the format ever changes
  "name": "Backlog & Execution",
  "description": "One-line value prop for the gallery card.",
  "icon": "Layers",                // lucide-react icon name
  "color": "#F59E0B",              // hex; used by card stripe + team
  "category": ["productivity", "development"],  // gallery filter tags

  "team": {
    "name": "Backlog & Execution",
    "description": "Optional team subtitle",
    "color": "#F59E0B"             // overrides outer color for PersonaTeam.color
  },

  "group": {                       // OPTIONAL — omit if no group binding
    "name": "Product & Engineering",
    "color": "#F59E0B",
    "shared_instructions": "..."   // stamped via update_group post-create
  },

  "members": [
    {
      "template_id": "idea-harvester",   // must match a real template's id
      "role": "triage",                  // unique within the preset
      "x": 240,                          // canvas coords (set by author)
      "y": 100
    }
    // ...
  ],

  "connections": [
    {
      "from": "capture",
      "to": "triage",
      "connection_type": "data",        // or "feedback" (dashed in preview)
      "label": "ad-hoc captures"        // optional
    }
    // ...
  ]
}
```

## Validation done at load time

`engine::team_preset_loader::list_presets` + `get_preset` validate:

1. **`schema_version == 1`** — newer manifests get a structured error
   so an older build doesn't silently mis-parse.
2. **`members[].role` unique** within a preset — connections
   reference roles by string, so a duplicate would silently bind to
   the first occurrence.
3. **`connections[].from` / `.to` resolve to known roles** — an
   unknown role at load time means the manifest can never wire that
   edge.

Template references (`members[].template_id`) are NOT validated at
load time. Coupling the loader to the template catalog would force
a full read on every list call. The adopter validates per-template at
adoption time and surfaces a precise error per missing template.

Invalid manifests are LOGGED (via `tracing::warn`) and SKIPPED by
`list_presets` — one bad manifest doesn't take the whole gallery
offline.

## Partial-success semantics

`adopt_team_preset` is explicitly not transactional across the
whole flow — too many sub-IPCs to wrap in one tx. The contract:

- **The team shell is created unconditionally.** Even if every member
  fails, the user keeps the team so they can retry from the gallery
  without losing the configured name/color.
- **Each member adoption is independent.** A failure on member N
  doesn't abort member N+1; the failure is captured in
  `AdoptedTeamPresetResult.failed_members` with the underlying error
  string.
- **Connections are silently skipped when either endpoint role
  failed.** The edge can't resolve to a member id on at least one
  side; rendering a stale edge would just create UI clutter.
- **Group binding is best-effort.** If the post-adopt
  `UPDATE personas.group_id` fails, the failure is logged but doesn't
  fail the member (the persona itself is still real and usable; the
  group binding just didn't take).

The preview modal handles this contract by rendering `failed_members`
inline next to their role rows so the user can decide whether to
retry the manifest or fix the failing template's prerequisites
(usually missing credentials).

## End-to-end test

`tests/playwright/preset-team-adoption.spec.ts` drives the live app
(via the existing test-automation HTTP bridge on :17320) through the
full adoption flow for `backlog-execution`:

```bash
npm run tauri:dev:test   # start the app with --features test-automation
npx playwright test preset-team-adoption  # in a second terminal
```

The spec waits for every member row to settle on `done` or `failed`
(via the `data-status` attribute on each `[data-testid="preset-row-
<role>"]` element, which the modal updates from
TEAM_PRESET_ADOPT_PROGRESS events), then reads back via `list_teams`
/ `list_groups` / `list_team_members` / `list_team_connections` to
verify the wiring landed correctly.

The spec deliberately accepts partial failure — when the test vault
lacks credentials for a template's required connectors, the persona
adopts but lands in `setup_status=needs_credentials`, which is a
wiring success (and what this test verifies), not a runtime success.
