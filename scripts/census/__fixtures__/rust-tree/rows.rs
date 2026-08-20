//! Census self-test fixture — the `fx-positional-row-get` twin of
//! `positional-row-get`. A comment naming row.get(0) must not count.

// --- POSITIVES (5) ---------------------------------------------------------

fn read_plain(row: &Row) -> Thing {
    Thing {
        id: row.get(0)?,
        name: row.get(1)?,
    }
}

fn read_turbofish(row: &Row) -> (String, Option<String>) {
    (row.get::<_, String>(0)?, row.get::<_, Option<String>>(2)?)
}

fn read_closure_binding(stmt: &mut Statement) -> Vec<String> {
    stmt.query_map([], |r| r.get(0)).unwrap().collect()
}

// --- NEGATIVES -------------------------------------------------------------
// Named columns are the compliant form; they survive an ALTER TABLE.
fn read_by_name(row: &Row) -> Thing {
    Thing {
        id: row.get("id")?,
        name: row.get("name")?,
    }
}

// Collection indexing is a different concept wearing the same method name.
fn not_a_row(args: &[String], map: &HashMap<String, u8>) -> usize {
    args.get(0).map(|_| 1).unwrap_or(0) + map.get("k").copied().unwrap_or(0) as usize
}

// An identifier that merely ENDS in `row` is not the row binding.
fn shadowed(arrow: &Vec<u8>) -> u8 {
    *arrow.get(0).unwrap()
}
