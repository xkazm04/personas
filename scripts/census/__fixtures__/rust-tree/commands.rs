//! Census self-test fixture — the `fx-sync-command-pool` and
//! `fx-bare-result-string` twins. Mentions of #[tauri::command] in comments must
//! not count.

// --- fx-sync-command-pool NEGATIVE, declared FIRST on purpose ---------------
// A plain helper that checks a connection out is not an IPC entry point. It sits
// above every command in this file so that no command's forward reach can claim
// it — see the KNOWN LIMITATION section at the bottom for what happens when one
// sits below a command instead.
fn helper_touches_pool(state: &State<'_, Arc<AppState>>) -> Result<i64, AppError> {
    let conn = state.db.get()?;
    Ok(count(&conn))
}

// --- fx-sync-command-pool POSITIVES (2) ------------------------------------

#[tauri::command]
pub fn sync_touches_pool(state: State<'_, Arc<AppState>>) -> Result<Vec<Thing>, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get()?;
    things::list(&conn)
}

#[tauri::command]
#[instrument(skip(state), fields(days))]
pub fn sync_with_intervening_attribute(state: State<'_, Arc<AppState>>) -> Result<i64, AppError> {
    let conn = state.user_db.get()?;
    Ok(count(&conn))
}

// --- fx-sync-command-pool NEGATIVES ----------------------------------------
// An async command may check a connection out: the IPC thread is not blocked.
#[tauri::command]
pub async fn async_touches_pool(state: State<'_, Arc<AppState>>) -> Result<i64, AppError> {
    let conn = state.db.get()?;
    Ok(count(&conn))
}

// A sync command that never reaches persistence is not the condition.
#[tauri::command]
pub fn sync_without_pool(app: AppHandle) -> Result<String, AppError> {
    Ok(app.package_info().version.to_string())
}

// --- fx-bare-result-string POSITIVES (2) -----------------------------------

#[tauri::command]
pub async fn stringly_typed(session_id: String) -> Result<String, String> {
    registry().subscribe(&session_id)
}

#[tauri::command]
pub async fn stringly_typed_generic(
    limit: Option<u32>,
) -> Result<Vec<FleetRunSummary>, String> {
    registry().runs(limit)
}

// --- fx-bare-result-string NEGATIVES ---------------------------------------
// The compliant form: a typed error the frontend can discriminate on.
#[tauri::command]
pub async fn typed_error(session_id: String) -> Result<String, AppError> {
    registry().subscribe(&session_id)
}

// A helper — not an IPC entry point — may still use a String error.
pub fn helper_string_error(path: &PathBuf) -> Result<Value, String> {
    read_settings(path)
}

// --- fx-sync-command-pool KNOWN LIMITATION (1 match, and it is a MIS-ATTRIBUTION)
//
// The matcher is line-oriented text, not a Rust parser: it reads forward from a
// sync command until it finds a pool checkout or hits the next #[tauri::command].
// A sync command that touches no database, followed by a PRIVATE helper that
// does, therefore reads as a violation — the CONDITION (a sync IPC call tree
// checks out a connection) is real, but the function it is attributed to is the
// wrong one. Measured at 2 of 44 matches in src-tauri/src at HEAD, i.e. 95%
// attribution precision. This pair is the regression guard for that number: if
// the rule is ever tightened to a parser, this match disappears and the fixture
// baseline must drop by one.

#[tauri::command]
pub fn sync_clean_but_followed_by_a_helper(app: AppHandle) -> Result<String, AppError> {
    Ok(app.package_info().name.to_string())
}

fn private_helper_below_a_command(state: &State<'_, Arc<AppState>>) -> Result<i64, AppError> {
    let conn = state.db.get()?;
    Ok(count(&conn))
}
