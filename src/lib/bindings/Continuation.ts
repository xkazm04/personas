/**
 * How to continue a previous execution.
 *
 * - `PromptHint`: injects a contextual hint into the input data.
 * - `SessionResume`: uses Claude CLI `--resume <session_id>` to natively
 *   continue a prior conversation.
 */
export type Continuation =
  | { type: "PromptHint"; value: string }
  | { type: "SessionResume"; value: string };
