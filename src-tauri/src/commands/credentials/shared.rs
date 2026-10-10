use crate::engine::types::CliArgs;

/// Call class of the credential-related AI tasks (design + negotiation): a
/// tool-using task that acts on the user's environment. Model and effort come
/// from the class table (`personas_core::model_class`).
const CREDENTIAL_TASK_CLASS: personas_core::model_class::CallClass =
    personas_core::model_class::CallClass::AgentTask;

/// Build CLI args for credential AI tasks on the [`CREDENTIAL_TASK_CLASS`]
/// route (exactly one `--model` and one `--effort`).
pub(crate) fn build_credential_task_cli_args() -> CliArgs {
    let route = CREDENTIAL_TASK_CLASS.route();
    crate::engine::cli_process::headless_claude_args(route.model, route.effort, &[])
}
