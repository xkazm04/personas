/**
 * operationalSteps — parse Athena's running plan from TodoWrite tool calls
 * in the stream-json. This is the data behind the "operational thread": the
 * live checklist of what she's working through, surfaced inline under the
 * bubble so a long / autonomous turn keeps the user informed step-by-step
 * instead of going silent until the final reply.
 *
 * TodoWrite is Claude Code's native primitive for an agent to publish and
 * continuously update a plan. Each call re-sends the FULL list (latest wins),
 * so the caller simply replaces the stored steps on every successful parse.
 *
 * We parse from the whole `assistant` message (complete JSON) rather than the
 * `input_json_delta` partials — partial tool-input JSON can't be parsed
 * incrementally, and the whole message always arrives.
 */

export type TodoStepStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoStep {
  /** Imperative description of the step (e.g. "Run the test suite"). */
  content: string;
  /**
   * Present-continuous form Claude supplies for the active step
   * (e.g. "Running the test suite"). Optional; falls back to `content`.
   */
  activeForm?: string;
  status: TodoStepStatus;
}

function coerceStatus(raw: unknown): TodoStepStatus {
  return raw === 'in_progress' || raw === 'completed' ? raw : 'pending';
}

/**
 * Extract the TodoWrite checklist from a stream-json line. Returns the full
 * step list when the line is an `assistant` message carrying a TodoWrite
 * `tool_use` block, otherwise `null` (line carries no plan update).
 */
export function extractTodoWrite(line: string): TodoStep[] | null {
  try {
    const json = JSON.parse(line);
    if (json?.type !== 'assistant') return null;
    const blocks = json?.message?.content;
    if (!Array.isArray(blocks)) return null;
    for (const b of blocks) {
      if (b?.type === 'tool_use' && b?.name === 'TodoWrite') {
        const todos = b?.input?.todos;
        if (!Array.isArray(todos)) return null;
        const steps: TodoStep[] = [];
        for (const it of todos) {
          if (typeof it?.content === 'string') {
            steps.push({
              content: it.content,
              activeForm:
                typeof it?.activeForm === 'string' ? it.activeForm : undefined,
              status: coerceStatus(it?.status),
            });
          }
        }
        return steps.length > 0 ? steps : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}
