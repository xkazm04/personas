//! The real [`LaneSession`]: one Chrome process plus one page-level CDP socket.

use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::time::{sleep, Instant};

use super::cdp::{Cdp, CALL_TIMEOUT};
use super::chrome::{
    chrome_args, devtools_http_get, discover_chrome, ensure_not_default_profile,
    free_loopback_port, ChromeProcess,
};
use super::{origin_allowed, LaneError, LaneMode, LaneSession};
use crate::commands::fleet::claude_accounts::relogin::ReloginReason;

const LAUNCH_CAP: Duration = Duration::from_secs(15);
const NAV_TIMEOUT: Duration = Duration::from_secs(30);
const PAGE_TEXT_CAP: usize = 200 * 1024;
const POLL: Duration = Duration::from_millis(250);

/// Visible-element test shared by the click and fill scripts.
const JS_VISIBLE: &str = "const vis=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};";

fn other(detail: impl Into<String>) -> LaneError {
    LaneError::new(ReloginReason::Other, detail)
}

/// One live Chrome page on one profile. Dropping it kills the Chrome tree.
pub struct ChromeSession {
    pub(super) cdp: Cdp,
    // Declared after `cdp` so the socket closes before the process is killed.
    proc: ChromeProcess,
    port: u16,
}

impl ChromeSession {
    pub fn pid(&self) -> u32 {
        self.proc.pid()
    }

    pub fn port(&self) -> u16 {
        self.port
    }
}

/// Launch Chrome on `profile_dir` (see [`super::launch`]).
pub(super) async fn launch(profile_dir: &Path, mode: LaneMode) -> Result<ChromeSession, LaneError> {
    ensure_not_default_profile(
        profile_dir,
        std::env::var_os("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .as_deref(),
    )?;
    let exe = discover_chrome().await?;
    std::fs::create_dir_all(profile_dir).map_err(|e| other(format!("create profile dir: {e}")))?;

    let mut last = other("chrome did not start");
    for _ in 0..3 {
        let port = free_loopback_port().await?;
        let mut proc = ChromeProcess::spawn(&exe, &chrome_args(profile_dir, port, mode))?;
        match attach(&mut proc, port).await {
            Ok(cdp) => return Ok(ChromeSession { cdp, proc, port }),
            Err(e) => {
                let early_exit = proc.exited();
                proc.terminate().await;
                last = e;
                // Only a port race / early exit is worth another port.
                if !early_exit {
                    break;
                }
            }
        }
    }
    Err(last)
}

/// Wait for DevTools, then attach to the first page target.
async fn attach(proc: &mut ChromeProcess, port: u16) -> Result<Cdp, LaneError> {
    let deadline = Instant::now() + LAUNCH_CAP;
    loop {
        if proc.exited() {
            return Err(other("chrome exited before DevTools came up"));
        }
        if Instant::now() >= deadline {
            return Err(LaneError::new(
                ReloginReason::Timeout,
                "chrome DevTools did not come up",
            ));
        }
        if devtools_http_get(port, "/json/version").await.is_ok() {
            if let Some(path) = first_page_path(port).await {
                let mut cdp = Cdp::connect(port, &path).await?;
                cdp.call("Page.enable", json!({}), CALL_TIMEOUT).await?;
                return Ok(cdp);
            }
        }
        sleep(Duration::from_millis(150)).await;
    }
}

async fn first_page_path(port: u16) -> Option<String> {
    let body = devtools_http_get(port, "/json/list").await.ok()?;
    let list: Vec<Value> = serde_json::from_str(&body).ok()?;
    let ws = list
        .iter()
        .find(|t| t.get("type").and_then(Value::as_str) == Some("page"))?
        .get("webSocketDebuggerUrl")?
        .as_str()?;
    let u = url::Url::parse(ws).ok()?;
    Some(u.path().to_string())
}

impl ChromeSession {
    async fn href(&mut self) -> Result<String, LaneError> {
        let v = self.cdp.evaluate("location.href").await?;
        Ok(v.as_str().unwrap_or_default().to_string())
    }

    async fn goto(&mut self, url: &str, within: Duration) -> Result<(), LaneError> {
        let baseline = self.cdp.load_count();
        let r = self
            .cdp
            .call("Page.navigate", json!({ "url": url }), CALL_TIMEOUT)
            .await?;
        if let Some(err) = r.get("errorText").and_then(Value::as_str) {
            return Err(other(format!("navigation failed: {err}")));
        }
        match self.cdp.wait_load(baseline, within).await {
            Ok(()) => Ok(()),
            Err(e) if e.reason == ReloginReason::Timeout => {
                // The load event can be missed (same-document or cached); trust readyState.
                let ready = self.cdp.evaluate("document.readyState").await;
                if matches!(ready, Ok(Value::String(ref s)) if s == "complete") {
                    Ok(())
                } else {
                    Err(e)
                }
            }
            Err(e) => Err(e),
        }
    }

    async fn mouse(&mut self, kind: &str, x: f64, y: f64) -> Result<(), LaneError> {
        self.cdp
            .call(
                "Input.dispatchMouseEvent",
                json!({ "type": kind, "x": x, "y": y, "button": "left", "clickCount": 1 }),
                CALL_TIMEOUT,
            )
            .await
            .map(|_| ())
    }

    /// Ask Chrome to quit itself (flushes cookies to the profile) over the
    /// browser-level socket. Best effort: the caller kills the tree after.
    async fn graceful_quit(&mut self) {
        let Ok(body) = devtools_http_get(self.port, "/json/version").await else {
            return;
        };
        let Some(path) = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| {
                v.get("webSocketDebuggerUrl")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .and_then(|u| url::Url::parse(&u).ok().map(|u| u.path().to_string()))
        else {
            return;
        };
        if let Ok(mut browser) = Cdp::connect(self.port, &path).await {
            let _ = browser
                .call("Browser.close", json!({}), Duration::from_secs(3))
                .await;
        }
        self.proc.wait_exit(Duration::from_secs(6)).await;
    }
}

impl LaneSession for ChromeSession {
    async fn navigate(&mut self, url: &str) -> Result<(), LaneError> {
        if !origin_allowed(url) {
            return Err(other("origin refused"));
        }
        self.goto(url, NAV_TIMEOUT).await?;
        let landed = self.href().await?;
        if !origin_allowed(&landed) {
            let chrome_error = landed.starts_with("chrome-error:");
            // Leave the off-list page at once; its content is never read.
            let _ = self.goto("about:blank", Duration::from_secs(5)).await;
            return Err(other(if chrome_error {
                "navigation failed"
            } else {
                "origin refused"
            }));
        }
        Ok(())
    }

    async fn current_url(&mut self) -> Result<String, LaneError> {
        self.href().await
    }

    async fn page_text(&mut self) -> Result<String, LaneError> {
        let v = self
            .cdp
            .evaluate("document.body ? document.body.innerText : ''")
            .await?;
        let mut s = v.as_str().unwrap_or_default().to_string();
        if s.len() > PAGE_TEXT_CAP {
            let mut cut = PAGE_TEXT_CAP;
            while !s.is_char_boundary(cut) {
                cut -= 1;
            }
            s.truncate(cut);
        }
        Ok(s)
    }

    async fn click_text(&mut self, text: &str) -> Result<bool, LaneError> {
        let needle = serde_json::to_string(&text.to_lowercase()).map_err(|_| other("encode"))?;
        let js = format!(
            "(()=>{{const n={needle};{JS_VISIBLE}\
             for(const e of document.querySelectorAll('button, a, [role=button], input[type=submit]')){{\
             const t=((e.tagName==='INPUT'?e.value:e.innerText)||e.textContent||'').trim().toLowerCase();\
             if(t.includes(n)&&vis(e)){{e.scrollIntoView({{block:'center',inline:'center',behavior:'instant'}});\
             const r=e.getBoundingClientRect();return {{x:r.left+r.width/2,y:r.top+r.height/2}};}}}}\
             return null;}})()"
        );
        let v = self.cdp.evaluate(&js).await?;
        let (Some(x), Some(y)) = (
            v.get("x").and_then(Value::as_f64),
            v.get("y").and_then(Value::as_f64),
        ) else {
            return Ok(false);
        };
        // Real mouse events: `isTrusted` clicks, which Google's pages require.
        self.mouse("mouseMoved", x, y).await?;
        self.mouse("mousePressed", x, y).await?;
        self.mouse("mouseReleased", x, y).await?;
        Ok(true)
    }

    async fn fill(&mut self, selector: &str, value: &str) -> Result<bool, LaneError> {
        let sel = serde_json::to_string(selector).map_err(|_| other("encode"))?;
        let js = format!(
            "(()=>{{{JS_VISIBLE}for(const e of document.querySelectorAll({sel})){{\
             if(vis(e)){{e.focus();if(typeof e.select==='function')e.select();return true;}}}}\
             return false;}})()"
        );
        if self.cdp.evaluate(&js).await? != Value::Bool(true) {
            return Ok(false);
        }
        self.cdp
            .call("Input.insertText", json!({ "text": value }), CALL_TIMEOUT)
            .await?;
        Ok(true)
    }

    async fn wait_for_text(&mut self, needle: &str, timeout_ms: u64) -> Result<bool, LaneError> {
        let needle = needle.to_lowercase();
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            match self.page_text().await {
                Ok(t) if t.to_lowercase().contains(&needle) => return Ok(true),
                Ok(_) => {}
                Err(e) if self.cdp.is_closed() => return Err(e),
                // A navigation can briefly invalidate the context; poll again.
                Err(_) => {}
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            sleep(POLL).await;
        }
    }

    async fn close(mut self) -> Result<(), LaneError> {
        self.graceful_quit().await;
        self.proc.terminate().await;
        Ok(())
    }
}
