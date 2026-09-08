//! The app-wide active-persona cap — a RESOURCE guard on how many personas may
//! be RUNNING at once, enforced where work starts.
//!
//! ## What this cap means, and what it stopped meaning on 2026-09-08
//!
//! Until 2026-09-08 `max_active_personas` gated *enabling*: every door that
//! turned a persona on (`check_enable_headroom`, since deleted) refused when
//! the enabled population was already at the ceiling. That made it an
//! **organisation-size limit**, and the Grand Simulation ran straight into the
//! consequence: this machine already held six personas for the operator's own
//! projects, so a workspace that legitimately needed six App Masters could not
//! have them. The simulation stalled on an arithmetic accident rather than on a
//! resource.
//!
//! The operator's ruling: *"Cap should always limit active only to spare
//! resources. Organization itself does not need to be limited, you are right to
//! apply guards for the max parallel executions."*
//!
//! So an organisation may hold **any number of personas**. Enabling, adopting
//! and hiring are never refused by this cap. What the cap bounds is
//! concurrency:
//!
//! | Guard | Bounds |
//! |---|---|
//! | `max_active_personas` (here) | how many DISTINCT personas may hold work at the same moment |
//! | `max_parallel_executions` | how many executions may run at the same moment, across everybody |
//! | fleet `live_slots` | an in-memory soft eviction of idle sessions |
//!
//! The two are different questions and both are kept: ten personas each running
//! one execution and one persona running ten are the same load for the
//! execution tracker and very different loads for the machine (ten CLI
//! processes, ten working trees, ten model conversations).
//!
//! ## Where it is enforced
//!
//! ONE place: the attention loop's admission ladder
//! (`app_lib`'s `engine::subscription::attention::admit_persona`), as a
//! **deferral**, not a failure. A persona that arrives at a full machine is
//! refused for this tick with a `concurrency_cap` refusal
//! (`personas_core::cycle::AttentionRefusal::ConcurrencyCap`) in its ledger row,
//! and is served on a later tick. Nothing is lost and nothing errors.
//!
//! A persona that is ALREADY running does not need a slot it is standing in, so
//! [`dispatch_refusal`] admits it. That keeps the guard a ceiling on the
//! population of busy personas rather than a ceiling on wakes.

use personas_core::error::AppError;
use personas_db::repos::core::settings as settings_repo;
use personas_db::repos::execution::executions as executions_repo;
use personas_db::settings_keys;
use personas_db::DbPool;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How many personas are running right now, and the ceiling they are measured
/// against.
///
/// Reported by `GET /dev-tools/app-master/{project}` and rendered into the App
/// Master's decision prompt, so an autonomous loop planning a workforce can see
/// how much of the machine is already busy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ActivePersonaHeadroom {
    /// Personas holding at least one queued or running execution right now.
    ///
    /// Renamed from `active` on 2026-09-08 with the meaning: the old field
    /// counted `enabled = 1 AND lifecycle = 'active'` ROWS, which is roster
    /// size. A reader that still says "active personas" is describing the
    /// roster and is wrong about this number.
    pub running: usize,
    /// The configured ceiling — `max_active_personas`, or its default.
    pub cap: usize,
}

impl ActivePersonaHeadroom {
    /// Slots left before the next persona would be deferred. Saturating: a
    /// count already above the cap (the cap was lowered under a running app)
    /// reports `0` rather than underflowing.
    pub fn free(&self) -> usize {
        self.cap.saturating_sub(self.running)
    }

    /// True when one MORE persona cannot start work.
    pub fn is_full(&self) -> bool {
        self.running >= self.cap
    }
}

/// The configured cap, clamped to its documented range.
///
/// Read fresh on every call rather than cached at construction — unlike
/// `max_parallel_executions`, which the engine seeds once into the
/// `ConcurrencyTracker`. There is no live object to hot-apply into here, so a
/// change to the setting takes effect at the very next tick with no restart and
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

/// The live concurrency and the cap, together.
///
/// A DB error propagates rather than being swallowed into an optimistic
/// "there's room": a guard that fails open under load is not a guard.
pub fn active_persona_headroom(pool: &DbPool) -> Result<ActivePersonaHeadroom, AppError> {
    Ok(ActivePersonaHeadroom {
        running: executions_repo::count_personas_running(pool)?,
        cap: active_persona_cap(pool),
    })
}

/// The one sentence every reader shares, so an operator meets one wording
/// rather than five paraphrases of it.
pub fn at_cap_message(h: &ActivePersonaHeadroom) -> String {
    format!(
        "{} of {} personas are already running; this one waits for a free slot \
         (raise max_active_personas to run more at once)",
        h.running, h.cap
    )
}

/// Should this persona be held back from STARTING work right now?
///
/// * `Ok(None)` — go ahead. Either the machine has a free slot, or this persona
///   is already running and is therefore already counted: it cannot consume a
///   slot it is standing in, and refusing it would turn the guard into a
///   ceiling on wakes rather than on busy personas.
/// * `Ok(Some(headroom))` — the machine is full. The caller **defers** with
///   these numbers; it never fails the persona. A read error propagates.
pub fn dispatch_refusal(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<ActivePersonaHeadroom>, AppError> {
    let headroom = active_persona_headroom(pool)?;
    if !headroom.is_full() {
        return Ok(None);
    }
    if executions_repo::get_running_count_for_persona(pool, persona_id)? > 0 {
        return Ok(None);
    }
    Ok(Some(headroom))
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::init_test_db;
    use personas_db::models::CreatePersonaInput;
    use personas_db::repos::core::personas as personas_repo;
    use personas_db::PoolExt;

    fn persona(name: &str) -> CreatePersonaInput {
        CreatePersonaInput {
            name: name.to_string(),
            system_prompt: "You are a test persona.".to_string(),
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
            lifecycle: Some("active".to_string()),
            project_id: None,
        }
    }

    /// `n` personas, each holding ONE live execution. Returns their ids.
    fn seed_running(pool: &DbPool, n: usize) -> Vec<String> {
        let mut ids = Vec::new();
        for i in 0..n {
            let p = personas_repo::create(pool, persona(&format!("runner-{i}"))).unwrap();
            executions_repo::create(pool, &p.id, None, None, None, None).unwrap();
            ids.push(p.id);
        }
        ids
    }

    #[test]
    fn an_empty_database_has_the_whole_default_cap_free() {
        let pool = init_test_db().unwrap();
        let h = active_persona_headroom(&pool).unwrap();
        assert_eq!(h.running, 0);
        assert_eq!(h.cap, settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT);
        assert_eq!(h.free(), settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT);
        assert!(!h.is_full());
    }

    #[test]
    fn the_headroom_counts_running_executions_not_enabled_rows() {
        let pool = init_test_db().unwrap();
        // A roster of twenty enabled, active personas — the shape the OLD cap
        // refused outright. Not one of them is running.
        for i in 0..20 {
            personas_repo::create(&pool, persona(&format!("idle-{i}"))).unwrap();
        }
        let h = active_persona_headroom(&pool).unwrap();
        assert_eq!(
            h.running, 0,
            "twenty enabled personas doing nothing occupy no slot"
        );
        assert!(!h.is_full(), "roster size is not a resource");
    }

    #[test]
    fn one_persona_running_three_executions_occupies_one_slot() {
        let pool = init_test_db().unwrap();
        let p = personas_repo::create(&pool, persona("busy")).unwrap();
        for _ in 0..3 {
            executions_repo::create(&pool, &p.id, None, None, None, None).unwrap();
        }
        assert_eq!(
            active_persona_headroom(&pool).unwrap().running,
            1,
            "the cap counts personas; max_parallel_executions counts executions"
        );
    }

    #[test]
    fn a_full_machine_defers_a_new_persona_and_names_both_numbers() {
        let pool = init_test_db().unwrap();
        seed_running(&pool, settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT);
        let waiting = personas_repo::create(&pool, persona("waiting")).unwrap();

        let refused = dispatch_refusal(&pool, &waiting.id)
            .unwrap()
            .expect("the machine is full");
        assert!(refused.is_full());
        assert_eq!(refused.free(), 0);
        let msg = at_cap_message(&refused);
        assert!(
            msg.contains("10 of 10 personas are already running"),
            "the refusal must name running/cap, got: {msg}"
        );
        assert!(
            msg.contains("max_active_personas"),
            "the refusal must name the setting, got: {msg}"
        );
    }

    #[test]
    fn a_persona_already_running_is_not_deferred_by_the_cap_it_is_inside() {
        let pool = init_test_db().unwrap();
        let ids = seed_running(&pool, settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT);
        assert!(active_persona_headroom(&pool).unwrap().is_full());
        assert_eq!(
            dispatch_refusal(&pool, &ids[0]).unwrap(),
            None,
            "it cannot consume a slot it is standing in"
        );
    }

    #[test]
    fn a_finished_execution_gives_its_slot_back() {
        let pool = init_test_db().unwrap();
        let ids = seed_running(&pool, settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT);
        let waiting = personas_repo::create(&pool, persona("waiting")).unwrap();
        assert!(dispatch_refusal(&pool, &waiting.id).unwrap().is_some());

        let conn = pool.conn("test::finish").unwrap();
        conn.execute(
            "UPDATE persona_executions SET status = 'completed' WHERE persona_id = ?1",
            [&ids[0]],
        )
        .unwrap();
        drop(conn);

        assert_eq!(active_persona_headroom(&pool).unwrap().running, 9);
        assert_eq!(
            dispatch_refusal(&pool, &waiting.id).unwrap(),
            None,
            "the freed slot is the next persona's"
        );
    }

    #[test]
    fn above_cap_reports_zero_free_and_still_defers() {
        let pool = init_test_db().unwrap();
        // Twelve running against a cap of ten — the shape a cap lowered under a
        // running app leaves behind.
        seed_running(&pool, settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT + 2);
        let waiting = personas_repo::create(&pool, persona("waiting")).unwrap();
        let h = active_persona_headroom(&pool).unwrap();
        assert_eq!(h.running, 12);
        assert_eq!(h.free(), 0, "saturating, never an underflow panic");
        assert!(dispatch_refusal(&pool, &waiting.id).unwrap().is_some());
        assert!(at_cap_message(&h).contains("12 of 10 personas"));
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
    fn a_lowered_cap_takes_effect_at_the_very_next_tick() {
        let pool = init_test_db().unwrap();
        seed_running(&pool, 3);
        let waiting = personas_repo::create(&pool, persona("waiting")).unwrap();
        assert_eq!(
            dispatch_refusal(&pool, &waiting.id).unwrap(),
            None,
            "3 of 10 — room"
        );
        settings_repo::set(&pool, settings_keys::MAX_ACTIVE_PERSONAS, "3").unwrap();
        let refused = dispatch_refusal(&pool, &waiting.id).unwrap().unwrap();
        assert!(at_cap_message(&refused).contains("3 of 3 personas"));
    }
}
