//! Census self-test fixture — the `fx-select-star` twin of `select-star-in-repo`.
//! This comment says SELECT * on purpose: prose about the migration is not a
//! violation of it.

// --- POSITIVES (3) ---------------------------------------------------------

pub fn list_all(conn: &Connection) -> Vec<Thing> {
    conn.prepare("SELECT * FROM things ORDER BY created_at DESC").unwrap();
    let mut sql = String::from("SELECT  * FROM things WHERE enabled = 1");
    conn.query_row("SELECT * FROM things WHERE id = ?1", [id], map_thing)
}

// --- NEGATIVES -------------------------------------------------------------
// An explicit column list is the compliant form.
pub fn list_columns(conn: &Connection) -> Vec<Thing> {
    conn.prepare("SELECT id, name, created_at FROM things").unwrap()
}

// COUNT(*) is an aggregate, not a wildcard projection: no whitespace + `*`.
pub fn count_all(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM things", [], |r| r.get(0)).unwrap()
}
