//! Persona chats -> `synced_chat_sessions` + `synced_chat_messages` with
//! `thread_kind = 'persona'` (PHASE2-SPEC 5.2; owner decision M18: Athena
//! first, then persona chat - this is the second half).
//!
//! Pushed only while the operator's "Sync chats" opt-in is on
//! ([`settings_keys::CLOUD_SYNC_CHATS_ENABLED`], default off, M19) - the same
//! switch as Athena's chats.
//!
//! # What leaves the machine
//!
//! For every persona chat session (`chat_session_context`) active in the 90
//! days before the opt-in or since: its id, persona, title (masked, 1 KB) and
//! chat mode, and two timestamps. For every USER and ASSISTANT message
//! (`chat_messages`) from the same floor on: its id, persona, session, role,
//! content (masked token by token, capped at 32 KB) and the execution that
//! answered it. Never: system or tool rows, the summary, working memory, the
//! system prompt hash, the Claude session id, or message metadata.
//!
//! # Incremental, deletions by tombstone
//!
//! Unlike Athena's storage, persona chat has ONE delete path
//! (`repos::communication::chat::delete_session`), so a tombstone is exact and
//! cheap: that function writes `chat_session_tombstones` in its transaction,
//! and the pass deletes each tombstoned session (messages first) after its
//! cursor. A persona delete needs no tombstone here: `persona_tombstones`
//! already sweeps both tables by `persona_id` (`PERSONA_SCOPED_TABLES`).
//!
//! * Sessions: cursor on `updated_at` (a turn touches it).
//! * Messages: cursor on `created_at`, append-only, so no resync window; read
//!   in pages of [`PAGE`], and a pass that fills one wakes the loop again.
//!
//! Cursors compare with `julianday`, which keeps milliseconds - the generic
//! `sync_table` fetch compares `datetime()`, which drops them, and would skip
//! a message written in the same second as the last one pushed.
//!
//! Turning the opt-in off deletes every persona chat row of this device and
//! forgets the cursors, so turning it on again starts a fresh 90-day push.

use rusqlite::params;
use serde::Serialize;

use super::client::SyncClient;
use super::cursor;
use super::notes::to_timestamptz;
use super::redact::{project_text, CHAT_CONTENT_CAP, SHORT_TEXT_CAP};
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;

/// `synced_chat_*.thread_kind` of persona rows.
pub const THREAD_KIND: &str = "persona";

/// Cursor keys. The first two are `SYNC_TABLES` entries (the status grid
/// shows them under the same two tables as Athena's); the third is the
/// tombstone watermark.
pub(super) const SESSIONS_CURSOR: &str = "persona_chat_sessions";
pub(super) const MESSAGES_CURSOR: &str = "persona_chat_messages";
pub(super) const TOMBSTONES_CURSOR: &str = "persona_chat_tombstones";

/// Messages read per pass at most.
pub(super) const PAGE: usize = 2_000;

/// A session id this module will put in a URL filter: the ids the desktop
/// mints (`chat-<ms>-<hex>`, `bgchat-<ms>-<hex>`). Anything else is not
/// synced, rather than escaped into a PostgREST filter.
pub fn is_syncable_session_id(id: &str) -> bool {
    super::athena_chat::is_syncable_thread_id(id)
}

/// One persona chat session as `synced_chat_sessions` holds it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PersonaChatSessionRow {
    pub device_id: String,
    pub thread_kind: &'static str,
    pub session_id: String,
    pub persona_id: String,
    pub title: Option<String>,
    pub chat_mode: Option<String>,
    pub origin: Option<String>,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// One persona chat message as `synced_chat_messages` holds it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PersonaChatMessageRow {
    pub device_id: String,
    pub thread_kind: &'static str,
    pub id: String,
    pub persona_id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub execution_id: Option<String>,
    pub created_at: String,
}

/// The cloud side. A trait so the pass is tested without a network.
#[async_trait::async_trait]
pub(super) trait PersonaChatCloud: Send + Sync {
    async fn upsert_sessions(&self, rows: &[PersonaChatSessionRow]) -> Result<(), AppError>;
    async fn upsert_messages(&self, rows: &[PersonaChatMessageRow]) -> Result<(), AppError>;
    /// Delete one session of this device, its messages first.
    async fn delete_session(&self, session_id: &str) -> Result<(), AppError>;
    /// Delete every persona chat row of this device (the opt-out).
    async fn purge(&self) -> Result<(), AppError>;
}

/// [`PersonaChatCloud`] over PostgREST, every filter scoped to this device and
/// kind.
pub(super) struct PostgrestPersonaChat<'a> {
    pub client: &'a SyncClient,
    pub device_id: String,
}

#[async_trait::async_trait]
impl PersonaChatCloud for PostgrestPersonaChat<'_> {
    async fn upsert_sessions(&self, rows: &[PersonaChatSessionRow]) -> Result<(), AppError> {
        self.client.upsert("synced_chat_sessions", rows).await
    }
    async fn upsert_messages(&self, rows: &[PersonaChatMessageRow]) -> Result<(), AppError> {
        self.client.upsert("synced_chat_messages", rows).await
    }
    async fn delete_session(&self, session_id: &str) -> Result<(), AppError> {
        // Messages first: a failure between the two leaves a session without
        // messages, never messages under no session.
        self.client
            .delete(&format!(
                "synced_chat_messages?device_id=eq.{}&thread_kind=eq.{THREAD_KIND}&session_id=eq.{session_id}",
                self.device_id
            ))
            .await?;
        self.client
            .delete(&format!(
                "synced_chat_sessions?device_id=eq.{}&thread_kind=eq.{THREAD_KIND}&session_id=eq.{session_id}",
                self.device_id
            ))
            .await
    }
    async fn purge(&self) -> Result<(), AppError> {
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

/// What one pass did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct PersonaChatReport {
    pub sessions: u64,
    pub messages: u64,
    pub deleted: u64,
    /// A page was full: more messages wait for the next pass.
    pub more: bool,
}

fn chats_enabled(pool: &DbPool) -> bool {
    super::athena_chat::chats_enabled(pool)
}

/// Whether an earlier pass may have left persona rows in the cloud: any of
/// the cursors exists (they are written from the first opted-in pass on).
fn may_have_rows(pool: &DbPool) -> bool {
    [SESSIONS_CURSOR, MESSAGES_CURSOR]
        .iter()
        .any(|k| cursor::peek_cursor(pool, k).is_some())
}

/// Forget the cursors (after a purge).
fn forget(pool: &DbPool) -> Result<(), AppError> {
    for name in [SESSIONS_CURSOR, MESSAGES_CURSOR, TOMBSTONES_CURSOR] {
        let key = format!("{}{}", settings_keys::CLOUD_SYNC_CURSOR_PREFIX, name);
        crate::db::repos::core::settings::delete(pool, &key)?;
    }
    Ok(())
}

/// Sessions changed after `after`, oldest first, and the newest `updated_at`
/// read (as stored).
fn fetch_sessions(
    pool: &DbPool,
    device_id: &str,
    after: &str,
) -> Result<(Vec<PersonaChatSessionRow>, Option<String>), AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT session_id, persona_id, title, chat_mode, created_at, updated_at \
         FROM chat_session_context \
         WHERE julianday(updated_at) > julianday(?1) \
         ORDER BY julianday(updated_at), session_id",
    )?;
    let raw = stmt
        .query_map(params![after], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let newest = raw.last().map(|r| r.5.clone());
    let rows = raw
        .into_iter()
        .filter(|r| is_syncable_session_id(&r.0))
        .map(
            |(session_id, persona_id, title, chat_mode, created_at, updated_at)| {
                PersonaChatSessionRow {
                    device_id: device_id.to_string(),
                    thread_kind: THREAD_KIND,
                    session_id,
                    persona_id,
                    title: title.map(|t| project_text(&t, SHORT_TEXT_CAP)),
                    chat_mode: Some(chat_mode),
                    origin: None,
                    pinned: false,
                    created_at: to_timestamptz(&created_at),
                    updated_at: to_timestamptz(&updated_at),
                }
            },
        )
        .collect();
    Ok((rows, newest))
}

/// User and assistant messages written after `after`, oldest first, at most
/// `page`; the newest `created_at` read (as stored); and whether the page was
/// full. A full page never ends inside a group of messages sharing one
/// timestamp: that group is left for the next pass (unless it is the whole
/// page), so the cursor cannot step over a message it did not push.
fn fetch_messages(
    pool: &DbPool,
    device_id: &str,
    after: &str,
    page: usize,
) -> Result<(Vec<PersonaChatMessageRow>, Option<String>, bool), AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, persona_id, session_id, role, content, execution_id, created_at, \
                julianday(created_at) \
         FROM chat_messages \
         WHERE role IN ('user', 'assistant') AND julianday(created_at) > julianday(?1) \
         ORDER BY julianday(created_at), id \
         LIMIT ?2",
    )?;
    let mut raw = stmt
        .query_map(params![after, page as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, f64>(7)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let full = raw.len() == page;
    if full {
        if let Some(last_jd) = raw.last().map(|r| r.7) {
            let keep = raw.iter().take_while(|r| r.7 < last_jd).count();
            if keep > 0 {
                raw.truncate(keep);
            }
        }
    }
    let newest = raw.last().map(|r| r.6.clone());
    let rows = raw
        .into_iter()
        .filter(|r| is_syncable_session_id(&r.2))
        .map(
            |(id, persona_id, session_id, role, content, execution_id, created_at, _)| {
                PersonaChatMessageRow {
                    device_id: device_id.to_string(),
                    thread_kind: THREAD_KIND,
                    id,
                    persona_id,
                    session_id,
                    role,
                    content: project_text(content.trim_end(), CHAT_CONTENT_CAP),
                    execution_id,
                    created_at: to_timestamptz(&created_at),
                }
            },
        )
        .collect();
    Ok((rows, newest, full))
}

/// Session deletions after `after`, oldest first: `(session_id, deleted_at)`.
fn fetch_tombstones(pool: &DbPool, after: &str) -> Result<Vec<(String, String)>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT session_id, deleted_at FROM chat_session_tombstones \
         WHERE julianday(deleted_at) > julianday(?1) \
         ORDER BY julianday(deleted_at), session_id",
    )?;
    let rows = stmt
        .query_map(params![after], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// One pass of the persona chat projection. Opted out: purge if an earlier
/// push left rows, else nothing. Opted in: sessions, then messages (so the
/// web never sees a message under an unknown session), then deletions. Each
/// cursor advances only after its upsert succeeded.
pub(super) async fn run_pass(
    pool: &DbPool,
    cloud: &dyn PersonaChatCloud,
    device_id: &str,
) -> Result<PersonaChatReport, AppError> {
    let mut report = PersonaChatReport::default();
    if !chats_enabled(pool) {
        if may_have_rows(pool) {
            cloud.purge().await?;
            forget(pool)?;
        }
        return Ok(report);
    }

    // 1. Sessions. The first opted-in pass anchors each cursor at the 90-day
    //    floor even when nothing is pushed, so the floor is fixed at the
    //    moment of the opt-in.
    let after = cursor::get_cursor(pool, SESSIONS_CURSOR, false);
    let (sessions, newest) = fetch_sessions(pool, device_id, &after)?;
    if !sessions.is_empty() {
        cloud.upsert_sessions(&sessions).await?;
        report.sessions = sessions.len() as u64;
    }
    cursor::set_cursor(pool, SESSIONS_CURSOR, newest.as_deref().unwrap_or(&after))?;

    // 2. Messages, one page.
    let after = cursor::get_cursor(pool, MESSAGES_CURSOR, false);
    let (messages, newest, full) = fetch_messages(pool, device_id, &after, PAGE)?;
    if !messages.is_empty() {
        cloud.upsert_messages(&messages).await?;
        report.messages = messages.len() as u64;
    }
    cursor::set_cursor(pool, MESSAGES_CURSOR, newest.as_deref().unwrap_or(&after))?;
    report.more = full;

    // 3. Deleted sessions.
    let after = cursor::get_cursor(pool, TOMBSTONES_CURSOR, false);
    for (session_id, deleted_at) in fetch_tombstones(pool, &after)? {
        if is_syncable_session_id(&session_id) {
            cloud.delete_session(&session_id).await?;
            report.deleted += 1;
        }
        // Per tombstone, so a failure part-way keeps what is already done.
        cursor::set_cursor(pool, TOMBSTONES_CURSOR, &deleted_at)?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{ChatRole, CreateChatMessageInput, UpsertSessionContextInput};
    use crate::db::repos::communication::chat;
    use crate::db::repos::core::settings;
    use std::collections::BTreeMap;
    use std::sync::Mutex as StdMutex;

    #[derive(Default)]
    struct FakeCloud {
        sessions: StdMutex<BTreeMap<String, PersonaChatSessionRow>>,
        messages: StdMutex<BTreeMap<String, PersonaChatMessageRow>>,
        purges: StdMutex<u32>,
    }

    impl FakeCloud {
        fn message_ids(&self) -> Vec<String> {
            self.messages.lock().unwrap().keys().cloned().collect()
        }
        fn session_ids(&self) -> Vec<String> {
            self.sessions.lock().unwrap().keys().cloned().collect()
        }
    }

    #[async_trait::async_trait]
    impl PersonaChatCloud for FakeCloud {
        async fn upsert_sessions(&self, rows: &[PersonaChatSessionRow]) -> Result<(), AppError> {
            let mut s = self.sessions.lock().unwrap();
            for r in rows {
                s.insert(r.session_id.clone(), r.clone());
            }
            Ok(())
        }
        async fn upsert_messages(&self, rows: &[PersonaChatMessageRow]) -> Result<(), AppError> {
            let mut m = self.messages.lock().unwrap();
            for r in rows {
                m.insert(r.id.clone(), r.clone());
            }
            Ok(())
        }
        async fn delete_session(&self, session_id: &str) -> Result<(), AppError> {
            self.messages
                .lock()
                .unwrap()
                .retain(|_, m| m.session_id != session_id);
            self.sessions.lock().unwrap().remove(session_id);
            Ok(())
        }
        async fn purge(&self) -> Result<(), AppError> {
            *self.purges.lock().unwrap() += 1;
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

    fn enable(pool: &DbPool, on: bool) {
        settings::set(
            pool,
            settings_keys::CLOUD_SYNC_CHATS_ENABLED,
            if on { "true" } else { "false" },
        )
        .unwrap();
    }

    fn persona(pool: &DbPool) -> String {
        crate::db::repos::core::personas::create(
            pool,
            crate::db::models::CreatePersonaInput {
                name: "Synced chat persona".into(),
                system_prompt: "You are a test persona.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    fn say(pool: &DbPool, persona: &str, session: &str, role: ChatRole, text: &str) -> String {
        chat::upsert_session_context(
            pool,
            UpsertSessionContextInput {
                session_id: session.into(),
                persona_id: persona.into(),
                title: Some(format!("Title of {session}")),
                summary: Some("a summary that never leaves".into()),
                system_prompt_hash: None,
                working_memory: Some("working memory that never leaves".into()),
                chat_mode: Some("agent".into()),
                claude_session_id: Some("claude-sess-never-leaves".into()),
            },
        )
        .unwrap();
        chat::create(
            pool,
            CreateChatMessageInput {
                persona_id: persona.into(),
                session_id: session.into(),
                role,
                content: text.into(),
                execution_id: None,
                metadata: Some(r#"{"secret":"never leaves"}"#.into()),
            },
        )
        .unwrap()
        .id
    }

    /// Run one statement; the checkout propagates.
    fn sql(pool: &DbPool, stmt: &str, p: impl rusqlite::Params) -> Result<usize, AppError> {
        Ok(pool.get()?.execute(stmt, p)?)
    }

    fn pass(pool: &DbPool, cloud: &FakeCloud) -> PersonaChatReport {
        block_on(run_pass(pool, cloud, "dev-1")).unwrap()
    }

    #[test]
    fn off_by_default_pushes_nothing_and_writes_no_cursor() {
        let pool = crate::db::init_test_db().unwrap();
        let p = persona(&pool);
        say(&pool, &p, "chat-1-aaaa0001", ChatRole::User, "hello");
        let cloud = FakeCloud::default();
        assert_eq!(pass(&pool, &cloud), PersonaChatReport::default());
        assert!(cloud.session_ids().is_empty());
        assert!(!may_have_rows(&pool));
        assert_eq!(*cloud.purges.lock().unwrap(), 0, "nothing to purge");
    }

    #[test]
    fn pushes_sessions_and_user_and_assistant_messages_only_masked() {
        let pool = crate::db::init_test_db().unwrap();
        enable(&pool, true);
        let p = persona(&pool);
        let u = say(
            &pool,
            &p,
            "chat-1-aaaa0001",
            ChatRole::User,
            "my key is ghp_16C7e42F292c6912E7710c838347Ae178B4a ok", // gitleaks:allow
        );
        let a = say(&pool, &p, "chat-1-aaaa0001", ChatRole::Assistant, "Noted.");
        let s = say(
            &pool,
            &p,
            "chat-1-aaaa0001",
            ChatRole::System,
            "system note",
        );
        let cloud = FakeCloud::default();
        let r = pass(&pool, &cloud);
        assert_eq!((r.sessions, r.messages), (1, 2));
        let msgs = cloud.messages.lock().unwrap();
        assert_eq!(msgs[&u].content, "my key is [redacted] ok");
        assert_eq!(
            (
                msgs[&u].thread_kind,
                msgs[&u].persona_id.as_str(),
                msgs[&u].role.as_str()
            ),
            ("persona", p.as_str(), "user")
        );
        assert_eq!(msgs[&a].role, "assistant");
        assert!(!msgs.contains_key(&s), "system rows never leave");
        let sess = &cloud.sessions.lock().unwrap()["chat-1-aaaa0001"];
        assert_eq!(sess.thread_kind, "persona");
        assert_eq!(sess.persona_id, p);
        assert_eq!(sess.chat_mode.as_deref(), Some("agent"));
        assert_eq!(sess.title.as_deref(), Some("Title of chat-1-aaaa0001"));
        let json = serde_json::to_string(sess).unwrap();
        for never in ["summary", "working", "claude", "secret"] {
            assert!(!json.contains(never), "{never} leaked: {json}");
        }
        assert!(!serde_json::to_string(&msgs[&u])
            .unwrap()
            .contains("never leaves"));
    }

    #[test]
    fn a_second_pass_pushes_only_what_is_new() {
        let pool = crate::db::init_test_db().unwrap();
        enable(&pool, true);
        let p = persona(&pool);
        say(&pool, &p, "chat-1-aaaa0001", ChatRole::User, "one");
        let cloud = FakeCloud::default();
        pass(&pool, &cloud);
        assert_eq!(pass(&pool, &cloud), PersonaChatReport::default());
        // Same second as the last push: julianday keeps the milliseconds.
        say(&pool, &p, "chat-1-aaaa0001", ChatRole::Assistant, "two");
        let r = pass(&pool, &cloud);
        assert_eq!((r.sessions, r.messages), (1, 1));
        assert_eq!(cloud.message_ids().len(), 2);
    }

    #[test]
    fn a_deleted_session_leaves_the_cloud_by_its_tombstone() {
        let pool = crate::db::init_test_db().unwrap();
        enable(&pool, true);
        let p = persona(&pool);
        say(&pool, &p, "chat-1-aaaa0001", ChatRole::User, "keep");
        say(&pool, &p, "chat-2-bbbb0002", ChatRole::User, "drop");
        let cloud = FakeCloud::default();
        pass(&pool, &cloud);
        assert_eq!(cloud.session_ids().len(), 2);
        chat::delete_session(&pool, &p, "chat-2-bbbb0002").unwrap();
        let r = pass(&pool, &cloud);
        assert_eq!(r.deleted, 1);
        assert_eq!(cloud.session_ids(), vec!["chat-1-aaaa0001"]);
        assert_eq!(cloud.message_ids().len(), 1);
        // The tombstone is processed once.
        assert_eq!(pass(&pool, &cloud).deleted, 0);
    }

    #[test]
    fn opting_out_purges_and_opting_in_again_starts_fresh() {
        let pool = crate::db::init_test_db().unwrap();
        enable(&pool, true);
        let p = persona(&pool);
        say(&pool, &p, "chat-1-aaaa0001", ChatRole::User, "one");
        let cloud = FakeCloud::default();
        pass(&pool, &cloud);
        assert!(may_have_rows(&pool));
        enable(&pool, false);
        pass(&pool, &cloud);
        assert!(cloud.session_ids().is_empty());
        assert!(cloud.message_ids().is_empty());
        assert!(!may_have_rows(&pool));
        assert_eq!(pass(&pool, &cloud), PersonaChatReport::default());
        assert_eq!(*cloud.purges.lock().unwrap(), 1, "purged once");
        enable(&pool, true);
        let r = pass(&pool, &cloud);
        assert_eq!((r.sessions, r.messages), (1, 1));
    }

    #[test]
    fn messages_before_the_floor_are_not_pushed() {
        let pool = crate::db::init_test_db().unwrap();
        enable(&pool, true);
        let p = persona(&pool);
        let old = say(&pool, &p, "chat-1-aaaa0001", ChatRole::User, "ancient");
        sql(
            &pool,
            "UPDATE chat_messages SET created_at = '2020-01-01T00:00:00+00:00' WHERE id = ?1",
            params![old],
        )
        .unwrap();
        let new = say(&pool, &p, "chat-1-aaaa0001", ChatRole::User, "recent");
        let cloud = FakeCloud::default();
        pass(&pool, &cloud);
        assert_eq!(cloud.message_ids(), vec![new]);
    }

    #[test]
    fn a_full_page_never_ends_inside_one_timestamp() {
        let pool = crate::db::init_test_db().unwrap();
        let p = persona(&pool);
        for (id, at) in [
            ("m1", "2026-10-06T10:00:00.001+00:00"),
            ("m2", "2026-10-06T10:00:00.002+00:00"),
            ("m3", "2026-10-06T10:00:00.002+00:00"),
        ] {
            sql(
                &pool,
                "INSERT INTO chat_messages (id, persona_id, session_id, role, content, created_at) \
                 VALUES (?1, ?2, 'chat-1-aaaa0001', 'user', 'x', ?3)",
                params![id, p, at],
            )
            .unwrap();
        }
        let (rows, newest, full) =
            fetch_messages(&pool, "dev-1", "2026-10-06T09:00:00Z", 2).unwrap();
        assert!(full);
        assert_eq!(
            rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["m1"],
            "m2 shares its timestamp with m3, which did not fit"
        );
        assert_eq!(newest.as_deref(), Some("2026-10-06T10:00:00.001+00:00"));
        let (rows, _, _) = fetch_messages(&pool, "dev-1", newest.as_deref().unwrap(), 2).unwrap();
        assert_eq!(
            rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["m2", "m3"]
        );
    }

    #[test]
    fn session_ids_outside_the_minted_alphabet_are_not_synced() {
        assert!(is_syncable_session_id("chat-1728200000000-0a1b2c3d"));
        assert!(is_syncable_session_id("bgchat-1728200000000-0a1b2c3d"));
        assert!(!is_syncable_session_id("chat&x=y"));
    }
}
