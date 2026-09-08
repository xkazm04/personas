//! The app-wide active-persona cap — one function, called by every door that
//! turns a persona ON.
//!
//! ## Why this exists
//!
//! Until 2026-09-07 nothing in the app bounded how many personas could be
//! switched on at once (`docs/architecture/grand-simulation.md` §3, gap G4).
//! Three things looked like they did and none of them do:
//!
//! | Looks like a cap | What it actually bounds |
//! |---|---|
//! | `MAX_PERSONAS = 200` (`commands/core/data_portability/limits.rs`) | how many rows one imported bundle may carry |
//! | `max_parallel_executions` (default 10) | how many executions run at the same *moment* |
//! | fleet `live_slots` | an in-memory soft eviction of idle sessions |
//!
//! A *population* cap is a different question from a *concurrency* cap: ten
//! personas that each wake on their own schedule can start work the machine
//! never agreed to, whatever the execution tracker admits. The Grand
//! Simulation's operator rule — at most ten active personas app-wide — is that
//! question, and [`MAX_ACTIVE_PERSONAS`] is where it is answered.
//!
//! ## The contract every door follows
//!
//! Call one of these BEFORE the write:
//!
//! * [`check_enable_headroom`] when a persona already exists — it reads the
//!   row's current `enabled`/`lifecycle`, applies the post-state the door is
//!   about to write, and refuses only when the count would actually RISE.
//! * [`check_active_persona_headroom`] when the door is a create, passing
//!   whether the row it is about to insert lands inside the counted population.
//!
//! **A change that leaves the count unchanged is never refused.** Re-enabling
//! an already enabled persona, a re-adoption that does not flip `enabled`, a
//! save of an active persona that happens to carry `enabled: true` — all of
//! them pass at the cap, because refusing them would make the cap a trap rather
//! than a limit. That is why the transition, not the current state, is what the
//! functions here take.
//!
//! The refusal is [`AppError::Validation`] and it names both numbers, because
//! "at the cap" is only actionable if you are told what the cap is and what to
//! do about it.

use personas_core::error::AppError;
use personas_db::repos::core::personas as personas_repo;
use personas_db::repos::core::settings as settings_repo;
use personas_db::settings_keys;
use personas_db::DbPool;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The active-persona population and the cap it is measured against.
///
/// Reported by `GET /dev-tools/app-master/{project}` and rendered into the App
/// Master's decision prompt, so an autonomous loop that is about to ask for
/// another hire can see the ceiling it is walking into rather than discovering
/// it as a refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ActivePersonaHeadroom {
    /// Personas that are `enabled = 1 AND lifecycle = 'active'` right now.
    pub active: usize,
    /// The configured ceiling — `max_active_personas`, or its default.
    pub cap: usize,
}

impl ActivePersonaHeadroom {
    /// Slots left before the next enable would be refused. Saturating: a count
    /// already above the cap (the cap was lowered under a running app, or rows
    /// were written by a path that predates this module) reports `0` rather
    /// than underflowing.
    pub fn free(&self) -> usize {
        self.cap.saturating_sub(self.active)
    }

    /// True when one MORE persona cannot be turned on.
    pub fn is_full(&self) -> bool {
        self.active >= self.cap
    }
}

/// The configured cap, clamped to its documented range.
///
/// Read fresh on every call rather than cached at construction — unlike
/// `max_parallel_executions`, which the engine seeds once into the
/// `ConcurrencyTracker`. There is no live object to hot-apply into here, so a
/// change to the setting takes effect at the very next door with no restart and
/// no hot-apply hook to keep in step. An unset, unparseable or out-of-range
/// value falls back to [`settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT`].
pub fn active_persona_cap(pool: &DbPool) -> usize {
    settings_repo::get(pool, settings_keys::MAX_ACTIVE_PERSONAS)
        .ok()
        .flatten()
        .and_then(|s| s.trim().parse::<usize>().ok())
        .filter(|n| {
            (settings_keys::MAX_ACTIVE_PERSONAS_MIN..=settings_keys::MAX_ACTIVE_PERSONAS_MAX)
                .contains(n)
        })
        .unwrap_or(settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT)
}

/// The live count and the cap, together.
///
/// A DB error propagates rather than being swallowed into an optimistic
/// "there's room": a cap that fails open under load is not a cap.
pub fn active_persona_headroom(pool: &DbPool) -> Result<ActivePersonaHeadroom, AppError> {
    Ok(ActivePersonaHeadroom {
        active: personas_repo::count_active(pool)?,
        cap: active_persona_cap(pool),
    })
}

/// The refusal message every door shares, so an operator meets one sentence
/// rather than five paraphrases of it.
fn at_cap_message(h: &ActivePersonaHeadroom) -> String {
    format!(
        "{} of {} active personas; disable one or raise max_active_personas",
        h.active, h.cap
    )
}

/// Gate one door.
///
/// * `raises_count` — whether this call would move a persona INTO the counted
///   population. `false` makes the check a no-op: the count cannot rise, so
///   there is nothing to refuse.
///
/// Returns the headroom as measured, so a caller that wants to report or log
/// the numbers does not have to read them a second time.
pub fn check_active_persona_headroom(
    pool: &DbPool,
    raises_count: bool,
) -> Result<ActivePersonaHeadroom, AppError> {
    let headroom = active_persona_headroom(pool)?;
    if raises_count && headroom.is_full() {
        return Err(AppError::Validation(at_cap_message(&headroom)));
    }
    Ok(headroom)
}

/// Gate a door that changes an EXISTING persona.
///
/// Reads the row's current `enabled` / `lifecycle`, applies the post-state this
/// door is about to write, and refuses only on an OFF→ON transition at the cap.
///
/// * `next_enabled` — the `enabled` value the door is about to write.
/// * `next_lifecycle` — the lifecycle it is about to write, when it writes one.
///   `None` = the door leaves the lifecycle alone, so the row's current value
///   is the post-state. This matters: a `draft` persona created with
///   `enabled = 1` is NOT active, so flipping its `enabled` changes nothing —
///   but an adoption that writes `enabled = true` AND `lifecycle = 'active'`
///   in the same statement does, and only the caller knows which it is.
///
/// An id with no row passes the check — the caller is about to fail on the
/// missing row anyway, and refusing it with a *capacity* message would name the
/// wrong problem.
pub fn check_enable_headroom(
    pool: &DbPool,
    persona_id: &str,
    next_enabled: bool,
    next_lifecycle: Option<&str>,
) -> Result<ActivePersonaHeadroom, AppError> {
    let Some((enabled_now, lifecycle_now)) =
        personas_repo::enabled_and_lifecycle(pool, persona_id)?
    else {
        return active_persona_headroom(pool);
    };
    let lifecycle_after = next_lifecycle.unwrap_or(&lifecycle_now);
    let was_active = enabled_now && lifecycle_now == LIFECYCLE_ACTIVE;
    let will_be_active = next_enabled && lifecycle_after == LIFECYCLE_ACTIVE;
    check_active_persona_headroom(pool, will_be_active && !was_active)
}

/// The one lifecycle value that counts. Mirrors
/// `personas_db::models::PersonaLifecycle::Active`, spelled here so the
/// comparison reads beside the SQL in `personas::count_active`.
const LIFECYCLE_ACTIVE: &str = "active";

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::init_test_db;
    use personas_db::models::CreatePersonaInput;
    use personas_db::PoolExt;

    fn persona(name: &str, enabled: bool, lifecycle: &str) -> CreatePersonaInput {
        CreatePersonaInput {
            name: name.to_string(),
            system_prompt: "You are a test persona.".to_string(),
            description: None,
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: Some(enabled),
            max_concurrent: None,
            timeout_ms: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            notification_channels: None,
            lifecycle: Some(lifecycle.to_string()),
            project_id: None,
        }
    }

    fn seed(pool: &DbPool, n: usize, enabled: bool, lifecycle: &str) {
        for i in 0..n {
            personas_repo::create(
                pool,
                persona(&format!("p{i}-{lifecycle}"), enabled, lifecycle),
            )
            .unwrap();
        }
    }

    #[test]
    fn an_empty_database_has_the_whole_default_cap_free() {
        let pool = init_test_db().unwrap();
        let h = active_persona_headroom(&pool).unwrap();
        assert_eq!(h.active, 0);
        assert_eq!(h.cap, settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT);
        assert_eq!(h.free(), settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT);
        assert!(!h.is_full());
        // Nothing to refuse.
        check_active_persona_headroom(&pool, true).unwrap();
    }

    #[test]
    fn only_enabled_and_lifecycle_active_rows_are_counted() {
        let pool = init_test_db().unwrap();
        seed(&pool, 3, true, "active");
        seed(&pool, 4, false, "active"); // switched off
        seed(&pool, 5, true, "draft"); // built, not promoted
        seed(&pool, 2, true, "archived");
        assert_eq!(active_persona_headroom(&pool).unwrap().active, 3);
    }

    #[test]
    fn at_cap_refuses_a_new_activation_and_names_both_numbers() {
        let pool = init_test_db().unwrap();
        seed(
            &pool,
            settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT,
            true,
            "active",
        );
        let h = active_persona_headroom(&pool).unwrap();
        assert!(h.is_full());
        assert_eq!(h.free(), 0);

        let err = check_active_persona_headroom(&pool, true).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("10 of 10 active personas"),
            "refusal must name active/cap, got: {msg}"
        );
        assert!(
            msg.contains("max_active_personas"),
            "refusal must name the setting, got: {msg}"
        );
        assert!(matches!(err, AppError::Validation(_)), "typed refusal");
    }

    #[test]
    fn a_call_that_does_not_raise_the_count_is_never_refused_at_cap() {
        let pool = init_test_db().unwrap();
        seed(
            &pool,
            settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT,
            true,
            "active",
        );
        let h = check_active_persona_headroom(&pool, false).unwrap();
        assert!(h.is_full(), "still full — the call just did not add to it");
    }

    #[test]
    fn re_enabling_an_already_enabled_persona_is_allowed_at_cap() {
        let pool = init_test_db().unwrap();
        let p = personas_repo::create(&pool, persona("incumbent", true, "active")).unwrap();
        seed(
            &pool,
            settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT - 1,
            true,
            "active",
        );
        assert!(active_persona_headroom(&pool).unwrap().is_full());
        check_enable_headroom(&pool, &p.id, true, None)
            .expect("an already-active persona keeps the count unchanged");
    }

    #[test]
    fn switching_a_persona_off_is_allowed_at_cap() {
        let pool = init_test_db().unwrap();
        let p = personas_repo::create(&pool, persona("incumbent", true, "active")).unwrap();
        seed(
            &pool,
            settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT - 1,
            true,
            "active",
        );
        check_enable_headroom(&pool, &p.id, false, None).expect("OFF never needs headroom");
    }

    #[test]
    fn a_disabled_persona_is_refused_at_cap_through_the_by_id_door() {
        let pool = init_test_db().unwrap();
        let off = personas_repo::create(&pool, persona("off", false, "active")).unwrap();
        seed(
            &pool,
            settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT,
            true,
            "active",
        );
        let err = check_enable_headroom(&pool, &off.id, true, None).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn enabling_a_draft_does_not_raise_the_count_but_promoting_it_does() {
        let pool = init_test_db().unwrap();
        let draft = personas_repo::create(&pool, persona("draft", false, "draft")).unwrap();
        seed(
            &pool,
            settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT,
            true,
            "active",
        );
        // Still a draft afterwards: not counted, so not refused.
        check_enable_headroom(&pool, &draft.id, true, None)
            .expect("a draft is outside the counted population");
        // Enabled AND promoted in the same write: that IS the transition.
        let err = check_enable_headroom(&pool, &draft.id, true, Some("active")).unwrap_err();
        assert!(err.to_string().contains("10 of 10 active personas"));
    }

    #[test]
    fn an_unknown_persona_id_is_not_refused_for_capacity() {
        let pool = init_test_db().unwrap();
        // The caller's own NotFound is the honest error, not a capacity refusal.
        check_enable_headroom(&pool, "no-such-persona", true, None).unwrap();
    }

    #[test]
    fn above_cap_after_a_manual_enable_reports_zero_free_and_still_refuses() {
        let pool = init_test_db().unwrap();
        // 10 seeded through the repo, then two more forced ON by a direct write
        // — the shape a cap lowered under a running app, or a pre-cap row,
        // leaves behind.
        seed(
            &pool,
            settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT,
            true,
            "active",
        );
        let a = personas_repo::create(&pool, persona("late-a", false, "active")).unwrap();
        let b = personas_repo::create(&pool, persona("late-b", false, "active")).unwrap();
        for id in [&a.id, &b.id] {
            let conn = pool.conn("test::force_enable").unwrap();
            conn.execute("UPDATE personas SET enabled = 1 WHERE id = ?1", [id])
                .unwrap();
        }
        let h = active_persona_headroom(&pool).unwrap();
        assert_eq!(h.active, 12);
        assert_eq!(h.free(), 0, "saturating, never an underflow panic");
        assert!(h.is_full());
        let err = check_active_persona_headroom(&pool, true).unwrap_err();
        assert!(err.to_string().contains("12 of 10 active personas"));
    }

    #[test]
    fn the_cap_is_read_from_settings_and_clamped_to_its_range() {
        let pool = init_test_db().unwrap();
        assert_eq!(
            active_persona_cap(&pool),
            settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT,
            "unset falls back to the default"
        );

        settings_repo::set(&pool, settings_keys::MAX_ACTIVE_PERSONAS, "3").unwrap();
        assert_eq!(active_persona_cap(&pool), 3);

        // The repo's own `set` refuses an out-of-range value — the first line of
        // defence, asserted here so a later loosening of it is noticed.
        for bad in ["0", "999", "ten", ""] {
            assert!(
                settings_repo::set(&pool, settings_keys::MAX_ACTIVE_PERSONAS, bad).is_err(),
                "settings::set must reject {bad:?}"
            );
        }

        // Defence in depth: a row that got past `set` anyway (written by an
        // older build, a restored backup, a hand-edited database) falls back to
        // the default rather than being obeyed.
        for bad in ["0", "999", "ten", "", "-1"] {
            let conn = pool.conn("test::force_setting").unwrap();
            conn.execute(
                "INSERT INTO app_settings (key, value, updated_at) \
                 VALUES (?1, ?2, datetime('now')) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![settings_keys::MAX_ACTIVE_PERSONAS, bad],
            )
            .unwrap();
            assert_eq!(
                active_persona_cap(&pool),
                settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT,
                "a stored {bad:?} must not become the cap"
            );
        }

        // The reader trims before parsing — the same leniency
        // `max_parallel_executions`' reader has (`engine/execution.rs`), and
        // deliberately WIDER than `settings::set`'s validator, which rejects
        // `" 5 "` outright. Asserted so the asymmetry is a decision on record
        // rather than something a future reader has to rediscover.
        let conn = pool.conn("test::force_setting").unwrap();
        conn.execute(
            "UPDATE app_settings SET value = ?2 WHERE key = ?1",
            rusqlite::params![settings_keys::MAX_ACTIVE_PERSONAS, " 5 "],
        )
        .unwrap();
        assert_eq!(active_persona_cap(&pool), 5);
    }

    #[test]
    fn a_lowered_cap_takes_effect_at_the_very_next_door() {
        let pool = init_test_db().unwrap();
        seed(&pool, 3, true, "active");
        check_active_persona_headroom(&pool, true).expect("3 of 10 — room");
        settings_repo::set(&pool, settings_keys::MAX_ACTIVE_PERSONAS, "3").unwrap();
        let err = check_active_persona_headroom(&pool, true).unwrap_err();
        assert!(err.to_string().contains("3 of 3 active personas"));
    }
}
