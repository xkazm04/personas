use crate::engine::prompt;
use crate::engine::types::CliArgs;

/// Model used for credential-related AI tasks (design + negotiation).
const CREDENTIAL_TASK_MODEL: &str = "claude-sonnet-4-6";

/// Build CLI args for credential AI tasks, appending the default model
/// when no explicit `--model` flag is present.
pub(crate) fn build_credential_task_cli_args() -> CliArgs {
    let mut cli_args = prompt::build_cli_args(None, None);
    if !cli_args.args.iter().any(|arg| arg == "--model") {
        cli_args.args.push("--model".to_string());
        cli_args.args.push(CREDENTIAL_TASK_MODEL.to_string());
    }
    cli_args
}
