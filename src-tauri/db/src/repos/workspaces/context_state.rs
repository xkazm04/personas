use crate::models::PracticeContextRollup;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension};

use super::org::applicability_matches;
use std::collections::HashMap;

/// Mechanical envelope verdict for one (practice, context) pair.
///
/// This writer is deliberately only allowed two answers: `na` ("surely does
/// not apply here") and `unverified` ("maybe — nobody has looked"). The 2026-07
/// probe experiments measured a 3-of-7 false-positive rate for mechanical
/// "yes" verdicts on known-good code, which is why `adopted`/`violating` are
/// reserved for the evidence-citing verify lane. Fail OPEN throughout: when
/// unsure, `unverified`, never `na`.
pub fn envelope_context_state(
    applicability: Option<&str>,
    topic: Option<&str>,
    context_tech_stack: Option<&str>,
    context_category: Option<&str>,
) -> &'static str {
    // (a) The practice's own applicability envelope vs the CONTEXT's stack —
    // but only when the context actually declares a stack; an empty stack is
    // "unknown", and unknown must never resolve to na.
    let ctx_stack_known = context_tech_stack.is_some_and(|s| !s.trim().is_empty());
    if ctx_stack_known && !applicability_matches(applicability, context_tech_stack) {
        return "na";
    }
    // (b) Coarse area × category disjoints — ONLY the pairs that are clearly
    // impossible. A frontend/* practice has nothing to say inside a pure Rust
    // command surface or a data-layer context. Everything else (lib, test,
    // config, unknown) stays unverified: a `lib` folder can hold UI helpers.
    let area = topic.unwrap_or("").split('/').next().unwrap_or("");
    let category = context_category.unwrap_or("").trim();
    if area == "frontend" && matches!(category, "api" | "data") {
        return "na";
    }
    "unverified"
}

/// Seed missing (adopted practice × member context) cells and drop cells for
/// practices that have left `adopted`. Idempotent; NEVER touches a verified
/// cell — `adopted`/`violating` verdicts belong to the verify lane alone.
pub fn seed_practice_context_cells(pool: &DbPool, workspace_id: &str) -> Result<u32, AppError> {
    timed_query!(
        "dev_workspaces",
        "dev_workspaces::seed_practice_context_cells",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let mut conn = pool.get()?;
            let tx = conn.transaction()?;

            // Cells for practices no longer adopted are noise in every denominator.
            tx.execute(
                "DELETE FROM workspace_practice_context_state
             WHERE practice_id IN (
                 SELECT id FROM workspace_knowledge
                 WHERE workspace_id = ?1 AND status != 'adopted'
             )",
                params![workspace_id],
            )?;

            let practices: Vec<(String, Option<String>, Option<String>)> = {
                let mut stmt = tx.prepare(
                    "SELECT id, applicability, topic FROM workspace_knowledge
                 WHERE workspace_id = ?1 AND status = 'adopted'",
                )?;
                let rows = stmt
                    .query_map(params![workspace_id], |r| {
                        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };

            // (context, project, name, tech_stack, category) for every member repo.
            let contexts: Vec<(String, String, String, Option<String>, Option<String>)> = {
                // FOREIGN TABLE: dev_contexts is owned by `repos::dev::contexts` and
                // dev_projects by `repos::dev::projects`.
                let mut stmt = tx.prepare(
                    "SELECT c.id, c.project_id, c.name, c.tech_stack, c.category
                 FROM dev_contexts c
                 JOIN dev_projects p ON p.id = c.project_id
                 WHERE p.workspace_id = ?1",
                )?;
                let rows = stmt
                    .query_map(params![workspace_id], |r| {
                        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };

            let mut inserted = 0u32;
            {
                let mut stmt = tx.prepare(
                    "INSERT OR IGNORE INTO workspace_practice_context_state
                     (practice_id, project_id, context_id, context_name, state, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )?;
                for (pid, applicability, topic) in &practices {
                    for (cid, project_id, name, stack, category) in &contexts {
                        let state = envelope_context_state(
                            applicability.as_deref(),
                            topic.as_deref(),
                            stack.as_deref(),
                            category.as_deref(),
                        );
                        inserted +=
                            stmt.execute(params![pid, project_id, cid, name, state, now])? as u32;
                    }
                }
            }

            tx.commit()?;
            Ok(inserted)
        }
    )
}

/// Per-practice adherence rollup — the one number the graph's rings show.
/// `applicable` excludes `na` by construction; a practice whose every cell is
/// `na` simply reports `applicable = 0` and the UI draws no ring.
pub fn practice_context_rollup(
    pool: &DbPool,
    workspace_id: &str,
    project_id: Option<&str>,
) -> Result<Vec<PracticeContextRollup>, AppError> {
    timed_query!(
        "dev_workspaces",
        "dev_workspaces::practice_context_rollup",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT s.practice_id,
                    SUM(CASE WHEN s.state = 'adopted'    THEN 1 ELSE 0 END),
                    SUM(CASE WHEN s.state = 'violating'  THEN 1 ELSE 0 END),
                    SUM(CASE WHEN s.state = 'unverified' THEN 1 ELSE 0 END)
             FROM workspace_practice_context_state s
             JOIN workspace_knowledge k ON k.id = s.practice_id
             WHERE k.workspace_id = ?1
               AND (?2 IS NULL OR s.project_id = ?2)
               AND s.state != 'na'
             GROUP BY s.practice_id",
            )?;
            let rows = stmt
                .query_map(params![workspace_id, project_id], |r| {
                    let adopted: i32 = r.get(1)?;
                    let violating: i32 = r.get(2)?;
                    let unverified: i32 = r.get(3)?;
                    Ok(PracticeContextRollup {
                        practice_id: r.get(0)?,
                        adopted,
                        violating,
                        unverified,
                        applicable: adopted + violating + unverified,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    )
}

/// What one verify ingest actually attributed (docs/concepts/pattern-context-trace.md W2).
///
/// `unattributed` is the report-denominator rule made structural: a cited file
/// that resolves to no context is RETURNED, never silently dropped. A run that
/// attributed 2 of 9 citations must be distinguishable from one that attributed
/// all 2 it had.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AttributionSummary {
    pub adopted_cells: i32,
    pub violating_cells: i32,
    pub unattributed: Vec<String>,
}

/// Normalize a cited path for matching against `dev_contexts.file_paths`.
///
/// Verifiers cite files the way humans write them — `./src/foo.rs`,
/// `src\bar.rs:120`, `` `src/baz.rs` `` — while the context map stores plain
/// forward-slash repo-relative paths. Everything that is not the path itself is
/// stripped here so the two sides can meet: surrounding punctuation, a
/// `:line` / `:line:col` suffix, backslashes, a leading `./` or `/`.
///
/// Case is folded because this repo's own primary host is Windows, where the
/// same file legitimately appears with different casing in two citations.
pub fn normalize_repo_path(raw: &str) -> String {
    let mut s = raw.trim();
    // Strip wrapping punctuation the model reliably adds around paths.
    s = s.trim_matches(|c: char| {
        matches!(
            c,
            '`' | '"' | '\'' | '(' | ')' | '[' | ']' | ',' | ';' | '*'
        )
    });
    let mut s = s.replace('\\', "/");
    // `path:120` / `path:120:8` — drop trailing numeric coordinates only.
    while let Some(idx) = s.rfind(':') {
        let tail = &s[idx + 1..];
        if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
            s.truncate(idx);
        } else {
            break;
        }
    }
    let trimmed = s.trim().trim_end_matches('.');
    let trimmed = trimmed.strip_prefix("./").unwrap_or(trimmed);
    trimmed.trim_start_matches('/').to_lowercase()
}

/// Pull path-looking tokens out of a free-text evidence string.
///
/// The verify contract now asks for explicit `applied_files`/`absent_files`
/// arrays, but every verdict written before that (and every session that
/// ignores the new fields) still carries its citations inside the prose
/// `evidence` field — the prompt has always demanded "with file:line". Throwing
/// those away would make attribution silently depend on a model remembering a
/// new field, so this is the fallback reader.
///
/// A token counts as a path when it contains a `/` and its last segment looks
/// like `name.ext`. Deliberately narrow: a false path costs a wrong context
/// attribution, which is exactly the "false green" this table exists to kill.
pub fn extract_file_citations(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in text.split_whitespace() {
        let token = raw.trim_matches(|c: char| {
            matches!(
                c,
                '`' | '"' | '\'' | '(' | ')' | '[' | ']' | ',' | ';' | '*'
            )
        });
        if token.is_empty() || !(token.contains('/') || token.contains('\\')) {
            continue;
        }
        let normalized = normalize_repo_path(token);
        let Some(last) = normalized.rsplit('/').next() else {
            continue;
        };
        let looks_like_file = last.rsplit_once('.').is_some_and(|(stem, ext)| {
            !stem.is_empty()
                && !ext.is_empty()
                && ext.len() <= 5
                && ext.chars().all(|c| c.is_ascii_alphanumeric())
        });
        if !looks_like_file {
            continue;
        }
        // Keep the ORIGINAL token as the evidence citation (it carries the
        // line number); dedupe on the normalized form.
        if !out.iter().any(|k| normalize_repo_path(k) == normalized) {
            out.push(token.to_string());
        }
    }
    out
}

/// One context's resolved verdict from a single verify run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextAttribution {
    pub context_id: String,
    pub context_name: String,
    /// `adopted` or `violating` — this lane writes nothing else.
    pub state: &'static str,
    /// The citing file paths, as cited.
    pub evidence: Vec<String>,
}

/// Pure attribution: map cited files onto contexts and resolve each context to
/// one verdict.
///
/// `contexts` is `(id, name, file_paths)` with `file_paths` already parsed.
/// Rules (pattern-context-trace.md W2):
/// - an `applied` citation inside a context → that context follows the practice;
/// - an `absent` citation → it does not;
/// - **both in one run for one context → `violating` wins.** A context that
///   half-follows a practice is work owed, and calling it adopted is the false
///   green the whole table exists to prevent.
/// - a file that lands in no context is returned in `unattributed`.
///
/// Matching is by normalized repo-relative path, with a suffix fallback so an
/// absolute citation (`C:/repo/src/a.rs`) still finds `src/a.rs`.
pub fn attribute_files_to_contexts(
    contexts: &[(String, String, Vec<String>)],
    applied_files: &[String],
    absent_files: &[String],
) -> (Vec<ContextAttribution>, Vec<String>) {
    // normalized file path -> context index
    let mut by_path: HashMap<String, usize> = HashMap::new();
    for (i, (_, _, paths)) in contexts.iter().enumerate() {
        for p in paths {
            let key = normalize_repo_path(p);
            if !key.is_empty() {
                by_path.entry(key).or_insert(i);
            }
        }
    }

    // Exact, then progressively drop leading segments (absolute paths, or a
    // citation prefixed with the repo folder name).
    let resolve = |cited: &str| -> Option<usize> {
        let norm = normalize_repo_path(cited);
        if norm.is_empty() {
            return None;
        }
        if let Some(i) = by_path.get(&norm) {
            return Some(*i);
        }
        let mut rest = norm.as_str();
        while let Some((_, tail)) = rest.split_once('/') {
            if let Some(i) = by_path.get(tail) {
                return Some(*i);
            }
            rest = tail;
        }
        None
    };

    // context index -> (saw_absent, evidence)
    let mut hits: HashMap<usize, (bool, Vec<String>)> = HashMap::new();
    let mut order: Vec<usize> = Vec::new();
    let mut unattributed: Vec<String> = Vec::new();

    let ingest = |cited: &str,
                  is_absent: bool,
                  hits: &mut HashMap<usize, (bool, Vec<String>)>,
                  order: &mut Vec<usize>,
                  unattributed: &mut Vec<String>| {
        if cited.trim().is_empty() {
            return;
        }
        match resolve(cited) {
            Some(i) => {
                let entry = hits.entry(i).or_insert_with(|| {
                    order.push(i);
                    (false, Vec::new())
                });
                entry.0 |= is_absent;
                let c = cited.trim().to_string();
                if !entry.1.contains(&c) {
                    entry.1.push(c);
                }
            }
            None => {
                let c = cited.trim().to_string();
                if !unattributed.contains(&c) {
                    unattributed.push(c);
                }
            }
        }
    };

    for f in applied_files {
        ingest(f, false, &mut hits, &mut order, &mut unattributed);
    }
    for f in absent_files {
        ingest(f, true, &mut hits, &mut order, &mut unattributed);
    }

    let resolved = order
        .into_iter()
        .filter_map(|i| {
            let (saw_absent, evidence) = hits.remove(&i)?;
            let (id, name, _) = &contexts[i];
            Some(ContextAttribution {
                context_id: id.clone(),
                context_name: name.clone(),
                state: if saw_absent { "violating" } else { "adopted" },
                evidence,
            })
        })
        .collect();
    (resolved, unattributed)
}

/// Verify ingest — W2, the ONLY writer allowed to set `adopted`/`violating`.
///
/// Takes the file citations a verify verdict produced for ONE practice in ONE
/// project and turns them into context cells. Two invariants:
///
/// 1. **Evidence or nothing.** Only cited contexts are written; a context the
///    session never mentioned keeps whatever it had. In particular an existing
///    `adopted` cell is NEVER downgraded to `unverified` here — ageing verdicts
///    out is W3 (staleness decay), and doing it on silence would make every
///    partial run look like a regression.
/// 2. **New evidence rules.** A cell may flip `adopted` ⇄ `violating` freely;
///    the newest cited verdict is the current truth.
pub fn apply_verified_context_evidence(
    pool: &DbPool,
    workspace_id: &str,
    project_id: &str,
    practice_id: &str,
    applied_files: &[String],
    absent_files: &[String],
) -> Result<AttributionSummary, AppError> {
    timed_query!(
        "dev_workspaces",
        "dev_workspaces::apply_verified_context_evidence",
        {
            let mut conn = pool.get()?;

            // The practice must belong to the workspace being verified — a stray id
            // would write cells nobody can ever see (or roll up).
            let owned: bool = conn
                .query_row(
                    "SELECT 1 FROM workspace_knowledge WHERE id = ?1 AND workspace_id = ?2",
                    params![practice_id, workspace_id],
                    |r| r.get::<_, i64>(0),
                )
                .optional()?
                .is_some();
            if !owned {
                return Err(AppError::Validation(format!(
                    "Practice {practice_id} is not in workspace {workspace_id}"
                )));
            }

            let contexts: Vec<(String, String, Vec<String>)> = {
                // FOREIGN TABLE: dev_contexts is owned by `repos::dev::contexts`.
                let mut stmt = conn.prepare(
                    "SELECT id, name, file_paths FROM dev_contexts WHERE project_id = ?1",
                )?;
                let rows = stmt
                    .query_map(params![project_id], |r| {
                        let paths_json: String = r.get(2)?;
                        let paths: Vec<String> =
                            serde_json::from_str(&paths_json).unwrap_or_default();
                        Ok((r.get(0)?, r.get(1)?, paths))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };

            let (resolved, unattributed) =
                attribute_files_to_contexts(&contexts, applied_files, absent_files);

            let now = chrono::Utc::now().to_rfc3339();
            let mut adopted_cells = 0i32;
            let mut violating_cells = 0i32;
            {
                let tx = conn.transaction()?;
                {
                    let mut stmt = tx.prepare(
                        "INSERT INTO workspace_practice_context_state
                         (practice_id, project_id, context_id, context_name,
                          state, evidence, verified_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                     ON CONFLICT(practice_id, context_id) DO UPDATE SET
                         project_id   = excluded.project_id,
                         context_name = excluded.context_name,
                         state        = excluded.state,
                         evidence     = excluded.evidence,
                         verified_at  = excluded.verified_at,
                         updated_at   = excluded.updated_at",
                    )?;
                    for a in &resolved {
                        let evidence =
                            serde_json::to_string(&a.evidence).unwrap_or_else(|_| "[]".into());
                        stmt.execute(params![
                            practice_id,
                            project_id,
                            a.context_id,
                            a.context_name,
                            a.state,
                            evidence,
                            now,
                        ])?;
                        if a.state == "violating" {
                            violating_cells += 1;
                        } else {
                            adopted_cells += 1;
                        }
                    }
                }
                tx.commit()?;
            }

            Ok(AttributionSummary {
                adopted_cells,
                violating_cells,
                unattributed,
            })
        }
    )
}

// ============================================================================
// Pattern fabric F0 — typed pattern edges (docs/concepts/pattern-fabric.md S2)
// ============================================================================

#[cfg(test)]
mod context_trace_tests {
    use super::*;

    #[test]
    fn envelope_may_only_say_maybe_or_surely_not() {
        // No envelope, no topic, no context metadata → unverified (fail open).
        assert_eq!(envelope_context_state(None, None, None, None), "unverified");
        // Stack mismatch with a KNOWN context stack → na.
        assert_eq!(
            envelope_context_state(
                Some("{\"frameworks\":[\"react\"]}"),
                Some("frontend/state"),
                Some("Rust, tokio"),
                Some("lib"),
            ),
            "na"
        );
        // Same mismatch but the context declares NO stack → unknown must never
        // resolve to na.
        assert_eq!(
            envelope_context_state(
                Some("{\"frameworks\":[\"react\"]}"),
                Some("frontend/state"),
                None,
                Some("lib"),
            ),
            "unverified"
        );
        assert_eq!(
            envelope_context_state(
                Some("{\"frameworks\":[\"react\"]}"),
                Some("frontend/state"),
                Some("   "),
                Some("lib"),
            ),
            "unverified"
        );
        // Area × category: frontend practice in an api/data context → na …
        assert_eq!(
            envelope_context_state(None, Some("frontend/components"), None, Some("api")),
            "na"
        );
        assert_eq!(
            envelope_context_state(None, Some("frontend/forms"), None, Some("data")),
            "na"
        );
        // … but lib/test/ui stay open — a lib folder can hold UI helpers.
        assert_eq!(
            envelope_context_state(None, Some("frontend/components"), None, Some("lib")),
            "unverified"
        );
        assert_eq!(
            envelope_context_state(None, Some("frontend/components"), None, Some("ui")),
            "unverified"
        );
        // Non-frontend areas never hit the category rule.
        assert_eq!(
            envelope_context_state(None, Some("data/queries"), None, Some("ui")),
            "unverified"
        );
        // Malformed applicability fails open even with a known stack.
        assert_eq!(
            envelope_context_state(Some("not json"), None, Some("Rust"), Some("api")),
            "unverified"
        );
    }

    // ── W2 verify ingest ────────────────────────────────────────────────────

    fn ctx(id: &str, name: &str, paths: &[&str]) -> (String, String, Vec<String>) {
        (
            id.to_string(),
            name.to_string(),
            paths.iter().map(|p| p.to_string()).collect(),
        )
    }

    #[test]
    fn normalizes_the_shapes_verifiers_actually_cite() {
        assert_eq!(normalize_repo_path("src/a.rs"), "src/a.rs");
        assert_eq!(normalize_repo_path("./src/a.rs"), "src/a.rs");
        assert_eq!(normalize_repo_path("src\\a.rs"), "src/a.rs");
        assert_eq!(normalize_repo_path("`src/a.rs:120`"), "src/a.rs");
        assert_eq!(normalize_repo_path("src/a.rs:120:8"), "src/a.rs");
        assert_eq!(normalize_repo_path("/src/a.rs"), "src/a.rs");
        assert_eq!(normalize_repo_path("SRC/A.rs"), "src/a.rs");
        // A colon that is not a line number is part of the path, not a suffix.
        assert_eq!(normalize_repo_path("C:/repo/src/a.rs"), "c:/repo/src/a.rs");
    }

    #[test]
    fn applied_and_absent_citations_become_adopted_and_violating_cells() {
        let contexts = vec![
            ctx("c-ui", "UI Shell", &["src/ui/App.tsx", "src/ui/Nav.tsx"]),
            ctx("c-db", "DB Layer", &["src-tauri/db/src/repos/x.rs"]),
        ];
        let (resolved, unattributed) = attribute_files_to_contexts(
            &contexts,
            &["src/ui/App.tsx:12".into()],
            &["src-tauri/db/src/repos/x.rs".into()],
        );
        assert!(unattributed.is_empty());
        let ui = resolved.iter().find(|a| a.context_id == "c-ui").unwrap();
        assert_eq!(ui.state, "adopted");
        assert_eq!(ui.context_name, "UI Shell");
        assert_eq!(ui.evidence, vec!["src/ui/App.tsx:12".to_string()]);
        let db = resolved.iter().find(|a| a.context_id == "c-db").unwrap();
        assert_eq!(db.state, "violating");
    }

    #[test]
    fn a_context_cited_both_ways_in_one_run_is_violating() {
        // Half-following a practice is work owed — `violating` wins, in either
        // citation order, and BOTH citations survive as evidence.
        let contexts = vec![ctx("c1", "One", &["src/a.rs", "src/b.rs"])];
        for (applied, absent) in [
            (vec!["src/a.rs".to_string()], vec!["src/b.rs".to_string()]),
            (vec!["src/b.rs".to_string()], vec!["src/a.rs".to_string()]),
        ] {
            let (resolved, _) = attribute_files_to_contexts(&contexts, &applied, &absent);
            assert_eq!(resolved.len(), 1);
            assert_eq!(resolved[0].state, "violating");
            assert_eq!(resolved[0].evidence.len(), 2);
        }
    }

    #[test]
    fn absolute_citations_still_find_their_context_by_suffix() {
        let contexts = vec![ctx("c1", "One", &["src/a.rs"])];
        let (resolved, unattributed) =
            attribute_files_to_contexts(&contexts, &["C:/Users/dev/repo/src/a.rs:9".into()], &[]);
        assert!(unattributed.is_empty(), "absolute path should resolve");
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].state, "adopted");
    }

    #[test]
    fn files_matching_no_context_are_reported_never_dropped() {
        let contexts = vec![ctx("c1", "One", &["src/a.rs"])];
        let (resolved, unattributed) = attribute_files_to_contexts(
            &contexts,
            &["src/a.rs".into(), "vendor/lib.js".into()],
            &["scripts/build.mjs".into(), "scripts/build.mjs".into()],
        );
        assert_eq!(resolved.len(), 1);
        assert_eq!(
            unattributed,
            vec!["vendor/lib.js".to_string(), "scripts/build.mjs".to_string()],
            "unmatched files are returned once each, never silently dropped"
        );
    }

    #[test]
    fn free_text_evidence_yields_its_file_citations() {
        let text = "Followed in `src/ui/App.tsx:120` and src-tauri/db/src/x.rs:9, \
                    but see the note about src/ui (a directory) and version 4.2.";
        let cites = extract_file_citations(text);
        assert_eq!(
            cites,
            vec![
                "src/ui/App.tsx:120".to_string(),
                "src-tauri/db/src/x.rs:9".to_string()
            ]
        );
        // Prose with no paths yields nothing rather than guessing.
        assert!(extract_file_citations("The check was inconclusive.").is_empty());
    }

    // ── the DB door ─────────────────────────────────────────────────────────

    fn seeded_pool() -> DbPool {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO dev_workspaces (id, name, created_at, updated_at)
                VALUES ('ws1', 'WS', '2026-01-01', '2026-01-01');
             INSERT INTO dev_projects (id, name, root_path, workspace_id)
                VALUES ('p1', 'P', '/tmp/p1', 'ws1');
             INSERT INTO workspace_knowledge
                 (id, workspace_id, kind, title, statement, status, created_at, updated_at)
                VALUES ('k1', 'ws1', 'pattern', 'T', 'S', 'adopted', '2026-01-01', '2026-01-01');
             INSERT INTO dev_contexts (id, project_id, name, file_paths)
                VALUES ('c1', 'p1', 'One', '[\"src/a.rs\",\"src/b.rs\"]');
             INSERT INTO dev_contexts (id, project_id, name, file_paths)
                VALUES ('c2', 'p1', 'Two', '[\"src/c.rs\"]');",
        )
        .unwrap();
        pool
    }

    fn cell_state(pool: &DbPool, context_id: &str) -> Option<String> {
        pool.get()
            .unwrap()
            .query_row(
                "SELECT state FROM workspace_practice_context_state
                 WHERE practice_id = 'k1' AND context_id = ?1",
                params![context_id],
                |r| r.get(0),
            )
            .optional()
            .unwrap()
    }

    #[test]
    fn verify_ingest_writes_cells_and_may_flip_but_never_downgrades() {
        let pool = seeded_pool();

        // First pass: c1 follows, c2 does not.
        let s = apply_verified_context_evidence(
            &pool,
            "ws1",
            "p1",
            "k1",
            &["src/a.rs:4".into()],
            &["src/c.rs:9".into(), "docs/none.md".into()],
        )
        .unwrap();
        assert_eq!(s.adopted_cells, 1);
        assert_eq!(s.violating_cells, 1);
        assert_eq!(s.unattributed, vec!["docs/none.md".to_string()]);
        assert_eq!(cell_state(&pool, "c1").as_deref(), Some("adopted"));
        assert_eq!(cell_state(&pool, "c2").as_deref(), Some("violating"));
        let (evidence, verified_at): (String, Option<String>) = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT evidence, verified_at FROM workspace_practice_context_state
                 WHERE practice_id = 'k1' AND context_id = 'c1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(evidence, "[\"src/a.rs:4\"]");
        assert!(verified_at.is_some(), "a verdict must stamp verified_at");

        // Second pass: new evidence flips c1 the other way …
        let s2 =
            apply_verified_context_evidence(&pool, "ws1", "p1", "k1", &[], &["src/b.rs".into()])
                .unwrap();
        assert_eq!((s2.adopted_cells, s2.violating_cells), (0, 1));
        assert_eq!(cell_state(&pool, "c1").as_deref(), Some("violating"));
        // … and a context this run said NOTHING about keeps its verdict. Ageing
        // a verdict out is W3 decay's job, not silence's.
        assert_eq!(cell_state(&pool, "c2").as_deref(), Some("violating"));

        let s3 =
            apply_verified_context_evidence(&pool, "ws1", "p1", "k1", &["src/c.rs".into()], &[])
                .unwrap();
        assert_eq!(s3.adopted_cells, 1);
        assert_eq!(cell_state(&pool, "c2").as_deref(), Some("adopted"));
        assert_eq!(
            cell_state(&pool, "c1").as_deref(),
            Some("violating"),
            "an uncited adopted/violating cell is never downgraded"
        );
    }

    #[test]
    fn verify_ingest_refuses_a_practice_from_another_workspace() {
        let pool = seeded_pool();
        assert!(apply_verified_context_evidence(
            &pool,
            "ws-other",
            "p1",
            "k1",
            &["src/a.rs".into()],
            &[]
        )
        .is_err());
    }

    #[test]
    fn a_run_with_no_citations_writes_nothing() {
        let pool = seeded_pool();
        let s = apply_verified_context_evidence(&pool, "ws1", "p1", "k1", &[], &[]).unwrap();
        assert_eq!(s, AttributionSummary::default());
        assert_eq!(cell_state(&pool, "c1"), None);
    }
}
