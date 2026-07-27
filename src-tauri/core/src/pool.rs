//! The SQLite connection-pool type alias.
//!
//! Only the alias lives here — pool *construction*, migration, and the
//! instrumented `acquire_logged` wrapper all stay in the desktop crate's `db`
//! module, which is where they belong. The alias moved because `crypto`'s
//! credential-migration helpers take a `&DbPool`, and `crypto` is needed by
//! `db::models`, which sits below `db` itself.
//!
//! `db` re-exports this, so `crate::db::DbPool` keeps resolving everywhere.

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

pub type DbPool = Pool<SqliteConnectionManager>;
