/**
 * Commands referenced in the frontend that are NOT yet registered in the Rust
 * invoke_handler. These are either planned commands or dead code.
 *
 * When a command is implemented and added to lib.rs invoke_handler, re-run
 * `node scripts/generate-command-names.mjs` and remove it from this list.
 */
export type UnregisteredCommand =
  // Curator's loop (stage 2b). The wire contract was frozen at 29d67ca26 so the
  // Rust and the UI could be built in parallel; these five are referenced by
  // `src/api/curator.ts` and drop off this list the moment the handler
  // registration lands and `generate-command-names.mjs` re-runs.
  | "curator_requests_list"
  | "curator_request_create"
  | "curator_request_cancel"
  | "curator_skills_list"
  | "curator_runtime_get"
  | "dev_tools_batch_create_tasks"
  | "dev_tools_cancel_task"
  | "dev_tools_generate_context_description"
  | "dev_tools_get_batch_status"
  | "dev_tools_move_context"
  | "dev_tools_record_goal_signal"
  | "dev_tools_scan_directory"
  | "dev_tools_start_task"
  | "gitlab_get_pipeline"
  | "gitlab_list_pipeline_jobs"
  | "gitlab_list_pipelines"
  | "gitlab_trigger_pipeline"
  | "create_chat_session"
  | "zapier_create_zap"
  | "zapier_list_zaps"
  | "zapier_trigger_webhook"
  | "lab_create_version_snapshot";
