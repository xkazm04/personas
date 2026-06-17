# Test Mastery — Personas Twin
> Total: 8 findings (2 critical, 3 high, 2 medium, 1 low)

## 1. `set_active_profile` single-active invariant is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/twin.rs:239-253
- **Current test state**: none
- **Scenario**: `set_active_profile` runs a two-statement transaction: demote every `is_active = 1` row, then promote `id`. The whole app assumes EXACTLY ONE active twin at a time — `get_active_profile` does `WHERE is_active = 1 LIMIT 1`, and `useTwinReadiness` / TwinPicker / the connector resolver all key off the single active twin. If a future refactor reorders the two UPDATEs, drops the `WHERE is_active = 1` clause, or breaks the transaction so the demote partially applies, you can end up with zero or multiple active twins. Today nothing fails the build when that happens.
- **Root cause**: The repo's only tests are `slugify` and the `get_tone_optional` table-name regression. No test exercises the activation transaction or the "first twin auto-activates" rule in `create_profile` (line 142-146).
- **Impact**: A persona silently resolves the wrong twin (wrong voice, wrong tone, wrong contacts/memories) or no twin at all — directly corrupts every downstream recall/draft. Cross-twin data leakage is a privacy issue for a personal-comms feature.
- **Fix sketch**: Rust `#[cfg(test)]` test using `init_test_db()`: create 3 twins (assert the FIRST auto-activates, the 2nd/3rd do not), call `set_active_profile` on twin C, then assert `SELECT COUNT(*) FROM twin_profiles WHERE is_active = 1` == 1 AND `get_active_profile()` returns C. Add a case asserting re-activating the already-active twin keeps the count at 1. Invariant: at-most-one (and, after any activation, exactly-one) active row.

## 2. `validateKeyFactsJson` trust-boundary cap is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/api/twin/twin.ts:165-214
- **Current test state**: none
- **Scenario**: This is an explicit security/trust boundary: it byte-caps an LLM-generated `keyFactsJson` blob at 64 KB and rejects unparseable JSON before it reaches the IPC frame / SQLite write. The comment even cites the failure modes (IPC overflow, OOM, silent truncate). It is pure, deterministic, and entirely untested. A refactor that swaps `TextEncoder().encode(value).length` for `value.length` would silently undercount multi-byte payloads (emoji/CJK — exactly the multilingual content this feature handles) and let an oversized blob through; removing the `JSON.parse` roundtrip would let malformed JSON store-and-fail-later. Neither breaks any test today.
- **Root cause**: No test file exists for `src/api/twin/`. The validator was added as a guard but never pinned.
- **Impact**: A regression reopens the exact IPC-overflow / silent-truncate bugs the cap was written to prevent, on a user-data write path.
- **Fix sketch**: **llm-generatable** vitest batch. Invariants to assert (not snapshot): (a) `undefined` passes through as `undefined`; (b) valid JSON under cap returns the string unchanged; (c) a string whose UTF-8 byte length exceeds 64 KB throws even when `.length` (UTF-16 units) is under the cap — build it from 4-byte emoji so byte-count > char-count; (d) syntactically invalid JSON throws with `cause` set. Boundary case at exactly 64 KB vs 64 KB + 1 byte.

## 3. `review_pending_memory` double-review guard has no test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/twin.rs:468-492
- **Current test state**: none
- **Scenario**: The UPDATE carries `AND status = 'pending'` and returns `NotFound` when `rows == 0` — a deliberate guard so an already-approved/rejected memory can't be re-reviewed (idempotency / race protection between two reviewers or a double-click). If the `AND status = 'pending'` clause is dropped in a refactor, a rejected memory could be flipped to approved (or re-flipped), changing what the twin recalls. No test catches removal of that clause.
- **Root cause**: Pending-memory lifecycle (`create_pending_memory` -> `review_pending_memory`) is untested end-to-end.
- **Impact**: Human-review gate becomes bypassable; rejected facts can silently re-enter the twin's approved memory set, polluting recall/draft output.
- **Fix sketch**: Rust test: create twin + pending memory, approve it (assert status `approved` + `reviewed_at` set), then call `review_pending_memory` again and assert it returns `AppError::NotFound` and the row is unchanged. Repeat for the reject path. Invariant: a memory transitions out of `pending` exactly once.

## 4. `create_distilled_fact` provenance + importance-clamp invariants untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/twin.rs:1005-1054
- **Current test state**: none
- **Scenario**: Two business rules live here: (a) provenance contract — empty `source_communication_ids` is rejected as `AppError::Validation` ("never a legitimate state ... rather than silently storing a hallucination-shaped row"), and (b) `importance` is clamped to 1..=5. Both are exactly the kind of validator a "make it compile" refactor erodes. If the empty-sources check is dropped, hallucinated facts with no provenance get persisted into recall; if the clamp is dropped, out-of-range importance skews the `ORDER BY importance DESC` recall ranking (`top_distilled_facts_for_recall`).
- **Root cause**: No test exercises distilled-fact creation; the empty-content / empty-sources / clamp branches all run unguarded.
- **Impact**: Unsourced or mis-ranked "facts" feed straight into persona prompt-building (`twin_recall`), degrading answer trustworthiness — the core value proposition of the Twin.
- **Fix sketch**: Rust tests: (a) empty `content` -> Validation error; (b) empty `source_communication_ids` -> Validation error (assert no row inserted); (c) `importance = 99` and `importance = -3` both persist clamped to 5 and 1; (d) valid call round-trips `sources_json` as the JSON array. Invariants: provenance-required, importance ∈ [1,5].

## 5. `record_interaction` create-memory side effect is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/twin.rs:562-615
- **Current test state**: none (the cited bug-hunt #1 truncation helper IS tested in utils/text.rs, but the integration here is not)
- **Scenario**: When `create_memory = true`, recording an interaction also inserts a pending memory whose content is `[channel] summary` (or char-boundary-truncated content) — this is how channel activity becomes reviewable memory. The `summary`-vs-truncated-content branch and the contact-handle-vs-no-handle title branch are pure formatting decisions feeding the human-review inbox, and the call deliberately swallows errors (`let _ =`). If `create_memory` wiring breaks, interactions stop producing memories and the Knowledge inbox silently goes empty — a no-error regression.
- **Root cause**: The communication-to-memory bridge is only covered indirectly (the truncation helper alone); the branch selection and "memory actually created" assertion are missing.
- **Impact**: Channel activity stops surfacing for review; the twin never accumulates approved memories, so readiness/score stalls and recall stays thin — invisible because nothing errors.
- **Fix sketch**: Rust test: `record_interaction(..., create_memory=true)` with a summary, then `list_pending_memories(twin, Some("pending"))` and assert exactly one memory exists with content `"[channel] summary"` and the expected title. Second case with `create_memory=false` asserts zero memories. Edge: long multi-byte `content` with no summary asserts the title/content branch and that no panic occurs (links to the existing truncation guard).

## 6. `TwinPicker` ordering + `relativeFromIso` are pure logic with no test
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/plugins/twin/shared/TwinPicker.tsx:53-127
- **Current test state**: none
- **Scenario**: Two non-trivial pure functions ship untested: the three-tier `ordered` sort (active-first, then pinned by recency, then unpinned by recency, with name as tiebreak on equal `updated_at`) and `relativeFromIso` (locale-aware "2d ago" that must return `''` for null/unparseable/future timestamps). The sort encodes a deliberate product rule ("pinning beats recency"); a refactor reordering the tiers, or `relativeFromIso` rendering a future stamp instead of `''`, is a real UX regression that no test would flag. (The `matches` name/role filter is also trivially testable here.)
- **Root cause**: TwinPicker has only the readiness/popover siblings tested; this picker's logic is inline and uncovered.
- **Impact**: Twin selection list mis-orders (active twin not pinned to top, pins ignored) or shows nonsensical relative times — low blast radius but high visibility on a core navigation control.
- **Fix sketch**: **llm-generatable** vitest batch (extract `matches`, `relativeFromIso`, and the `ordered` comparator, or test via a small harness). Assert: active twin is always index 0; a pinned non-active twin sorts above an unpinned more-recent one; equal `updated_at` falls back to name order; `relativeFromIso` returns `''` for `null`, `'not-a-date'`, and a future ISO, and a non-empty string for a past one. Use a fixed `Date.now()` (fake timers) so the relative-time assertions are deterministic — invariant: ordering rules, not exact phrasing.

## 7. `unique_slug` collision-suffix logic is untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/twin.rs:63-82
- **Current test state**: exists-but-weak (`slugify` is tested; `unique_slug` is not)
- **Scenario**: `unique_slug` appends `-2`, `-3`, ... when a slug already exists, and the slug becomes the twin's `obsidian_subpath` (`personas/twins/{slug}`) — i.e. a filesystem path. Two twins named "Founder Twin" must not collide on subpath. The suffix loop is untested; an off-by-one or wrong base-string concat would either infinite-loop or produce duplicate subpaths (two twins writing to the same vault folder).
- **Root cause**: Only the string-level `slugify` is tested; the DB-aware uniqueness resolver isn't.
- **Impact**: Two twins share an Obsidian vault folder — cross-twin note overwrite / data loss on a sync surface.
- **Fix sketch**: Rust test: create two twins with the same name via `create_profile`, assert the second's `slug` is `<base>-2` and its `obsidian_subpath` differs from the first's. Invariant: distinct twins get distinct slugs/subpaths.

## 8. CoachMark dismissal persistence has no test
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/features/plugins/twin/CoachMark.tsx:13-48
- **Current test state**: none
- **Scenario**: Dismissal writes `twin.coachmarks.{id} = '1'` to localStorage and the synchronous `readDismissed` init prevents an already-dismissed mark from flashing in; the `prevIdRef` render-time re-derive handles subtab switches. Low business value, but the "never reappears after dismiss" promise and the per-id isolation (dismissing tab A doesn't hide tab B's mark) are easy to break and currently unverified.
- **Root cause**: Plugin UI hints aren't covered; localStorage read/write is inline.
- **Impact**: Coach marks re-appear after dismissal or wrongly stay hidden across tabs — minor annoyance, not data risk.
- **Fix sketch**: vitest + testing-library: render with id "x", click dismiss, assert it unmounts and `localStorage['twin.coachmarks.x'] === '1'`; re-render with same id asserts it renders nothing; re-render with id "y" asserts it shows. Mock/stub localStorage to keep it deterministic and isolated.

---
### Suite-health note (not a numbered finding)
`vitest.config.ts` defines no `coverage.thresholds` — there is no gate at all. Given the critical untested write paths above, a calibrated **new-code ratchet** (e.g. require coverage on changed `src/api/twin/*` and `src-tauri/src/db/repos/twin.rs` lines, advisory at first) would catch the next regression without demanding a giant backfill. Existing TS tests are well-structured (factory helpers, behavior-over-impl); the gap is the Rust repo write layer and the API trust-boundary, not the already-strong `deriveReadiness` / popover suite.
