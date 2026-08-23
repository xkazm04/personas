//! Boot phase: open the two SQLite pools and the channels that feed off them.

use std::path::PathBuf;

use crate::db::{self, DbPool};
use crate::startup_timing::StartupTimer;

// Create CDC channel for reactive SQLite change notifications
#[allow(clippy::type_complexity)]
pub fn open_databases(
    app_data_dir: &PathBuf,
    st: &mut StartupTimer,
) -> Result<
    (
        DbPool,
        db::UserDbPool,
        db::cdc::CdcReceiver,
        db::journal::JournalReceiver,
    ),
    Box<dyn std::error::Error>,
> {
    let (cdc_sender, cdc_receiver) = db::cdc::create_cdc_channel(512);

    // Reversible Agent: durable change-journal capture channel
    // (preupdate hook -> batch writer thread; see db::journal).
    let (journal_sender, journal_receiver) = db::journal::create_journal_channel(2048);

    let pool = db::init_db_with_journal(app_data_dir, Some(cdc_sender), Some(journal_sender))?;
    tracing::info!("Database pool ready (max_size=4, CDC enabled)");
    st.checkpoint("db_init");

    let user_db_pool = db::init_user_db(app_data_dir)?;
    tracing::info!("User data database pool ready (max_size=4)");
    st.checkpoint("user_db_init");

    Ok((pool, user_db_pool, cdc_receiver, journal_receiver))
}
