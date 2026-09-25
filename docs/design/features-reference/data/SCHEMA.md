# Staged material - schema

## `features.js` -> `window.FEATURES` (also `features.json`)
`{ schema, generatedAt, states[], rubric{dimension: weight}, threshold 0.7, coverage_floor 0.6, projects[] }`

Two REAL projects. Features, contexts and groups come from real scans of real codebases; nothing about their names, spans or descriptions is invented. Council state per feature is a fixture on the production contract (shapes real, figures illustrative).

`projects[]`: `{ key, name, totals{contexts, groups, features, majors, covered, unclaimed}, groups[], contexts[], features[], missing_shared_contexts[] }`
- `groups[]`: `{ name, contexts (count), features (distinct features touching the group) }`. CandiDate has 25 groups and 191 contexts; Ascent 11 and 54.
- `contexts[]`: `{ name, group, description, role, features[] }`. A context is a code-ownership unit (every file belongs to exactly one). `role` is one of `core` (it is in at least one feature's slice; `features[]` names them), `platform` (shared code that serves features without belonging to one), `tests`, `unclaimed` (no feature claims it: either a feature nobody captured or code nobody needs - the actionable list). 38% of CandiDate's contexts and 59% of Ascent's are `core`.
- `features[]`: `{ slug, name, description, kind 'user_flow'|'capability'|'integration'|'ops', tier 'major'|'standard', rationale, contexts[] (2-8 context names, the slice), primary_context, groups[] (derived: the groups the slice crosses), spend_30d_usd|null, council }`. Only `major` features may reach a human decision.
- `council`: `{ state }` plus, when a council has run: `round_no` (1-3; 3 without success is `stalled`), `overall` 0..1 or null, `coverage` 0..1, `trust_state` ('uncalibrated' everywhere today), `dimensions[]` `{ dimension, weight, state 'measured'|'unmeasured', score|null, floor|null, floor_hit }`, `history[]` `{ round, overall }`, `last_run`, `decided_at|null`, `rejection_reason|null`, `drift 'none'|'changed'`, `top_finding|null`. A feature may carry `running: true` with `started_minutes_ago` while a council session is in flight. A `null` score is NOT MEASURED, never zero.
- `states[]` (closed set): `none` (never councilled - the majority, and permanently so), `fail`, `incomplete`, `stalled`, `ready` (escorted to the human gate, awaiting a decision), `machine_pass` (clean, standard tier: not waiting on anyone), `approved`, `approved_drifted` (approved, code changed since), `rejected`.
- `missing_shared_contexts[]`: `{ name, why, used_by[] }` - shared services the scan says the context map fails to name.

What a person can DO to a feature, by state: none -> run council; fail / incomplete / rejected / approved_drifted -> run the next round; stalled -> needs the person to look before a 4th round; ready -> open the decision (it lives on the Council page, not here); machine_pass -> promote to major; approved -> nothing. Any feature: toggle tier major/standard, open its contexts in the context map, open its council history.

## `council-reference/`
The sibling page this module sits next to in the same menu ("Council"): its approved design (`index.html`, `README.md`) and three screenshots of the shipped product. Your module must feel like the same product: same tokens, same type discipline, same figures vocabulary (the rose chart, the round history, the state chips). Read it for the visual language; do not rebuild the galaxy.

## `tokens/`
`globals.css`, `typography.css` from the host app: semantic colour tokens (light and dark), the `.typo-*` scale, radii, elevation.
