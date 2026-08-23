//! Pre-export accounting: what a bundle would contain.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// Pool-level body of [`get_export_stats`] — split out so unit tests can
/// exercise the counters without constructing a Tauri `State`.
///
/// `user_db` is the second database file. Athena's brain lives there, not in
/// the app database the rest of these counters read, so `None` simply reports
/// her tiers as empty rather than failing.
pub(crate) fn compute_export_stats(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
) -> Result<ExportStats, AppError> {
    let personas = persona_repo::get_all(pool)?;
    let tools = tool_repo::get_all_definitions(pool)?;
    let teams = team_repo::get_all(pool)?;
    let credentials = cred_repo::get_all(pool)?;

    // Scalar COUNTs for the preview numbers. The previous per-persona loops
    // ran 2 queries per persona (200+ sequential queries on a big workspace)
    // and list_by_persona hydrated full test_suites rows — including the
    // up-to-500KB scenarios blob — just to .len() them. The stats are
    // workspace-wide, so plain aggregates are both correct and O(1) queries.
    let conn = pool.get()?;
    let scalar_count = |sql: &str| -> Result<u32, AppError> {
        Ok(conn
            .query_row(sql, [], |r| r.get::<_, i64>(0))
            .map_err(crate::error::AppError::Database)? as u32)
    };
    let memory_count = scalar_count("SELECT COUNT(*) FROM persona_memories")?;
    let test_suite_count = scalar_count("SELECT COUNT(*) FROM test_suites")?;
    let team_memory_count = scalar_count("SELECT COUNT(*) FROM team_memories")?;
    // KPIs that are part of a live "setup" — active or paused (proposed = review
    // queue, archived = retired; neither travels). Matches the export filter
    // (is_exportable_kpi).
    let kpi_count =
        scalar_count("SELECT COUNT(*) FROM dev_kpis WHERE status IN ('active', 'paused')")
            .unwrap_or(0);
    // Dev-tools tables arrive via incremental migrations — tolerate their
    // absence on very old databases the same way kpi_count does.
    let dev_project_count = scalar_count("SELECT COUNT(*) FROM dev_projects").unwrap_or(0);
    let workspace_knowledge_count =
        scalar_count("SELECT COUNT(*) FROM workspace_knowledge").unwrap_or(0);
    let twin_count = scalar_count("SELECT COUNT(*) FROM twin_profiles").unwrap_or(0);

    // Athena's two tiers. Counted, never read: this is the modal's preview, so
    // it must not open a single markdown file. The picker hides a tier whose
    // count is 0, which is why "identity.md exists" is worth one point.
    let (athena_core_count, athena_learned_count) = athena_tier_counts(pool, user_db);

    // Pre-flight cap forecast. Only the workspace-wide top-level caps can be
    // checked from scalar counts; per-entity caps (a single twin's 5k-message
    // history, a project's skills) are reported by the export itself through
    // the bundle's `export_warnings`.
    //
    // The two behaviours are NOT the same and the message must not blur them:
    // projects / KPIs / twins truncate on the way out, while personas / tools /
    // teams / credentials are not capped by the exporter at all — an oversize
    // bundle writes fine and is then REJECTED by `validate_bundle` on the way
    // in. That asymmetry is pre-existing; naming it is the least this preview
    // can do.
    let mut warnings = Vec::new();
    let truncates = |w: &mut Vec<String>, label: &str, have: u32, cap: usize| {
        if have as usize > cap {
            w.push(format!(
                "{label}: this workspace has {have}, but an export carries at most {cap} — {} will be left behind.",
                have as usize - cap
            ));
        }
    };
    let rejects = |w: &mut Vec<String>, label: &str, have: u32, cap: usize| {
        if have as usize > cap {
            w.push(format!(
                "{label}: this workspace has {have}, over the {cap} an import accepts. The file will be written but refused when imported — split the selection."
            ));
        }
    };
    rejects(
        &mut warnings,
        "Personas",
        personas.len() as u32,
        MAX_PERSONAS,
    );
    rejects(&mut warnings, "Tools", tools.len() as u32, MAX_TOOLS);
    rejects(&mut warnings, "Teams", teams.len() as u32, MAX_TEAMS);
    rejects(
        &mut warnings,
        "Credentials",
        credentials.len() as u32,
        MAX_CREDENTIALS,
    );
    truncates(&mut warnings, "KPIs", kpi_count, MAX_KPIS);
    truncates(
        &mut warnings,
        "Projects",
        dev_project_count,
        MAX_DEV_PROJECTS,
    );
    truncates(&mut warnings, "Twins", twin_count, MAX_TWINS);

    Ok(ExportStats {
        persona_count: personas.len() as u32,
        tool_count: tools.len() as u32,
        team_count: teams.len() as u32,
        credential_count: credentials.len() as u32,
        memory_count,
        team_memory_count,
        test_suite_count,
        kpi_count,
        dev_project_count,
        workspace_knowledge_count,
        twin_count,
        athena_core_count,
        athena_learned_count,
        warnings,
    })
}

/// `(core, learned)` sizes for the export preview. Never fails: a machine with
/// no companion schema (very old database, or a unit test with no user pool)
/// simply reports `(0, 0)` and the picker hides both rows.
pub(crate) fn athena_tier_counts(pool: &DbPool, user_db: Option<&UserDbPool>) -> (u32, u32) {
    let mut core = 0u32;
    // identity.md on disk — one point, because "she has an identity" is the
    // difference between an offerable tier and a hidden one.
    if crate::companion::disk::brain_root()
        .map(|r| r.join("identity.md").is_file())
        .unwrap_or(false)
    {
        core += 1;
    }
    for key in ATHENA_PORTABLE_PREF_KEYS {
        if matches!(settings_repo::get(pool, key), Ok(Some(_))) {
            core += 1;
        }
    }

    let Some(user_db) = user_db else {
        return (core, 0);
    };
    let Ok(conn) = user_db.get() else {
        return (core, 0);
    };
    let count = |sql: &str| -> u32 {
        conn.query_row(sql, [], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
            .max(0) as u32
    };
    core += count("SELECT COUNT(*) FROM companion_session");
    let kinds = athena_kind_list();
    let learned = count(&format!(
        "SELECT COUNT(*) FROM companion_node WHERE kind IN ({kinds})"
    )) + count("SELECT COUNT(*) FROM companion_design_decision");
    (core, learned)
}
