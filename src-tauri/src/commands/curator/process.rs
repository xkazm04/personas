//! The Process read - what the fleet's development sessions actually DID.
//!
//! The registry owns the extraction (`scripts/process-sessions.mjs`): every fleet
//! checkout's Claude Code transcripts, summarised into structure-only process
//! instances - step kinds, counts, errors, timing, outcome facts - and nothing a
//! person typed or a command printed. This module runs it through the instrument's
//! spawn door and hands the page the parse. The page derives the standard path and
//! every per-station figure itself, so this door carries instances, not verdicts.
//!
//! The script keeps its own device cache (a warm run only stats files), so the
//! slot here exists to spare the node start on re-navigation, not the walk.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::instrument::{parse_json, run_node, script};
use crate::error::AppError;

/// Measured 18-24 s cold over ~2,100 transcripts, 0.3 s warm.
const PROCESS_TIMEOUT: Duration = Duration::from_secs(180);
/// Sessions land by the minute; a minute is the useful staleness bound.
const CACHE_TTL: Duration = Duration::from_secs(60);
/// The page's horizon. The device cache keeps more; the page does not need it.
const SINCE: &str = "60d";

/// One step: `(kind index, count, errors, start second, span seconds, extra)`.
/// `extra` is a skill name on a skill step, a length class on a prompt, else null.
pub type CuratorProcessStep = (u32, u32, u32, u32, u32, Option<String>);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorProcessSession {
    pub id: String,
    /// The fleet slug of the checkout the session ran in.
    pub project: String,
    /// 1 when the session ran in a git worktree.
    pub wt: u32,
    /// `interactive` (a person steering) or `headless` (launched by a tool).
    pub mode: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub start: String,
    /// Wall-clock seconds, idle included.
    pub dur: u32,
    /// Seconds with every gap over ten minutes capped at ten minutes.
    pub active: u32,
    pub prompts: u32,
    pub interrupts: u32,
    pub compactions: u32,
    pub errors: u32,
    pub commits: u32,
    pub skills: Vec<String>,
    pub steps: Vec<CuratorProcessStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorProcessSource {
    /// Transcripts looked at this run.
    pub scanned: u32,
    /// Of those, parsed because they were new or changed.
    pub parsed: u32,
    /// Sessions the device cache holds, including ones whose transcript rolled off.
    pub cached: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CuratorProcess {
    /// Step kinds; a step's first tuple field indexes this list.
    pub kinds: Vec<String>,
    /// Kind -> phase (`brief`, `explore`, `edit`, `verify`, `ship`, or a non-work kind).
    pub phases: BTreeMap<String, String>,
    pub sessions: Vec<CuratorProcessSession>,
    pub source: CuratorProcessSource,
}

static PROCESS_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
type Slot = Option<(String, Instant, Arc<CuratorProcess>)>;
/// One slot, keyed on the checkout; overwritten by the next read after the TTL.
static PROCESS_CACHE: OnceLock<Mutex<Slot>> = OnceLock::new();

/// Read the fleet's sessions. Serialised: the script rewrites its device cache,
/// and two writers racing on one file is a torn cache.
pub async fn read(registry_root: &Path) -> Result<Arc<CuratorProcess>, AppError> {
    let _serialised = PROCESS_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let key = registry_root.to_string_lossy().into_owned();
    let cache = PROCESS_CACHE.get_or_init(|| Mutex::new(None));
    {
        let guard = cache.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((k, at, reading)) = guard.as_ref() {
            if *k == key && at.elapsed() < CACHE_TTL {
                return Ok(Arc::clone(reading));
            }
        }
    }
    let path = script(registry_root, "process-sessions.mjs")?;
    let out = run_node(
        registry_root,
        vec![path, "--json".into(), "--since".into(), SINCE.into()],
        PROCESS_TIMEOUT,
        "process-sessions",
    )
    .await?;
    let reading: Arc<CuratorProcess> = Arc::new(parse_json(&out, "process-sessions")?);
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    *guard = Some((key, Instant::now(), Arc::clone(&reading)));
    Ok(reading)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_registry_wire_form() {
        let json = r#"{"schema":"process-sessions/1","kinds":["edit","prompt"],"phases":{"edit":"edit","prompt":"brief"},
          "stepTuple":["kind"],"sessions":[{"id":"abcd1234","project":"kp","wt":0,"mode":"interactive","model":"m","effort":null,
          "start":"2026-09-20T10:00:00.000Z","dur":60,"active":50,"tok":{"in":1,"out":2,"cr":0,"cw":0},"prompts":1,"interrupts":0,
          "compactions":0,"errors":0,"commits":1,"skills":["spark"],"steps":[[1,1,0,0,0,"s"],[0,3,1,5,9,null]]}],
          "source":{"scanned":3,"parsed":1,"cached":3,"window":[null,null]}}"#;
        let p: CuratorProcess = serde_json::from_str(json).expect("wire form parses");
        assert_eq!(p.sessions.len(), 1);
        assert_eq!(p.sessions[0].steps[1], (0, 3, 1, 5, 9, None));
        assert_eq!(p.phases.get("prompt").map(String::as_str), Some("brief"));
    }
}
