//! The table names a scanned project can honestly claim.
//!
//! `db_tables` is one of the descriptive fields the context-map generator asks
//! an LLM for, and it was persisted verbatim. The shipped map claimed tables
//! `standards_violations` and `doc_rot_findings` for `workspace-governance`;
//! neither has ever existed (the code writes `dev_standards` and `doc_status`).
//! A table name nobody can query is worse than a blank field, because every
//! agent navigating by the map reads it as ground truth.
//!
//! This module derives the set of tables the project itself DEFINES, by reading
//! the project's own source: SQL DDL, ORM table declarations, Prisma models.
//! Deliberately derived from the PROJECT, never from Personas' own SQLite — a
//! scanned repo's schema has nothing to do with the app's, and checking one
//! against the other would both miss real inventions and manufacture new ones.
//!
//! Absence of evidence is not evidence of absence. If the walk finds no schema
//! at all, or has to stop early, the vocabulary reports itself unusable and the
//! caller drops NOTHING. An incomplete vocabulary would delete true names.

use std::collections::HashSet;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use super::context_generation::{NON_SOURCE_DIRS, SOURCE_EXTS};

/// Extensions that can define a table on top of `SOURCE_EXTS` (which already
/// carries `sql`). Prisma keeps its schema in its own file type.
const EXTRA_SCHEMA_EXTS: &[&str] = &["prisma"];

/// Walk bounds. Hitting any of them marks the vocabulary TRUNCATED rather than
/// returning a partial set — a partial vocabulary is exactly how a validator
/// deletes true information.
const WALK_BUDGET: usize = 400_000;
const MAX_FILES: usize = 60_000;
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

/// Every way a project in a mainstream stack states "this table exists".
/// Capture group 1 is the table name in all of them. Widening this list can
/// only ever make the validator MORE permissive (fewer drops), which is the
/// safe direction: a missing pattern costs a false drop, a spurious one costs
/// a missed invention.
static TABLE_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        // SQL DDL: CREATE [OR REPLACE] [TEMP|VIRTUAL|MATERIALIZED|…] TABLE|VIEW
        // [IF NOT EXISTS] [schema.]name — quoted with "", ``, or [] .
        r#"(?i)\bcreate\s+(?:or\s+replace\s+)?(?:global\s+|local\s+|temp\s+|temporary\s+|unlogged\s+|virtual\s+|materialized\s+)*(?:table|view)\s+(?:if\s+not\s+exists\s+)?["`\[]?([A-Za-z_][A-Za-z0-9_$.]*)"#,
        // A renamed table is a real table under its NEW name.
        r#"(?i)\balter\s+table\s+(?:if\s+exists\s+)?["`\[]?[A-Za-z_][A-Za-z0-9_$.]*["`\]]?\s+rename\s+to\s+["`\[]?([A-Za-z_][A-Za-z0-9_$.]*)"#,
        // Rails / ActiveRecord + Phoenix migrations: create_table :users
        r#"(?i)\bcreate_table\s*[!(]?\s*[:'"]([A-Za-z_][A-Za-z0-9_]*)"#,
        // Prisma: `model User {` and its explicit @@map("users") override.
        r#"(?m)^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{"#,
        r#"@@map\(\s*["']([A-Za-z_][A-Za-z0-9_]*)"#,
        // Drizzle: pgTable("users", …) / sqliteTable / mysqlTable
        r#"(?i)\b(?:pg|sqlite|mysql)table\s*\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)"#,
        // SQLAlchemy declarative + core, Django Meta.
        r#"__tablename__\s*=\s*["']([A-Za-z_][A-Za-z0-9_]*)"#,
        r#"\bdb_table\s*=\s*["']([A-Za-z_][A-Za-z0-9_]*)"#,
        r#"\bTable\s*\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*,"#,
    ]
    .iter()
    .filter_map(|p| Regex::new(p).ok())
    .collect()
});

/// A project's table vocabulary plus whether it can be TRUSTED to judge names.
pub(crate) struct TableVocabulary {
    pub names: HashSet<String>,
    /// The walk stopped early (bound hit, directory or file unreadable), so
    /// `names` is a subset of the truth and must not be used to drop anything.
    pub truncated: bool,
    /// First path the walk could not read — named in the operator-facing skip
    /// line so "validation was skipped" is never an unexplained no-op.
    pub first_unreadable: Option<String>,
}

impl TableVocabulary {
    /// Only a complete, non-empty vocabulary may drop a name.
    pub fn is_usable(&self) -> bool {
        !self.truncated && !self.names.is_empty()
    }
}

/// Canonical lookup form of a table reference: unquoted, unqualified, lowercase.
///
/// Returns `None` when the string is not a table name at all — prose like
/// "(all tables — this context owns the schema)" (a real entry on the shipped
/// map) names nothing and can never resolve.
pub(crate) fn normalize_table_ref(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches(';').trim();
    let unquoted = trimmed.trim_matches(|c| c == '"' || c == '`' || c == '\'' || c == '[' || c == ']');
    // `main.users` / `public.users` — the schema qualifier is not part of the name.
    let bare = unquoted.rsplit('.').next().unwrap_or(unquoted).trim();
    if bare.is_empty() {
        return None;
    }
    if !bare
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
    {
        return None;
    }
    Some(bare.to_ascii_lowercase())
}

/// Add every table this text defines to `out`.
pub(crate) fn extract_table_names(text: &str, out: &mut HashSet<String>) {
    for re in TABLE_PATTERNS.iter() {
        for caps in re.captures_iter(text) {
            if let Some(m) = caps.get(1) {
                if let Some(name) = normalize_table_ref(m.as_str()) {
                    out.insert(name);
                }
            }
        }
    }
}

fn is_schema_bearing(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .is_some_and(|e| {
            SOURCE_EXTS.contains(&e.as_str()) || EXTRA_SCHEMA_EXTS.contains(&e.as_str())
        })
}

/// Read the project's own source and collect every table name it defines.
///
/// Skips the same trees the context map itself refuses to claim
/// (`NON_SOURCE_DIRS` + hidden directories), so a vendored dependency's schema
/// never becomes part of the project's vocabulary.
pub(crate) fn collect_table_names(root: &Path) -> TableVocabulary {
    let mut vocab = TableVocabulary {
        names: HashSet::new(),
        truncated: false,
        first_unreadable: None,
    };
    if !root.is_dir() {
        vocab.truncated = true;
        vocab.first_unreadable = Some(root.display().to_string());
        return vocab;
    }

    let mut stack = vec![root.to_path_buf()];
    let mut budget = WALK_BUDGET;
    let mut files_read = 0usize;
    let mut bytes_read = 0u64;

    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => {
                vocab.truncated = true;
                vocab
                    .first_unreadable
                    .get_or_insert_with(|| dir.display().to_string());
                continue;
            }
        };
        for entry in entries.flatten() {
            if budget == 0 || files_read >= MAX_FILES || bytes_read >= MAX_TOTAL_BYTES {
                vocab.truncated = true;
                return vocab;
            }
            budget -= 1;
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if path.is_dir() {
                if !name.starts_with('.') && !NON_SOURCE_DIRS.contains(&name.as_ref()) {
                    stack.push(path);
                }
                continue;
            }
            if !is_schema_bearing(&path) {
                continue;
            }
            // A file too large to read is not evidence that it holds no schema.
            if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
                vocab.truncated = true;
                vocab
                    .first_unreadable
                    .get_or_insert_with(|| path.display().to_string());
                continue;
            }
            match std::fs::read_to_string(&path) {
                Ok(text) => {
                    files_read += 1;
                    bytes_read += text.len() as u64;
                    extract_table_names(&text, &mut vocab.names);
                }
                Err(_) => {
                    // Non-UTF8 or locked. Same reasoning as above: unknown, not empty.
                    vocab.truncated = true;
                    vocab
                        .first_unreadable
                        .get_or_insert_with(|| path.display().to_string());
                }
            }
        }
    }

    vocab
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names_of(text: &str) -> HashSet<String> {
        let mut out = HashSet::new();
        extract_table_names(text, &mut out);
        out
    }

    #[test]
    fn reads_sql_ddl_in_every_shape_the_repo_actually_uses() {
        let set = names_of(
            r#"
            CREATE TABLE IF NOT EXISTS dev_standards (id TEXT PRIMARY KEY);
            create table "doc_status" (id text);
            CREATE TABLE `back_ticked` (id INT);
            CREATE VIRTUAL TABLE chat_messages_fts USING fts5(body);
            CREATE TABLE public.qualified (id INT);
            CREATE OR REPLACE VIEW active_users AS SELECT 1;
            ALTER TABLE old_name RENAME TO new_name;
            "#,
        );
        for expected in [
            "dev_standards",
            "doc_status",
            "back_ticked",
            "chat_messages_fts",
            "qualified",
            "active_users",
            "new_name",
        ] {
            assert!(set.contains(expected), "missing {expected} in {set:?}");
        }
    }

    #[test]
    fn reads_orm_declarations_so_a_non_sql_project_is_not_wiped() {
        // Each of these is a project whose tables never appear as CREATE TABLE.
        // Without them the vocabulary would be empty — which must mean "skip",
        // never "drop everything" (see `is_usable`).
        assert!(names_of("model Invoice {\n  id Int @id\n}").contains("invoice"));
        assert!(names_of("model User {\n  @@map(\"users\")\n}").contains("users"));
        assert!(names_of("export const t = pgTable(\"payments\", {});").contains("payments"));
        assert!(names_of("sqliteTable('sessions', {})").contains("sessions"));
        assert!(names_of("    __tablename__ = \"accounts\"").contains("accounts"));
        assert!(names_of("        db_table = 'legacy_people'").contains("legacy_people"));
        assert!(names_of("create_table :orders do |t|").contains("orders"));
        assert!(names_of("meta = Table('audit_log', metadata,").contains("audit_log"));
    }

    #[test]
    fn a_name_that_is_only_queried_is_not_a_definition() {
        // SELECT/INSERT tell you a name was USED, not that it exists — which is
        // exactly the mistake that let `standards_violations` look real.
        let set = names_of("SELECT * FROM standards_violations; INSERT INTO ghosts VALUES (1);");
        assert!(set.is_empty(), "{set:?}");
    }

    #[test]
    fn normalizes_quoting_qualification_and_case() {
        assert_eq!(normalize_table_ref("Users").as_deref(), Some("users"));
        assert_eq!(normalize_table_ref("  users ; ").as_deref(), Some("users"));
        assert_eq!(normalize_table_ref("\"users\"").as_deref(), Some("users"));
        assert_eq!(normalize_table_ref("`users`").as_deref(), Some("users"));
        assert_eq!(normalize_table_ref("[users]").as_deref(), Some("users"));
        assert_eq!(normalize_table_ref("main.users").as_deref(), Some("users"));
    }

    #[test]
    fn prose_is_not_a_table_name() {
        // A real entry from the shipped map.
        assert_eq!(normalize_table_ref("(all tables — this context owns the schema)"), None);
        assert_eq!(normalize_table_ref(""), None);
        assert_eq!(normalize_table_ref("   "), None);
    }

    #[test]
    fn unreadable_root_is_truncated_not_empty() {
        let v = collect_table_names(Path::new("Z:/no/such/tree/at/all"));
        assert!(v.truncated, "a tree we cannot read is unknown, not schema-free");
        assert!(!v.is_usable(), "an unusable vocabulary may never drop a name");
    }

    #[test]
    fn empty_vocabulary_is_never_usable() {
        let v = TableVocabulary {
            names: HashSet::new(),
            truncated: false,
            first_unreadable: None,
        };
        assert!(!v.is_usable());
    }

    /// The defect this whole module exists for, measured against the real repo:
    /// `standards_violations` / `doc_rot_findings` (claimed by the shipped map's
    /// `workspace-governance` context) are absent from the project's schema,
    /// while the tables the code really writes are present.
    #[test]
    fn real_repo_vocabulary_knows_the_true_tables_and_not_the_invented_ones() {
        let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        if !repo_root.join("src-tauri").join("db").is_dir() {
            // Source tree not present (packaged build) — nothing to measure.
            return;
        }
        let v = collect_table_names(&repo_root);
        assert!(v.is_usable(), "the repo's own schema must be readable; truncated={} at {:?}", v.truncated, v.first_unreadable);
        for real in ["dev_standards", "doc_status", "doc_read_events", "dev_contexts"] {
            assert!(v.names.contains(real), "{real} is a real table in this repo");
        }
        for invented in ["standards_violations", "doc_rot_findings"] {
            assert!(
                !v.names.contains(invented),
                "{invented} was never defined anywhere — the map invented it"
            );
        }
    }
}
