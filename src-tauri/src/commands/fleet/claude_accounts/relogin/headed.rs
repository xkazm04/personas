//! "Open sign-in window": the human's route when a profile is cold, a challenge
//! needs passing, or Proton asks for a second factor. A VISIBLE Chrome opens on
//! the profile at claude.ai/login and nothing is automated in it. The session
//! is parked here until the human closes the window (or 20 minutes pass), and
//! the profile directory stays reserved meanwhile, so no run can start a second
//! Chrome on it.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tokio::task::JoinHandle;
use tokio::time::{sleep, Instant};

use crate::engine::login_lane::{LaneError, LaneMode, LaneSession};
use crate::error::AppError;

use super::lane::{self, ChromeLauncher, LaneLauncher, LockedSession};
use super::ReloginReason;
use crate::engine::login_lane::ChromeSession;

const LOGIN_URL: &str = "https://claude.ai/login";
/// A window left open this long is closed.
const HEADED_LIFETIME: Duration = Duration::from_secs(20 * 60);
/// A closed window shows up as a dead DevTools socket on the next poll.
const HEADED_POLL: Duration = Duration::from_secs(2);

/// Parked windows by profile key. The registry owns each task's handle; a
/// finished handle is replaced on the next open.
fn parked() -> &'static Mutex<HashMap<String, JoinHandle<()>>> {
    static P: OnceLock<Mutex<HashMap<String, JoinHandle<()>>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Map a lane failure to the cause the frontend branches on.
pub(super) fn lane_to_app(e: LaneError) -> AppError {
    match e.reason {
        ReloginReason::ChromeMissing => {
            AppError::ProcessSpawn("Google Chrome was not found on this machine".into())
        }
        ReloginReason::Busy => AppError::Validation(
            "this browser profile is already open (close its window first)".into(),
        ),
        _ => AppError::Internal(format!("sign-in browser: {}", e.detail)),
    }
}

/// Open the profile headed on claude.ai/login and return at once.
pub(super) async fn open_headed(app_data: &Path, key: &str) -> Result<(), AppError> {
    let dir = lane::profile_dir(app_data, key).map_err(lane_to_app)?;
    let mut session = ChromeLauncher
        .launch(&dir, LaneMode::Headed)
        .await
        .map_err(lane_to_app)?;
    if let Err(e) = session.navigate(LOGIN_URL).await {
        let _ = session.close().await;
        return Err(lane_to_app(e));
    }
    let handle = tokio::spawn(hold(session));
    if let Ok(mut g) = parked().lock() {
        g.retain(|_, h| !h.is_finished());
        g.insert(key.to_string(), handle);
    }
    Ok(())
}

/// Keep the window until the human closes it.
async fn hold(mut session: LockedSession<ChromeSession>) {
    let end = Instant::now() + HEADED_LIFETIME;
    while Instant::now() < end {
        sleep(HEADED_POLL).await;
        if session.current_url().await.is_err() {
            break;
        }
    }
    let _ = session.close().await;
}
