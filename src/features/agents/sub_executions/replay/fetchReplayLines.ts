import { getExecutionLogLines } from '@/api/agents/executions';

/** Page size — matches `get_execution_log_lines`' own default page. */
export const REPLAY_PAGE_SIZE = 500;

/**
 * Ceiling on replayed lines. Matches `RECOVERY_MAX_LINES` (session recovery)
 * and the terminal sink's `MAX_TERMINAL_LINES`; it is also the loop's liveness
 * guarantee should a backend return a full page forever.
 */
export const REPLAY_MAX_LINES = 10_000;

/**
 * A run's stamped stdout, paged FORWARD from offset 0 until a short page (the
 * command's end-of-stream signal) or the cap. A single 500-line page replayed
 * only the first 500 lines of a longer run and reported `totalLines` as 500.
 * Stamped: the timeline places each line at the time it was written.
 */
export async function fetchReplayLines(execId: string, personaId: string): Promise<string[]> {
  const all: string[] = [];
  for (let offset = 0; offset < REPLAY_MAX_LINES; offset += REPLAY_PAGE_SIZE) {
    const page = await getExecutionLogLines(execId, personaId, offset, REPLAY_PAGE_SIZE, true);
    all.push(...page);
    if (page.length < REPLAY_PAGE_SIZE) break;
  }
  return all.length > REPLAY_MAX_LINES ? all.slice(0, REPLAY_MAX_LINES) : all;
}
