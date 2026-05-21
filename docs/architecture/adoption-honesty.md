# Adoption Honesty — make the build tell the truth about what a persona needs

## Why this exists

The 50-template marathon (2026-05) showed 34 personas promoted
`setup_status='ready'` that delivered zero business value. The
build-readiness redesign (`build-readiness-redesign.md`) fixed the
worst of it — connectors now bind, promotion is verified. But two
things are still true:

1. `setup_status` is a flat `ready` / `needs_credentials` string. It
   cannot say *what* is missing or *where* the user fixes it — and
   `needs_credentials` is now overloaded for missing Dev Tools
   projects, missing data sources, and verification failures.
2. The build never tells the user what the persona *needs from the
   world* to be useful — a trigger, a data source with content. A
   bare green "Ready" badge over-promises.

The root truth: **`ready` is a promise about a world the build can't
see.** The fix is not a better guess — it is honesty. Tell the user
exactly what each persona needs, and where to provide it.

This covers three directions:

- **D1 — Structured setup-state.** Replace the meaning-free flat string
  with a structured list of typed blockers.
- **D2 — First-run state bootstrapping.** Stop personas failing run 1
  on missing state files they assume a prior run created.
- **D3 — Input-path verification + readiness preview.** Verify the
  persona can actually be triggered, and show the user a plain-language
  account of what it needs and when it will run.

## D1 + D3 — `setup_detail`, one structured field

A new nullable JSON column `personas.setup_detail` holds a
`PersonaSetup`:

```
PersonaSetup {
  blockers: [ SetupBlocker { connector, kind, detail } ],
  has_autonomous_trigger: bool,
  triggers: [string],          // wired trigger types
  preview: string,             // human-readable "needs X, runs on Y"
}
SetupBlocker.kind ∈ vault_credential | dev_project | obsidian_vault | twin_profile
```

`SetupKind` / `Readiness` already exist in
`commands/design/connector_readiness.rs` — the blocker list is just
`missing_connectors()` serialized, plus the Phase 3b verification
result. No new readiness primitive is invented.

`setup_status` (the flat string) **stays** as the coarse gate —
`execute_persona`'s `== "needs_credentials"` check is unchanged and
keeps working. Promote writes BOTH: `setup_status` = `needs_credentials`
when `blockers` is non-empty, else `ready`; `setup_detail` = the full
structure. The UI reads `setup_detail`; legacy code reads
`setup_status`. No execute-gate change, no CHECK-constraint risk.

**Input-path verification (D3):** at promote, after connectors and the
Phase 3b verification, the path also records the persona's wired
triggers. A persona with only a `manual` trigger has no autonomous
input path — `has_autonomous_trigger = false` — which the preview
states plainly ("you will need to run this persona yourself"). The
`preview` string is assembled from the triggers + the (now bound)
connectors + the capability summary.

## D2 — first-run state bootstrapping

Templates may declare initial state their personas assume:

```
payload.initial_state: [ { path: "dev_config.json", content: "{...}" } ]
```

At adoption — after questionnaire answers are applied so
`${answer}` variables resolve — each entry is materialized to the
**managed drive**, namespaced per persona at
`state/<persona-id>/<path>`, and **only if the file does not already
exist** (never clobber a prior run's state). The managed drive is the
right home: durable across runs, agent-readable via
`drive_read_text`, and the drive is global so per-persona namespacing
is mandatory.

A template that ships `initial_state` must reference the drive path
(`state/<persona-id>/…`) in its `operating_instructions`, not a bare
`./file.json`, so the agent uses the drive tool. The mechanism lands
here; populating `initial_state` on individual templates is per-template
authoring work that follows.

## What this is NOT

- Not a new execution gate — `execute_persona` is untouched.
- Not a `setup_status` value rename — the flat string keeps its two
  values; `setup_detail` carries the richness.
- Not a per-template content pass — D2 ships the mechanism; templates
  adopt `initial_state` afterward.

## Rollout

| Step | Delivers | Touches |
|---|---|---|
| 1 | `setup_detail` column + `PersonaSetup` types; promote writes it | migration, `connector_readiness.rs`, `persona.rs`, `build_sessions.rs`, bindings |
| 2 | `initial_state` materialization at adoption | template schema, adoption path, drive write |
| 3 | UI: blocker chips with deep-links + readiness preview | `SetupStatusBadge`, persona overview |

After this, a persona's setup state is honest and actionable: the user
sees exactly which connector/resource is missing, where to fix it, and
what the persona will do once it is.
