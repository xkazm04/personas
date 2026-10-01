//! Twin learn-from-sample (spark `twin-portable-blueprint`, WP3).
//!
//! The person highlights or copies a piece of their OWN writing (the browser's
//! `page_selection` hand, the clipboard, or the sample a new twin was forged
//! from). [`learn`] stores it at `analyzing` and returns at once; a per-twin
//! single-flight lane ([`jobs`]) analyses it in the background:
//!
//! 1. **Guard** ([`guard`]): a sample that matches text the twin itself wrote
//!    (a browser placement, an approved outbox reply) is refused before any
//!    model call. A twin never learns from its own output.
//! 2. **Analysis** ([`analyze`]): one `TwinCall::SAMPLE_LEARN` call (Sonnet,
//!    low, lean CLI) through the setup engine's repair door, prompt built with
//!    the twin core ([`prompt`]), reply through one door ([`parse`]). Not the
//!    person's own writing: refused with the model's reason.
//! 3. **Proposals**: an exemplar, merged voice notes, rules, a length hint and
//!    the eight style dims for the detected channel, filed `open`; self-facts
//!    go to the pending-memory queue (channel `sample`). Nothing writes a tone
//!    field until [`resolve`] accepts a proposal ([`accept`]).
//!
//! Every status change of a sample, and every resolve, is announced with
//! `twin-sample-updated` (`TwinSampleUpdatedEvent`, no sample text), sent to
//! the `main` window only: the browser host's page webviews must never
//! receive app events (`browser_bridge/webview/tabs.rs::announce`).

pub(crate) mod accept;
pub(crate) mod analyze;
pub(crate) mod guard;
pub(crate) mod jobs;
pub(crate) mod parse;
pub(crate) mod prompt;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use tauri::AppHandle;

use crate::db::models::{TwinSample, TwinSampleProposal, TwinSampleUpdatedEvent};
use crate::db::repos::twin_sample::{
    self as repo, NewSample, PROPOSAL_STATUSES, SOURCE_KINDS, STATUS_ANALYZING,
};
use crate::db::DbPool;
use crate::engine::twin_setup::jobs::{db, JobCtx};
use crate::engine::twin_setup::llm::{real_llm, LlmFn};
use crate::error::AppError;
use personas_core::validation::require_non_empty;

/// The longest sample stored and analysed, in characters. The browser's
/// `page_selection` hand and `twin_clipboard_text` cap at the same number.
pub(crate) const SAMPLE_MAX_CHARS: usize = 8000;
/// The longest source host kept (a DNS name is at most 253 characters).
const HOST_MAX_CHARS: usize = 253;

/// How the analysis announces a change (`twin-sample-updated`).
pub(crate) type SampleEmitFn = Arc<dyn Fn(TwinSampleUpdatedEvent) + Send + Sync>;

/// Everything the sample engine needs, cheap to clone.
#[derive(Clone)]
pub(crate) struct SampleCtx {
    pub pool: DbPool,
    pub llm: LlmFn,
    pub emit: SampleEmitFn,
}

impl SampleCtx {
    /// The production context: the real CLI, events to the `main` window.
    pub(crate) fn for_app(app: &AppHandle, pool: DbPool) -> Self {
        let app = app.clone();
        Self {
            pool,
            llm: real_llm(),
            emit: Arc::new(move |event: TwinSampleUpdatedEvent| emit_to_main(&app, &event)),
        }
    }

    pub(crate) fn announce(&self, twin_id: &str, sample_id: &str, status: &str, proposals: u32) {
        (self.emit)(TwinSampleUpdatedEvent {
            twin_id: twin_id.to_string(),
            sample_id: sample_id.to_string(),
            status: status.to_string(),
            proposals,
        });
    }

    /// The setup engine's job context, for its repair door
    /// (`twin_setup::jobs::call_with_repair`), which reads only `pool` and
    /// `llm`. Its setup announcer is a no-op here and is never called.
    pub(crate) fn llm_ctx(&self) -> JobCtx {
        JobCtx {
            pool: self.pool.clone(),
            llm: self.llm.clone(),
            emit: Arc::new(|_| {}),
        }
    }
}

/// `twin-sample-updated` to the `main` webview ONLY (never `app.emit`, which
/// would broadcast into the browser's page webviews too).
fn emit_to_main(app: &AppHandle, event: &TwinSampleUpdatedEvent) {
    use tauri::{Emitter, EventTarget};
    if let Err(e) = app.emit_to(
        EventTarget::AnyLabel {
            label: crate::browser_bridge::webview::layout::MAIN_WINDOW.to_string(),
        },
        crate::engine::event_registry::event_name::TWIN_SAMPLE_UPDATED,
        event,
    ) {
        // A serialisation failure here is permanent and per-call-site: surface
        // it instead of letting the Hub and the learn row go silently stale.
        tracing::warn!(twin_id = %event.twin_id, error = %e, "twin-sample-updated: emit to main failed");
    }
}

/// `text` cut to at most `max_chars` characters on a character boundary, and
/// whether anything was cut. No marker is appended: the text is stored
/// verbatim and the flag travels beside it.
pub(crate) fn cap_chars(text: &str, max_chars: usize) -> (String, bool) {
    match text.char_indices().nth(max_chars) {
        Some((at, _)) => (text[..at].to_string(), true),
        None => (text.to_string(), false),
    }
}

/// A source host as a host name, or `None` when absent. Anything else
/// (whitespace, a path, a scheme) is `Validation`: the value is shown to the
/// model as provenance, so only a host may pass.
fn clean_host(raw: Option<String>) -> Result<Option<String>, AppError> {
    let Some(host) = raw
        .map(|h| h.trim().to_ascii_lowercase())
        .filter(|h| !h.is_empty())
    else {
        return Ok(None);
    };
    let ok = host.chars().count() <= HOST_MAX_CHARS
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'));
    if ok {
        Ok(Some(host))
    } else {
        Err(AppError::Validation(
            "source_host: not a host name".to_string(),
        ))
    }
}

/// Validate and store a sample, announce it, start its analysis. Returns the
/// stored row (status `analyzing`) without waiting for the analysis.
pub(crate) async fn learn(
    ctx: &SampleCtx,
    twin_id: String,
    text: String,
    source_kind: String,
    source_host: Option<String>,
) -> Result<TwinSample, AppError> {
    let source_kind = source_kind.trim().to_string();
    if !SOURCE_KINDS.contains(&source_kind.as_str()) {
        return Err(AppError::Validation(format!(
            "source_kind: \"{source_kind}\" is not one of: {}",
            SOURCE_KINDS.join(", ")
        )));
    }
    let (text, cut) = cap_chars(text.trim(), SAMPLE_MAX_CHARS);
    require_non_empty("text", &text)?;
    if cut {
        // The analysis sees the cut too (a stored sample at the cap is not a
        // whole message); the text itself is never logged.
        tracing::info!(twin_id = %twin_id, cap = SAMPLE_MAX_CHARS, "twin sample: capped at the length limit");
    }
    let host = clean_host(source_host)?;
    let sample = db(&ctx.pool, move |pool| {
        repo::insert_sample(
            pool,
            &NewSample {
                twin_id: &twin_id,
                text: &text,
                source_kind: &source_kind,
                source_host: host.as_deref(),
            },
        )
    })
    .await?;
    ctx.announce(&sample.twin_id, &sample.id, STATUS_ANALYZING, 0);
    // Production lets the lane go; it reports through durable rows + events.
    drop(jobs::schedule(ctx, &sample.twin_id));
    Ok(sample)
}

/// The twin's samples, newest first. A sample still `analyzing` with no lane
/// alive in this process was orphaned by a restart: its analysis is started
/// again (the person asked for it; nothing else would ever finish it).
pub(crate) async fn list(ctx: &SampleCtx, twin_id: String) -> Result<Vec<TwinSample>, AppError> {
    let id = twin_id.clone();
    let samples = db(&ctx.pool, move |pool| repo::list_samples(pool, &id)).await?;
    if samples.iter().any(|s| s.status == STATUS_ANALYZING) && !jobs::is_running(&twin_id) {
        drop(jobs::schedule(ctx, &twin_id));
    }
    Ok(samples)
}

/// The twin's proposals, newest first, optionally only those at `status`.
pub(crate) async fn proposals(
    pool: &DbPool,
    twin_id: String,
    status: Option<String>,
) -> Result<Vec<TwinSampleProposal>, AppError> {
    // `None` lists every status; any string given must be one of them.
    let status = status.map(|s| s.trim().to_string());
    if let Some(s) = status.as_deref() {
        if !PROPOSAL_STATUSES.contains(&s) {
            return Err(AppError::Validation(format!(
                "status: \"{s}\" is not one of: {}",
                PROPOSAL_STATUSES.join(", ")
            )));
        }
    }
    db(pool, move |pool| {
        repo::list_proposals(pool, &twin_id, status.as_deref())
    })
    .await
}

/// Accept or dismiss one proposal ([`accept::resolve`]), then announce the
/// sample's new open count so every surface showing it refetches.
pub(crate) async fn resolve(
    ctx: &SampleCtx,
    proposal_id: String,
    verdict: String,
    edited_value: Option<String>,
) -> Result<TwinSampleProposal, AppError> {
    let (resolved, sample, open) = db(&ctx.pool, move |pool| {
        let resolved = accept::resolve(pool, &proposal_id, &verdict, edited_value.as_deref())?;
        let sample = repo::get_sample(pool, &resolved.sample_id)?;
        let open = repo::open_count(pool, &resolved.sample_id)?;
        Ok((resolved, sample, open))
    })
    .await?;
    if let Some(sample) = sample {
        ctx.announce(&sample.twin_id, &sample.id, &sample.status, open);
    }
    Ok(resolved)
}

/// The OS clipboard's text, read once, capped at [`SAMPLE_MAX_CHARS`]; `None`
/// when it holds no text. Never logged.
pub(crate) async fn clipboard_text() -> Result<Option<String>, AppError> {
    let raw = read_clipboard().await?;
    Ok(raw
        .map(|text| cap_chars(text.trim(), SAMPLE_MAX_CHARS).0)
        .filter(|text| !text.trim().is_empty()))
}

#[cfg(feature = "desktop")]
async fn read_clipboard() -> Result<Option<String>, AppError> {
    let read = tokio::task::spawn_blocking(|| -> Result<Option<String>, String> {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        match clipboard.get_text() {
            Ok(text) => Ok(Some(text)),
            // An image, a file list or an empty clipboard: no text to learn from.
            Err(arboard::Error::ContentNotAvailable) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| AppError::Internal(format!("clipboard read task: {e}")))?;
    read.map_err(|e| AppError::Internal(format!("clipboard read: {e}")))
}

/// No OS clipboard on a mobile build: nothing to read.
#[cfg(not(feature = "desktop"))]
async fn read_clipboard() -> Result<Option<String>, AppError> {
    Ok(None)
}
