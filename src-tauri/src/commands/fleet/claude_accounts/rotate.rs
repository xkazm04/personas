//! Auto-rotate: switch to the coolest stored account before the live one
//! hits its 5-hour ceiling. Off by default; the policy is one setting.
//!
//! The decision is the same one the operator makes by hand from the strip —
//! "this plan is nearly spent, that one is fresh" — made on the subscription
//! tick instead of on a glance. A cooldown stops two near-threshold plans
//! from ping-ponging, and a candidate must be under the threshold on BOTH
//! windows: swapping onto a plan whose week is spent only moves the wall.

use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::repos::core::settings;
use crate::db::DbPool;
use crate::engine::subscription::ReactiveSubscription;

use super::{build_snapshot, switch_inner, ClaudeAccountView};

pub const SETTING_CONFIG: &str = "claude_accounts.auto_rotate";
pub const SETTING_LAST: &str = "claude_accounts.last_rotation";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAutoRotateConfig {
    pub enabled: bool,
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
            threshold_pct: 80.0,
            cooldown_secs: 300,
        }
    }
}

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

fn five_hour(view: &ClaudeAccountView) -> Option<f64> {
    view.usage
        .iter()
        .find(|w| w.key == "five_hour")
        .map(|w| w.utilization_pct)
}
fn seven_day(view: &ClaudeAccountView) -> Option<f64> {
    view.usage
        .iter()
        .find(|w| w.key == "seven_day")
        .map(|w| w.utilization_pct)
}

/// Pure policy: which account to rotate to, or none. Exposed for tests.
pub fn pick_target<'a>(
    cfg: &ClaudeAutoRotateConfig,
    accounts: &'a [ClaudeAccountView],
    last: Option<&ClaudeRotationEvent>,
    now_ms: i64,
) -> Option<(&'a ClaudeAccountView, &'a ClaudeAccountView)> {
    if !cfg.enabled {
        return None;
    }
    let active = accounts.iter().find(|a| a.is_active)?;
    let active_5h = five_hour(active)?;
    if active_5h < cfg.threshold_pct {
        return None;
    }
    if let Some(last) = last {
        if now_ms - last.at_ms < cfg.cooldown_secs * 1000 {
            return None;
        }
    }
    let target = accounts
        .iter()
        .filter(|a| !a.is_active && a.quarantine_reason.is_none())
        .filter(|a| five_hour(a).is_some_and(|p| p < cfg.threshold_pct))
        .filter(|a| !seven_day(a).is_some_and(|p| p >= cfg.threshold_pct))
        .min_by(|a, b| {
            five_hour(a)
                .unwrap_or(100.0)
                .partial_cmp(&five_hour(b).unwrap_or(100.0))
                .unwrap_or(std::cmp::Ordering::Equal)
        })?;
    Some((active, target))
}

/// One tick: read, decide, switch, record. Errors are logged, never raised —
/// the subscription loop must outlive a bad network minute.
pub async fn maybe_rotate(pool: &DbPool) -> Option<ClaudeRotationEvent> {
    let cfg = read_config(pool);
    if !cfg.enabled {
        return None;
    }
    let snapshot = match build_snapshot(pool).await {
        Ok(s) => s,
        Err(e) => {
            tracing::debug!(error = %e, "auto-rotate: snapshot failed");
            return None;
        }
    };
    let now = super::super::claude_usage::now_ms();
    let last = read_last(pool);
    let (from, to) = pick_target(&cfg, &snapshot.accounts, last.as_ref(), now)?;
    let reason = format!("five_hour:{}", five_hour(from).unwrap_or(0.0).round());
    let event = ClaudeRotationEvent {
        at_ms: now,
        from_email: from.email.clone(),
        to_email: to.email.clone(),
        reason,
    };
    let to_id = to.id.clone();
    match switch_inner(pool, &to_id).await {
        Ok(()) => {
            tracing::info!(from = %event.from_email, to = %event.to_email, reason = %event.reason, "auto-rotated Claude login");
            if let Ok(json) = serde_json::to_string(&event) {
                let _ = settings::set(pool, SETTING_LAST, &json);
            }
            Some(event)
        }
        Err(e) => {
            tracing::warn!(error = %e, to = %event.to_email, "auto-rotate: switch failed");
            None
        }
    }
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
            last_switched_at_ms: None,
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
        assert_eq!(d.threshold_pct, 80.0);
        let json = serde_json::to_string(&d).unwrap();
        assert_eq!(
            serde_json::from_str::<ClaudeAutoRotateConfig>(&json).unwrap(),
            d
        );
    }
}
