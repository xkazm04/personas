//! Local Agent Runtime (Phase 4).
//!
//! Provides a persistent orchestration layer that enables agents to compose
//! actions across multiple desktop bridges in a single execution flow.
//! The runtime manages execution context, result chaining, and cross-app
//! coordination while enforcing security boundaries.

use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::engine::desktop_bridges::BridgeActionResult;
use crate::engine::desktop_security::{self, DesktopApprovalStore, DesktopCapability};
use crate::error::AppError;

// ── Runtime types ────────────────────────────────────────────────────

/// A single step in a desktop agent plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopStep {
    /// Unique step ID within the plan.
    pub id: String,
    /// Which bridge to use (vscode, docker, terminal, obsidian).
    pub bridge: String,
    /// The action payload (JSON matching the bridge's action enum).
    pub action: serde_json::Value,
    /// Optional: step ID whose output should be injected as context.
    pub depends_on: Option<String>,
    /// Human-readable description of what this step does.
    pub description: String,
}

/// A plan comprising multiple steps to be executed in sequence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopPlan {
    pub id: String,
    pub name: String,
    pub steps: Vec<DesktopStep>,
    pub created_at: String,
}

/// Result of executing a full plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanExecutionResult {
    pub plan_id: String,
    pub success: bool,
    pub step_results: Vec<StepResult>,
    pub total_duration_ms: u64,
    pub failed_step: Option<String>,
}

/// Result of a single step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub step_id: String,
    pub bridge_result: BridgeActionResult,
    /// The output from the previous step that was injected (if any).
    pub injected_context: Option<String>,
}

/// Status of a running plan execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeStatus {
    pub active_plan: Option<String>,
    pub completed_steps: usize,
    pub total_steps: usize,
    pub current_step: Option<String>,
}

// ── Runtime state ────────────────────────────────────────────────────

/// Tracks active plan executions.
pub struct DesktopRuntime {
    status: RwLock<RuntimeStatus>,
    /// Results cache: plan_id → result.
    results: RwLock<HashMap<String, PlanExecutionResult>>,
}

impl DesktopRuntime {
    pub fn new() -> Self {
        Self {
            status: RwLock::new(RuntimeStatus {
                active_plan: None,
                completed_steps: 0,
                total_steps: 0,
                current_step: None,
            }),
            results: RwLock::new(HashMap::new()),
        }
    }

    pub async fn get_status(&self) -> RuntimeStatus {
        self.status.read().await.clone()
    }

    pub async fn get_result(&self, plan_id: &str) -> Option<PlanExecutionResult> {
        self.results.read().await.get(plan_id).cloned()
    }

    /// Execute a desktop plan step-by-step, enforcing security checks.
    pub async fn execute_plan(
        &self,
        plan: DesktopPlan,
        approvals: &DesktopApprovalStore,
        bridge_config: &BridgeConfig,
    ) -> Result<PlanExecutionResult, AppError> {
        let start = Instant::now();

        // Pre-validate: all bridges have approved capabilities
        for step in &plan.steps {
            let capabilities = required_capabilities_for_bridge(&step.bridge);
            for cap in &capabilities {
                let connector_name = format!("desktop_{}", step.bridge);
                desktop_security::check_permission(approvals, &connector_name, cap)?;
            }
        }

        // Update status
        {
            let mut status = self.status.write().await;
            status.active_plan = Some(plan.id.clone());
            status.total_steps = plan.steps.len();
            status.completed_steps = 0;
            status.current_step = plan.steps.first().map(|s| s.id.clone());
        }

        let mut step_results: Vec<StepResult> = Vec::new();
        let mut step_outputs: HashMap<String, String> = HashMap::new();
        let mut failed_step = None;

        for step in &plan.steps {
            // Update current step
            {
                let mut status = self.status.write().await;
                status.current_step = Some(step.id.clone());
            }

            // Resolve dependency context
            let injected_context = step.depends_on.as_ref().and_then(|dep_id| {
                step_outputs.get(dep_id).cloned()
            });

            // Execute the step
            let bridge_result = execute_bridge_action(
                &step.bridge,
                &step.action,
                injected_context.as_deref(),
                bridge_config,
            )
            .await;

            let bridge_result = match bridge_result {
                Ok(r) => r,
                Err(e) => {
                    failed_step = Some(step.id.clone());
                    let result = PlanExecutionResult {
                        plan_id: plan.id.clone(),
                        success: false,
                        step_results,
                        total_duration_ms: start.elapsed().as_millis() as u64,
                        failed_step,
                    };
                    // Clear status
                    let mut status = self.status.write().await;
                    *status = RuntimeStatus {
                        active_plan: None,
                        completed_steps: 0,
                        total_steps: 0,
                        current_step: None,
                    };
                    self.results.write().await.insert(plan.id.clone(), result.clone());
                    return Err(e);
                }
            };

            // Store output for dependency resolution
            if bridge_result.success {
                step_outputs.insert(step.id.clone(), bridge_result.output.clone());
            } else {
                failed_step = Some(step.id.clone());
            }

            step_results.push(StepResult {
                step_id: step.id.clone(),
                bridge_result: bridge_result.clone(),
                injected_context,
            });

            // Update progress
            {
                let mut status = self.status.write().await;
                status.completed_steps += 1;
            }

            // Stop on failure
            if !bridge_result.success {
                break;
            }
        }

        let result = PlanExecutionResult {
            plan_id: plan.id.clone(),
            success: failed_step.is_none(),
            step_results,
            total_duration_ms: start.elapsed().as_millis() as u64,
            failed_step,
        };

        // Clear status, cache result
        {
            let mut status = self.status.write().await;
            *status = RuntimeStatus {
                active_plan: None,
                completed_steps: 0,
                total_steps: 0,
                current_step: None,
            };
        }
        self.results.write().await.insert(plan.id.clone(), result.clone());

        Ok(result)
    }
}

// ── Bridge config ────────────────────────────────────────────────────

/// Configuration for bridge execution (binary paths, vault paths, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BridgeConfig {
    /// VS Code binary path (e.g., "code" or full path).
    pub vscode_binary: Option<String>,
    /// Docker binary path.
    pub docker_binary: Option<String>,
    /// Shell for terminal bridge.
    pub terminal_shell: Option<String>,
    /// Obsidian vault path.
    pub obsidian_vault_path: Option<String>,
    /// Obsidian REST API port.
    pub obsidian_api_port: Option<u16>,
    /// Obsidian REST API key.
    pub obsidian_api_key: Option<String>,
    /// Extra environment variables for terminal execution.
    pub env_vars: HashMap<String, String>,
}

// ── Bridge dispatch ──────────────────────────────────────────────────

/// Map bridge name to required security capabilities.
fn required_capabilities_for_bridge(bridge: &str) -> Vec<DesktopCapability> {
    match bridge {
        "vscode" => vec![DesktopCapability::ProcessSpawn],
        "docker" => vec![DesktopCapability::ProcessSpawn],
        "terminal" => vec![DesktopCapability::ProcessSpawn, DesktopCapability::FileRead],
        "obsidian" => vec![DesktopCapability::FileRead, DesktopCapability::FileWrite],
        _ => vec![],
    }
}

/// Execute a single bridge action by bridge name.
async fn execute_bridge_action(
    bridge: &str,
    action_json: &serde_json::Value,
    _context: Option<&str>,
    config: &BridgeConfig,
) -> Result<BridgeActionResult, AppError> {
    match bridge {
        "vscode" => {
            let action: super::desktop_bridges::vscode::VsCodeAction =
                serde_json::from_value(action_json.clone())
                    .map_err(|e| AppError::Validation(format!("Invalid VS Code action: {e}")))?;
            let binary = config.vscode_binary.as_deref().unwrap_or("code");
            super::desktop_bridges::vscode::execute(binary, action).await
        }
        "docker" => {
            let action: super::desktop_bridges::docker::DockerAction =
                serde_json::from_value(action_json.clone())
                    .map_err(|e| AppError::Validation(format!("Invalid Docker action: {e}")))?;
            let binary = config.docker_binary.as_deref().unwrap_or("docker");
            super::desktop_bridges::docker::execute(binary, action).await
        }
        "terminal" => {
            let action: super::desktop_bridges::terminal::TerminalAction =
                serde_json::from_value(action_json.clone())
                    .map_err(|e| AppError::Validation(format!("Invalid Terminal action: {e}")))?;
            let shell = config.terminal_shell.as_deref().unwrap_or("bash");
            super::desktop_bridges::terminal::execute(shell, action, &config.env_vars).await
        }
        "obsidian" => {
            let action: super::desktop_bridges::obsidian::ObsidianAction =
                serde_json::from_value(action_json.clone())
                    .map_err(|e| AppError::Validation(format!("Invalid Obsidian action: {e}")))?;
            let vault = config.obsidian_vault_path.as_deref()
                .ok_or_else(|| AppError::Validation("Obsidian vault path not configured".into()))?;
            super::desktop_bridges::obsidian::execute(
                vault,
                config.obsidian_api_port,
                config.obsidian_api_key.as_deref(),
                action,
            )
            .await
        }
        _ => Err(AppError::Validation(format!("Unknown bridge: {bridge}"))),
    }
}
