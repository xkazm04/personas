use crate::db::models::DevIdea;

/// Evaluate triage rule conditions against a single idea.
///
/// Conditions are JSON:
/// `[{"field":"effort|impact|risk|category|scan_type","op":"lt|gt|eq|in","value":...}]`.
/// All conditions must match. Invalid JSON is a non-match so one bad rule does
/// not block the rest of the triage run.
pub(super) fn evaluate_conditions(conditions_json: &str, idea: &DevIdea) -> bool {
    let conditions: Vec<serde_json::Value> = match serde_json::from_str(conditions_json) {
        Ok(c) => c,
        Err(_) => return false,
    };

    conditions.iter().all(|cond| {
        let field = cond.get("field").and_then(|f| f.as_str()).unwrap_or("");
        let op = cond.get("op").and_then(|o| o.as_str()).unwrap_or("");
        let value = cond.get("value");

        match field {
            "effort" => compare_numeric(idea.effort.unwrap_or(0), op, value),
            "impact" => compare_numeric(idea.impact.unwrap_or(0), op, value),
            "risk" => compare_numeric(idea.risk.unwrap_or(0), op, value),
            "category" => compare_string(Some(&idea.category), op, value),
            "scan_type" => compare_string(Some(&idea.scan_type), op, value),
            // The findings spine: rules can now target WHICH SENSOR raised an idea
            // ("auto-accept passport_gap", "auto-reject llm_cost under $5"). A
            // classic scanner idea has no origin, so such a rule never matches it.
            "origin" => compare_string(idea.origin.as_deref(), op, value),
            _ => false,
        }
    })
}

fn compare_numeric(field_value: i32, op: &str, value: Option<&serde_json::Value>) -> bool {
    let target = value.and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    match op {
        "lt" => field_value < target,
        "gt" => field_value > target,
        "eq" => field_value == target,
        "lte" => field_value <= target,
        "gte" => field_value >= target,
        _ => false,
    }
}

fn compare_string(field_value: Option<&str>, op: &str, value: Option<&serde_json::Value>) -> bool {
    let field_str = field_value.unwrap_or("");
    match op {
        "eq" => value
            .and_then(|v| v.as_str())
            .map(|s| s == field_str)
            .unwrap_or(false),
        "in" => value
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().any(|item| item.as_str() == Some(field_str)))
            .unwrap_or(false),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idea() -> DevIdea {
        DevIdea {
            id: "idea-1".into(),
            project_id: Some("project-1".into()),
            context_id: None,
            scan_type: "static".into(),
            category: "reliability".into(),
            title: "Improve retries".into(),
            description: None,
            reasoning: None,
            status: "pending".into(),
            effort: Some(3),
            impact: Some(8),
            risk: Some(2),
            priority: None,
            provider: None,
            model: None,
            rejection_reason: None,
            origin: None,
            use_case_id: None,
            evidence: None,
            dedup_key: None,
            verify_state: None,
            verify_checked_at: None,
            verify_evidence: None,
            created_at: "2026-05-02T00:00:00Z".into(),
            updated_at: "2026-05-02T00:00:00Z".into(),
        }
    }

    #[test]
    fn matches_all_conditions() {
        let conditions = r#"
          [
            {"field":"impact","op":"gte","value":8},
            {"field":"category","op":"eq","value":"reliability"},
            {"field":"scan_type","op":"in","value":["static","llm"]}
          ]
        "#;

        assert!(evaluate_conditions(conditions, &idea()));
    }

    #[test]
    fn invalid_json_is_non_match() {
        assert!(!evaluate_conditions("{", &idea()));
    }

    #[test]
    fn origin_condition_targets_the_emitting_sensor() {
        let mut finding = idea();
        finding.origin = Some("passport_gap".into());

        let rule = r#"[{"field":"origin","op":"eq","value":"passport_gap"}]"#;
        assert!(evaluate_conditions(rule, &finding));

        let other = r#"[{"field":"origin","op":"eq","value":"llm_cost"}]"#;
        assert!(!evaluate_conditions(other, &finding));

        // A classic scanner idea carries no origin, so an origin rule must never
        // sweep it up — otherwise "auto-accept passport gaps" would auto-accept
        // the whole backlog.
        assert!(!evaluate_conditions(rule, &idea()));
    }

    #[test]
    fn origin_condition_supports_in() {
        let mut finding = idea();
        finding.origin = Some("sentry_spike".into());
        let rule = r#"[{"field":"origin","op":"in","value":["sentry_spike","kpi_offtrack"]}]"#;
        assert!(evaluate_conditions(rule, &finding));
    }
}
