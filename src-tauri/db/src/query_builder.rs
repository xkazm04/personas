//! Safe SQL query builder that eliminates manual parameter index tracking.
//!
//! Instead of manually managing `Vec<Box<dyn ToSql>>` and `format!("?{idx}")`,
//! use `QueryBuilder` to compose WHERE clauses, ORDER BY, LIMIT/OFFSET, and
//! SET clauses with automatic parameter binding.
//!
//! # Example — SELECT with filters
//!
//! ```ignore
//! let mut qb = QueryBuilder::new();
//! if let Some(pid) = persona_id {
//!     qb.where_eq("persona_id", pid.to_string());
//! }
//! if let Some(q) = search {
//!     let pattern = format!("%{}%", escape_like(q));
//!     qb.where_like_escape_any(&["title", "content"], pattern);
//! }
//! qb.order_by(order_col, order_dir);
//! qb.limit(limit_val);
//! qb.offset(offset_val);
//!
//! let sql = format!("SELECT * FROM my_table {}", qb.build_clauses());
//! let mut stmt = conn.prepare(&sql)?;
//! let rows = stmt.query_map(qb.params_ref().as_slice(), row_mapper)?;
//! ```

use rusqlite::types::ToSql;

use personas_core::error::AppError;

/// The only two directions an ORDER BY may carry. Matched case-insensitively
/// and re-emitted in canonical upper case, so the SQL never contains a caller's
/// spelling.
const ORDER_DIRECTIONS: &[(&str, &str)] = &[("asc", "ASC"), ("desc", "DESC")];

/// Resolve `col` against `allowed`, returning the ALLOWLIST's spelling rather
/// than the caller's. Returning the listed string is what makes this safe:
/// nothing a caller supplies reaches the SQL, only a `&'static str` the repo
/// wrote down.
fn validate_order_column<'a>(col: &str, allowed: &[&'a str]) -> Result<&'a str, AppError> {
    allowed
        .iter()
        .find(|candidate| **candidate == col)
        .copied()
        .ok_or_else(|| {
            AppError::Validation(format!("sort column {col:?} is not one of {allowed:?}"))
        })
}

/// Resolve `dir` to `ASC` or `DESC`. Same property: the returned string is a
/// literal, never the caller's bytes.
fn validate_order_direction(dir: &str) -> Result<&'static str, AppError> {
    let lowered = dir.trim().to_ascii_lowercase();
    ORDER_DIRECTIONS
        .iter()
        .find(|(candidate, _)| *candidate == lowered)
        .map(|(_, canonical)| *canonical)
        .ok_or_else(|| AppError::Validation(format!("sort direction {dir:?} must be ASC or DESC")))
}

/// A SQL query builder that tracks parameter indices automatically.
///
/// All user-supplied values go through parameter binding (`?N` placeholders),
/// preventing SQL injection. Column names are **not** parameterised — callers
/// must validate them (e.g. via allowlist) before passing them in.
#[allow(dead_code)]
pub struct QueryBuilder {
    conditions: Vec<String>,
    sets: Vec<String>,
    params: Vec<Box<dyn ToSql>>,
    order_clause: Option<String>,
    has_limit: bool,
    has_offset: bool,
}

#[allow(dead_code)]
impl QueryBuilder {
    pub fn new() -> Self {
        Self {
            conditions: Vec::new(),
            sets: Vec::new(),
            params: Vec::new(),
            order_clause: None,
            has_limit: false,
            has_offset: false,
        }
    }

    /// Current 1-based index for the next parameter.
    fn next_idx(&self) -> usize {
        self.params.len() + 1
    }

    // ── WHERE conditions (AND-joined) ──────────────────────────────────

    /// `column = ?N`
    pub fn where_eq(&mut self, col: &str, val: impl ToSql + 'static) -> &mut Self {
        let idx = self.next_idx();
        self.conditions.push(format!("{col} = ?{idx}"));
        self.params.push(Box::new(val));
        self
    }

    /// `column >= ?N`
    pub fn where_gte(&mut self, col: &str, val: impl ToSql + 'static) -> &mut Self {
        let idx = self.next_idx();
        self.conditions.push(format!("{col} >= ?{idx}"));
        self.params.push(Box::new(val));
        self
    }

    /// `column <= ?N`
    pub fn where_lte(&mut self, col: &str, val: impl ToSql + 'static) -> &mut Self {
        let idx = self.next_idx();
        self.conditions.push(format!("{col} <= ?{idx}"));
        self.params.push(Box::new(val));
        self
    }

    /// `column LIKE ?N`
    pub fn where_like(&mut self, col: &str, pattern: impl ToSql + 'static) -> &mut Self {
        let idx = self.next_idx();
        self.conditions.push(format!("{col} LIKE ?{idx}"));
        self.params.push(Box::new(pattern));
        self
    }

    /// `column LIKE ?N ESCAPE '\'`
    pub fn where_like_escape(&mut self, col: &str, pattern: impl ToSql + 'static) -> &mut Self {
        let idx = self.next_idx();
        self.conditions
            .push(format!("{col} LIKE ?{idx} ESCAPE '\\'"));
        self.params.push(Box::new(pattern));
        self
    }

    /// `(col1 LIKE ?N ESCAPE '\' OR col2 LIKE ?M ESCAPE '\' OR ...)`
    ///
    /// Each column gets its own parameter binding (all bound to the same pattern value).
    pub fn where_like_escape_any(&mut self, cols: &[&str], pattern: String) -> &mut Self {
        if cols.is_empty() {
            return self;
        }
        let mut parts = Vec::with_capacity(cols.len());
        for col in cols {
            let idx = self.next_idx();
            parts.push(format!("{col} LIKE ?{idx} ESCAPE '\\'"));
            self.params.push(Box::new(pattern.clone()));
        }
        self.conditions.push(format!("({})", parts.join(" OR ")));
        self
    }

    /// `(col1 LIKE ?N OR col2 LIKE ?M OR ...)` — no ESCAPE clause.
    pub fn where_like_any(&mut self, cols: &[&str], pattern: String) -> &mut Self {
        if cols.is_empty() {
            return self;
        }
        let mut parts = Vec::with_capacity(cols.len());
        for col in cols {
            let idx = self.next_idx();
            parts.push(format!("{col} LIKE ?{idx}"));
            self.params.push(Box::new(pattern.clone()));
        }
        self.conditions.push(format!("({})", parts.join(" OR ")));
        self
    }

    /// `column IN (?N, ?M, ...)` with one binding per value.
    pub fn where_in<V: ToSql + 'static>(&mut self, col: &str, vals: Vec<V>) -> &mut Self {
        if vals.is_empty() {
            // Produce an always-false condition for empty IN
            self.conditions.push("0".to_string());
            return self;
        }
        let mut placeholders = Vec::with_capacity(vals.len());
        for v in vals {
            let idx = self.next_idx();
            placeholders.push(format!("?{idx}"));
            self.params.push(Box::new(v));
        }
        self.conditions
            .push(format!("{col} IN ({})", placeholders.join(", ")));
        self
    }

    /// Push a raw SQL condition with associated parameter values.
    ///
    /// The `clause_fn` receives the next available parameter index and must
    /// return the SQL fragment. This is for edge cases where the standard
    /// methods don't fit (e.g. multi-column conditions with custom logic).
    ///
    /// # Example
    /// ```ignore
    /// qb.where_raw(|idx| {
    ///     format!("(a = ?{} AND b = ?{})", idx, idx + 1)
    /// }, vec![Box::new(val_a), Box::new(val_b)]);
    /// ```
    pub fn where_raw(
        &mut self,
        clause_fn: impl FnOnce(usize) -> String,
        params: Vec<Box<dyn ToSql>>,
    ) -> &mut Self {
        let idx = self.next_idx();
        self.conditions.push(clause_fn(idx));
        self.params.extend(params);
        self
    }

    // ── SET clause (for UPDATE) ────────────────────────────────────────

    /// `column = ?N` — adds a SET clause for UPDATE statements.
    pub fn set(&mut self, col: &str, val: impl ToSql + 'static) -> &mut Self {
        let idx = self.next_idx();
        self.sets.push(format!("{col} = ?{idx}"));
        self.params.push(Box::new(val));
        self
    }

    /// Conditionally set a column if the value is `Some`.
    pub fn set_opt<V: ToSql + 'static>(&mut self, col: &str, val: Option<V>) -> &mut Self {
        if let Some(v) = val {
            self.set(col, v);
        }
        self
    }

    // ── ORDER BY / LIMIT / OFFSET ──────────────────────────────────────

    /// `ORDER BY column direction`
    ///
    /// Column and direction are interpolated directly — callers must validate.
    pub fn order_by(&mut self, col: &str, dir: &str) -> &mut Self {
        self.order_clause = Some(format!("ORDER BY {col} {dir}"));
        self
    }

    /// `ORDER BY column direction`, refusing anything not on the allowlist.
    ///
    /// The unchecked [`order_by`](Self::order_by) above interpolates whatever
    /// it is handed, and the module's own doc tells callers to validate first -
    /// which is the same as saying nothing validates. A list endpoint that
    /// forwards a UI sort key through `order_by` emits it verbatim into the
    /// SQL, so the one builder that exists to make injection unrepresentable
    /// leaves ORDER BY open.
    ///
    /// This is the door for any column name that came from outside: `col` must
    /// appear in `allowed` exactly, and `dir` must be `ASC` or `DESC` in any
    /// case. Keep [`order_by`](Self::order_by) for literals written in the
    /// source.
    ///
    /// Returns [`AppError::Validation`] naming the offending value, and emits
    /// no SQL - the builder is left untouched, so a rejected sort cannot half
    /// apply.
    pub fn try_order_by_allowed(
        &mut self,
        col: &str,
        dir: &str,
        allowed: &[&str],
    ) -> Result<&mut Self, AppError> {
        let column = validate_order_column(col, allowed)?;
        let direction = validate_order_direction(dir)?;
        self.order_clause = Some(format!("ORDER BY {column} {direction}"));
        Ok(self)
    }

    /// `ORDER BY col1 dir1, col2 dir2`, refusing anything not on the allowlist.
    ///
    /// Every pair is validated before any of them is written, so a bad third
    /// column does not leave the first two applied.
    pub fn try_order_by_multiple_allowed(
        &mut self,
        clauses: &[(&str, &str)],
        allowed: &[&str],
    ) -> Result<&mut Self, AppError> {
        if clauses.is_empty() {
            return Ok(self);
        }
        let mut parts: Vec<String> = Vec::with_capacity(clauses.len());
        for (col, dir) in clauses {
            let column = validate_order_column(col, allowed)?;
            let direction = validate_order_direction(dir)?;
            parts.push(format!("{column} {direction}"));
        }
        self.order_clause = Some(format!("ORDER BY {}", parts.join(", ")));
        Ok(self)
    }

    /// `ORDER BY col1 dir1, col2 dir2`
    pub fn order_by_multiple(&mut self, clauses: &[(&str, &str)]) -> &mut Self {
        if clauses.is_empty() {
            return self;
        }
        let parts: Vec<String> = clauses.iter().map(|(c, d)| format!("{c} {d}")).collect();
        self.order_clause = Some(format!("ORDER BY {}", parts.join(", ")));
        self
    }

    /// `LIMIT ?N`
    pub fn limit(&mut self, n: impl ToSql + 'static) -> &mut Self {
        self.has_limit = true;
        self.params.push(Box::new(n));
        self
    }

    /// `OFFSET ?N`
    pub fn offset(&mut self, n: impl ToSql + 'static) -> &mut Self {
        self.has_offset = true;
        self.params.push(Box::new(n));
        self
    }

    // ── Push a bare param (used by macros / advanced callers) ──────────

    /// Add a parameter value and return its `?N` placeholder string.
    pub fn push_param(&mut self, val: impl ToSql + 'static) -> String {
        let idx = self.next_idx();
        self.params.push(Box::new(val));
        format!("?{idx}")
    }

    /// Add a boxed parameter value and return its `?N` placeholder string.
    pub fn push_param_boxed(&mut self, val: Box<dyn ToSql>) -> String {
        let idx = self.next_idx();
        self.params.push(val);
        format!("?{idx}")
    }

    // ── Build final SQL fragments ──────────────────────────────────────

    /// Returns `"WHERE cond1 AND cond2 ..."` or `""` if no conditions.
    pub fn where_clause(&self) -> String {
        if self.conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", self.conditions.join(" AND "))
        }
    }

    /// Returns `"SET col1 = ?1, col2 = ?2, ..."` or `""` if no sets.
    pub fn set_clause(&self) -> String {
        if self.sets.is_empty() {
            String::new()
        } else {
            format!("SET {}", self.sets.join(", "))
        }
    }

    /// Build trailing clauses: `WHERE ... ORDER BY ... LIMIT ?N OFFSET ?M`
    ///
    /// Suitable for appending to a `SELECT ... FROM table` base.
    pub fn build_clauses(&self) -> String {
        let mut parts = Vec::new();

        let wc = self.where_clause();
        if !wc.is_empty() {
            parts.push(wc);
        }

        if let Some(ref order) = self.order_clause {
            parts.push(order.clone());
        }

        // LIMIT and OFFSET indices: they were pushed in order after conditions,
        // so they occupy the last 1-2 positions in self.params.
        let total = self.params.len();
        if self.has_limit && self.has_offset {
            parts.push(format!("LIMIT ?{} OFFSET ?{}", total - 1, total));
        } else if self.has_limit {
            parts.push(format!("LIMIT ?{total}"));
        } else if self.has_offset {
            // SQLite requires LIMIT before OFFSET; `-1` is the SQLite idiom for
            // "no limit" so offset-only callers still get a valid, fully-bound
            // clause instead of a dropped OFFSET with a dangling param (see
            // refactor-bughunt tauri-db.md #4).
            parts.push(format!("LIMIT -1 OFFSET ?{total}"));
        }

        parts.join(" ")
    }

    /// Build a complete `SELECT base_sql <clauses>` query.
    ///
    /// `base` should be everything up to (but not including) WHERE,
    /// e.g. `"SELECT * FROM my_table"`.
    pub fn build_select(&self, base: &str) -> String {
        let clauses = self.build_clauses();
        if clauses.is_empty() {
            base.to_string()
        } else {
            format!("{base} {clauses}")
        }
    }

    /// Build an `UPDATE table SET ... WHERE ...` query.
    pub fn build_update(&self, table: &str) -> String {
        let sc = self.set_clause();
        let wc = self.where_clause();
        if wc.is_empty() {
            format!("UPDATE {table} {sc}")
        } else {
            format!("UPDATE {table} {sc} {wc}")
        }
    }

    // ── Parameter access ───────────────────────────────────────────────

    /// Borrow the parameters as `&[&dyn ToSql]` for passing to rusqlite.
    pub fn params_ref(&self) -> Vec<&dyn ToSql> {
        self.params.iter().map(|p| p.as_ref()).collect()
    }

    /// Consume the builder and return the raw parameter vector.
    pub fn into_params(self) -> Vec<Box<dyn ToSql>> {
        self.params
    }

    /// Number of bound parameters.
    pub fn param_count(&self) -> usize {
        self.params.len()
    }

    /// Whether any WHERE conditions have been added.
    pub fn has_conditions(&self) -> bool {
        !self.conditions.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_builder() {
        let qb = QueryBuilder::new();
        assert_eq!(qb.where_clause(), "");
        assert_eq!(qb.build_clauses(), "");
        assert_eq!(qb.param_count(), 0);
    }

    #[test]
    fn test_where_eq() {
        let mut qb = QueryBuilder::new();
        qb.where_eq("name", "alice".to_string());
        assert_eq!(qb.where_clause(), "WHERE name = ?1");
        assert_eq!(qb.param_count(), 1);
    }

    #[test]
    fn test_multiple_conditions() {
        let mut qb = QueryBuilder::new();
        qb.where_eq("status", "active".to_string());
        qb.where_gte("created_at", "2024-01-01".to_string());
        qb.where_lte("created_at", "2024-12-31".to_string());
        assert_eq!(
            qb.where_clause(),
            "WHERE status = ?1 AND created_at >= ?2 AND created_at <= ?3"
        );
        assert_eq!(qb.param_count(), 3);
    }

    #[test]
    fn test_like_escape_any() {
        let mut qb = QueryBuilder::new();
        qb.where_like_escape_any(&["title", "content"], "%test%".to_string());
        assert_eq!(
            qb.where_clause(),
            "WHERE (title LIKE ?1 ESCAPE '\\' OR content LIKE ?2 ESCAPE '\\')"
        );
        assert_eq!(qb.param_count(), 2);
    }

    #[test]
    fn test_like_any_no_escape() {
        let mut qb = QueryBuilder::new();
        qb.where_like_any(
            &["event_type", "source_type", "payload"],
            "%search%".to_string(),
        );
        assert_eq!(
            qb.where_clause(),
            "WHERE (event_type LIKE ?1 OR source_type LIKE ?2 OR payload LIKE ?3)"
        );
        assert_eq!(qb.param_count(), 3);
    }

    #[test]
    fn test_where_in() {
        let mut qb = QueryBuilder::new();
        qb.where_in(
            "id",
            vec!["a".to_string(), "b".to_string(), "c".to_string()],
        );
        assert_eq!(qb.where_clause(), "WHERE id IN (?1, ?2, ?3)");
        assert_eq!(qb.param_count(), 3);
    }

    #[test]
    fn test_where_in_empty() {
        let mut qb = QueryBuilder::new();
        qb.where_in::<String>("id", vec![]);
        assert_eq!(qb.where_clause(), "WHERE 0");
    }

    #[test]
    fn test_full_select() {
        let mut qb = QueryBuilder::new();
        qb.where_eq("persona_id", "p1".to_string());
        qb.order_by("created_at", "DESC");
        qb.limit(50i64);
        qb.offset(0i64);
        let sql = qb.build_select("SELECT * FROM memories");
        assert_eq!(
            sql,
            "SELECT * FROM memories WHERE persona_id = ?1 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
        );
        assert_eq!(qb.param_count(), 3);
    }

    #[test]
    fn test_update_builder() {
        let mut qb = QueryBuilder::new();
        qb.set("name", "new_name".to_string());
        qb.set("updated_at", "2024-01-01".to_string());
        qb.where_eq("id", "abc".to_string());
        assert_eq!(
            qb.build_update("my_table"),
            "UPDATE my_table SET name = ?1, updated_at = ?2 WHERE id = ?3"
        );
        assert_eq!(qb.param_count(), 3);
    }

    #[test]
    fn test_set_opt() {
        let mut qb = QueryBuilder::new();
        qb.set("updated_at", "now".to_string());
        qb.set_opt("name", Some("alice".to_string()));
        qb.set_opt::<String>("description", None);
        qb.where_eq("id", "abc".to_string());
        assert_eq!(
            qb.build_update("t"),
            "UPDATE t SET updated_at = ?1, name = ?2 WHERE id = ?3"
        );
        assert_eq!(qb.param_count(), 3);
    }

    #[test]
    fn test_order_by_multiple() {
        let mut qb = QueryBuilder::new();
        qb.order_by_multiple(&[("importance", "DESC"), ("created_at", "ASC")]);
        qb.limit(10i64);
        let sql = qb.build_select("SELECT * FROM t");
        assert_eq!(
            sql,
            "SELECT * FROM t ORDER BY importance DESC, created_at ASC LIMIT ?1"
        );
    }

    #[test]
    fn test_where_raw() {
        let mut qb = QueryBuilder::new();
        qb.where_eq("status", "active".to_string());
        qb.where_raw(
            |idx| format!("(a = ?{} AND b = ?{})", idx, idx + 1),
            vec![Box::new("val_a".to_string()), Box::new("val_b".to_string())],
        );
        assert_eq!(
            qb.where_clause(),
            "WHERE status = ?1 AND (a = ?2 AND b = ?3)"
        );
        assert_eq!(qb.param_count(), 3);
    }

    #[test]
    fn test_push_param() {
        let mut qb = QueryBuilder::new();
        let p1 = qb.push_param("val1".to_string());
        let p2 = qb.push_param("val2".to_string());
        assert_eq!(p1, "?1");
        assert_eq!(p2, "?2");
        assert_eq!(qb.param_count(), 2);
    }

    /// The allowlisted door emits the LIST's spelling, not the caller's, and
    /// canonicalises the direction.
    #[test]
    fn try_order_by_allowed_accepts_a_listed_column() {
        let mut qb = QueryBuilder::new();
        qb.try_order_by_allowed("created_at", "desc", &["created_at", "name"])
            .expect("listed column and direction");
        assert_eq!(
            qb.build_select("SELECT * FROM t"),
            "SELECT * FROM t ORDER BY created_at DESC"
        );
    }

    /// A direction carrying a payload is refused, and NOTHING is written - a
    /// rejected sort must not half-apply.
    #[test]
    fn try_order_by_allowed_refuses_a_smuggled_direction() {
        let mut qb = QueryBuilder::new();
        let err = match qb.try_order_by_allowed("created_at", "DESC;--", &["created_at"]) {
            Ok(_) => panic!("a direction is ASC or DESC, nothing else"),
            Err(e) => e,
        };
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
        assert_eq!(
            qb.build_select("SELECT * FROM t"),
            "SELECT * FROM t",
            "no ORDER BY may be emitted for a rejected sort"
        );
    }

    /// An unlisted column is refused even when it is a perfectly innocent
    /// identifier - the allowlist is the contract, not a syntax check.
    #[test]
    fn try_order_by_allowed_refuses_an_unlisted_column() {
        let mut qb = QueryBuilder::new();
        let err = match qb.try_order_by_allowed("payload", "ASC", &["created_at", "name"]) {
            Ok(_) => panic!("payload is not on the list"),
            Err(e) => e,
        };
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    }

    /// A bad pair anywhere in the list rejects the whole clause.
    #[test]
    fn try_order_by_multiple_allowed_is_all_or_nothing() {
        let mut qb = QueryBuilder::new();
        let err = match qb.try_order_by_multiple_allowed(
            &[("name", "ASC"), ("1; DROP TABLE t", "ASC")],
            &["name", "created_at"],
        ) {
            Ok(_) => panic!("the second pair is not listed"),
            Err(e) => e,
        };
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
        assert_eq!(
            qb.build_select("SELECT * FROM t"),
            "SELECT * FROM t",
            "the first, valid pair must not survive the rejection"
        );

        let mut ok = QueryBuilder::new();
        ok.try_order_by_multiple_allowed(
            &[("name", "asc"), ("created_at", "DESC")],
            &["name", "created_at"],
        )
        .expect("both pairs listed");
        assert_eq!(
            ok.build_select("SELECT * FROM t"),
            "SELECT * FROM t ORDER BY name ASC, created_at DESC"
        );
    }
}
