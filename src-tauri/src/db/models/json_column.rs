//! Generic `Json<T>` wrapper for typed JSON columns in SQLite.
//!
//! The database stores JSON as TEXT. `Json<T>` validates on every read/write
//! through serde, so invalid data is caught at the DB boundary rather than
//! scattered across business logic.

use std::fmt;
use std::ops::{Deref, DerefMut};

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// A wrapper that stores `T` as a JSON TEXT column in SQLite.
///
/// - `ToSql`: serializes `T` → JSON string for DB writes.
/// - `FromSql`: deserializes JSON string → `T` for DB reads (validates on load).
/// - `Serialize`/`Deserialize`: transparent — the frontend sees `T`, not a string.
///
/// # Example
///
/// ```ignore
/// pub struct MyModel {
///     pub tags: Option<Json<Vec<String>>>,
/// }
/// ```
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct Json<T>(pub T);

impl<T> Json<T> {
    /// Unwrap the inner value.
    pub fn into_inner(self) -> T {
        self.0
    }
}

impl<T: Default> Default for Json<T> {
    fn default() -> Self {
        Json(T::default())
    }
}

impl<T: fmt::Debug> fmt::Debug for Json<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl<T> Deref for Json<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T> DerefMut for Json<T> {
    fn deref_mut(&mut self) -> &mut T {
        &mut self.0
    }
}

impl<T> From<T> for Json<T> {
    fn from(val: T) -> Self {
        Json(val)
    }
}

// -- Serde (transparent) -----------------------------------------------------

impl<T: Serialize> Serialize for Json<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Json<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize(deserializer).map(Json)
    }
}

// -- rusqlite ToSql / FromSql ------------------------------------------------

impl<T: Serialize> ToSql for Json<T> {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        let s = serde_json::to_string(&self.0).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })?;
        Ok(ToSqlOutput::from(s))
    }
}

impl<T: for<'de> Deserialize<'de>> FromSql for Json<T> {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        serde_json::from_str::<T>(s)
            .map(Json)
            .map_err(|e| FromSqlError::Other(Box::new(e)))
    }
}

// -- ts-rs (transparent delegation to inner T) --------------------------------

impl<T: ts_rs::TS + 'static> ts_rs::TS for Json<T> {
    type WithoutGenerics = T::WithoutGenerics;

    fn decl() -> String {
        T::decl()
    }

    fn decl_concrete() -> String {
        T::decl_concrete()
    }

    fn name() -> String {
        T::name()
    }

    fn inline() -> String {
        T::inline()
    }

    fn inline_flattened() -> String {
        T::inline_flattened()
    }

    fn visit_dependencies(v: &mut impl ts_rs::TypeVisitor) {
        T::visit_dependencies(v);
    }

    fn visit_generics(v: &mut impl ts_rs::TypeVisitor) {
        T::visit_generics(v);
    }
}
