//! Auto-rotate: switch to the coolest stored account before the live one
//! hits a ceiling. Off by default; the policy is one setting.
//!
//! The decision is the same one the operator makes by hand from the strip —
//! "this plan is nearly spent, that one is fresh" — made on the subscription
//! tick instead of on a glance. A cooldown stops two near-threshold plans
//! from ping-ponging, and a candidate must be under the threshold on BOTH
//! windows: swapping onto a plan whose week is spent only moves the wall.
//!
//! # The rule
//!
//! * **Trigger — either window.** Rotate when the ACTIVE account's
//!   utilisation is `>= threshold_pct` on `five_hour` OR on `seven_day`
//!   (boundary inclusive: exactly 95.0 rotates, 94.99 does not). A window the
//!   endpoint did not report counts as 0, so absent data never rotates.
//! * **Eligible target.** Not active, not quarantined, with a `five_hour`
//!   reading, and STRICTLY below the threshold on both windows (an unreported
//!   `seven_day` counts as 0).
//! * **Choice.** Lowest `max(five_hour, seven_day)`; ties go to the lowest
//!   `five_hour`, then to the lowest slot.
//! * **Default threshold 95.** Applies to a new install only; a stored config
//!   (any value, including the old default 80) is read back untouched.
//!
//! The quota governor composes through [`try_rotate_now`]: when it is about to
//! stop dispatch it asks here first, so the loop only stops when no stored
//! plan can take over.

use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::repos::core::settings;
use crate::db::DbPool;
use crate::engine::subscription::ReactiveSubscription;

use super::{build_snapshot, switch_inner, ClaudeAccountView};

pub const SETTING_CONFIG: &str = crate::db::settings_keys::CLAUDE_ACCOUNTS_AUTO_ROTATE;
pub const SETTING_LAST: &str = crate::db::settings_keys::CLAUDE_ACCOUNTS_LAST_ROTATION;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAutoRotateConfig {
    pub enabled: bool,
    // Rotate once the ACTIVE account's 5-hour OR 7-day utilisation reaches
    // this. (Plain comment on purpose: a `///` here would change the exported
    // ts-rs binding, and the wire contract is frozen.)
    /// Rotate once the ACTIVE account's 5-hour utilisation reaches this.
    pub threshold_pct: f64,
    /// Minimum seconds between two automatic switches.
    #[ts(type = "number")]
    pub cooldown_secs: i64,
}

impl Default for ClaudeAutoRotateConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            threshold_pct: DEFAULT_THRESHOLD_PCT,
            cooldown_secs: 300,
        }
    }
}

/// New-install threshold. Stored configs are never rewritten to it.
pub const DEFAULT_THRESHOLD_PCT: f64 = 95.0;

/// What the last automatic switch did, for the strip's "rotated 3m ago".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRotationEvent {
    #[ts(type = "number")]
    pub at_ms: i64,
    pub from_email: String,
    pub to_email: String,
    /// `five_hour:84` — the reading that triggered it.
    pub reason: String,
}

pub fn read_config(pool: &DbPool) -> ClaudeAutoRotateConfig {
    settings::get(pool, SETTING_CONFIG)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write_config(
    pool: &DbPool,
    cfg: &ClaudeAutoRotateConfig,
) -> Result<(), crate::error::AppError> {
    settings::set(pool, SETTING_CONFIG, &serde_json::to_string(cfg)?)
}

pub fn read_last(pool: &DbPool) -> Option<ClaudeRotationEvent> {
    settings::get(pool, SETTING_LAST)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn window(view: &ClaudeAccountView, key: &str) -> Option<f64> {
    view.usage
        .iter()
        .find(|w| w.key == key)
        .map(|w| w.utilization_pct)
}
fn five_hour(view: &ClaudeAccountView) -> Option<f64> {
    window(view, "five_hour")
}
fn seven_day(view: &ClaudeAccountView) -> Option<f64> {
    window(view, "seven_day")
}

/// Why a rotation pass did nothing. Stable machine names for logs and tests;
/// not on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RotateSkip {
    Disabled,
    NoActiveAccount,
    BelowThreshold,
    Cooldown,
    NoEligibleTarget,
}

/// What [`try_rotate_now`] did.
#[derive(Debug, Clone, PartialEq)]
pub enum RotateOutcome {
    Rotated(ClaudeRotationEvent),
    Skipped(RotateSkip),
    /// A target was chosen but the switch failed (already logged).
    Failed,
}

/// The window of the active account closest to the ceiling, as
/// `(key, pct)`; absent windows count as 0.
fn worst_window(view: &ClaudeAccountView) -> (&'static str, f64) {
    let five = five_hour(view).unwrap_or(0.0);
    let seven = seven_day(view).unwrap_or(0.0);
    if seven > five {
        ("seven_day", seven)
    } else {
        ("five_hour", five)
    }
}

/// Core policy. `require_trigger = false` is the governor's call: it has
/// already decided the live login is spent, so the active account need not
/// itself be at the rotate threshold; eligibility and cooldown still apply.
fn plan<'a>(
    cfg: &ClaudeAutoRotateConfig,
    accounts: &'a [ClaudeAccountView],
    last: Option<&ClaudeRotationEvent>,
    now_ms: i64,
    require_trigger: bool,
) -> Result<(&'a ClaudeAccountView, &'a ClaudeAccountView), RotateSkip> {
    if !cfg.enabled {
        return Err(RotateSkip::Disabled);
    }
    let active = accounts
        .iter()
        .find(|a| a.is_active)
        .ok_or(RotateSkip::NoActiveAccount)?;
    if require_trigger && worst_window(active).1 < cfg.threshold_pct {
        return Err(RotateSkip::BelowThreshold);
    }
    if let Some(last) = last {
        if now_ms - last.at_ms < cfg.cooldown_secs * 1000 {
            return Err(RotateSkip::Cooldown);
        }
    }
    let load = |a: &ClaudeAccountView| {
        let five = five_hour(a).unwrap_or(0.0);
        (five.max(seven_day(a).unwrap_or(0.0)), five)
    };
    accounts
        .iter()
        .filter(|a| !a.is_active && a.quarantine_reason.is_none())
        // A standby with no five-hour reading is unknown, not cool.
        .filter(|a| five_hour(a).is_some_and(|p| p < cfg.threshold_pct))
        .filter(|a| seven_day(a).unwrap_or(0.0) < cfg.threshold_pct)
        .min_by(|a, b| {
            let (la, lb) = (load(a), load(b));
            la.0.total_cmp(&lb.0)
                .then(la.1.total_cmp(&lb.1))
                .then(a.slot.cmp(&b.slot))
        })
        .map(|target| (active, target))
        .ok_or(RotateSkip::NoEligibleTarget)
}

/// Pure policy: which account to rotate to, or none. Test-facing wrapper of
/// [`plan`] with the trigger required (the production paths call `plan`).
#[cfg(test)]
pub fn pick_target<'a>(
    cfg: &ClaudeAutoRotateConfig,
    accounts: &'a [ClaudeAccountView],
    last: Option<&ClaudeRotationEvent>,
    now_ms: i64,
) -> Option<(&'a ClaudeAccountView, &'a ClaudeAccountView)> {
    plan(cfg, accounts, last, now_ms, true).ok()
}

async fn rotate_once(pool: &DbPool, require_trigger: bool) -> RotateOutcome {
    let cfg = read_config(pool);
    if !cfg.enabled {
        return RotateOutcome::Skipped(RotateSkip::Disabled);
    }
    let snapshot = match build_snapshot(pool).await {
        Ok(s) => s,
        Err(e) => {
            tracing::debug!(error = %e, "auto-rotate: snapshot failed");
            return RotateOutcome::Failed;
        }
    };
    let now = super::super::claude_usage::now_ms();
    let last = read_last(pool);
    let (from, to) = match plan(
        &cfg,
        &snapshot.accounts,
        last.as_ref(),
        now,
        require_trigger,
    ) {
        Ok(p) => p,
        Err(skip) => return RotateOutcome::Skipped(skip),
    };
    let (key, pct) = worst_window(from);
    let event = ClaudeRotationEvent {
        at_ms: now,
        from_email: from.email.clone(),
        to_email: to.email.clone(),
        reason: format!("{key}:{}", pct.round()),
    };
    let to_id = to.id.clone();
    match switch_inner(pool, &to_id).await {
        Ok(()) => {
            tracing::info!(from = %event.from_email, to = %event.to_email, reason = %event.reason, "auto-rotated Claude login");
            if let Ok(json) = serde_json::to_string(&event) {
                let _ = settings::set(pool, SETTING_LAST, &json);
            }
            RotateOutcome::Rotated(event)
        }
        Err(e) => {
            tracing::warn!(error = %e, to = %event.to_email, "auto-rotate: switch failed");
            RotateOutcome::Failed
        }
    }
}

/// One tick: read, decide, switch, record. Errors are logged, never raised —
/// the subscription loop must outlive a bad network minute.
pub async fn maybe_rotate(pool: &DbPool) -> Option<ClaudeRotationEvent> {
    match rotate_once(pool, true).await {
        RotateOutcome::Rotated(e) => Some(e),
        _ => None,
    }
}

/// The governor's entry: switch to an eligible standby NOW because the live
/// login crossed the dispatch stop, without requiring the active account to
/// be at the rotate threshold. Honours `enabled`, the cooldown and the same
/// eligibility as the tick; its usage reads go through the 45 s cache.
pub async fn try_rotate_now(pool: &DbPool) -> RotateOutcome {
    rotate_once(pool, false).await
}

/// The background tick. Per-instance (it is this machine's CLI login), so it
/// does not wait for engine leadership.
pub struct ClaudeAccountRotateSubscription {
    pub pool: DbPool,
}

#[async_trait]
impl ReactiveSubscription for ClaudeAccountRotateSubscription {
    fn name(&self) -> &'static str {
        "claude_account_rotate"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(60)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(300)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(30)
    }
    fn requires_leadership(&self) -> bool {
        false
    }
    async fn tick(&self) {
        // Cheap gate first: a disabled policy must cost no HTTP.
        if !read_config(&self.pool).enabled {
            return;
        }
        let _ = maybe_rotate(&self.pool).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fleet::claude_usage::ClaudeUsageWindow;

    fn view(id: &str, active: bool, five: f64, seven: f64, quarantined: bool) -> ClaudeAccountView {
        let w = |key: &str, pct: f64| ClaudeUsageWindow {
            key: key.into(),
            utilization_pct: pct,
            resets_at_ms: None,
            window_ms: 1,
        };
        ClaudeAccountView {
            id: id.into(),
            email: format!("{id}@x"),
            display_name: None,
            organization_name: None,
            rate_limit_tier: None,
            slot: 1,
            is_active: active,
            quarantine_reason: quarantined.then(|| "invalid_grant".to_string()),
            token_expires_at_ms: None,
            usage: vec![w("five_hour", five), w("seven_day", seven)],
            usage_reason: None,
            usage_fetched_at_ms: None,
            usage_projected_from_ms: None,
            last_switched_at_ms: None,
            login: None,
            relogin: None,
        }
    }

    #[test]
    fn rotates_to_the_coolest_eligible_account_once_over_threshold() {
        let cfg = ClaudeAutoRotateConfig {
            enabled: true,
            threshold_pct: 80.0,
            cooldown_secs: 300,
        };
        let accts = vec![
            view("a", true, 85.0, 10.0, false),
            view("b", false, 40.0, 20.0, false),
            view("c", false, 10.0, 95.0, false), // week spent — ineligible
            view("d", false, 5.0, 5.0, true),    // quarantined — ineligible
            view("e", false, 20.0, 30.0, false),
        ];
        let (from, to) = pick_target(&cfg, &accts, None, 1_000_000).expect("rotates");
        assert_eq!(from.id, "a");
        assert_eq!(to.id, "e");
    }

    #[test]
    fn holds_below_threshold_within_cooldown_or_when_disabled() {
        let cfg = ClaudeAutoRotateConfig {
            enabled: true,
            threshold_pct: 80.0,
            cooldown_secs: 300,
        };
        let accts = vec![
            view("a", true, 79.9, 0.0, false),
            view("b", false, 0.0, 0.0, false),
        ];
        assert!(
            pick_target(&cfg, &accts, None, 0).is_none(),
            "under threshold"
        );

        let hot = vec![
            view("a", true, 90.0, 0.0, false),
            view("b", false, 0.0, 0.0, false),
        ];
        let recent = ClaudeRotationEvent {
            at_ms: 1_000_000,
            from_email: "".into(),
            to_email: "".into(),
            reason: "".into(),
        };
        assert!(
            pick_target(&cfg, &hot, Some(&recent), 1_000_000 + 299_000).is_none(),
            "cooldown"
        );
        assert!(
            pick_target(&cfg, &hot, Some(&recent), 1_000_000 + 300_000).is_some(),
            "cooldown over"
        );

        let off = ClaudeAutoRotateConfig {
            enabled: false,
            ..cfg.clone()
        };
        assert!(pick_target(&off, &hot, None, 0).is_none(), "disabled");

        let nowhere = vec![
            view("a", true, 90.0, 0.0, false),
            view("b", false, 85.0, 0.0, false),
        ];
        assert!(
            pick_target(&cfg, &nowhere, None, 0).is_none(),
            "no cool candidate"
        );
    }

    #[test]
    fn config_round_trips_with_defaults() {
        let d = ClaudeAutoRotateConfig::default();
        assert!(!d.enabled);
        assert_eq!(d.threshold_pct, 95.0);
        let json = serde_json::to_string(&d).unwrap();
        assert_eq!(
            serde_json::from_str::<ClaudeAutoRotateConfig>(&json).unwrap(),
            d
        );
    }

    fn cfg95() -> ClaudeAutoRotateConfig {
        ClaudeAutoRotateConfig {
            enabled: true,
            threshold_pct: 95.0,
            cooldown_secs: 300,
        }
    }

    fn slotted(mut v: ClaudeAccountView, slot: i64) -> ClaudeAccountView {
        v.slot = slot;
        v
    }

    fn target_id(accts: &[ClaudeAccountView]) -> Option<String> {
        pick_target(&cfg95(), accts, None, 0).map(|(_, t)| t.id.clone())
    }

    #[test]
    fn five_hour_alone_over_threshold_rotates() {
        let accts = vec![
            view("a", true, 96.0, 10.0, false),
            view("b", false, 20.0, 20.0, false),
        ];
        assert_eq!(target_id(&accts).as_deref(), Some("b"));
    }

    #[test]
    fn seven_day_alone_over_threshold_rotates() {
        let accts = vec![
            view("a", true, 10.0, 96.0, false),
            view("b", false, 20.0, 20.0, false),
        ];
        assert_eq!(target_id(&accts).as_deref(), Some("b"));
    }

    #[test]
    fn both_windows_over_threshold_rotates() {
        let accts = vec![
            view("a", true, 99.0, 98.0, false),
            view("b", false, 20.0, 20.0, false),
        ];
        assert_eq!(target_id(&accts).as_deref(), Some("b"));
    }

    #[test]
    fn threshold_boundary_is_inclusive_and_94_99_holds() {
        let at = vec![
            view("a", true, 95.0, 0.0, false),
            view("b", false, 1.0, 1.0, false),
        ];
        assert!(target_id(&at).is_some(), "exactly 95.0 rotates");
        let at7 = vec![
            view("a", true, 0.0, 95.0, false),
            view("b", false, 1.0, 1.0, false),
        ];
        assert!(target_id(&at7).is_some(), "exactly 95.0 on 7d rotates");
        let under = vec![
            view("a", true, 94.99, 94.99, false),
            view("b", false, 1.0, 1.0, false),
        ];
        assert!(target_id(&under).is_none(), "94.99 does not");
    }

    #[test]
    fn a_standby_exactly_at_threshold_is_not_eligible() {
        let accts = vec![
            view("a", true, 99.0, 0.0, false),
            view("b", false, 95.0, 0.0, false),
            view("c", false, 0.0, 95.0, false),
        ];
        assert!(target_id(&accts).is_none(), "strictly below on both");
    }

    #[test]
    fn a_missing_active_window_counts_as_zero_and_never_rotates() {
        let mut a = view("a", true, 0.0, 0.0, false);
        a.usage.clear();
        let accts = vec![a, view("b", false, 1.0, 1.0, false)];
        assert!(target_id(&accts).is_none());
    }

    #[test]
    fn all_standbys_exhausted_does_nothing() {
        let accts = vec![
            view("a", true, 97.0, 10.0, false),
            view("b", false, 96.0, 10.0, false),
            view("c", false, 10.0, 99.0, false),
        ];
        assert!(target_id(&accts).is_none());
        assert_eq!(
            plan(&cfg95(), &accts, None, 0, true).err(),
            Some(RotateSkip::NoEligibleTarget)
        );
    }

    #[test]
    fn only_quarantined_standbys_does_nothing() {
        let accts = vec![
            view("a", true, 97.0, 10.0, false),
            view("b", false, 1.0, 1.0, true),
        ];
        assert!(target_id(&accts).is_none());
    }

    #[test]
    fn lowest_of_the_two_windows_max_wins() {
        let accts = vec![
            view("a", true, 97.0, 0.0, false),
            view("b", false, 10.0, 60.0, false), // max 60
            view("c", false, 50.0, 40.0, false), // max 50
        ];
        assert_eq!(target_id(&accts).as_deref(), Some("c"));
    }

    #[test]
    fn ties_break_on_five_hour_then_slot() {
        let accts = vec![
            view("a", true, 97.0, 0.0, false),
            view("b", false, 40.0, 30.0, false), // max 40, 5h 40
            view("c", false, 30.0, 40.0, false), // max 40, 5h 30
        ];
        assert_eq!(target_id(&accts).as_deref(), Some("c"), "lower 5h");
        let accts = vec![
            view("a", true, 97.0, 0.0, false),
            slotted(view("b", false, 30.0, 40.0, false), 3),
            slotted(view("c", false, 30.0, 40.0, false), 2),
        ];
        assert_eq!(target_id(&accts).as_deref(), Some("c"), "lower slot");
    }

    #[test]
    fn the_governor_path_does_not_need_the_active_to_be_at_threshold() {
        let accts = vec![
            view("a", true, 50.0, 50.0, false),
            view("b", false, 1.0, 1.0, false),
        ];
        assert!(plan(&cfg95(), &accts, None, 0, true).is_err());
        assert!(plan(&cfg95(), &accts, None, 0, false).is_ok());
        let off = ClaudeAutoRotateConfig {
            enabled: false,
            ..cfg95()
        };
        assert_eq!(
            plan(&off, &accts, None, 0, false).err(),
            Some(RotateSkip::Disabled)
        );
    }

    #[test]
    fn reason_names_the_window_that_tripped() {
        let a = view("a", true, 10.0, 96.0, false);
        assert_eq!(worst_window(&a), ("seven_day", 96.0));
        let a = view("a", true, 96.0, 10.0, false);
        assert_eq!(worst_window(&a), ("five_hour", 96.0));
    }

    #[test]
    fn a_stored_80_config_is_preserved_byte_for_byte() {
        let pool = personas_db::init_test_db().expect("test db");
        // A fresh install reads the new default.
        assert_eq!(read_config(&pool).threshold_pct, 95.0);
        let stored = ClaudeAutoRotateConfig {
            enabled: true,
            threshold_pct: 80.0,
            cooldown_secs: 300,
        };
        write_config(&pool, &stored).expect("write");
        let raw_before = settings::get(&pool, SETTING_CONFIG).unwrap().unwrap();
        let back = read_config(&pool);
        assert_eq!(back, stored);
        assert_eq!(back.threshold_pct, 80.0);
        let raw_after = settings::get(&pool, SETTING_CONFIG).unwrap().unwrap();
        assert_eq!(raw_before, raw_after, "reading never rewrites it");
        assert!(!ClaudeAutoRotateConfig::default().enabled, "opt-in stays");
    }
}
