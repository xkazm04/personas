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
}
