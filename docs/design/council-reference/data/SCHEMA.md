# Staged material - schema

Everything loads from disk. Each dataset ships twice: `<name>.js` sets a global, `<name>.json` is the same object.

## `topology.js` -> `window.TOPOLOGY` (1.3 MB, real, generated from the live registry on 2026-09-20)
`{ schema, generatedAt, totals{domains 10, categories 58, subjects 471, techniques 3260, applications 1788, laws 98}, domains[] }`
- `domains[]`: `{ slug, title, categories[], laws[] }`
- `categories[]`: `{ id, title, subjects[] }`
- `subjects[]`: `{ slug, title, subcategory|null, status ('forged'|'draft'|...), revision|null, changedAt|null, applications (count), techniques[] }`
- `techniques[]`: `{ slug, laws[] (law slugs), use_when[] (up to 2 trigger phrases) }`
- `laws[]`: `{ slug, statement, techniques[] ('subject/technique') }` - the ONLY cross-subject edges in the corpus. There are no related/depends-on links; do not invent any.

## `council-state.js` -> `window.COUNCIL` (fixture on the FROZEN verdict contract; shapes are real, figures are illustrative, not arithmetic you need to re-derive except where noted)
- `rubrics{ 'feature-v1', 'architecture-v1' }`: `{ threshold, coverage_floor, dimensions{ <name>: { weight, floor|null, kind 'mechanical'|'judged'|'mixed' } } }`.
- `states[]`: the closed set `none | fail | incomplete | stalled | ready | machine_pass | approved | approved_drifted | rejected`.
- `projects[]`: the 14 projects the council governs.
- `subjects[]`: one row per councilled subject: `{ project, kind 'use_case'|'architecture', slug, title, tier 'major'|'standard'|null, state, round_no, overall|null, coverage, trust_state 'uncalibrated'|'untrusted'|'trusted', drift 'none'|'grown'|'changed'|'unknown', latest_run_id?, decided_at?, rejection_reason?, rubric_version?, registry_subjects[] }`. `registry_subjects` are topology subject slugs: this is how a council subject lands on the galaxy (council mode focuses the SET of those stars).
- `runs[]`: full council runs for ONE subject (`multi-agent-orchestration`): round 1 stopped at the mechanical tier on a robustness floor hit; round 2 supersedes it and is `ready`. Each run: `{ schema_version, run_id, subject{kind,slug,title,summary}, rubric_version, round_no, supersedes_run_id|null, trust_state, receipt{head_sha, spanned_paths[], span_digest}, hard_failures[], dimensions[], overall|null, coverage, outcome 'ready'|'fail'|'incomplete'|'stalled', must_address[], summary, started_at, finished_at }`.
- `dimensions[]`: `{ dimension, kind, state 'measured'|'unmeasured'|'not_applicable'|'carried', score 0..1|null, confidence, floor|null, floor_hit, advisory, unmeasured_reason|null, findings[{id,severity,title,detail,recurrence}], evidence[{kind 'file'|'url'|'screenshot'|'video'|'metric', ref, caption}], techniques[{subject, technique, proof 'execution'|'inspection'|'claim'}], delta|null }`. `null` score means NOT MEASURED and must never render as zero. The video and screenshot refs do not exist on disk: draw a placeholder frame that is honestly labelled as one.
- `overlay.subjects{ <topology subject slug>: { approved, rejected, pending, techniques_proven, projects[], last } }`. A subject ABSENT from this map has never been councilled. That is ~97% of the 471 subjects and it is the permanent condition of this product, not a fixture shortcut.

## `baseline/`
The round-one prototype the owner kept (`index.html` + `NOTES.md`). It loads `../data/*.js`; from `data/baseline/` that path is wrong, so copy it into your variant directory if you want to run it. Start from it; rewrite freely.

## `reference-queue-detail/`
Another round-one prototype. The owner found ONLY its queue item detail thoughtful. Its L0 is a dial and is an invalid answer in this round: do not borrow it.

## `tokens/`
`globals.css` and `typography.css` from the host app: semantic colour tokens (light and dark via `[data-theme^="light"]`), the `.typo-*` type scale, radii, elevation.
