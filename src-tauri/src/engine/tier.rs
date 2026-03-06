use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Per-tier rate and queue limits.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TierConfig {
    /// Display name: "free", "pro", "enterprise"
    pub tier_name: String,
    /// Max events per source per minute.
    pub event_source_max: usize,
    /// Max webhook calls per trigger per minute.
    pub webhook_trigger_max: usize,
    /// Max queue depth per persona.
    pub max_queue_depth: usize,
}

impl TierConfig {
    pub fn free() -> Self {
        Self {
            tier_name: "free".into(),
            event_source_max: 30,
            webhook_trigger_max: 5,
            max_queue_depth: 5,
        }
    }

    pub fn pro() -> Self {
        Self {
            tier_name: "pro".into(),
            event_source_max: 120,
            webhook_trigger_max: 20,
            max_queue_depth: 25,
        }
    }

    pub fn enterprise() -> Self {
        Self {
            tier_name: "enterprise".into(),
            event_source_max: usize::MAX,
            webhook_trigger_max: usize::MAX,
            max_queue_depth: usize::MAX,
        }
    }

    /// Resolve tier from the subscription plan string.
    /// Falls back to free tier for unknown/empty plans.
    pub fn from_plan(plan: &str) -> Self {
        match plan.to_lowercase().as_str() {
            "pro" | "professional" => Self::pro(),
            "enterprise" | "business" => Self::enterprise(),
            _ => Self::free(),
        }
    }
}

impl Default for TierConfig {
    fn default() -> Self {
        Self::free()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_free_tier_defaults() {
        let tier = TierConfig::free();
        assert_eq!(tier.event_source_max, 30);
        assert_eq!(tier.webhook_trigger_max, 5);
        assert_eq!(tier.max_queue_depth, 5);
    }

    #[test]
    fn test_pro_tier() {
        let tier = TierConfig::pro();
        assert_eq!(tier.event_source_max, 120);
        assert_eq!(tier.webhook_trigger_max, 20);
        assert_eq!(tier.max_queue_depth, 25);
    }

    #[test]
    fn test_enterprise_tier() {
        let tier = TierConfig::enterprise();
        assert_eq!(tier.event_source_max, usize::MAX);
    }

    #[test]
    fn test_from_plan() {
        assert_eq!(TierConfig::from_plan("pro").tier_name, "pro");
        assert_eq!(TierConfig::from_plan("Professional").tier_name, "pro");
        assert_eq!(TierConfig::from_plan("enterprise").tier_name, "enterprise");
        assert_eq!(TierConfig::from_plan("Business").tier_name, "enterprise");
        assert_eq!(TierConfig::from_plan("unknown").tier_name, "free");
        assert_eq!(TierConfig::from_plan("").tier_name, "free");
    }

    #[test]
    fn test_default_is_free() {
        let tier = TierConfig::default();
        assert_eq!(tier.tier_name, "free");
    }
}
