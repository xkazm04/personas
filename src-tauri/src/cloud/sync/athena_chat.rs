//! Athena's conversations -> `synced_chat_sessions` + `synced_chat_messages`
//! with `thread_kind = 'athena'` (PHASE2-SPEC 5.2 adapted, owner decision
//! M18: Athena first).
//!
//! Pushed only while the operator's "Sync chats" opt-in is on
//! ([`settings_keys::CLOUD_SYNC_CHATS_ENABLED`], default off, M19).
//!
//! # What leaves the machine
//!
//! For every ACTIVE thread (`companion_session.status = 'active'`): its id,
//! title, origin, pinned flag and two timestamps; and its USER and ASSISTANT
//! turns (masked token by token, capped at 32 KB) from 90 days before the
//! opt-in onwards. Never: system rows (forwarded prompts, autonomy markers,
//! the machine correlator records), the `claude_session_id`, archived
//! threads, or anything of the brain above the threads.
//!
//! # Incremental, with deletion found by counting
//!
//! Athena's storage has no tombstones: a thread is archived (soft) or its
//! transcript is wiped (`session::wipe_transcript`), and a single episode can
//! be deleted from the brain view. A tombstone table would mean hooking every
//! one of those writers in the companion module. Instead the pass keeps a
//! small per-thread ledger (persisted under the cursor key [`LEDGER_CURSOR`]):
//!
//! * a `(created_at, id)` keyset cursor of the newest turn pushed, so each
//!   pass pushes only what is new (turns are append-only);
//! * the COUNT of the thread's turns in `[floor, cursor]` at push time. On the
//!   next pass the same count is taken again; if it differs, a turn this
//!   device already pushed was deleted (or an older one was indexed late), and
//!   the thread is replaced: its cloud messages are deleted and pushed again
//!   from the floor. That costs one indexed COUNT per thread per pass and is
//!   exact for any deletion, however it happened;
//! * the fingerprint of the thread row, so a session row is upserted only when
//!   its title, pin, origin or activity changed.
//!
//! A thread that leaves the active set (archived) is removed from the cloud
//! with its messages. Turning the opt-in off deletes every Athena row of this
//! device and forgets the ledger.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::client::SyncClient;
use super::notes::to_timestamptz;
use super::redact::{project_text, CHAT_CONTENT_CAP, SHORT_TEXT_CAP};
use crate::db::repos::core::settings;
use crate::db::settings_keys;
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

/// `synced_chat_*.persona_id` of every Athena row, and the persona a
/// `chat_send` to Athena names (`pending_commands.persona_id`,
/// `envelope.persona`). Desktop persona ids are UUIDs, so it cannot collide.
pub const ATHENA_PERSONA: &str = "athena";

/// `synced_chat_*.thread_kind` of Athena rows.
pub const THREAD_KIND: &str = "athena";

/// Cursor keys in `SYNC_TABLES` (the status grid's "last synced").
pub(super) const SESSIONS_CURSOR: &str = "chat_sessions";
pub(super) const MESSAGES_CURSOR: &str = "chat_messages";

/// The ledger's key (under the cursor prefix, so it is unaudited bookkeeping).
/// Its presence also means "this device may have Athena rows in the cloud",
/// which is what the opt-out purge keys on.
pub(super) const LEDGER_CURSOR: &str = "athena_chat_ledger";

/// How far back the first push reaches, from the moment of the opt-in.
const FIRST_PUSH_DAYS: i64 = 90;

/// Turns read per query, and the most one pass pushes across all threads. A
/// pass that hits the budget wakes the loop again, so a long backlog drains
/// over consecutive passes instead of making one pass unbounded.
const PAGE: u32 = 200;
const PASS_BUDGET: usize = 2_000;

/// Whether the operator opted into syncing chats. Default off (M19).
pub fn chats_enabled(pool: &DbPool) -> bool {
    settings::get_bool(pool, settings_keys::CLOUD_SYNC_CHATS_ENABLED, false)
}

/// A thread id this module will put in a URL filter: the ids Athena mints
/// (`default`, `athena-notices`, `conv_<hex>`). Anything else is not synced,
/// rather than escaped into a PostgREST filter.
pub fn is_syncable_thread_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// One thread as `synced_chat_sessions` holds it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ChatSessionRow {
    pub device_id: String,
    pub thread_kind: &'static str,
    pub session_id: String,
    pub persona_id: &'static str,
    pub title: Option<String>,
    pub chat_mode: Option<String>,
    pub origin: Option<String>,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// One turn as `synced_chat_messages` holds it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ChatMessageRow {
    pub device_id: String,
    pub thread_kind: &'static str,
    pub id: String,
    pub persona_id: &'static str,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub execution_id: Option<String>,
    pub created_at: String,
}

/// What the pass remembers about one pushed thread.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(super) struct ThreadMark {
    /// Fingerprint of the session row last upserted.
    pub fp: String,
    /// `(created_at, id)` of the newest turn pushed, as stored locally.
    pub cursor: Option<(String, String)>,
    /// Turns in `[floor, cursor]` when the cursor was written.
    pub pushed: u64,
}

/// The per-device ledger of the Athena chat projection.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(super) struct Ledger {
    /// Turns older than this are never pushed (opt-in time minus 90 days).
    pub floor: String,
    pub threads: BTreeMap<String, ThreadMark>,
}

fn ledger_key() -> String {
    format!(
        "{}{}",
        settings_keys::CLOUD_SYNC_CURSOR_PREFIX,
        LEDGER_CURSOR
    )
}

pub(super) fn load_ledger(pool: &DbPool) -> Option<Ledger> {
    let raw = super::cursor::peek_cursor(pool, LEDGER_CURSOR)?;
    // An unreadable ledger is treated as present-but-empty: the threads are
    // pushed again from the floor (an idempotent upsert), never skipped.
    Some(serde_json::from_str(&raw).unwrap_or_else(|_| Ledger {
        floor: first_push_floor(),
        threads: BTreeMap::new(),
    }))
}

fn save_ledger(pool: &DbPool, ledger: &Ledger) -> Result<(), AppError> {
    let raw = serde_json::to_string(ledger)
        .map_err(|e| AppError::Internal(format!("chat ledger encode: {e}")))?;
    settings::set(pool, &ledger_key(), &raw)
}

/// Forget the ledger and the two status cursors (after a purge).
pub(super) fn forget(pool: &DbPool) -> Result<(), AppError> {
    for name in [LEDGER_CURSOR, SESSIONS_CURSOR, MESSAGES_CURSOR] {
        let key = format!("{}{}", settings_keys::CLOUD_SYNC_CURSOR_PREFIX, name);
        settings::delete(pool, &key)?;
    }
    Ok(())
}

fn first_push_floor() -> String {
    (chrono::Utc::now() - chrono::Duration::days(FIRST_PUSH_DAYS)).to_rfc3339()
}

/// The active threads, as rows plus their fingerprints.
fn active_threads(user_db: &UserDbPool, device_id: &str) -> Result<Vec<ChatSessionRow>, AppError> {
    let conn = user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, title, origin, pinned, created_at, last_active_at FROM companion_session \
         WHERE status = 'active' ORDER BY id",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter(|(id, ..)| is_syncable_thread_id(id))
        .map(
            |(id, title, origin, pinned, created_at, last_active_at)| ChatSessionRow {
                device_id: device_id.to_string(),
                thread_kind: THREAD_KIND,
                session_id: id,
                persona_id: ATHENA_PERSONA,
                title: title.map(|t| project_text(&t, SHORT_TEXT_CAP)),
                chat_mode: None,
                origin,
                pinned: pinned != 0,
                created_at: to_timestamptz(&created_at),
                updated_at: to_timestamptz(&last_active_at),
            },
        )
        .collect())
}

fn session_fp(row: &ChatSessionRow) -> String {
    serde_json::to_string(row).unwrap_or_default()
}

fn to_message(device_id: &str, e: crate::companion::brain::episodic::Episode) -> ChatMessageRow {
    ChatMessageRow {
        device_id: device_id.to_string(),
        thread_kind: THREAD_KIND,
        persona_id: ATHENA_PERSONA,
        content: project_text(e.content.trim_end(), CHAT_CONTENT_CAP),
        role: e.role,
        created_at: to_timestamptz(&e.created_at),
        session_id: e.session_id,
        execution_id: None,
        id: e.id,
    }
}

/// The cloud side of the projection. A trait so the pass's decisions are
/// tested without a network.
#[async_trait::async_trait]
pub(super) trait ChatCloud: Send + Sync {
    async fn upsert_sessions(&self, rows: &[ChatSessionRow]) -> Result<(), AppError>;
    async fn upsert_messages(&self, rows: &[ChatMessageRow]) -> Result<(), AppError>;
    /// Delete this device's Athena messages of one thread.
    async fn delete_thread_messages(&self, session_id: &str) -> Result<(), AppError>;
    /// Delete this device's Athena session row of one thread.
    async fn delete_thread(&self, session_id: &str) -> Result<(), AppError>;
    /// Delete every Athena row of this device (the opt-out).
    async fn purge(&self) -> Result<(), AppError>;
}

/// [`ChatCloud`] over PostgREST, every filter scoped to this device and kind.
pub(super) struct PostgrestChat<'a> {
    pub client: &'a SyncClient,
    pub device_id: String,
}

#[async_trait::async_trait]
impl ChatCloud for PostgrestChat<'_> {
    async fn upsert_sessions(&self, rows: &[ChatSessionRow]) -> Result<(), AppError> {
        self.client.upsert("synced_chat_sessions", rows).await
    }
    async fn upsert_messages(&self, rows: &[ChatMessageRow]) -> Result<(), AppError> {
        self.client.upsert("synced_chat_messages", rows).await
    }
    async fn delete_thread_messages(&self, session_id: &str) -> Result<(), AppError> {
        self.client
            .delete(&format!(
                "synced_chat_messages?device_id=eq.{}&thread_kind=eq.{THREAD_KIND}&session_id=eq.{session_id}",
                self.device_id
            ))
            .await
    }
    async fn delete_thread(&self, session_id: &str) -> Result<(), AppError> {
        self.client
            .delete(&format!(
                "synced_chat_sessions?device_id=eq.{}&thread_kind=eq.{THREAD_KIND}&session_id=eq.{session_id}",
                self.device_id
            ))
            .await
    }
    async fn purge(&self) -> Result<(), AppError> {
        // Messages first: a failure between the two leaves sessions without
        // messages, never messages under no session.
        self.client
            .delete(&format!(
                "synced_chat_messages?device_id=eq.{}&thread_kind=eq.{THREAD_KIND}",
                self.device_id
            ))
            .await?;
        self.client
            .delete(&format!(
                "synced_chat_sessions?device_id=eq.{}&thread_kind=eq.{THREAD_KIND}",
                self.device_id
            ))
            .await
    }
}

/// What one pass did: rows upserted per table.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct ChatPassReport {
    pub sessions: u64,
    pub messages: u64,
    /// The pass budget ran out; more turns wait for the next pass.
    pub more: bool,
}

/// One pass of the Athena chat projection. Opted out: purge if an earlier
/// push left rows, else nothing. Opted in: the ledger walk described in the
/// module doc. The ledger is saved after every thread, so a failure part-way
/// keeps the progress already made.
pub(super) async fn run_pass(
    pool: &DbPool,
    user_db: &UserDbPool,
    cloud: &dyn ChatCloud,
    device_id: &str,
) -> Result<ChatPassReport, AppError> {
    let mut report = ChatPassReport::default();
    let existing = load_ledger(pool);
    if !chats_enabled(pool) {
        if existing.is_some() {
            cloud.purge().await?;
            forget(pool)?;
        }
        return Ok(report);
    }
    let mut ledger = existing.unwrap_or_else(|| Ledger {
        floor: first_push_floor(),
        threads: BTreeMap::new(),
    });
    save_ledger(pool, &ledger)?;

    let threads = active_threads(user_db, device_id)?;
    let active: BTreeSet<&str> = threads.iter().map(|t| t.session_id.as_str()).collect();

    // Threads that left the active set: remove them, messages first.
    let gone: Vec<String> = ledger
        .threads
        .keys()
        .filter(|id| !active.contains(id.as_str()))
        .cloned()
        .collect();
    for id in gone {
        cloud.delete_thread_messages(&id).await?;
        cloud.delete_thread(&id).await?;
        ledger.threads.remove(&id);
        save_ledger(pool, &ledger)?;
    }

    let mut budget = PASS_BUDGET;
    for thread in &threads {
        let id = thread.session_id.as_str();
        let mut mark = ledger.threads.get(id).cloned().unwrap_or_default();

        // 1. The session row, when it changed (before its messages, so the web
        //    never sees messages under an unknown thread).
        let fp = session_fp(thread);
        if mark.fp != fp {
            cloud.upsert_sessions(std::slice::from_ref(thread)).await?;
            report.sessions += 1;
            mark.fp = fp;
            ledger.threads.insert(id.to_string(), mark.clone());
            save_ledger(pool, &ledger)?;
        }

        // 2. Deletion check: the pushed range must still hold what it held.
        if let Some((at, eid)) = mark.cursor.clone() {
            let now_count = crate::companion::brain::episodic::count_turns_through(
                user_db,
                id,
                &ledger.floor,
                (&at, &eid),
            )?;
            if now_count != mark.pushed {
                tracing::info!(
                    thread = id,
                    was = mark.pushed,
                    now = now_count,
                    "cloud sync: an Athena thread changed under its cursor; pushing it again"
                );
                cloud.delete_thread_messages(id).await?;
                mark.cursor = None;
                mark.pushed = 0;
                ledger.threads.insert(id.to_string(), mark.clone());
                save_ledger(pool, &ledger)?;
            }
        }

        // 3. Push what is new, a page at a time, within the pass budget.
        while budget > 0 {
            let limit = PAGE.min(budget as u32);
            let after = mark.cursor.as_ref().map(|(a, b)| (a.as_str(), b.as_str()));
            let page = crate::companion::brain::episodic::list_turns_after(
                user_db,
                id,
                &ledger.floor,
                after,
                limit,
            )?;
            if page.is_empty() {
                break;
            }
            let full = page.len() as u32 == limit;
            let Some(last) = page.last().map(|e| (e.created_at.clone(), e.id.clone())) else {
                break;
            };
            let rows: Vec<ChatMessageRow> =
                page.into_iter().map(|e| to_message(device_id, e)).collect();
            cloud.upsert_messages(&rows).await?;
            report.messages += rows.len() as u64;
            budget = budget.saturating_sub(rows.len());
            mark.pushed = crate::companion::brain::episodic::count_turns_through(
                user_db,
                id,
                &ledger.floor,
                (&last.0, &last.1),
            )?;
            mark.cursor = Some(last);
            ledger.threads.insert(id.to_string(), mark.clone());
            save_ledger(pool, &ledger)?;
            if !full {
                break;
            }
        }
        if budget == 0 {
            report.more = true;
            break;
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use std::sync::Mutex as StdMutex;

    #[derive(Default)]
    struct FakeCloud {
        sessions: StdMutex<BTreeMap<String, ChatSessionRow>>,
        messages: StdMutex<BTreeMap<String, ChatMessageRow>>,
        session_upserts: StdMutex<u32>,
    }

    impl FakeCloud {
        fn message_ids(&self, thread: &str) -> Vec<String> {
            self.messages
                .lock()
                .unwrap()
                .values()
                .filter(|m| m.session_id == thread)
                .map(|m| m.id.clone())
                .collect()
        }
        fn session_ids(&self) -> Vec<String> {
            self.sessions.lock().unwrap().keys().cloned().collect()
        }
    }

    #[async_trait::async_trait]
    impl ChatCloud for FakeCloud {
        async fn upsert_sessions(&self, rows: &[ChatSessionRow]) -> Result<(), AppError> {
            *self.session_upserts.lock().unwrap() += 1;
            let mut s = self.sessions.lock().unwrap();
            for r in rows {
                s.insert(r.session_id.clone(), r.clone());
            }
            Ok(())
        }
        async fn upsert_messages(&self, rows: &[ChatMessageRow]) -> Result<(), AppError> {
            let mut m = self.messages.lock().unwrap();
            for r in rows {
                m.insert(r.id.clone(), r.clone());
            }
            Ok(())
        }
        async fn delete_thread_messages(&self, session_id: &str) -> Result<(), AppError> {
            self.messages
                .lock()
                .unwrap()
                .retain(|_, m| m.session_id != session_id);
            Ok(())
        }
        async fn delete_thread(&self, session_id: &str) -> Result<(), AppError> {
            self.sessions.lock().unwrap().remove(session_id);
            Ok(())
        }
        async fn purge(&self) -> Result<(), AppError> {
            self.messages.lock().unwrap().clear();
            self.sessions.lock().unwrap().clear();
            Ok(())
        }
    }

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    fn pools() -> (DbPool, UserDbPool) {
        let pool = crate::db::init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();
        (pool, user)
    }

    /// Run one statement on the user DB; the checkout propagates.
    fn sql(user: &UserDbPool, stmt: &str, p: impl rusqlite::Params) -> Result<usize, AppError> {
        Ok(user.get()?.execute(stmt, p)?)
    }

    fn thread(user: &UserDbPool, id: &str, title: &str) {
        sql(
            user,
                "INSERT INTO companion_session (id, title, status, origin, pinned, created_at, last_active_at) \
                 VALUES (?1, ?2, 'active', 'user', 0, '2026-10-06 10:00:00', '2026-10-06 10:00:00')",
                params![id, title],
            )
            .unwrap();
    }

    /// One index row with a short body (the excerpt holds the whole body, so
    /// no file is read).
    fn turn(user: &UserDbPool, id: &str, thread: &str, role: &str, at: &str, body: &str) {
        sql(
            user,
                "INSERT INTO companion_node (id, kind, session_id, file_path, content_hash, importance, body_excerpt, created_at, updated_at) \
                 VALUES (?1, 'episode', ?2, ?3, 'h', 3, ?4, ?5, ?5)",
                params![id, thread, format!("episodes/2026/10/06/{id}_{role}.md"), body, at],
            )
            .unwrap();
    }

    fn enable(pool: &DbPool, on: bool) {
        settings::set(
            pool,
            settings_keys::CLOUD_SYNC_CHATS_ENABLED,
            if on { "true" } else { "false" },
        )
        .unwrap();
    }

    fn pass(pool: &DbPool, user: &UserDbPool, cloud: &FakeCloud) -> ChatPassReport {
        block_on(run_pass(pool, user, cloud, "dev-1")).unwrap()
    }

    const T1: &str = "2026-10-06T10:00:01+00:00";
    const T2: &str = "2026-10-06T10:00:02+00:00";
    const T3: &str = "2026-10-06T10:00:03+00:00";

    #[test]
    fn off_by_default_pushes_nothing() {
        let (pool, user) = pools();
        thread(&user, "default", "General");
        turn(&user, "ep_a", "default", "user", T1, "hello");
        let cloud = FakeCloud::default();
        assert_eq!(pass(&pool, &user, &cloud), ChatPassReport::default());
        assert!(cloud.session_ids().is_empty());
        assert!(load_ledger(&pool).is_none(), "no ledger until opted in");
    }

    #[test]
    fn pushes_user_and_assistant_turns_only_masked_with_the_sentinel() {
        let (pool, user) = pools();
        enable(&pool, true);
        thread(&user, "default", "General");
        turn(
            &user,
            "ep_u",
            "default",
            "user",
            T1,
            "my key is ghp_16C7e42F292c6912E7710c838347Ae178B4a ok", // gitleaks:allow
        );
        turn(&user, "ep_a", "default", "assistant", T2, "Noted.");
        turn(&user, "ep_s", "default", "system", T3, "[proactive: brief]");
        let cloud = FakeCloud::default();
        let r = pass(&pool, &user, &cloud);
        assert_eq!((r.sessions, r.messages), (1, 2));
        let msgs = cloud.messages.lock().unwrap();
        let u = &msgs["ep_u"];
        assert_eq!(u.content, "my key is [redacted] ok");
        assert_eq!(
            (u.persona_id, u.thread_kind, u.role.as_str()),
            ("athena", "athena", "user")
        );
        assert_eq!(u.created_at, "2026-10-06T10:00:01Z");
        assert!(!msgs.contains_key("ep_s"), "system rows never leave");
        let s = &cloud.sessions.lock().unwrap()["default"];
        assert_eq!(
            (s.persona_id, s.title.as_deref()),
            ("athena", Some("General"))
        );
        assert_eq!(s.updated_at, "2026-10-06T10:00:00Z");
    }

    #[test]
    fn a_second_pass_pushes_only_what_is_new_and_skips_an_unchanged_thread() {
        let (pool, user) = pools();
        enable(&pool, true);
        thread(&user, "default", "General");
        turn(&user, "ep_1", "default", "user", T1, "one");
        let cloud = FakeCloud::default();
        pass(&pool, &user, &cloud);
        assert_eq!(pass(&pool, &user, &cloud), ChatPassReport::default());
        assert_eq!(*cloud.session_upserts.lock().unwrap(), 1);
        turn(&user, "ep_2", "default", "assistant", T2, "two");
        let r = pass(&pool, &user, &cloud);
        assert_eq!((r.sessions, r.messages), (0, 1));
        assert_eq!(cloud.message_ids("default"), vec!["ep_1", "ep_2"]);
    }

    #[test]
    fn a_deleted_turn_is_found_by_the_count_and_the_thread_is_replaced() {
        let (pool, user) = pools();
        enable(&pool, true);
        thread(&user, "default", "General");
        turn(&user, "ep_1", "default", "user", T1, "one");
        turn(&user, "ep_2", "default", "assistant", T2, "two");
        let cloud = FakeCloud::default();
        pass(&pool, &user, &cloud);
        // A brain-view delete of an already-pushed turn, then a new turn: the
        // newest-cursor alone would never notice the first.
        sql(&user, "DELETE FROM companion_node WHERE id = 'ep_1'", []).unwrap();
        turn(&user, "ep_3", "default", "user", T3, "three");
        pass(&pool, &user, &cloud);
        assert_eq!(cloud.message_ids("default"), vec!["ep_2", "ep_3"]);
    }

    #[test]
    fn a_wiped_thread_loses_its_cloud_messages() {
        let (pool, user) = pools();
        enable(&pool, true);
        thread(&user, "default", "General");
        turn(&user, "ep_1", "default", "user", T1, "one");
        let cloud = FakeCloud::default();
        pass(&pool, &user, &cloud);
        sql(
            &user,
            "DELETE FROM companion_node WHERE session_id = 'default'",
            [],
        )
        .unwrap();
        pass(&pool, &user, &cloud);
        assert!(cloud.message_ids("default").is_empty());
        assert_eq!(
            cloud.session_ids(),
            vec!["default"],
            "the thread itself stays"
        );
    }

    #[test]
    fn an_archived_thread_leaves_the_cloud_with_its_messages() {
        let (pool, user) = pools();
        enable(&pool, true);
        thread(&user, "default", "General");
        thread(&user, "conv_abc", "Q3 planning");
        turn(&user, "ep_1", "conv_abc", "user", T1, "plan");
        let cloud = FakeCloud::default();
        pass(&pool, &user, &cloud);
        assert_eq!(cloud.session_ids(), vec!["conv_abc", "default"]);
        sql(
            &user,
            "UPDATE companion_session SET status = 'archived' WHERE id = 'conv_abc'",
            [],
        )
        .unwrap();
        pass(&pool, &user, &cloud);
        assert_eq!(cloud.session_ids(), vec!["default"]);
        assert!(cloud.message_ids("conv_abc").is_empty());
    }

    #[test]
    fn opting_out_purges_this_devices_rows_and_forgets_the_ledger() {
        let (pool, user) = pools();
        enable(&pool, true);
        thread(&user, "default", "General");
        turn(&user, "ep_1", "default", "user", T1, "one");
        let cloud = FakeCloud::default();
        pass(&pool, &user, &cloud);
        assert!(load_ledger(&pool).is_some());
        enable(&pool, false);
        pass(&pool, &user, &cloud);
        assert!(cloud.session_ids().is_empty());
        assert!(cloud.messages.lock().unwrap().is_empty());
        assert!(load_ledger(&pool).is_none());
        // Opting in again pushes from scratch.
        enable(&pool, true);
        let r = pass(&pool, &user, &cloud);
        assert_eq!((r.sessions, r.messages), (1, 1));
    }

    #[test]
    fn turns_before_the_floor_are_not_pushed() {
        let (pool, user) = pools();
        enable(&pool, true);
        thread(&user, "default", "General");
        turn(
            &user,
            "ep_old",
            "default",
            "user",
            "2020-01-01T00:00:00+00:00",
            "ancient",
        );
        turn(&user, "ep_new", "default", "user", T1, "recent");
        let cloud = FakeCloud::default();
        pass(&pool, &user, &cloud);
        assert_eq!(cloud.message_ids("default"), vec!["ep_new"]);
    }

    #[test]
    fn thread_ids_outside_the_minted_alphabet_are_not_synced() {
        assert!(is_syncable_thread_id("default"));
        assert!(is_syncable_thread_id("athena-notices"));
        assert!(is_syncable_thread_id("conv_0123abcd"));
        assert!(!is_syncable_thread_id("a&b=c"));
        assert!(!is_syncable_thread_id(""));
    }
}
