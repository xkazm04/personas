//! Census self-test fixture — the `fx-pool-get-unwrapped` twin of
//! `pool-get-unwrapped`. A comment naming pool.get().unwrap() must not count.

// --- POSITIVES (4) ---------------------------------------------------------

pub fn unwrapped(pool: &DbPool) -> Connection {
    pool.get().unwrap()
}

pub fn expected(pool: &DbPool) -> Connection {
    pool.get().expect("pool.get")
}

pub fn field_chain(state: &AppState) -> Connection {
    state.db.get().unwrap()
}

pub fn split_across_lines(pool: &DbPool) -> Connection {
    pool.get()
        .expect("conn")
}

// --- NEGATIVES -------------------------------------------------------------
// The compliant form propagates instead of aborting the process.
pub fn propagated(pool: &DbPool) -> Result<Connection, AppError> {
    Ok(pool.get()?)
}

// A keyed lookup on a collection: `.get(k)` is never a pool checkout, and the
// empty-argument list is what tells the two apart.
pub fn keyed(map: &HashMap<String, u8>) -> u8 {
    *map.get("k").unwrap()
}
