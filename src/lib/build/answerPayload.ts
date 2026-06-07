/**
 * Shared build-session answer batching.
 *
 * The build session resumes the CLI with a single multi-dimension payload where
 * each answered dimension is one line: `[cellKey]: answer`. The backend parses
 * this line-by-line, so each answer MUST stay on a single line — otherwise a
 * pasted log snippet (or malicious input) containing a newline + `[dimension]:`
 * could forge an extra answer the user never consented to.
 *
 * This helper is the single source of truth for that escaping. It is used by
 * both {@link useBuildSession.submitAllAnswers} (the matrix/glyph surface) and
 * the global Quick Answer popover, so the security-sensitive escaping can never
 * drift between the two call paths.
 */

/** Escape a single answer so it occupies exactly one line and cannot forge a
 *  `[dimension]:` prefix. Order matters: escape backslashes first. */
export function escapeAnswer(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/\[/g, '\\[');
}

/**
 * Build the `_batch` payload string from a `cellKey → answer` map. Returns an
 * empty string when there are no answers (callers should skip the IPC then).
 */
export function buildBatchedAnswerPayload(answers: Record<string, string>): string {
  return Object.entries(answers)
    .map(([cellKey, answer]) => `[${cellKey}]: ${escapeAnswer(answer)}`)
    .join('\n');
}
