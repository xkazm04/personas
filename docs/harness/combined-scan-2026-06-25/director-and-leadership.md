# Director & Leadership — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: director-and-leadership | Group: Execution Engine
> Total: 5 | Critical: 0 | High: 1 | Medium: 4 | Low: 0

## 1. `json_path` parser returns an intermediate numeric node when the path doesn't fully match
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / wrong-results
- **File**: src-tauri/src/engine/kpi_eval.rs:258-276
- **Scenario**: A `codebase` KPI uses `parse: "json_path:total.pct"`. The measurement command prints `{"total": 100, "covered": 80}` (no `pct` key — tool changed its shape, or the path was authored slightly wrong). Instead of failing, the evaluator records **100** as the KPI value.
- **Root cause**: The segment walk `for seg in path.split('.') { match cur.get(seg) { Some(next)=>cur=next, None=>break } }` `break`s on the first missing segment but leaves `cur` pointing at the **last matched node**. The subsequent `if let Some(n) = cur.as_f64()` then succeeds on that intermediate number (`total` = 100), so a partial-path match silently yields the wrong value rather than `None`. Only a *fully* walked path should be accepted.
- **Impact**: A misconfigured or drifted JSON path records a confidently-wrong KPI number (no error, full evidence blob written). KPI values drive goal/orchestration decisions and user dashboards, so a wrong measurement is acted on as truth — classic success theater. `coverage_pct`/`regex`/`count_lines` strategies are unaffected; only `json_path` partial matches.
- **Fix sketch**: Track whether every segment resolved (e.g. `let mut ok = true; … None => { ok = false; break }`) and only read `cur.as_f64()` when `ok`. Equivalently, fold with `?`/`and_then` over `cur.get(seg)` and bail to `None` on any miss before the numeric coercion.
- **Value**: impact=7 effort=2

## 2. Director Brain notes grow without bound and are fully re-stat'd on every evaluation
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: unbounded-growth / performance
- **File**: src-tauri/src/engine/director_brain.rs:81-105 (write), 59-76 (read)
- **Scenario**: Brain is enabled with a vault. A persona is reviewed on every Director cycle (manual + the batch/scheduler). Each review calls `write_brain_note`, which writes a **new** timestamp-named `.md` file under `Director/<persona>/` and never prunes. After months of nightly cycles the folder holds thousands of notes. Every subsequent `read_brain_history` does `read_dir` + a `std::fs::metadata(...).modified()` stat on **every** file just to pick the 3 newest.
- **Root cause**: Append-only persistence with no retention/rotation, paired with a read that sorts the *entire* directory by mtime (`files.sort_by(...)` over all entries) on each evaluation. Cost is O(files) per review and disk grows linearly forever.
- **Impact**: Steadily slower Director runs (each eval already runs an LLM call; the FS scan compounds), unbounded vault disk usage, and a noisier vault for users browsing it. Degrades silently — no error, just creep.
- **Fix sketch**: Cap retention at write time (e.g. after writing, delete all but the newest N notes in the folder), or read the 3 newest via a bounded directory walk that stops early. Alternatively, keep a single rolling note per persona and append/truncate rather than one-file-per-review.
- **Value**: impact=5 effort=3

## 3. `director_score` clobbers the same execution row on re-evaluation — the "is coaching working?" trend can't move
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / wrong-results
- **File**: src-tauri/src/engine/director.rs:662-668 (and :793 capture of `latest_execution_id`)
- **Scenario**: User stars a persona, the Director scores it (writes `director_score` onto the persona's most-recent execution). The persona doesn't run again; the user re-runs the Director (or the nightly batch does). `gather_context` again picks `recent.first()` — the *same* execution row (confirmed: `get_by_persona_id` is `ORDER BY created_at DESC`) — and `set_director_review` UPDATEs that row's `director_score` again, overwriting the prior score.
- **Root cause**: The score is conceptually persona-level ("verdict on this persona's health + usefulness") but is persisted onto a single execution row keyed by `latest_execution_id`, which is stable until a *new* execution exists. Repeated evaluations with no intervening run overwrite rather than append.
- **Impact**: `list_score_trends`/the persona-table sparkline read one `director_score` per distinct execution; their stated purpose (director.rs:1261 — "a glance shows whether coaching is moving the needle") is defeated in the common case (coach → persona idles → re-evaluate → same row overwritten → flat/single-point trend). Prior scores are lost, not historized.
- **Fix sketch**: Persist Director scores in their own append-only table/row (persona_id + timestamp + score), independent of execution rows; have the trend read from there. Or, if execution-anchoring must stay, only write when `latest_execution_id` differs from the last-scored execution and store the time series separately.
- **Value**: impact=5 effort=4

## 4. `feedback_accepts` / `feedback_rejects` are permanently 0 — the documented accept/reject calibration signal is dead
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: tribal-knowledge / silent-failure
- **File**: src-tauri/src/engine/director.rs:825-838 (tally), 1128-1129 (stamped into review context)
- **Scenario**: A user approves and rejects several Director verdicts over weeks. On the next cycle, `gather_context` tallies `feedback_accepts`/`feedback_rejects` by scanning memories for `category == "director_feedback"` AND content containing `"outcome":"accepted"` / `"outcome":"rejected"`. No such memory is ever written: the resolve-review learning loop (db/repos/communication/manual_reviews.rs:368-432) writes categories `decision`/`constraint` (team) or `learned` (solo) with prose content — never `director_feedback`, never an `"outcome":"…"` JSON. So both counters are hardwired to 0.
- **Root cause**: Read/write contract drift. The `DIRECTOR_FEEDBACK_CATEGORY` + `"outcome":"…"` substring format the Director reads is an undocumented coupling to a writer that doesn't exist. The module header (lines 6-8) and rubric item 5 both promise the Director learns from accept/reject, and `route_verdicts` stamps `feedback_accepts_so_far`/`feedback_rejects_so_far` into every review's `context_data` — values that are always 0.
- **Impact**: The headline "calibrates to your taste" sub-signal is non-functional; reviews persist misleading always-0 counters; future maintainers reading the rubric assume a working loop. (Prior-verdict *status* is still surfaced via `list_verdicts` in payload section 5, so calibration isn't fully absent — but this specific signal is dead and silently so.)
- **Fix sketch**: Either make the resolve handler emit a `director_feedback` memory in the exact `{"outcome":"accepted|rejected",…}` shape the tally expects (share one serializer constant), or delete the dead tally + the `feedback_*_so_far` context fields and rely solely on the verdict-status channel. Add a sync test pinning the format both sides use.
- **Value**: impact=5 effort=3

## 5. Brain history is keyed by slugified persona *name* (not id) — same/similar names cross-contaminate long-term memory
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: edge-case / data-correctness
- **File**: src-tauri/src/engine/director_brain.rs:28-34 (slug), 52-54 (read by name), 90-93 (write by name)
- **Scenario**: Two personas named "Dev Clone" and "Dev-Clone" (or two distinct personas that simply share the name "Assistant") both map to `director_vault_folder` slug `Dev-Clone` / `Assistant`. `write_brain_note` writes both personas' reviews into the *same* `Director/<slug>/` folder, and `read_brain_history` folds that mixed history into each one's next evaluation payload. Persona A's coaching becomes Persona B's "prior coaching from long-term memory." Worse, an all-symbol name (e.g. `***`) slugs to `""` → folder `Director/` (and a `Director//<ts>.md` double-slash write path), pooling *every* such persona together.
- **Root cause**: The vault key is a non-injective slug of a non-unique field (persona names aren't unique; ids are). `is_alphanumeric`-collapse plus `trim_matches('-')` makes distinct names collide and can produce an empty slug.
- **Impact**: Cross-persona leakage of Director coaching history (wrong "build on past advice" context → misdirected verdicts), and an empty-slug bucket that conflates unrelated personas. Silent — the vault just looks like one persona has lots of notes.
- **Fix sketch**: Include the persona id (or a short id hash) in the folder name, e.g. `Director/<slug>-<id[..8]>`; reject/replace empty slugs with the id. Keying read+write on id guarantees per-persona isolation regardless of name.
- **Value**: impact=5 effort=3
