//! Claude Code `CLAUDE.md` memory projection.
//!
//! Personas already inlines tiered persona memories into the system prompt
//! at every spawn (`engine/prompt/mod.rs:537`). That injection is lost on
//! `/compact`: Claude Code's compaction logic only re-reads `CLAUDE.md` from
//! disk, not the original system prompt. This module mirrors the same
//! tiered-memory selection (`get_for_injection_v2`) into the per-persona
//! `exec_dir` as native Claude Code memory files, so the model keeps the
//! context across compactions for free.
//!
//! ## Safety
//!
//! Opt-in via env var `PERSONAS_CLAUDE_MD_PROJECTION=1`. When unset,
//! `install_projection` is a complete no-op. Existing `CLAUDE.md` files in
//! the exec_dir are preserved — the projection only ever appends an
//! `@.claude/persona-memory.md` import line if it is not already there.
//!
//! ## Layering
//!
//! Both injection paths run in parallel during the dual-write phase. The
//! system-prompt injection ensures the model has the memories at session
//! start even when the env flag is off; the projection ensures they survive
//! compaction when the flag is on. Removing the system-prompt path is a
//! later cleanup once the projection is verified in production.

use std::path::Path;

use personas_core::error::AppError;
use personas_db::repos::core::memories as mem_repo;
use personas_db::DbPool;

/// Env var that gates the projection write. Unset → no-op.
pub const PROJECTION_ENV: &str = "PERSONAS_CLAUDE_MD_PROJECTION";

/// Memory file written under `<exec_dir>/.claude/`. Referenced from CLAUDE.md
/// via the `@` import syntax.
const MEMORY_FILE: &str = "persona-memory.md";

/// Default core / active limits for projection. Mirror the values used by
/// `assemble_prompt`'s in-memory injection so both surfaces show the same
/// material to the model.
const CORE_LIMIT: i64 = 10;
const ACTIVE_LIMIT: i64 = 40;

/// Character budget for the active tier, mirroring the system-prompt path.
///
/// `get_for_injection_v2` bounds the entry *count* (`CORE_LIMIT` /
/// `ACTIVE_LIMIT`) but not their size — the char budget lives downstream in
/// [`pack_by_budget`], which the runner applies before rendering its
/// `## Agent Memory` section. This module previously rendered straight from
/// the repo call and skipped that step, so the projected file could carry
/// materially more text than the system prompt it claims to mirror — and it is
/// imported into CLAUDE.md, which Claude Code prepends to *every* turn and
/// re-reads on `/compact`.
///
/// Core is deliberately not budgeted here: user-pinned is sacred and always
/// injected (MEMORY CONTRACT (1)), bounded by `CORE_LIMIT` rows.
const ACTIVE_MEM_BUDGET_CHARS: usize = personas_db::memory_recall::ACTIVE_MEM_BUDGET_CHARS;

/// Marker used inside an existing CLAUDE.md to detect a previous projection
/// pass and avoid duplicating the import line.
const IMPORT_LINE: &str = "@.claude/persona-memory.md";

/// Project the persona's tiered memories into the per-persona `exec_dir` as
/// `CLAUDE.md` + `.claude/persona-memory.md`. Returns `Ok(false)` when the
/// projection is disabled or there is nothing to project; `Ok(true)` when the
/// memory file was written and CLAUDE.md was created/updated.
///
/// Best-effort: I/O failures are logged via `tracing::warn` and surfaced as
/// `Ok(false)` so they cannot break the execution that owns this exec_dir.
pub fn install_projection(
    pool: &DbPool,
    exec_dir: &Path,
    persona_id: &str,
    use_case_id: Option<&str>,
) -> Result<bool, AppError> {
    if std::env::var(PROJECTION_ENV).ok().as_deref() != Some("1") {
        return Ok(false);
    }

    let mut tiered = match mem_repo::get_for_injection_v2(
        pool,
        mem_repo::InjectionScope::for_persona(persona_id).with_use_case(use_case_id),
        CORE_LIMIT,
        ACTIVE_LIMIT,
    ) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(error = %e, persona_id, "projection: memory fetch failed — skipping");
            return Ok(false);
        }
    };

    // Apply the same char budget the runner applies before rendering its
    // system-prompt memory section. Value-only pack: the ml task-aware variant
    // needs the run's input payload, which the projection does not have — and
    // the projected file has to stay valid across the whole session, not just
    // the opening turn, so task-blind is the correct ranking here.
    let packed = personas_db::memory_recall::pack_by_budget(
        std::mem::take(&mut tiered.active),
        ACTIVE_MEM_BUDGET_CHARS,
        chrono::Utc::now(),
    );
    tiered.active = packed.selected;

    if tiered.core.is_empty() && tiered.active.is_empty() {
        // No memories yet — skip the write so we don't litter CLAUDE.md with
        // a useless import line on first runs.
        return Ok(false);
    }

    let claude_dir = exec_dir.join(".claude");
    if let Err(e) = std::fs::create_dir_all(&claude_dir) {
        tracing::warn!(
            error = %e,
            dir = %claude_dir.display(),
            "projection: failed to create .claude/ — skipping"
        );
        return Ok(false);
    }

    let memory_md = render_memory_markdown(&tiered.core, &tiered.active, packed.omitted);
    if let Err(e) = std::fs::write(claude_dir.join(MEMORY_FILE), &memory_md) {
        tracing::warn!(
            error = %e,
            "projection: failed to write persona-memory.md — skipping"
        );
        return Ok(false);
    }

    if let Err(e) = ensure_import_in_claude_md(exec_dir) {
        tracing::warn!(error = %e, "projection: failed to update CLAUDE.md — skipping");
        return Ok(false);
    }

    tracing::debug!(
        persona_id,
        core = tiered.core.len(),
        active = tiered.active.len(),
        "projection: wrote tiered memories to exec_dir/.claude/persona-memory.md"
    );
    Ok(true)
}

/// Render the tiered memories as a Claude Code-readable markdown file. The
/// shape mirrors the system-prompt section in `engine/prompt`: core memories
/// are stable identity / preferences (always relevant), active memories are
/// scored learnings that may rotate run-to-run.
fn render_memory_markdown(
    core: &[personas_db::models::PersonaMemory],
    active: &[personas_db::models::PersonaMemory],
    omitted: usize,
) -> String {
    let mut out = String::new();
    out.push_str(
        "<!-- Auto-generated by personas claude_md_projection — do not edit by hand. -->\n",
    );
    out.push_str("<!-- Edits in this file will be overwritten on the next persona run. -->\n\n");
    out.push_str("# Persona Memory\n\n");
    out.push_str(
        "These are durable facts, preferences, and learnings the persona has accumulated \
across executions. Treat them as background context — they describe who the persona is \
and what it knows, not instructions to follow verbatim.\n\n",
    );

    if !core.is_empty() {
        out.push_str("## Core (always relevant)\n\n");
        for m in core {
            push_memory_entry(&mut out, m);
        }
    }

    if !active.is_empty() {
        out.push_str("## Active (scored, capability-scoped)\n\n");
        for m in active {
            push_memory_entry(&mut out, m);
        }
    }

    // Say what the budget dropped. Serving a partial set silently reads to the
    // model as "this is everything the persona knows"; the runner's
    // `## Agent Memory` section announces its omissions for the same reason.
    if omitted > 0 {
        let plural = if omitted == 1 { "memory" } else { "memories" };
        out.push_str(&format!(
            "\n_[{omitted} lower-ranked active {plural} omitted to stay within the \
{ACTIVE_MEM_BUDGET_CHARS}-character memory budget.]_\n"
        ));
    }

    out
}

fn push_memory_entry(out: &mut String, m: &personas_db::models::PersonaMemory) {
    out.push_str(&format!(
        "### {} _(category: {} · importance: {})_\n\n",
        m.title.trim(),
        m.category,
        m.importance
    ));
    out.push_str(m.content.trim());
    out.push_str("\n\n");
}

/// Ensure `<exec_dir>/CLAUDE.md` references `@.claude/persona-memory.md`.
/// Creates the file with a stub header + import if missing; otherwise appends
/// the import line iff it is not already present anywhere in the file.
fn ensure_import_in_claude_md(exec_dir: &Path) -> Result<(), AppError> {
    let claude_md = exec_dir.join("CLAUDE.md");

    if !claude_md.exists() {
        let body = format!(
            "<!-- personas exec_dir CLAUDE.md — auto-generated; safe to edit. -->\n\
             <!-- The line below imports persona memories regenerated each run. -->\n\
             {IMPORT_LINE}\n"
        );
        std::fs::write(&claude_md, body)
            .map_err(|e| AppError::Internal(format!("write CLAUDE.md: {e}")))?;
        return Ok(());
    }

    let existing = std::fs::read_to_string(&claude_md)
        .map_err(|e| AppError::Internal(format!("read CLAUDE.md: {e}")))?;
    if existing.contains(IMPORT_LINE) {
        return Ok(());
    }

    // Append on a fresh line. Preserve any trailing newline the user already
    // had so we don't double up.
    let mut updated = existing;
    if !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push('\n');
    updated.push_str(IMPORT_LINE);
    updated.push('\n');
    std::fs::write(&claude_md, updated)
        .map_err(|e| AppError::Internal(format!("update CLAUDE.md: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::init_test_db;
    use personas_db::models::{CreatePersonaInput, CreatePersonaMemoryInput};
    use personas_db::repos::core::{memories as mem_repo, personas};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn make_persona(pool: &DbPool, name: &str) -> String {
        personas::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    fn create_memory(
        pool: &DbPool,
        persona_id: &str,
        title: &str,
        tier: &str,
        importance: i32,
    ) -> String {
        let m = mem_repo::create(
            pool,
            CreatePersonaMemoryInput {
                persona_id: persona_id.to_string(),
                title: title.to_string(),
                content: format!("Body of {title}"),
                category: Some("fact".into()),
                source_execution_id: None,
                importance: Some(importance),
                tags: None,
                use_case_id: None,
            },
        )
        .unwrap();
        if tier != "active" {
            mem_repo::update_tier(pool, &m.id, tier).unwrap();
        }
        m.id
    }

    #[test]
    fn install_projection_is_noop_when_disabled() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var(PROJECTION_ENV);

        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Projection Off");
        create_memory(&pool, &persona_id, "Stable preference", "core", 5);

        let tmp = tempfile::tempdir().unwrap();
        let installed = install_projection(&pool, tmp.path(), &persona_id, None).unwrap();
        assert!(!installed);
        assert!(!tmp.path().join(".claude").exists());
        assert!(!tmp.path().join("CLAUDE.md").exists());
    }

    #[test]
    fn install_projection_skips_when_no_memories() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var(PROJECTION_ENV, "1");

        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "No Memories");

        let tmp = tempfile::tempdir().unwrap();
        let installed = install_projection(&pool, tmp.path(), &persona_id, None).unwrap();
        std::env::remove_var(PROJECTION_ENV);

        assert!(!installed, "no memories → no projection");
        assert!(!tmp.path().join("CLAUDE.md").exists());
    }

    fn create_fat_memory(pool: &DbPool, persona_id: &str, title: &str, chars: usize) {
        mem_repo::create(
            pool,
            CreatePersonaMemoryInput {
                persona_id: persona_id.to_string(),
                title: title.to_string(),
                // Content must differ per row — the repo dedups identical
                // bodies, which would silently collapse this fixture to one
                // memory and stop the budget from ever being exercised.
                content: format!("{title}: {}", "x".repeat(chars)),
                category: Some("fact".into()),
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: None,
            },
        )
        .unwrap();
    }

    /// The projected file is imported into CLAUDE.md, which Claude Code
    /// prepends to every turn. Before the budget was applied here, the file
    /// rendered straight from `get_for_injection_v2` — which caps rows, not
    /// characters — so 40 fat active memories could put hundreds of KB into
    /// every single turn of the session.
    #[test]
    fn active_tier_respects_the_shared_char_budget_and_says_what_it_dropped() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var(PROJECTION_ENV, "1");

        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Fat Memories");
        // 10 × 2000 chars = 20k of candidates against a 6k budget.
        for i in 0..10 {
            create_fat_memory(&pool, &persona_id, &format!("Bulky {i}"), 2000);
        }

        let tmp = tempfile::tempdir().unwrap();
        let installed = install_projection(&pool, tmp.path(), &persona_id, None).unwrap();
        std::env::remove_var(PROJECTION_ENV);
        assert!(installed);

        let mem_text =
            std::fs::read_to_string(tmp.path().join(".claude").join("persona-memory.md")).unwrap();

        assert!(
            mem_text.len() < ACTIVE_MEM_BUDGET_CHARS * 2,
            "projected file must stay near the budget, got {} chars",
            mem_text.len()
        );
        assert!(
            mem_text.contains("omitted"),
            "a partial memory set must announce itself, got:\n{mem_text}"
        );
    }

    #[test]
    fn install_projection_writes_memory_and_import_when_enabled() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var(PROJECTION_ENV, "1");

        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Projector");
        create_memory(&pool, &persona_id, "Always use ISO 8601", "core", 5);
        create_memory(&pool, &persona_id, "Recent learning", "active", 4);

        let tmp = tempfile::tempdir().unwrap();
        let installed = install_projection(&pool, tmp.path(), &persona_id, None).unwrap();
        std::env::remove_var(PROJECTION_ENV);
        assert!(installed);

        let mem_path = tmp.path().join(".claude").join("persona-memory.md");
        assert!(mem_path.exists());
        let mem_text = std::fs::read_to_string(&mem_path).unwrap();
        assert!(mem_text.contains("# Persona Memory"));
        assert!(mem_text.contains("## Core"));
        assert!(mem_text.contains("Always use ISO 8601"));
        assert!(mem_text.contains("## Active"));
        assert!(mem_text.contains("Recent learning"));

        let claude_md = std::fs::read_to_string(tmp.path().join("CLAUDE.md")).unwrap();
        assert!(claude_md.contains("@.claude/persona-memory.md"));
    }

    #[test]
    fn install_projection_preserves_existing_claude_md() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var(PROJECTION_ENV, "1");

        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Preserver");
        create_memory(&pool, &persona_id, "A core fact", "core", 5);

        let tmp = tempfile::tempdir().unwrap();
        let user_content = "# My Project\n\nUse 2-space indent. Run npm test before commits.\n";
        std::fs::write(tmp.path().join("CLAUDE.md"), user_content).unwrap();

        let installed = install_projection(&pool, tmp.path(), &persona_id, None).unwrap();
        std::env::remove_var(PROJECTION_ENV);
        assert!(installed);

        let updated = std::fs::read_to_string(tmp.path().join("CLAUDE.md")).unwrap();
        assert!(
            updated.contains("Use 2-space indent"),
            "user content preserved"
        );
        assert!(updated.contains("npm test"));
        assert!(
            updated.contains("@.claude/persona-memory.md"),
            "import appended"
        );
    }

    #[test]
    fn install_projection_idempotent_on_repeat_runs() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var(PROJECTION_ENV, "1");

        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Idempotent");
        create_memory(&pool, &persona_id, "A core fact", "core", 5);

        let tmp = tempfile::tempdir().unwrap();
        install_projection(&pool, tmp.path(), &persona_id, None).unwrap();
        install_projection(&pool, tmp.path(), &persona_id, None).unwrap();
        install_projection(&pool, tmp.path(), &persona_id, None).unwrap();
        std::env::remove_var(PROJECTION_ENV);

        let claude_md = std::fs::read_to_string(tmp.path().join("CLAUDE.md")).unwrap();
        let import_count = claude_md.matches("@.claude/persona-memory.md").count();
        assert_eq!(import_count, 1, "import line must not duplicate");
    }
}
