//! The lens-scan store, read side (spark one-control, Stage 2, WP2).
//!
//! A product repo keeps one SQLite file, `<root>/.ai/lens-scan/scan.db`, that
//! lens-scan's own scripts write (WAL mode, concurrently, and they migrate the
//! file's `user_version` whenever they open it: v1 -> v2 -> v3 on 2026-10-15
//! alone). This module is the ONLY Personas reader of that file and it is a
//! 1:1 port of bp's `src/lib/scan/store.server.ts`:
//!
//! - **Read-only, in place.** `SQLITE_OPEN_READ_ONLY` plus `PRAGMA query_only`,
//!   a 2000 ms busy timeout, never a copy (a copy of a WAL database misses the
//!   committed pages that still sit in the `-wal` file). Nothing here can write
//!   `scan.db`: the transition rules have exactly one owner, lens-scan's
//!   `store.mjs`, which the command layer drives.
//! - **Columns by presence, never a version allowlist.** Tables are looked up in
//!   `sqlite_master` and each statement's column list is read from
//!   `PRAGMA table_info` at read time, so a v1 store reads with `packs` /
//!   `releases` empty and a v4 store that adds a column reads without a code
//!   change. Rows are keyed by column NAME, never by position.
//! - **Absent-value convention.** A NULL column is omitted from the row, never
//!   `null`; a JSON column is parsed and held to the wire's shape
//!   (`runs.lenses` string array, `runs.scope` / `shots.report` object or
//!   omitted).
//!
//! Layout note: the private query helpers come first and the public doors last,
//! each door timing its work with `timed_query!` (the repo-layer convention).

use crate::models::{
    DevProject, LensScanOpenRelease, LensScanProduct, LensScanRows, LensScanSnapshot,
};
use crate::repos::dev::projects;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde_json::{Map, Number, Value};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The most activity rows a snapshot carries (the LAST 200 by id).
pub const ACTIVITY_LIMIT: i64 = 200;
/// How long a read waits on a writer before it gives up.
const BUSY: Duration = Duration::from_millis(2000);

// ---------------------------------------------------------------------------
// The connection
// ---------------------------------------------------------------------------

/// Open a store read-only, in place. The only `Connection::open*` in this
/// module; the flags below are the whole claim that nothing here writes.
fn open_read_only(file: &Path) -> Result<Connection, AppError> {
    let conn = Connection::open_with_flags(
        file,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(BUSY)?;
    conn.pragma_update(None, "query_only", true)?;
    Ok(conn)
}

fn user_version(conn: &Connection) -> Result<u32, AppError> {
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get("user_version"))?;
    Ok(u32::try_from(v).unwrap_or(0))
}

/// The store's tables that exist (a store being created may not have all).
fn tables_present(conn: &Connection) -> Result<HashSet<String>, AppError> {
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")?;
    let names = stmt
        .query_map([], |r| r.get::<_, String>("name"))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(names)
}

/// The column names of a table in declaration order (empty when the table is
/// absent). `table` is always one of this module's literals, never caller input.
fn columns_in_order(conn: &Connection, table: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = stmt
        .query_map([], |r| r.get::<_, String>("name"))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(names)
}

fn columns_of(conn: &Connection, table: &str) -> Result<HashSet<String>, AppError> {
    Ok(columns_in_order(conn, table)?.into_iter().collect())
}

/// `"a", "b", "c"`: the table's columns as a quoted select list. The names
/// come from the store file, so each is quoted with embedded quotes doubled.
fn select_list(conn: &Connection, table: &str) -> Result<String, AppError> {
    Ok(columns_in_order(conn, table)?
        .iter()
        .map(|c| format!("\"{}\"", c.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(", "))
}

// ---------------------------------------------------------------------------
// Rows -> wire objects
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum Shape {
    /// A JSON array of strings; anything else is `[]`.
    Strings,
    /// A JSON object; anything else omits the key.
    Object,
}

/// The columns that hold JSON text, per table, with the shape the wire promises.
fn json_shape(table: &str, column: &str) -> Option<Shape> {
    match (table, column) {
        ("runs", "lenses") => Some(Shape::Strings),
        ("runs", "scope") | ("shots", "report") => Some(Shape::Object),
        _ => None,
    }
}

/// Hold parsed JSON to the shape the wire promises. `None` = omit the key.
fn shaped(shape: Shape, parsed: Option<Value>) -> Option<Value> {
    match shape {
        Shape::Strings => {
            let items = match parsed {
                Some(Value::Array(a)) => a.into_iter().filter(Value::is_string).collect(),
                _ => Vec::new(),
            };
            Some(Value::Array(items))
        }
        Shape::Object => match parsed {
            Some(v @ Value::Object(_)) => Some(v),
            _ => None,
        },
    }
}

/// One SQLite value as JSON. `None` = omit (NULL, a BLOB, a non-finite REAL).
fn value_of(v: ValueRef<'_>) -> Option<Value> {
    match v {
        ValueRef::Null | ValueRef::Blob(_) => None,
        ValueRef::Integer(i) => Some(Value::Number(i.into())),
        ValueRef::Real(f) => Number::from_f64(f).map(Value::Number),
        ValueRef::Text(t) => Some(Value::String(String::from_utf8_lossy(t).into_owned())),
    }
}

/// Run `sql` and turn every row into a wire object keyed by the statement's own
/// column names.
fn wire_rows(
    conn: &Connection,
    table: &str,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<Vec<Map<String, Value>>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
    let mut rows = stmt.query(params)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut obj = Map::new();
        for (i, name) in names.iter().enumerate() {
            let cell = value_of(row.get_ref(i)?);
            let cell = match json_shape(table, name) {
                Some(shape) => {
                    let parsed = match &cell {
                        Some(Value::String(s)) => serde_json::from_str::<Value>(s).ok(),
                        _ => None,
                    };
                    shaped(shape, parsed)
                }
                None => cell,
            };
            if let Some(v) = cell {
                obj.insert(name.clone(), v);
            }
        }
        out.push(obj);
    }
    Ok(out)
}

/// A table's rows in `order` (an `ORDER BY` tail), or `[]` when the table is
/// absent. The select list is the table's own columns, read now.
fn table_rows(
    conn: &Connection,
    has: &HashSet<String>,
    table: &str,
    order: &str,
) -> Result<Vec<Map<String, Value>>, AppError> {
    if !has.contains(table) {
        return Ok(Vec::new());
    }
    let cols = select_list(conn, table)?;
    wire_rows(
        conn,
        table,
        &format!("SELECT {cols} FROM {table} ORDER BY {order}"),
        &[],
    )
}

/// The LAST `ACTIVITY_LIMIT` activity rows by id, oldest first.
fn activity_tail(
    conn: &Connection,
    has: &HashSet<String>,
) -> Result<Vec<Map<String, Value>>, AppError> {
    if !has.contains("activity") {
        return Ok(Vec::new());
    }
    let cols = select_list(conn, "activity")?;
    wire_rows(
        conn,
        "activity",
        &format!(
            "SELECT {cols} FROM (SELECT {cols} FROM activity ORDER BY id DESC LIMIT ?1) ORDER BY id"
        ),
        &[&ACTIVITY_LIMIT],
    )
}

fn read_all_tables(conn: &Connection) -> Result<LensScanRows, AppError> {
    let has = tables_present(conn)?;
    Ok(LensScanRows {
        runs: table_rows(conn, &has, "runs", "started_at, id")?,
        measurements: table_rows(conn, &has, "measurements", "id")?,
        proposals: table_rows(conn, &has, "proposals", "created_at, id")?,
        activity: activity_tail(conn, &has)?,
        shots: table_rows(conn, &has, "shots", "id")?,
        coverage: table_rows(conn, &has, "coverage", "judged_at, feature, standard")?,
        // v2 tables: a v1 store has neither and reads them empty.
        packs: table_rows(conn, &has, "packs", "created_at, lens, n")?,
        releases: table_rows(conn, &has, "releases", "created_at, id")?,
    })
}

// ---------------------------------------------------------------------------
// The product list's per-store numbers
// ---------------------------------------------------------------------------

/// The per-store numbers a product card carries.
struct StoreSummary {
    version: u32,
    counts: BTreeMap<String, u32>,
    awaiting_triage: u32,
    unreleased_accepted: u32,
    open_release: Option<LensScanOpenRelease>,
    last_run_at: Option<String>,
    measured_facets: u32,
}

/// What a product's map says about its readiness (bp `readiness.server.ts`
/// `summarizeMap`): whether it parses as an object, its version, and its
/// feature and enabled-lens counts.
#[derive(Debug, Default, PartialEq, Eq)]
struct MapSummary {
    ok: bool,
    version: Option<u32>,
    features: u32,
    lenses: u32,
}

/// True when `v` is the number or the string `n` (bp compares `v === n || v === 'n'`).
fn is_version(v: Option<&Value>, n: u64) -> bool {
    match v {
        Some(Value::Number(x)) => x.as_u64() == Some(n),
        Some(Value::String(s)) => s == &n.to_string(),
        _ => false,
    }
}

fn summarize_map(dir: &Path) -> MapSummary {
    let Ok(Value::Object(j)) = read_structure(dir) else {
        return MapSummary::default();
    };
    let v = j.get("version");
    let version = if j.get("$schema").and_then(Value::as_str) == Some("app-structure/3")
        || is_version(v, 3)
    {
        Some(3)
    } else if j.get("$schema").is_none() && is_version(v, 2) {
        Some(2)
    } else {
        None
    };
    let len = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    let features = j
        .get("features")
        .and_then(Value::as_array)
        .map_or(0, |a| len(a.len()));
    // bp: `l && l.enabled !== false` - a falsy entry is no lens.
    let enabled = |l: &&Value| {
        let truthy = match l {
            Value::Null => false,
            Value::Bool(b) => *b,
            Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
            Value::String(s) => !s.is_empty(),
            _ => true,
        };
        truthy && l.get("enabled") != Some(&Value::Bool(false))
    };
    let lenses = j
        .get("lenses")
        .and_then(Value::as_array)
        .map_or(0, |a| len(a.iter().filter(enabled).count()));
    MapSummary {
        ok: true,
        version,
        features,
        lenses,
    }
}

fn count_u32(conn: &Connection, sql: &str) -> Result<u32, AppError> {
    let n: i64 = conn.query_row(sql, [], |r| r.get("n"))?;
    Ok(u32::try_from(n).unwrap_or(0))
}

/// `Some(row)`, or `None` when the query matched nothing.
fn optional<T>(found: rusqlite::Result<T>) -> Result<Option<T>, AppError> {
    match found {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn summarize(file: &Path) -> Result<StoreSummary, AppError> {
    let conn = open_read_only(file)?;
    let version = user_version(&conn)?;
    let has = tables_present(&conn)?;
    let mut counts = BTreeMap::new();
    let mut awaiting_triage = 0;
    let mut unreleased_accepted = 0;
    if has.contains("proposals") {
        let cols = columns_of(&conn, "proposals")?;
        let mut stmt =
            conn.prepare("SELECT status, COUNT(*) AS n FROM proposals GROUP BY status")?;
        let pairs = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>("status")?, r.get::<_, i64>("n")?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (status, n) in pairs {
            counts.insert(status, u32::try_from(n).unwrap_or(0));
        }
        // Accepted items no release has taken: all of them on a store with no
        // `release_id` column (v1).
        unreleased_accepted = if cols.contains("release_id") {
            count_u32(
                &conn,
                "SELECT COUNT(*) AS n FROM proposals WHERE status = 'accepted' AND release_id IS NULL",
            )?
        } else {
            counts.get("accepted").copied().unwrap_or(0)
        };
        // Built items still waiting for a person, in packs that are open.
        if has.contains("packs") && cols.contains("pack_id") {
            awaiting_triage = count_u32(
                &conn,
                "SELECT COUNT(*) AS n FROM proposals p JOIN packs k ON k.id = p.pack_id \
                 WHERE k.status = 'open' AND p.status IN ('done', 'failed')",
            )?;
        }
    }
    let open_release = if has.contains("releases") {
        optional(conn.query_row(
            "SELECT id, status FROM releases WHERE status <> 'tagged' \
             ORDER BY created_at DESC, id DESC LIMIT 1",
            [],
            |r| {
                Ok(LensScanOpenRelease {
                    id: r.get("id")?,
                    status: r.get("status")?,
                })
            },
        ))?
    } else {
        None
    };
    let last_run_at = if has.contains("runs") {
        optional(conn.query_row(
            "SELECT COALESCE(ended_at, updated_at) AS at FROM runs \
             ORDER BY started_at DESC, id DESC LIMIT 1",
            [],
            |r| r.get::<_, Option<String>>("at"),
        ))?
        .flatten()
    } else {
        None
    };
    // Distinct readings (bp `readiness.server.ts readStore`).
    let measured_facets = if has.contains("measurements") {
        count_u32(
            &conn,
            "SELECT COUNT(*) AS n FROM (SELECT DISTINCT feature, lens, metric FROM measurements)",
        )?
    } else {
        0
    };
    Ok(StoreSummary {
        version,
        counts,
        awaiting_triage,
        unreleased_accepted,
        open_release,
        last_run_at,
        measured_facets,
    })
}

fn product_of(project: &DevProject, file: &Path) -> LensScanProduct {
    // The map is read whether or not the store opens (bp reads them apart).
    let dir = store_dir(Path::new(&project.root_path));
    let map = summarize_map(&dir);
    let base = LensScanProduct {
        project_id: project.id.clone(),
        name: project.name.clone(),
        root: project.root_path.clone(),
        has_map: map.ok,
        map_version: map.version,
        features: map.features,
        lenses: map.lenses,
        has_events: dir.join("events.jsonl").is_file(),
        ..LensScanProduct::default()
    };
    match summarize(file) {
        Ok(s) => LensScanProduct {
            store_version: s.version,
            counts: s.counts,
            awaiting_triage: s.awaiting_triage,
            unreleased_accepted: s.unreleased_accepted,
            open_release: s.open_release,
            last_run_at: s.last_run_at,
            measured_facets: s.measured_facets,
            ..base
        },
        // A store that will not open is listed with the reason, never dropped.
        Err(e) => LensScanProduct {
            error: Some(e.to_string()),
            ..base
        },
    }
}

/// `app-structure.json` in the store directory, parsed. bp reads only this
/// path (`src/app/api/products/[slug]/structure/route.ts`); so does this.
fn read_structure(dir: &Path) -> Result<Value, AppError> {
    let file = dir.join("app-structure.json");
    let text = match std::fs::read_to_string(&file) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null),
        Err(e) => {
            return Err(AppError::Internal(format!(
                "unreadable structure at {}: {e}",
                file.display()
            )))
        }
    };
    serde_json::from_str(&text)
        .map_err(|e| AppError::Internal(format!("unreadable structure at {}: {e}", file.display())))
}

/// `events.jsonl` beside the map, raw; `""` when there is none.
fn read_events(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("events.jsonl")).unwrap_or_default()
}

/// Throwaway lens-scan stores for tests (this crate's and the app crate's).
/// They are built from the DDL files in `lens_scan_fixtures/`, which mirror
/// lens-scan's `references/store.sql` per version; writing them needs a
/// writable connection that production code never opens.
#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    use super::*;

    const V1: &str = include_str!("lens_scan_fixtures/store_v1.sql");
    const V2: &str = include_str!("lens_scan_fixtures/store_v2_extra.sql");
    const V3: &str = include_str!("lens_scan_fixtures/store_v3_extra.sql");

    /// A store of `version` (1..=3) at `root/.ai/lens-scan/scan.db`, in WAL
    /// mode like the real one, holding one `done` measure run `r1`. The
    /// returned connection is the WRITER: keep it open to leave committed
    /// pages in the `-wal` file.
    fn build_store(root: &Path, version: u32) -> Connection {
        std::fs::create_dir_all(store_dir(root)).expect("store dir");
        let conn = Connection::open(store_file(root)).expect("create store");
        conn.pragma_update(None, "journal_mode", "WAL")
            .expect("wal");
        conn.execute_batch(V1).expect("v1 ddl");
        if version >= 2 {
            conn.execute_batch(V2).expect("v2 ddl");
        }
        if version >= 3 {
            conn.execute_batch(V3).expect("v3 ddl");
        }
        conn.execute(
            "INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) \
             VALUES ('r1', '2026-10-15T10:00:00Z', '2026-10-15T10:05:00Z', 'measure', 'done', '[\"dev\",\"sec\"]')",
            [],
        )
        .expect("run");
        conn
    }

    /// The door the app crate's tests use; see [`build_store`].
    pub fn make_store(root: &Path, version: u32) -> Connection {
        build_store(root, version)
    }
}

// ---------------------------------------------------------------------------
// The doors
// ---------------------------------------------------------------------------

/// `<root>/.ai/lens-scan`: the store directory (the map, the events and the
/// shots live beside the database).
pub fn store_dir(root: &Path) -> PathBuf {
    root.join(".ai").join("lens-scan")
}

/// `<root>/.ai/lens-scan/scan.db`.
pub fn store_file(root: &Path) -> PathBuf {
    store_dir(root).join("scan.db")
}

/// Every table of the store as wire rows, in bp's order, plus `user_version`.
pub fn read_rows(file: &Path) -> Result<(u32, LensScanRows), AppError> {
    crate::timed_query!("lens_scan", "lens_scan::read_rows", {
        let conn = open_read_only(file)?;
        let version = user_version(&conn)?;
        read_all_tables(&conn).map(|rows| (version, rows))
    })
}

/// What `lens_scan_snapshot` answers: the map, the events log and the store.
/// A product with no map yet reads `structure: null`; an unreadable or
/// malformed map is an error naming the file.
pub fn read_snapshot(root: &Path) -> Result<LensScanSnapshot, AppError> {
    let file = store_file(root);
    if !file.is_file() {
        return Err(AppError::NotFound(format!(
            "no lens-scan store at {}",
            file.display()
        )));
    }
    let dir = store_dir(root);
    let (store_version, scan) = read_rows(&file)?;
    Ok(LensScanSnapshot {
        structure: read_structure(&dir)?,
        events: read_events(&dir),
        scan,
        store_version,
    })
}

/// Every enabled code project whose root holds a lens-scan store.
pub fn list_products(pool: &DbPool) -> Result<Vec<LensScanProduct>, AppError> {
    crate::timed_query!("lens_scan", "lens_scan::list_products", {
        let mut out = Vec::new();
        for project in projects::list_projects(pool, None)? {
            if !project.enabled || project.kind != "code" {
                continue;
            }
            let file = store_file(Path::new(&project.root_path));
            if file.is_file() {
                out.push(product_of(&project, &file));
            }
        }
        out.sort_by_key(|p| p.name.to_lowercase());
        Ok(out)
    })
}

/// The project a door names, and its repo root. `NotFound` for an unknown id
/// or a project whose root holds no store.
pub fn project_root(pool: &DbPool, project_id: &str) -> Result<PathBuf, AppError> {
    let project = projects::get_project_by_id(pool, project_id)?;
    let root = PathBuf::from(&project.root_path);
    if !store_file(&root).is_file() {
        return Err(AppError::NotFound(format!(
            "no lens-scan store for project {}",
            project.name
        )));
    }
    Ok(root)
}

/// Why a sha did not name exactly one item commit.
#[derive(Debug, PartialEq, Eq)]
pub enum CommitMatch {
    One(String),
    None,
    Ambiguous(usize),
}

/// Every commit sha a proposal of the store carries (`commit_sha`,
/// `result_sha`), lower-cased and distinct.
pub fn item_commits(root: &Path) -> Result<Vec<String>, AppError> {
    crate::timed_query!("lens_scan", "lens_scan::item_commits", {
        let conn = open_read_only(&store_file(root))?;
        let cols = columns_of(&conn, "proposals")?;
        let mut shas = HashSet::new();
        for column in ["commit_sha", "result_sha"] {
            if !cols.contains(column) {
                continue;
            }
            let mut stmt = conn.prepare(&format!(
                "SELECT DISTINCT {column} AS sha FROM proposals WHERE {column} IS NOT NULL"
            ))?;
            let rows = stmt.query_map([], |r| r.get::<_, String>("sha"))?;
            for sha in rows {
                shas.insert(sha?.to_lowercase());
            }
        }
        let mut out: Vec<String> = shas.into_iter().collect();
        out.sort();
        Ok(out)
    })
}

/// Which item commit `want` names: it is a prefix of one, or (a store that
/// kept a short sha) one is a prefix of it. Needs 7+ hex characters on both
/// sides, as bp's commits route.
pub fn match_item_commit(shas: &[String], want: &str) -> CommitMatch {
    let want = want.to_lowercase();
    let mut hits: Vec<&String> = shas
        .iter()
        .filter(|s| s.len() >= 7 && (s.starts_with(&want) || want.starts_with(s.as_str())))
        .collect();
    hits.sort();
    hits.dedup();
    match hits.as_slice() {
        [] => CommitMatch::None,
        [one] => CommitMatch::One(if one.len() >= want.len() {
            (*one).clone()
        } else {
            want
        }),
        many => CommitMatch::Ambiguous(many.len()),
    }
}

#[cfg(test)]
#[path = "lens_scan_tests.rs"]
mod tests;
