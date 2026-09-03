//! `personas-memory-sim` — Athena's brain, driven headlessly, on a simulated
//! clock, over the tree's own Claude Code CLI engine.
//!
//! The `memory-year` harness (`evals/memory-year`) wants to replay a *year* of
//! conversation against every memory architecture it benchmarks, in minutes.
//! Athena's brain is one of those architectures, and it is the only one that is
//! not a Python object: it is a Rust module over SQLite plus an append-only
//! markdown store, wired into a Tauri app that assumes a window and an
//! `AppHandle`.
//!
//! This module is the smallest thing that lets the harness drive the real brain
//! anyway. **It reimplements nothing that already exists.** `ingest` goes
//! through [`episodic::append_episode`]; `consolidate` through the sleep
//! cycle's own [`sleep_cycle::admit`] + [`sleep_cycle::run_admitted_with`] with
//! [`oneshot::call_claude_text`] behind the [`CycleLlm`] seam — the same call
//! production's `MeteredLegs` makes, so every leg lands in `companion_turn`
//! with `origin='maintenance'` exactly as it does in the app; `recall` through
//! [`retrieval`] and the *same* renderer the prompt assembler uses; and `turn`
//! through [`prompt::build_system_prompt`] and the same `claude -p` invocation
//! `session::cli::run_cli` builds, at the model and effort
//! [`model_routing`](crate::companion::model_routing) assigns.
//!
//! Two things are substituted, and only two: the clock ([`sim_clock`]) and the
//! transport (stdin/stdout JSON lines instead of Tauri IPC). Nothing here picks
//! a model, invents a routing, or holds an opinion about cost.
//!
//! The protocol is specified by the consumer, not here — see the docstring of
//! `evals/memory-year/memory_year/backends/athena.py`. One JSON object per line
//! in, one per line out, stderr for logs, `{"ok":false,"error":…}` for anything
//! that goes wrong, and the process keeps serving.
//!
//! ## What `turn` is, and is not
//!
//! `session::send_turn` cannot be called here: `send_turn_inner` takes an
//! `&AppHandle` and `session::cli::run_cli` is `pub(super)`. Rather than
//! refactor the app for a benchmark, `turn` composes the same four pieces
//! `send_turn_inner` composes — build the system prompt, run the CLI, append
//! the reply as an episode, write the ledger row — and skips the rest. The
//! skipped steps are listed in `docs/plans/memory-year-sim-driver.md`; the
//! short version is that everything skipped is a *side effect on a UI or on
//! another subsystem*, never a step that shapes the reply.

// This binary talks to a harness over stdout, not to a log sink. Same
// exception the other entry points take.
#![allow(clippy::print_stdout, clippy::print_stderr)]

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use r2d2::CustomizeConnection;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::companion::brain::retrieval::{Recall, RecallTrace};
use crate::companion::brain::sleep_cycle::{
    self, AdmittedCycle, CycleAdmission, CycleLlm, CycleOutcome,
};
use crate::companion::brain::{episodic, oneshot, retrieval, sim_clock};
use crate::companion::model_routing;
use crate::companion::turn_ledger::{self, CliUsage, TurnRecord};
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

/// The conversation the harness replays into. Every episode carries it as its
/// `session_id`, and recall is scoped to it, exactly as a real chat thread is.
const DEFAULT_CONVERSATION: &str = "sim-year";

/// Production's per-turn ceiling (`session::events::TURN_TIMEOUT`, which is
/// `pub(super)`). Mirrored rather than imported; if that constant moves, this
/// one is wrong and the sim is more patient than the app, which is the safe
/// direction for a benchmark.
const TURN_TIMEOUT: Duration = Duration::from_secs(25 * 60);

// ── Entry point ────────────────────────────────────────────────────────────

/// Parse args, open the store, then serve stdin until EOF or `quit`.
///
/// Returns the process exit code rather than calling `exit` so the binary
/// wrapper stays a one-liner.
pub fn main() -> i32 {
    let opts = match Options::parse(std::env::args().skip(1)) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("personas-memory-sim: {e}");
            eprintln!("{USAGE}");
            return 2;
        }
    };

    if opts.ml && !cfg!(feature = "ml") {
        eprintln!(
            "personas-memory-sim: --ml was requested but this binary was built without the \
             `ml` feature, so there is no vec0 table and no embedder. Rebuild with \
             `--features memory-sim,ml` or drop --ml to run the keyword lane (which is what \
             the shipped desktop build runs)."
        );
        return 2;
    }

    // `PERSONAS_HOME` is how `disk::brain_root()` is redirected — the same
    // override the brain's own tests use. Set it before the first brain call.
    std::env::set_var("PERSONAS_HOME", &opts.home);
    if let Err(e) = std::fs::create_dir_all(&opts.home) {
        eprintln!(
            "personas-memory-sim: could not create --home {}: {e}",
            opts.home.display()
        );
        return 1;
    }

    let pool = match open_store(&opts) {
        Ok(p) => p,
        Err(e) => {
            eprintln!(
                "personas-memory-sim: could not open --db {}: {e}",
                opts.db.display()
            );
            return 1;
        }
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("personas-memory-sim: tokio: {e}");
            return 1;
        }
    };

    // The SYSTEM database (`personas.db`) is only needed by `turn`, and
    // standing it up runs the whole migration + seed chain. Opened on first
    // use so a memory-only run (ingest / consolidate / recall) never pays for
    // it and never creates the file.
    let mut sys_db: Option<DbPool> = None;

    eprintln!(
        "personas-memory-sim: ready (db={}, home={}, cycle-model={}, turn-model={}, ml={})",
        opts.db.display(),
        opts.home.display(),
        opts.cycle_model(),
        opts.turn_model(),
        opts.ml
    );

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("personas-memory-sim: stdin: {e}");
                break;
            }
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                reply(&mut stdout, &err_reply(&format!("malformed request JSON: {e}")));
                continue;
            }
        };
        if req.get("op").and_then(Value::as_str) == Some("quit") {
            reply(&mut stdout, &json!({"ok": true}));
            break;
        }
        let out = match runtime.block_on(dispatch(&pool, &mut sys_db, &opts, &req)) {
            Ok(v) => v,
            Err(e) => err_reply(&e.to_string()),
        };
        reply(&mut stdout, &out);
    }

    sim_clock::clear();
    0
}

fn reply(out: &mut std::io::Stdout, value: &Value) {
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

fn err_reply(msg: &str) -> Value {
    json!({"ok": false, "error": msg})
}

// ── Arguments ──────────────────────────────────────────────────────────────

const USAGE: &str = "usage: personas-memory-sim --db <path> --home <dir> \
                     [--leg-model <model>] [--turn-model <model>] [--ml]";

struct Options {
    db: PathBuf,
    home: PathBuf,
    /// Override for the *cycle leg* model only. `None` — the normal case —
    /// leaves the routing table in charge.
    leg_model: Option<String>,
    /// Override for the *chat turn* model only. Same rule. (Production's own
    /// `PERSONAS_ATHENA_MODEL` env override is honoured too, and wins nothing:
    /// this flag and that variable resolve to the same slot.)
    turn_model: Option<String>,
    ml: bool,
}

impl Options {
    fn parse(args: impl Iterator<Item = String>) -> Result<Self, String> {
        let (mut db, mut home, mut leg_model, mut turn_model, mut ml) =
            (None, None, None, None, false);
        let mut args = args.peekable();
        while let Some(a) = args.next() {
            match a.as_str() {
                "--db" => db = args.next(),
                "--home" => home = args.next(),
                "--leg-model" => leg_model = args.next(),
                "--turn-model" => turn_model = args.next(),
                "--ml" => ml = true,
                other => return Err(format!("unknown argument `{other}`")),
            }
        }
        Ok(Self {
            db: PathBuf::from(db.ok_or("--db is required")?),
            home: PathBuf::from(home.ok_or("--home is required")?),
            leg_model: leg_model.filter(|s| !s.trim().is_empty()),
            turn_model: turn_model.filter(|s| !s.trim().is_empty()),
            ml,
        })
    }

    /// The model the sleep cycle's two legs run on: the routing table's
    /// [`ASIDE`](model_routing::ASIDE) tier, which is what production's
    /// `MeteredLegs` passes, unless `--leg-model` overrides it.
    fn cycle_model(&self) -> String {
        self.leg_model
            .clone()
            .unwrap_or_else(|| model_routing::ASIDE.model.to_string())
    }

    /// The model a full chat turn runs on: the routing table's
    /// [`MAIN`](model_routing::MAIN) tier. Resolution order mirrors
    /// `session::model::companion_turn_model` — the env override the bench
    /// already uses first, then this flag, then the table.
    fn turn_model(&self) -> String {
        match std::env::var("PERSONAS_ATHENA_MODEL") {
            Ok(m) if !m.trim().is_empty() => m.trim().to_string(),
            _ => self
                .turn_model
                .clone()
                .unwrap_or_else(|| model_routing::MAIN.model.to_string()),
        }
    }
}

/// Reasoning effort for a chat turn, resolved exactly as
/// `session::model::companion_effort_override` then `run_cli` resolve it: the
/// validated env override, else the routing tier's own effort.
fn turn_effort() -> Option<String> {
    let from_env = std::env::var("PERSONAS_ATHENA_EFFORT")
        .ok()
        .map(|e| e.trim().to_ascii_lowercase())
        .filter(|e| matches!(e.as_str(), "low" | "medium" | "high" | "xhigh"));
    from_env.or_else(|| model_routing::MAIN.effort.map(String::from))
}

// ── The store ──────────────────────────────────────────────────────────────

/// Per-connection pragmas, mirroring `personas_db`'s own customizer (which is
/// private to that crate). Same set, same reasons — a pool whose connections
/// lack `foreign_keys` or `busy_timeout` is not the pool the brain is written
/// against.
#[derive(Debug)]
struct SimPragmas;

impl CustomizeConnection<rusqlite::Connection, rusqlite::Error> for SimPragmas {
    fn on_acquire(&self, conn: &mut rusqlite::Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = 2;",
        )
    }
}

/// Open (creating if needed) the throwaway user DB at `--db` and apply the
/// **full** `COMPANION_SCHEMA` through the test-support accessor, plus the
/// incremental ALTERs `init_user_db` applies after it. This is deliberately the
/// same schema the app boots on: a sim running against a narrower table set
/// would be measuring a brain that does not exist.
fn open_store(opts: &Options) -> Result<UserDbPool, AppError> {
    if let Some(parent) = opts.db.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // vec0 is an auto-extension: it only reaches connections opened AFTER
    // registration, and a pool built first would hold connections without it.
    #[cfg(feature = "ml")]
    if opts.ml {
        crate::db::vector_store::ensure_vec_registered_pub();
    }

    let manager = r2d2_sqlite::SqliteConnectionManager::file(&opts.db);
    let pool = r2d2::Pool::builder()
        .max_size(4)
        .connection_timeout(Duration::from_secs(10))
        .connection_customizer(Box::new(SimPragmas))
        .build(manager)?;

    let conn = pool.get()?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.execute_batch(crate::db::companion_schema_for_test())?;
    // The columns `init_user_db` adds AFTER the CREATE block. "duplicate column
    // name" is the success path on a re-run.
    //
    // The full production list, not `init_test_user_db`'s shorter one: the four
    // `companion_turn` columns are missing from the test initializer, and
    // without them `turn_ledger::record_turn` fails its insert — silently, by
    // design, because a ledger write must never break a real turn. The symptom
    // is a run that reports zero spend while spending real money, which is the
    // one failure a cost benchmark must not have.
    for stmt in &[
        "ALTER TABLE companion_proactive_message ADD COLUMN scheduled_for TEXT;",
        "ALTER TABLE companion_background_job ADD COLUMN short_title TEXT;",
        "ALTER TABLE companion_background_job ADD COLUMN parent_turn_id TEXT;",
        "ALTER TABLE companion_background_job ADD COLUMN conversation_id TEXT;",
        "ALTER TABLE companion_session ADD COLUMN title TEXT;",
        "ALTER TABLE companion_session ADD COLUMN status TEXT NOT NULL DEFAULT 'active';",
        "ALTER TABLE companion_session ADD COLUMN last_read_at TEXT;",
        "ALTER TABLE companion_session ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE companion_session ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';",
        "ALTER TABLE companion_node ADD COLUMN session_id TEXT;",
        "ALTER TABLE companion_node ADD COLUMN tags_json TEXT;",
        "ALTER TABLE companion_turn ADD COLUMN prompt_blocks_json TEXT;",
        "ALTER TABLE companion_turn ADD COLUMN total_prompt_chars INTEGER;",
        "ALTER TABLE companion_turn ADD COLUMN prompt_block_hashes_json TEXT;",
        "ALTER TABLE companion_turn ADD COLUMN error_reason TEXT;",
    ] {
        let _ = conn.execute_batch(stmt);
    }
    drop(conn);
    Ok(pool)
}

/// The SYSTEM database, opened on first use. `prompt::build_system_prompt`
/// reads it for the observability digest and the persona / context / skill /
/// scene / device index blocks — none of which need an `AppHandle`, all of
/// which need this pool. It lands beside the user DB, the same layout the app
/// uses (`personas.db` + `personas_data.db` in one app-data dir).
fn sys_store(opts: &Options) -> Result<DbPool, AppError> {
    let dir = opts
        .db
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| opts.home.clone());
    crate::db::init_db(&dir, None)
}

// ── Metering ───────────────────────────────────────────────────────────────

/// What the run has spent, read back out of `companion_turn` — the ledger the
/// production legs write to, not a private counter.
///
/// This is the point of routing every model call through
/// `oneshot::call_claude_text` and `turn_ledger::record_turn`: the harness's
/// cost figures and the app's own spend rollup are then the same numbers from
/// the same rows, and a leg that somehow skipped the ledger shows up as a
/// discrepancy rather than being quietly counted anyway.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Spend {
    calls: i64,
    tokens_in: i64,
    tokens_out: i64,
}

impl Spend {
    fn minus(self, base: Spend) -> Spend {
        Spend {
            calls: self.calls - base.calls,
            tokens_in: self.tokens_in - base.tokens_in,
            tokens_out: self.tokens_out - base.tokens_out,
        }
    }
}

/// `tokens_in` sums the fresh input **and** both cache columns: a cached read
/// is still input the model was given, and reporting only `input_tokens` would
/// make a long-context architecture look free next to one that re-sends
/// everything.
fn ledger_spend(pool: &UserDbPool) -> Result<Spend, AppError> {
    let conn = pool.get()?;
    let row = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(COALESCE(input_tokens,0)
                           + COALESCE(cache_read_tokens,0)
                           + COALESCE(cache_creation_tokens,0)), 0),
                COALESCE(SUM(COALESCE(output_tokens,0)), 0)
         FROM companion_turn",
        [],
        |r| Ok(Spend { calls: r.get(0)?, tokens_in: r.get(1)?, tokens_out: r.get(2)? }),
    )?;
    Ok(row)
}

// ── The cycle's model seam ─────────────────────────────────────────────────

/// The sleep cycle's [`CycleLlm`], pointed at the production one-shot leg.
///
/// This IS `sleep_cycle::MeteredLegs` when `--leg-model` is absent: the same
/// [`oneshot::call_claude_text`] call, with the same
/// [`ASIDE`](model_routing::ASIDE) model, so the leg is metered into
/// `companion_turn` with `origin='maintenance'` and `trigger_kind` = the leg
/// name, exactly as a night in the app would be. The type exists only so the
/// harness can pin a different model for a measured run without that override
/// leaking into the routing table.
struct CliLegs<'a> {
    pool: &'a UserDbPool,
    model: String,
}

#[async_trait::async_trait]
impl CycleLlm for CliLegs<'_> {
    async fn call(&self, leg: &str, prompt: &str, timeout: Duration) -> Result<String, AppError> {
        eprintln!(
            "personas-memory-sim: {leg} -> {} ({} prompt chars, timeout {}s)",
            self.model,
            prompt.chars().count(),
            timeout.as_secs()
        );
        let started = std::time::Instant::now();
        let out = oneshot::call_claude_text(self.pool, prompt, &self.model, leg, timeout).await;
        eprintln!(
            "personas-memory-sim: {leg} <- {} in {:.1}s",
            match &out {
                Ok(t) => format!("{} reply chars", t.chars().count()),
                Err(e) => format!("FAILED: {e}"),
            },
            started.elapsed().as_secs_f32()
        );
        out
    }
}

// ── Dispatch ───────────────────────────────────────────────────────────────

async fn dispatch(
    pool: &UserDbPool,
    sys_db: &mut Option<DbPool>,
    opts: &Options,
    req: &Value,
) -> Result<Value, AppError> {
    let op = req
        .get("op")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Internal("request has no `op`".into()))?;
    match op {
        "ingest" => op_ingest(pool, req),
        "consolidate" => op_consolidate(pool, opts, req).await,
        "recall" => op_recall(pool, req).await,
        "turn" => {
            if sys_db.is_none() {
                *sys_db = Some(sys_store(opts)?);
            }
            let sys = sys_db.as_ref().expect("just opened");
            op_turn(pool, sys, opts, req).await
        }
        "cost" => op_cost(pool, opts),
        other => Err(AppError::Internal(format!("unknown op `{other}`"))),
    }
}

/// Read the request's simulated instant and pin the brain's clock to it.
/// Every op does this first, so a request's writes and its comparisons share
/// one `now` — the property the whole seam exists for.
fn pin_clock(req: &Value) -> Result<(), AppError> {
    let at = req
        .get("at")
        .and_then(Value::as_i64)
        .ok_or_else(|| AppError::Internal("request has no integer `at`".into()))?;
    sim_clock::set(at);
    Ok(())
}

fn conversation_of(req: &Value) -> &str {
    req.get("conversation")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_CONVERSATION)
}

// ── ingest ─────────────────────────────────────────────────────────────────

/// Append one conversation turn through the writer the chat turn uses.
///
/// `scope` has nowhere to live on an episode — `send_turn` does not stamp one,
/// and `companion_node` has no scope column (scope is a *fact* property, set by
/// the cycle when it distils one). Rather than invent a column the production
/// path would never populate, the sim folds it into the FTS tag string beside
/// `session:` and `role:`, which [`episodic::append_episode`] already writes and
/// the keyword lane already indexes. Nothing in production reads it; the sim's
/// world model can.
fn op_ingest(pool: &UserDbPool, req: &Value) -> Result<Value, AppError> {
    pin_clock(req)?;
    let text = req
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Internal("ingest has no `text`".into()))?;
    let role = match req.get("role").and_then(Value::as_str).unwrap_or("user") {
        "assistant" => episodic::EpisodeRole::Assistant,
        "system" => episodic::EpisodeRole::System,
        _ => episodic::EpisodeRole::User,
    };

    let id = episodic::append_episode(pool, conversation_of(req), role, text)?;
    stamp_scope(pool, &id, req);
    Ok(json!({"ok": true, "episode_id": id}))
}

fn stamp_scope(pool: &UserDbPool, episode_id: &str, req: &Value) {
    let Some(scope) = req.get("scope").and_then(Value::as_str) else {
        return;
    };
    if scope.is_empty() {
        return;
    }
    let Ok(conn) = pool.get() else { return };
    let _ = conn.execute(
        "UPDATE companion_fts SET tags = tags || ' scope:' || ?2 WHERE node_id = ?1",
        rusqlite::params![episode_id, scope],
    );
}

// ── consolidate ────────────────────────────────────────────────────────────

/// Weigh sleep pressure and, if a cycle is admitted, run it — the real
/// admission, the real phases, the real writers, all the production caps, and
/// the production model leg.
async fn op_consolidate(
    pool: &UserDbPool,
    opts: &Options,
    req: &Value,
) -> Result<Value, AppError> {
    pin_clock(req)?;
    let force = req.get("force").and_then(Value::as_bool).unwrap_or(false);

    let admitted: AdmittedCycle = match sleep_cycle::admit(pool, force)? {
        CycleAdmission::Skipped(reason) => {
            return Ok(json!({
                "ok": true,
                "admitted": false,
                "reason": reason,
                "facts_written": 0,
                "procedurals_written": 0,
                "supersedes": 0,
                "llm_calls": 0,
                "tokens_in": 0,
                "tokens_out": 0,
            }));
        }
        CycleAdmission::Admitted(a) => a,
    };

    let cycle_id = admitted.cycle_id().to_string();
    let before = ledger_spend(pool)?;
    let llm = CliLegs {
        pool,
        model: opts.cycle_model(),
    };
    let outcome = sleep_cycle::run_admitted_with(pool, &llm, admitted).await?;
    let delta = ledger_spend(pool)?.minus(before);

    let stats = cycle_stats(pool, &cycle_id)?;

    // A cycle that failed is still a cycle that ran and still wrote a report,
    // but for the harness it is an error: its `_call` raises on `ok:false`, and
    // silently counting a failed consolidation as a successful one would make a
    // broken CLI look like a memory that simply learned nothing.
    if let CycleOutcome::Ran { status, .. } = &outcome {
        if status != "completed" {
            let why = stats
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("cycle failed without recording a reason");
            return Ok(json!({"ok": false, "error": format!("cycle {cycle_id} {status}: {why}")}));
        }
    }

    Ok(json!({
        "ok": true,
        "admitted": true,
        "cycle_id": cycle_id,
        "model": opts.cycle_model(),
        "facts_written": stats.get("facts_applied").and_then(Value::as_u64).unwrap_or(0),
        "procedurals_written": stats.get("procedurals_applied").and_then(Value::as_u64).unwrap_or(0),
        "supersedes": stats.get("supersedes_applied").and_then(Value::as_u64).unwrap_or(0),
        "episodes_in": stats.get("episodes_in").and_then(Value::as_u64).unwrap_or(0),
        "llm_calls": delta.calls,
        "tokens_in": delta.tokens_in,
        "tokens_out": delta.tokens_out,
    }))
}

/// The cycle's own `stats_json`, parsed. The cycle writes it; re-deriving the
/// counts here would be a second definition free to drift from the first.
fn cycle_stats(pool: &UserDbPool, cycle_id: &str) -> Result<Value, AppError> {
    let conn = pool.get()?;
    let raw: String = conn.query_row(
        "SELECT COALESCE(stats_json, '{}') FROM companion_cycle WHERE id = ?1",
        rusqlite::params![cycle_id],
        |r| r.get(0),
    )?;
    Ok(serde_json::from_str(&raw).unwrap_or_else(|_| json!({})))
}

// ── recall ─────────────────────────────────────────────────────────────────

/// Retrieve, render, and report — through the production retrieval path and
/// the production renderer.
///
/// `probe: true` suppresses the read-marking side effect (see
/// [`retrieval::ProbeRead`]): a benchmark question must not itself keep a
/// memory alive, or the measurement changes the thing measured.
async fn op_recall(pool: &UserDbPool, req: &Value) -> Result<Value, AppError> {
    pin_clock(req)?;
    let query = req.get("query").and_then(Value::as_str).unwrap_or("");
    let session = conversation_of(req);
    let budget_chars = req
        .get("budget_chars")
        .and_then(Value::as_u64)
        .unwrap_or(8_000) as usize;
    let probe = req.get("probe").and_then(Value::as_bool).unwrap_or(false);

    let recall = {
        let _guard = probe.then(retrieval::ProbeRead::new);
        #[cfg(not(feature = "ml"))]
        {
            retrieval::retrieve(pool, session, query).await?
        }
        // On an `ml` build the sim still takes the keyword lane: the embedder
        // is an `EmbeddingManager` the app builds from user settings and a
        // downloaded ONNX model, neither of which a headless harness has.
        #[cfg(feature = "ml")]
        {
            retrieval::retrieve_keyword(pool, session, query)
        }
    };

    let text = crate::companion::prompt::render_memory_block(&recall, budget_chars);
    Ok(json!({
        "ok": true,
        "text": text,
        "chars": text.chars().count(),
        "items": recall_item_ids(&recall),
        "trace": trace_json(&recall),
    }))
}

/// Every memory id that reached the rendered block, in the order the block
/// renders them. The harness scores recall against this list.
fn recall_item_ids(recall: &Recall) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    ids.extend(recall.episodes.iter().map(|e| e.id.clone()));
    ids.extend(recall.doctrine.iter().map(|d| d.node_id.clone()));
    ids.extend(recall.facts.iter().map(|f| f.id.clone()));
    ids.extend(recall.goals.iter().map(|g| g.id.clone()));
    ids.extend(recall.procedurals.iter().map(|p| p.id.clone()));
    ids.extend(recall.backlog.iter().map(|b| b.id.clone()));
    ids
}

/// [`RecallTrace`] as JSON: which lane produced each id, its relevance when the
/// vector lane produced it, and the floor's own accounting.
fn trace_json(recall: &Recall) -> Value {
    let trace: &RecallTrace = &recall.trace;
    let lanes: serde_json::Map<String, Value> = recall_item_ids(recall)
        .into_iter()
        .map(|id| {
            let entry = json!({
                "lane": trace.lane_of(&id).as_str(),
                "relevance": trace.relevance_of(&id),
            });
            (id, entry)
        })
        .collect();
    json!({
        "lanes": lanes,
        "dropped_far": trace.dropped_far,
        "floor": trace.floor,
        "counts": {
            "episodes": recall.episodes.len(),
            "doctrine": recall.doctrine.len(),
            "facts": recall.facts.len(),
            "procedurals": recall.procedurals.len(),
            "goals": recall.goals.len(),
            "backlog": recall.backlog.len(),
        },
    })
}

// ── turn ───────────────────────────────────────────────────────────────────

/// Athena's real turn, as closely as the tree allows without an `AppHandle`.
///
/// The four pieces `send_turn_inner` composes, in its order:
///
/// 1. the user message lands as an episode ([`episodic::append_episode`]);
/// 2. [`prompt::build_system_prompt`] composes the whole system prompt —
///    constitution, identity, observability, the six memory blocks from live
///    retrieval, the index blocks, addenda — over the sim clock;
/// 3. `claude -p` runs with the argv `session::cli::run_cli` builds for a chat
///    turn, at [`MAIN`](model_routing::MAIN)'s model and effort;
/// 4. the reply lands as an assistant episode and the ledger row is written
///    with the CLI's own usage and the prompt-block sizes and hashes.
///
/// What it skips, and why none of it shapes the reply: the turn lock (one
/// process, one request at a time), stream emission and the recall-preview
/// event (no UI), `--resume` continuity (each sim turn is a fresh CLI process —
/// the benchmark is measuring what *memory* carries across a year, so borrowing
/// the CLI's own conversation state would measure the wrong thing), the
/// dispatcher's op extraction and approval rows, the fleet bridge, the
/// autonomous/proactive origins, and the progress-beat episode persistence.
async fn op_turn(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    opts: &Options,
    req: &Value,
) -> Result<Value, AppError> {
    pin_clock(req)?;
    let text = req
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Internal("turn has no `text`".into()))?;
    let session_id = conversation_of(req).to_string();
    let started = std::time::Instant::now();

    // 1 · the user's message is an episode before anything else reads memory,
    //     exactly as in `send_turn_inner`.
    let user_ep = episodic::append_episode(
        user_db,
        &session_id,
        episodic::EpisodeRole::User,
        text,
    )?;
    stamp_scope(user_db, &user_ep, req);

    // 2 · the production system prompt. `voice_enabled` / `recall_synthesis` /
    //     `autonomous_mode` are all false: the harness drives a plain typed
    //     chat turn, and each of those flags only ADDS a block.
    let (system_prompt, recall_preview, prompt_blocks) =
        crate::companion::prompt::build_system_prompt(
            user_db, sys_db, None, &session_id, text, false, false, false,
        )
        .await?;

    // 3 · the CLI.
    let model = opts.turn_model();
    eprintln!(
        "personas-memory-sim: turn -> {model} ({} prompt chars, {} chars of user text)",
        system_prompt.chars().count(),
        text.chars().count()
    );
    let run = run_turn_cli(&system_prompt, text, &model, &opts.home).await;
    let elapsed_ms = started.elapsed().as_millis() as u64;

    let run = match run {
        Ok(r) => r,
        Err(e) => {
            // Production books a failed turn rather than dropping it; so does
            // this. `classify_failure` is `pub(super)` in `session`, so the
            // reason token is the coarse one the ledger tolerates.
            turn_ledger::record_turn(
                user_db,
                &turn_ledger::failed_turn_record(
                    "chat",
                    None,
                    Some(model.clone()),
                    "cli_failed",
                    &e.to_string(),
                    None,
                ),
            );
            return Err(e);
        }
    };

    // 4 · the reply is an episode, then the ledger row that points at it.
    let assistant_ep = episodic::append_episode(
        user_db,
        &session_id,
        episodic::EpisodeRole::Assistant,
        &run.text,
    )?;
    turn_ledger::record_turn(
        user_db,
        &TurnRecord {
            origin: "chat".to_string(),
            model: Some(model.clone()),
            usage: run.usage.clone(),
            assistant_episode_id: Some(assistant_ep.clone()),
            prompt_blocks_json: prompt_blocks.to_json(),
            prompt_block_hashes_json: prompt_blocks.hashes_json(),
            total_prompt_chars: Some(system_prompt.len() as u32),
            ..TurnRecord::default()
        },
    );

    let usage = run.usage.unwrap_or_default();
    Ok(json!({
        "ok": true,
        "reply": run.text,
        "prompt_chars": system_prompt.chars().count(),
        "recall_items": preview_item_ids(&recall_preview),
        "recall_episodes": recall_preview.episode_count,
        "user_episode_id": user_ep,
        "assistant_episode_id": assistant_ep,
        "model": model,
        "effort": turn_effort(),
        "tokens_in": usage.input_tokens.unwrap_or(0)
            + usage.cache_read_tokens.unwrap_or(0)
            + usage.cache_creation_tokens.unwrap_or(0),
        "tokens_out": usage.output_tokens.unwrap_or(0),
        "ms": elapsed_ms,
    }))
}

/// The ids the production recall preview carries.
///
/// Episodes are a COUNT there, not a list — the panel's strip says "N turns" —
/// so they ride the reply as `recall_episodes` instead of being invented here.
fn preview_item_ids(p: &crate::companion::prompt::RecallPreview) -> Vec<String> {
    let mut ids = Vec::new();
    for group in [
        &p.doctrine,
        &p.facts,
        &p.procedurals,
        &p.goals,
        &p.backlog,
    ] {
        ids.extend(group.iter().map(|e| e.id.clone()));
    }
    ids
}

struct TurnRun {
    text: String,
    usage: Option<CliUsage>,
}

/// Spawn `claude -p` with the chat-turn argv `session::cli::run_cli` builds.
///
/// `run_cli` itself takes an `&AppHandle` (it emits a stream event per stdout
/// line) and is `pub(super)`, so it cannot be called from here. Everything that
/// reaches the model is mirrored: the same `base_cli_invocation()` prefix, the
/// same flags, the same `--system-prompt-file` temp file, the same model and
/// effort from the routing table, the same subscription-auth stripping, the
/// same env. What is NOT mirrored is the streaming half — `--include-partial-
/// messages` and the per-line emit are dropped, because there is no UI to
/// stream to and the whole `assistant` messages still carry the full text.
async fn run_turn_cli(
    system_prompt: &str,
    user_message: &str,
    model: &str,
    home: &Path,
) -> Result<TurnRun, AppError> {
    // Same reason as production: an inline `--system-prompt` breaks at the OS
    // arg-length limit (~32k on Windows), and a composed prompt passes that
    // early.
    let prompt_file = home.join(format!("sim-prompt-{}.md", crate::companion::util::short_id(8)));
    std::fs::write(&prompt_file, system_prompt)?;

    let (cmd_program, mut argv) = crate::companion::session::base_cli_invocation();
    argv.extend([
        "-p".into(),
        "-".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        model.to_string(),
        "--system-prompt-file".into(),
        prompt_file.to_string_lossy().to_string(),
    ]);
    if let Some(effort) = turn_effort() {
        argv.push("--effort".into());
        argv.push(effort);
    }

    // Production spawns from the user's home so a turn does not auto-pick up
    // the Personas project's CLAUDE.md. The sim spawns from `--home`, which is
    // the throwaway equivalent and holds no CLAUDE.md at all.
    let mut cmd = Command::new(&cmd_program);
    cmd.args(&argv)
        .current_dir(home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
        .env("CLAUDE_CODE_DISABLE_TERMINAL_TITLE", "1")
        .env("CLAUDE_CODE_FORK_SUBAGENT", "1");
    // Subscription-only — never the API account. Same call production makes.
    crate::engine::cli_process::force_subscription_auth(&mut cmd);
    crate::companion::session::apply_no_console_window(&mut cmd);
    cmd.kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn claude (turn): {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(user_message.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("write claude stdin (turn): {e}")))?;
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("claude stdout missing (turn)".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("claude stderr missing (turn)".into()))?;

    let stderr_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let stderr_handle = {
        let buf = Arc::clone(&stderr_buf);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut g = buf.lock().await;
                if !g.is_empty() {
                    g.push('\n');
                }
                g.push_str(&line);
            }
        })
    };

    // Same two extractors production uses — `oneshot::extract_assistant_text`
    // for the prose and `CliUsage::from_line` for the terminal `result` event's
    // cost. Two parsers would drift, and both feed one health number.
    let mut assistant_text = String::new();
    let mut usage: Option<CliUsage> = None;
    let mut reader = BufReader::new(stdout).lines();
    let collect = async {
        while let Some(line) = reader
            .next_line()
            .await
            .map_err(|e| AppError::Internal(format!("read stdout (turn): {e}")))?
        {
            if let Some(delta) = oneshot::extract_assistant_text(&line) {
                assistant_text.push_str(&delta);
            }
            if let Some(u) = CliUsage::from_line(&line) {
                usage = Some(u);
            }
        }
        Ok::<(), AppError>(())
    };

    let timed_out = tokio::time::timeout(TURN_TIMEOUT, collect).await.is_err();
    if timed_out {
        let _ = child.kill().await;
        let _ = std::fs::remove_file(&prompt_file);
        return Err(AppError::Internal(format!(
            "turn timed out after {TURN_TIMEOUT:?}"
        )));
    }

    let _ = stderr_handle.await;
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Internal(format!("await claude (turn): {e}")))?;
    let _ = std::fs::remove_file(&prompt_file);

    if !status.success() {
        let err = stderr_buf.lock().await.clone();
        return Err(AppError::Internal(format!(
            "claude turn exited {}: {}",
            status.code().map(|c| c.to_string()).unwrap_or("?".into()),
            oneshot::preview(&err, 500)
        )));
    }

    Ok(TurnRun {
        text: assistant_text,
        usage,
    })
}

// ── cost ───────────────────────────────────────────────────────────────────

fn op_cost(pool: &UserDbPool, opts: &Options) -> Result<Value, AppError> {
    let spend = ledger_spend(pool)?;
    Ok(json!({
        "ok": true,
        "llm_calls": spend.calls,
        "tokens_in": spend.tokens_in,
        "tokens_out": spend.tokens_out,
        // No embedder on this build; `--ml` is refused at startup without one,
        // so reporting anything but zero would be a fiction.
        "embeddings": 0,
        "store_bytes": store_bytes(&opts.db) + dir_bytes(&opts.home),
    }))
}

/// The database file plus its WAL and shared-memory siblings — a measurement
/// taken mid-run would otherwise report a near-empty main file with everything
/// still in the log.
fn store_bytes(db: &Path) -> u64 {
    let mut total = 0;
    for suffix in ["", "-wal", "-shm"] {
        let mut p = db.as_os_str().to_os_string();
        p.push(suffix);
        if let Ok(md) = std::fs::metadata(PathBuf::from(p)) {
            total += md.len();
        }
    }
    total
}

/// Recursive byte size of the brain root: the append-only markdown store is
/// half of what this architecture actually costs to keep.
fn dir_bytes(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut total = 0;
    for entry in entries.flatten() {
        match entry.metadata() {
            Ok(md) if md.is_dir() => total += dir_bytes(&entry.path()),
            Ok(md) => total += md.len(),
            Err(_) => {}
        }
    }
    total
}
