import { executePersona, getExecution } from '@/api/agents/executions';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'error', 'timeout']);

export interface RunPersonaResult {
  execution: PersonaExecution;
  output: string | null;
  passed: boolean;
}

export interface RunPersonaOptions {
  personaId: string;
  input: string;
  /** How long to wait before giving up (ms). Default 120s. */
  timeoutMs?: number;
  /** Poll interval (ms). Default 2000. */
  pollMs?: number;
  /** Callback each time we observe an updated status. */
  onStatus?: (status: string) => void;
  /** Caller persona id used by `getExecution` for access control. Defaults to the target persona. */
  callerPersonaId?: string;
}

/**
 * Fire a persona and poll until it reaches a terminal status or times out.
 * Returns the final execution row and a `passed` boolean derived from the status.
 */
export async function runPersonaAndWait(opts: RunPersonaOptions): Promise<RunPersonaResult> {
  const pollMs = opts.pollMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const callerPersonaId = opts.callerPersonaId ?? opts.personaId;

  const started = await executePersona(opts.personaId, undefined, opts.input);
  opts.onStatus?.(started.status);

  if (TERMINAL.has(started.status)) {
    return {
      execution: started,
      output: started.output_data,
      passed: started.status === 'completed',
    };
  }

  const deadline = Date.now() + timeoutMs;
  let latest = started;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    try {
      latest = await getExecution(started.id, callerPersonaId);
      opts.onStatus?.(latest.status);
      if (TERMINAL.has(latest.status)) break;
    } catch {
      // Ignore transient errors during polling; retry on next tick.
    }
  }

  return {
    execution: latest,
    output: latest.output_data,
    passed: latest.status === 'completed',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
