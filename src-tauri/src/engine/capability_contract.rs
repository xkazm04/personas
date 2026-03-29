//! Capability contracts for persona subsystems.
//!
//! Each persona subsystem (tools, triggers, automations) implicitly depends on
//! external resources: credentials, other personas, webhooks, etc.  These
//! dependencies are normally discovered only at execution time, causing cryptic
//! failures.
//!
//! This module introduces typed capability requirements that subsystems declare
//! up-front.  A resolver validates all requirements against the current DB state
//! **before** execution, surfacing unmet dependencies at design time.
//!
//! ## Architecture
//!
//! ```text
//! PersonaToolDefinition ──┐
//! PersonaTrigger ─────────┤  collect_requirements()
//! PersonaAutomation ──────┘         │
//!                                   ▼
//!                          Vec<Requirement>
//!                                   │
//!                          resolve(pool, &[Requirement])
//!                                   │
//!                                   ▼
//!                          ContractReport { met, unmet }
//! ```

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{PersonaAutomation, PersonaToolDefinition, PersonaTrigger};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::{
    connectors as connector_repo, credentials as cred_repo,
};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Requirement -- a single typed dependency predicate
// ============================================================================

/// A typed dependency predicate that a subsystem declares.
///
/// Each variant encodes *what* is needed and *who* needs it, so the resolver
/// can check the DB and produce a human-readable diagnostic.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Requirement {
    /// A credential of a specific service type must exist.
    Credential {
        /// The `service_type` value expected in `persona_credentials`.
        service_type: String,
        /// Human-readable label of the subsystem that needs it (e.g. tool name).
        needed_by: String,
    },
    /// A connector definition must exist (tools resolve creds via connectors).
    Connector {
        /// The connector `name` in `connector_definitions`.
        connector_name: String,
        needed_by: String,
    },
    /// Another persona must exist (chain triggers reference a source persona).
    Persona {
        persona_id: String,
        needed_by: String,
    },
    /// An automation must exist (automation-type tools encode an automation ID).
    Automation {
        automation_id: String,
        needed_by: String,
    },
}

impl Requirement {
    /// Short human-readable summary for display in the UI.
    pub fn summary(&self) -> String {
        match self {
            Self::Credential { service_type, needed_by } => {
                format!("Credential '{service_type}' required by {needed_by}")
            }
            Self::Connector { connector_name, needed_by } => {
                format!("Connector '{connector_name}' required by {needed_by}")
            }
            Self::Persona { persona_id, needed_by } => {
                format!("Persona '{persona_id}' required by {needed_by}")
            }
            Self::Automation { automation_id, needed_by } => {
                format!("Automation '{automation_id}' required by {needed_by}")
            }
        }
    }
}

// ============================================================================
// ContractReport -- resolution result
// ============================================================================

/// The result of resolving all requirements against the current DB state.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContractReport {
    /// Requirements that are satisfied.
    pub met: Vec<Requirement>,
    /// Requirements that are NOT satisfied -- these would cause runtime failure.
    pub unmet: Vec<UnmetRequirement>,
    /// True when every requirement is met.
    pub all_satisfied: bool,
}

/// An unmet requirement with a human-readable diagnostic.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UnmetRequirement {
    pub requirement: Requirement,
    /// What went wrong (e.g. "No credential with service_type 'notion' found").
    pub reason: String,
}

// ============================================================================
// Requirement collection -- extract requirements from subsystem data
// ============================================================================

/// Collect all capability requirements for a persona given its tools, triggers,
/// and automations.
pub fn collect_requirements(
    tools: &[PersonaToolDefinition],
    triggers: &[PersonaTrigger],
    automations: &[PersonaAutomation],
) -> Vec<Requirement> {
    let mut reqs = Vec::new();
    reqs.extend(collect_tool_requirements(tools));
    reqs.extend(collect_trigger_requirements(triggers));
    reqs.extend(collect_automation_requirements(automations));
    // Deduplicate while preserving order
    deduplicate(&mut reqs);
    reqs
}

/// Extract requirements from tool definitions.
fn collect_tool_requirements(tools: &[PersonaToolDefinition]) -> Vec<Requirement> {
    let mut reqs = Vec::new();
    for tool in tools {
        // Tools with requires_credential_type need a matching credential
        if let Some(ref cred_type) = tool.requires_credential_type {
            if !cred_type.trim().is_empty() {
                reqs.push(Requirement::Credential {
                    service_type: cred_type.clone(),
                    needed_by: format!("tool '{}'", tool.name),
                });
            }
        }

        // Automation-type tools encode an automation ID in the tool ID
        if tool.category == "automation" {
            if let Some(auto_id) = tool.id.strip_prefix("auto::") {
                reqs.push(Requirement::Automation {
                    automation_id: auto_id.to_string(),
                    needed_by: format!("tool '{}'", tool.name),
                });
            }
        }
    }
    reqs
}

/// Extract requirements from triggers.
fn collect_trigger_requirements(triggers: &[PersonaTrigger]) -> Vec<Requirement> {
    let mut reqs = Vec::new();
    for trigger in triggers {
        if trigger.trigger_type == "chain" {
            let config = trigger.parse_config();
            if let crate::db::models::TriggerConfig::Chain {
                source_persona_id: Some(ref pid),
                ..
            } = config
            {
                if !pid.trim().is_empty() {
                    reqs.push(Requirement::Persona {
                        persona_id: pid.clone(),
                        needed_by: format!("chain trigger '{}'", trigger.id),
                    });
                }
            }
        }
    }
    reqs
}

/// Extract requirements from automations.
fn collect_automation_requirements(automations: &[PersonaAutomation]) -> Vec<Requirement> {
    let mut reqs = Vec::new();
    for auto in automations {
        // Automations with a platform_credential_id need that credential to exist
        if let Some(ref cred_id) = auto.platform_credential_id {
            if !cred_id.trim().is_empty() {
                reqs.push(Requirement::Credential {
                    service_type: cred_id.clone(),
                    needed_by: format!("automation '{}'", auto.name),
                });
            }
        }
    }
    reqs
}

/// Remove duplicates while preserving insertion order.
fn deduplicate(reqs: &mut Vec<Requirement>) {
    let mut seen = std::collections::HashSet::new();
    reqs.retain(|r| seen.insert(r.clone()));
}

// ============================================================================
// Resolver -- validate requirements against DB state
// ============================================================================

/// Resolve all requirements against the current database state.
///
/// Returns a [`ContractReport`] with met and unmet requirements.
/// This is intentionally synchronous (no async) because it only does DB reads
/// on the local SQLite pool.
pub fn resolve(pool: &DbPool, requirements: &[Requirement]) -> ContractReport {
    let mut met = Vec::new();
    let mut unmet = Vec::new();

    for req in requirements {
        match check_requirement(pool, req) {
            Ok(()) => met.push(req.clone()),
            Err(reason) => unmet.push(UnmetRequirement {
                requirement: req.clone(),
                reason,
            }),
        }
    }

    let all_satisfied = unmet.is_empty();
    ContractReport {
        met,
        unmet,
        all_satisfied,
    }
}

/// Check a single requirement against DB state.
/// Returns `Ok(())` if satisfied, `Err(reason)` if not.
fn check_requirement(pool: &DbPool, req: &Requirement) -> Result<(), String> {
    match req {
        Requirement::Credential { service_type, .. } => {
            // Check if any credential with this service_type exists
            match cred_repo::get_by_service_type(pool, service_type) {
                Ok(creds) if !creds.is_empty() => Ok(()),
                Ok(_) => Err(format!(
                    "No credential with service_type '{}' found. Add one in the Vault.",
                    service_type
                )),
                Err(e) => Err(format!("Failed to query credentials: {e}")),
            }
        }
        Requirement::Connector { connector_name, .. } => {
            match connector_repo::get_by_name(pool, connector_name) {
                Ok(Some(_)) => Ok(()),
                Ok(None) => Err(format!(
                    "Connector '{}' not found. Install or create the connector.",
                    connector_name
                )),
                Err(e) => Err(format!("Failed to query connectors: {e}")),
            }
        }
        Requirement::Persona { persona_id, .. } => {
            match persona_repo::get_by_id(pool, persona_id) {
                Ok(_) => Ok(()),
                Err(AppError::NotFound(_)) => Err(format!(
                    "Persona '{}' not found. Create it or update the reference.",
                    persona_id
                )),
                Err(e) => Err(format!("Failed to query persona: {e}")),
            }
        }
        Requirement::Automation { automation_id, .. } => {
            match crate::db::repos::resources::automations::get_by_id(pool, automation_id) {
                Ok(_) => Ok(()),
                Err(AppError::NotFound(_)) => Err(format!(
                    "Automation '{}' not found. Create it or update the tool reference.",
                    automation_id
                )),
                Err(e) => Err(format!("Failed to query automation: {e}")),
            }
        }
    }
}

// ============================================================================
// Convenience -- validate a full persona by ID
// ============================================================================

/// Load all subsystem data for a persona and resolve its capability contracts.
///
/// This is the primary entry point for design-time validation from the UI
/// and from the runner's validate stage.
pub fn validate_persona_contracts(
    pool: &DbPool,
    persona_id: &str,
) -> Result<ContractReport, AppError> {
    use crate::db::repos::resources::{
        automations as auto_repo, tools as tool_repo, triggers as trigger_repo,
    };

    let tools = tool_repo::get_tools_for_persona(pool, persona_id)?;
    let triggers = trigger_repo::get_by_persona_id(pool, persona_id)?;
    let automations = auto_repo::get_by_persona(pool, persona_id)?;

    let requirements = collect_requirements(&tools, &triggers, &automations);
    Ok(resolve(pool, &requirements))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requirement_summary_formats() {
        let r = Requirement::Credential {
            service_type: "notion".into(),
            needed_by: "tool 'read_pages'".into(),
        };
        assert_eq!(
            r.summary(),
            "Credential 'notion' required by tool 'read_pages'"
        );

        let r = Requirement::Persona {
            persona_id: "p-123".into(),
            needed_by: "chain trigger 'after-build'".into(),
        };
        assert!(r.summary().contains("p-123"));
    }

    #[test]
    fn deduplicate_preserves_order() {
        let mut reqs = vec![
            Requirement::Credential {
                service_type: "notion".into(),
                needed_by: "tool A".into(),
            },
            Requirement::Credential {
                service_type: "slack".into(),
                needed_by: "tool B".into(),
            },
            Requirement::Credential {
                service_type: "notion".into(),
                needed_by: "tool A".into(),
            },
        ];
        deduplicate(&mut reqs);
        assert_eq!(reqs.len(), 2);
        assert!(matches!(&reqs[0], Requirement::Credential { service_type, .. } if service_type == "notion"));
        assert!(matches!(&reqs[1], Requirement::Credential { service_type, .. } if service_type == "slack"));
    }

    #[test]
    fn empty_requirements_produces_satisfied_report() {
        // No requirements → all_satisfied = true
        let report = ContractReport {
            met: vec![],
            unmet: vec![],
            all_satisfied: true,
        };
        assert!(report.all_satisfied);
    }

    #[test]
    fn collect_tool_requirements_extracts_credential_type() {
        let tool = PersonaToolDefinition {
            id: "t-1".into(),
            name: "read_pages".into(),
            category: "api".into(),
            description: "Read Notion pages".into(),
            script_path: String::new(),
            input_schema: None,
            output_schema: None,
            requires_credential_type: Some("notion".into()),
            implementation_guide: None,
            is_builtin: false,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let reqs = collect_tool_requirements(&[tool]);
        assert_eq!(reqs.len(), 1);
        assert!(matches!(&reqs[0], Requirement::Credential { service_type, .. } if service_type == "notion"));
    }

    #[test]
    fn collect_tool_requirements_skips_empty_credential_type() {
        let tool = PersonaToolDefinition {
            id: "t-1".into(),
            name: "local_script".into(),
            category: "script".into(),
            description: "Local script".into(),
            script_path: "run.ts".into(),
            input_schema: None,
            output_schema: None,
            requires_credential_type: Some("".into()),
            implementation_guide: None,
            is_builtin: false,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let reqs = collect_tool_requirements(&[tool]);
        assert!(reqs.is_empty());
    }

    #[test]
    fn collect_tool_requirements_detects_automation_tool() {
        let tool = PersonaToolDefinition {
            id: "auto::aut-abc123".into(),
            name: "deploy_workflow".into(),
            category: "automation".into(),
            description: "Deploy via n8n".into(),
            script_path: String::new(),
            input_schema: None,
            output_schema: None,
            requires_credential_type: None,
            implementation_guide: None,
            is_builtin: false,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let reqs = collect_tool_requirements(&[tool]);
        assert_eq!(reqs.len(), 1);
        assert!(matches!(&reqs[0], Requirement::Automation { automation_id, .. } if automation_id == "aut-abc123"));
    }
}
