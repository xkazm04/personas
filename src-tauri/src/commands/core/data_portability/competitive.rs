//! Preview parsing for foreign automation exports (n8n, Zapier, Make).
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CompetitiveImportPreview {
    pub source_platform: String,
    pub workflow_name: String,
    pub description: String,
    pub suggested_tools: Vec<String>,
    pub suggested_triggers: Vec<String>,
}

/// Parse competitive workflow file and return previews.
pub(crate) fn parse_competitive_workflow(
    content: &str,
) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| AppError::Validation(format!("Invalid JSON: {e}")))?;

    // Detect platform from structure
    if is_n8n_workflow(&value) {
        return parse_n8n_preview(&value);
    }
    if is_zapier_workflow(&value) {
        return parse_zapier_preview(&value);
    }
    if is_make_workflow(&value) {
        return parse_make_preview(&value);
    }

    Err(AppError::Validation(
        "Unrecognized workflow format. Supported: n8n, Zapier, Make/Integromat".into(),
    ))
}

pub(crate) fn is_n8n_workflow(v: &serde_json::Value) -> bool {
    v.get("nodes").is_some() && v.get("connections").is_some()
}

pub(crate) fn is_zapier_workflow(v: &serde_json::Value) -> bool {
    // Zapier exports have "steps" array and often a "title" field
    v.get("steps").is_some_and(|s| s.is_array()) && v.get("title").is_some()
}

pub(crate) fn is_make_workflow(v: &serde_json::Value) -> bool {
    // Make/Integromat exports have "modules" array
    v.get("modules").is_some_and(|s| s.is_array()) || v.get("scenario").is_some()
}

pub(crate) fn parse_n8n_preview(
    v: &serde_json::Value,
) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled n8n Workflow")
        .to_string();

    let nodes = v
        .get("nodes")
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();

    let tools: Vec<String> = nodes
        .iter()
        .filter_map(|n| n.get("type").and_then(|t| t.as_str()))
        .filter(|t| !t.starts_with("n8n-nodes-base."))
        .map(|t| t.to_string())
        .collect();

    let triggers: Vec<String> = nodes
        .iter()
        .filter_map(|n| {
            let node_type = n.get("type")?.as_str()?;
            if node_type.contains("Trigger") || node_type.contains("trigger") {
                Some(node_type.to_string())
            } else {
                None
            }
        })
        .collect();

    let desc = format!(
        "n8n workflow with {} nodes. Use the n8n Transform wizard for full AI-assisted conversion.",
        nodes.len()
    );

    Ok(vec![CompetitiveImportPreview {
        source_platform: "n8n".into(),
        workflow_name: name,
        description: desc,
        suggested_tools: tools,
        suggested_triggers: triggers,
    }])
}

pub(crate) fn parse_zapier_preview(
    v: &serde_json::Value,
) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let name = v
        .get("title")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled Zap")
        .to_string();

    let steps = v
        .get("steps")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    let apps: Vec<String> = steps
        .iter()
        .filter_map(|s| s.get("app").and_then(|a| a.as_str()).map(|a| a.to_string()))
        .collect();

    let triggers: Vec<String> = steps
        .first()
        .and_then(|s| s.get("action"))
        .and_then(|a| a.as_str())
        .map(|a| vec![a.to_string()])
        .unwrap_or_default();

    let desc = format!(
        "Zapier Zap with {} steps connecting: {}",
        steps.len(),
        apps.join(", ")
    );

    Ok(vec![CompetitiveImportPreview {
        source_platform: "zapier".into(),
        workflow_name: name,
        description: desc,
        suggested_tools: apps,
        suggested_triggers: triggers,
    }])
}

pub(crate) fn parse_make_preview(
    v: &serde_json::Value,
) -> Result<Vec<CompetitiveImportPreview>, AppError> {
    let scenario = v.get("scenario").unwrap_or(v);
    let name = scenario
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Untitled Make Scenario")
        .to_string();

    let modules = scenario
        .get("modules")
        .or_else(|| v.get("modules"))
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();

    let tools: Vec<String> = modules
        .iter()
        .filter_map(|m| {
            m.get("module")
                .and_then(|a| a.as_str())
                .map(|a| a.to_string())
        })
        .collect();

    let desc = format!(
        "Make scenario with {} modules: {}",
        modules.len(),
        tools.join(", ")
    );

    Ok(vec![CompetitiveImportPreview {
        source_platform: "make".into(),
        workflow_name: name,
        description: desc,
        suggested_tools: tools,
        suggested_triggers: vec![],
    }])
}
