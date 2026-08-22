//! The three bounded indexes — personas, dev contexts, skills — and the
//! char-budget machinery they share.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use crate::db::DbPool;

/// Combined token budget for the persona + context + skill index blocks.
const INDEX_TOKEN_BUDGET: usize = 1200;
/// Rough chars-per-token ratio used to turn the token budget into the byte
/// budget the formatters actually enforce.
pub(super) const CHARS_PER_TOKEN: usize = 4;
/// Total characters the three blocks may occupy together.
pub(super) const INDEX_CHAR_BUDGET: usize = INDEX_TOKEN_BUDGET * CHARS_PER_TOKEN;
/// Per-block split of [`INDEX_CHAR_BUDGET`]. Personas get the largest share
/// (they carry a UUID, a tier and a capability line, and they are what most
/// ops target); contexts next; skills are the leanest rows.
pub(super) const PERSONA_INDEX_CHARS: usize = INDEX_CHAR_BUDGET * 5 / 12; // 2000
pub(super) const CONTEXT_INDEX_CHARS: usize = INDEX_CHAR_BUDGET * 4 / 12; // 1600
pub(super) const SKILL_INDEX_CHARS: usize = INDEX_CHAR_BUDGET * 3 / 12; // 1200

const _: () =
    assert!(PERSONA_INDEX_CHARS + CONTEXT_INDEX_CHARS + SKILL_INDEX_CHARS <= INDEX_CHAR_BUDGET);

/// A block being assembled under a hard character cap.
///
/// Rows are appended until the next one would push the block past
/// `cap - footer_reserve`; everything after that is dropped and the caller
/// renders a footer stating how many of the true total made it in. The
/// reserve exists so the "showing N of M" footer can never itself be the
/// thing that blows the cap — a truncated list that doesn't SAY it is
/// truncated is worse than no list at all.
pub(super) struct BoundedBlock {
    pub(super) out: String,
    pub(super) cap: usize,
    pub(super) footer_reserve: usize,
    pub(super) shown: usize,
}

impl BoundedBlock {
    pub(super) fn new(header: &str, cap: usize, footer_reserve: usize) -> Self {
        Self {
            out: header.to_string(),
            cap,
            footer_reserve,
            shown: 0,
        }
    }

    /// Append one row. Returns false when it did not fit (the caller stops
    /// iterating; nothing partial is ever written).
    pub(super) fn push_row(&mut self, row: &str) -> bool {
        if self.out.len() + row.len() + self.footer_reserve > self.cap {
            return false;
        }
        self.out.push_str(row);
        self.shown += 1;
        true
    }

    pub(super) fn finish(mut self, footer: &str) -> String {
        self.out.push_str(footer);
        self.out
    }
}

/// Collapse a description to a single short line: first paragraph, no
/// newlines, hard-truncated on a char boundary.
pub(super) fn index_summary(raw: &str, max: usize) -> String {
    let line = raw
        .split(['\n', '\r'])
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or("");
    if line.chars().count() <= max {
        return line.to_string();
    }
    format!(
        "{}\u{2026}",
        crate::utils::text::truncate_on_char_boundary(line, max)
    )
}

/// Model tier label from a persona's `model_profile` JSON blob. We only
/// want the family word (`opus` / `sonnet` / `haiku`) — the full model id
/// costs tokens and tells Athena nothing extra at index level.
pub(super) fn model_tier_label(model_profile: &str) -> String {
    let model = serde_json::from_str::<serde_json::Value>(model_profile)
        .ok()
        .and_then(|v| {
            v.get("model")
                .and_then(|m| m.as_str())
                .map(|s| s.to_lowercase())
        })
        .unwrap_or_default();
    for family in ["opus", "sonnet", "haiku"] {
        if model.contains(family) {
            return family.to_string();
        }
    }
    if model.is_empty() {
        "default tier".to_string()
    } else {
        index_summary(&model, 24)
    }
}

/// **Authoritative persona listing for the prompt.** The observability
/// digest deliberately does NOT list persona names any more (it kept a
/// names-only "Recently active" line that had no ids, so Athena could name
/// an agent but not act on it, and two lists disagreeing about which
/// personas matter is worse than one); it now carries counts only and
/// points here.
///
/// Order: enabled first, then `updated_at DESC` — the agents the user has
/// most recently touched are the ones a turn is most likely to be about,
/// and a disabled agent is never a valid `run_persona` target.
pub(super) fn format_persona_index(sys_db: &DbPool) -> String {
    let Ok(conn) = sys_db.get() else {
        return String::new();
    };
    let (total, enabled_total) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) FROM personas",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .unwrap_or((0, 0));
    if total == 0 {
        return String::new();
    }
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, name, COALESCE(description, ''), COALESCE(model_profile, ''), enabled
         FROM personas
         ORDER BY enabled DESC, updated_at DESC",
    ) else {
        return String::new();
    };
    let Ok(rows) = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)? != 0,
        ))
    }) else {
        return String::new();
    };

    let mut block = BoundedBlock::new(
        "\n\n# Agent roster (name → id)\n\n\
         The exact `persona_id` values `run_persona`, `run_arena`, \
         `companion_breed_personas` and `companion_evolve_persona` expect. \
         Copy an id verbatim; never invent or reshape one. Enabled agents \
         first, then most recently updated.\n\n",
        PERSONA_INDEX_CHARS,
        // Reserve for the footer below. Kept generous on purpose — the
        // footer is what makes a truncated list honest, so it must never be
        // the thing that gets squeezed out. `index_blocks_stay_under_budget`
        // fails if this drifts below the real footer length.
        240,
    );
    for row in rows.flatten() {
        let (id, name, description, model_profile, enabled) = row;
        let summary = index_summary(&description, 70);
        let summary = if summary.is_empty() {
            "no description".to_string()
        } else {
            summary
        };
        let line = format!(
            "- **{name}** `{id}` · {tier}{off} · {summary}\n",
            name = name.trim(),
            id = id,
            tier = model_tier_label(&model_profile),
            off = if enabled { "" } else { " · DISABLED" },
            summary = summary,
        );
        if !block.push_row(&line) {
            break;
        }
    }
    let shown = block.shown;
    block.finish(&format!(
        "\n_Listing {shown} of {total} agents ({enabled_total} enabled). The \
         list is truncated for prompt budget, so absent here does NOT mean \
         absent from the app._ Look one up with the `describe_persona` read op, and \
         get team ids (never listed above) with `list_teams`.\n"
    ))
}

/// Dev contexts + their groups. These are what a context-scoped scan, a
/// KPI sweep or a dev job targets, and the id is the handle.
///
/// Order: pinned first, then `updated_at DESC` — pinning is the user's own
/// "this area matters" signal, recency is the fallback.
pub(super) fn format_context_index(sys_db: &DbPool) -> String {
    let Ok(conn) = sys_db.get() else {
        return String::new();
    };
    let total = conn
        .query_row("SELECT COUNT(*) FROM dev_contexts", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0);
    if total == 0 {
        return String::new();
    }
    let group_total = conn
        .query_row("SELECT COUNT(*) FROM dev_context_groups", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0);
    let Ok(mut stmt) = conn.prepare(
        "SELECT c.id, c.name, COALESCE(c.description, ''),
                COALESCE(g.name, ''), COALESCE(p.name, '')
         FROM dev_contexts c
         LEFT JOIN dev_context_groups g ON g.id = c.group_id
         LEFT JOIN dev_projects p ON p.id = c.project_id
         ORDER BY c.pinned DESC, c.updated_at DESC",
    ) else {
        return String::new();
    };
    let Ok(rows) = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
        ))
    }) else {
        return String::new();
    };

    let mut block = BoundedBlock::new(
        "\n\n# Dev contexts (name → id)\n\n\
         Feature areas the context scan mapped, pinned first then most \
         recently scanned. Each belongs to a project and usually a group. \
         Reference one by id when you scope work to it.\n\n",
        CONTEXT_INDEX_CHARS,
        200,
    );
    for row in rows.flatten() {
        let (id, name, description, group, project) = row;
        let where_ = match (project.trim(), group.trim()) {
            ("", "") => String::new(),
            (p, "") => format!(" · {p}"),
            ("", g) => format!(" · {g}"),
            (p, g) => format!(" · {p}/{g}"),
        };
        let line = format!(
            "- **{name}** `{id}`{where_} · {summary}\n",
            name = name.trim(),
            id = id,
            where_ = where_,
            summary = index_summary(&description, 60),
        );
        if !block.push_row(&line) {
            break;
        }
    }
    let shown = block.shown;
    block.finish(&format!(
        "\n_Listing {shown} of {total} contexts across {group_total} groups, \
         truncated for prompt budget._ Use the `describe_context` read op for \
         one context's files, keywords and group.\n"
    ))
}

/// One skill discovered on disk, in the shape both the prompt index and
/// the `describe_skill` read op need.
#[derive(Debug, Clone)]
pub(crate) struct SkillIndexEntry {
    pub name: String,
    /// `global` for `~/.claude/skills`, otherwise the dev project's name.
    pub scope: String,
    pub description: String,
    pub path: String,
}

/// Discover skills on disk: every registered dev project's
/// `<root>/.claude/skills` (bounded to the first few projects, mirroring
/// `skill_files::skills_dir`'s own candidate scan) plus the user-global
/// `~/.claude/skills`. Project skills win a name collision because they are
/// the ones a repo-scoped dispatch actually runs.
///
/// The provenance sidecar (`.skill-provenance.json`) and any other dotfile
/// are skipped, and we deliberately do NOT compute sync state here: that
/// hashes every skill directory twice, which is far too expensive for
/// something rebuilt on every chat turn.
pub(crate) fn scan_skill_index(sys_db: &DbPool) -> Vec<SkillIndexEntry> {
    use std::path::PathBuf;

    let mut dirs: Vec<(String, PathBuf)> = Vec::new();
    if let Ok(conn) = sys_db.get() {
        if let Ok(mut stmt) = conn.prepare("SELECT name, root_path FROM dev_projects LIMIT 5") {
            if let Ok(rows) =
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            {
                for (name, root) in rows.flatten() {
                    dirs.push((name, PathBuf::from(root).join(".claude").join("skills")));
                }
            }
        }
    }
    if let Some(global) = crate::commands::infrastructure::skill_files::global_skills_dir() {
        dirs.push(("global".to_string(), global));
    }

    let mut out: Vec<SkillIndexEntry> = Vec::new();
    for (scope, dir) in dirs {
        let Ok(read_dir) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let raw_name = entry.file_name().to_string_lossy().to_string();
            if raw_name.starts_with('.') {
                continue;
            }
            let (name, md_path) = if path.is_dir() {
                let upper = path.join("SKILL.md");
                let lower = path.join("skill.md");
                let md = if upper.exists() {
                    upper
                } else if lower.exists() {
                    lower
                } else {
                    continue;
                };
                (raw_name, md)
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                (stem, path.clone())
            } else {
                continue;
            };
            if out.iter().any(|e| e.name == name) {
                continue;
            }
            let description = std::fs::read_to_string(&md_path)
                .ok()
                .as_deref()
                .and_then(crate::commands::infrastructure::skill_files::extract_skill_description)
                .unwrap_or_default();
            out.push(SkillIndexEntry {
                name,
                scope: scope.clone(),
                description,
                path: md_path.to_string_lossy().to_string(),
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Skills on disk. Ordered alphabetically by name: a skill index is a
/// lookup table (Athena knows the shape of the job and needs the name), so
/// stable alphabetical beats any recency heuristic here.
pub(super) fn format_skill_index(sys_db: &DbPool) -> String {
    render_skill_index(&scan_skill_index(sys_db))
}

/// Rendering half of [`format_skill_index`], split out so the budget can be
/// tested against a synthetic corpus without touching the filesystem.
pub(super) fn render_skill_index(skills: &[SkillIndexEntry]) -> String {
    let total = skills.len();
    if total == 0 {
        return String::new();
    }
    let mut block = BoundedBlock::new(
        "\n\n# Skills installed on disk (name → when to use)\n\n\
         Packaged procedures a dispatched CLI session can invoke as \
         `/<name>`. Name them exactly as written; a skill not listed here \
         may still exist (see the count below) but never invent one.\n\n",
        SKILL_INDEX_CHARS,
        180,
    );
    for s in skills {
        let line = format!(
            "- **{name}** ({scope}) · {desc}\n",
            name = s.name,
            scope = s.scope,
            desc = index_summary(&s.description, 80),
        );
        if !block.push_row(&line) {
            break;
        }
    }
    let shown = block.shown;
    block.finish(&format!(
        "\n_Listing {shown} of {total} installed skills, truncated for \
         prompt budget._ Use the `describe_skill` read op for one skill's \
         full when-to-use.\n"
    ))
}

// ─────────────────────────────────────────────────────────────────────────
// Mastermind canvas scene digest — the bounded "what does the portfolio
// look like right now" layer (WP2, 2026-08-04)
//
// The three index blocks above answer "what exists, by id". This one answers
// "what needs me". It is a TRIAGE surface, so the order is worst-first, never
// alphabetical: attention, then island state, then alerting cells, then
// blockers, then total unhealthy cells, with the slug as a stable tiebreak.
// The ordering rule itself lives on `canvas::CanvasProject::triage_key`.
//
// Budget: its OWN ~1200 tokens, deliberately not carved out of
// `INDEX_CHAR_BUDGET` — the digest and the indexes answer different questions
// and starving one to feed the other would silently truncate a list Athena is
// told is authoritative. Combined always-on structural ceiling is therefore
// ~2400 tokens.
//
// SOURCE: the canvas publishes a snapshot (see `companion::canvas` for why a
// Rust re-derive is the wrong shape). No snapshot published yet means NO
// BLOCK: a user who never opens Mastermind pays nothing for it.
// ─────────────────────────────────────────────────────────────────────────
