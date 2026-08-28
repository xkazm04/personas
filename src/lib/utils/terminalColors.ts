import { safeJsonParse } from './parseJson';

export type TerminalLineStyle = 'meta' | 'tool' | 'error' | 'status' | 'summary' | 'text' | 'code' | 'info';

/** Classify a terminal output line into a visual category */
export function classifyLine(line: string): TerminalLineStyle {
  if (line.startsWith('[ERROR]') || line.startsWith('[TIMEOUT]') || line.startsWith('[WARN]')) return 'error';
  if (line.startsWith('[SUMMARY]')) return 'summary';
  if (line.startsWith('[System]')) return 'meta';
  if (line.startsWith('> Using tool:')) return 'tool';
  if (line.startsWith('  Tool result:')) return 'tool';
  // P4 fan-out: every subagent-attributed line the runner emits is indented and
  // prefixed with `subagent`. Classifying it as meta (not text) keeps subagent
  // chatter out of the chat bubble, which filters this channel to `text` only.
  if (line.startsWith('  subagent')) return 'meta';
  if (line.startsWith('> Analyzing') || line.startsWith('> Attempt') || line.startsWith('> Resuming') || line.startsWith('> Query succeeded') || line.startsWith('> Max retries')) return 'info';
  // `> Cancelled` MUST be tested before the generic `> ` branch below. It used to
  // sit after it, which made it unreachable: every `> `-prefixed line except
  // `> _` was already claimed as 'code', so a cancellation was painted as CLI
  // code rather than as run metadata.
  if (line.startsWith('> Cancelled')) return 'meta';
  if (line.startsWith('> ') && !line.startsWith('> _')) return 'code';
  if (line.startsWith('Session started') || line.startsWith('Completed in') || line.startsWith('Cost: $') || line.startsWith('=== ')) return 'status';
  if (line.startsWith('Process exited')) return 'meta';
  return 'text';
}

export const TERMINAL_STYLE_MAP: Record<TerminalLineStyle, string> = {
  meta: 'text-foreground italic',
  tool: 'text-cyan-400/70',
  error: 'text-red-400/80 font-medium',
  status: 'text-emerald-400/70 font-semibold',
  summary: '',
  text: 'text-foreground',
  code: 'text-violet-300/80 font-mono',
  info: 'text-blue-400/70 font-medium',
};

export interface ExecutionSummary {
  status: string;
  duration_ms: number | null;
  cost_usd: number | null;
  last_tool?: string | null;
}

/**
 * Runtime shape check for a `[SUMMARY]` payload.
 *
 * Deliberately narrow: it demands only what the callers actually branch on
 * (`status` must be a string) and tolerates a missing or null numeric, because
 * the emitters are four different CLI providers and rejecting a summary is
 * worse for the user than rendering one with a blank duration. What it DOES
 * reject is the shape that used to slip through — a payload that parses but is
 * not an object at all (`[SUMMARY]"done"`, `[SUMMARY]null`, `[SUMMARY][]`),
 * which was cast straight to `ExecutionSummary` and reached the runner as an
 * object whose every field was undefined.
 */
function isExecutionSummary(value: unknown): value is ExecutionSummary {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.status !== 'string') return false;
  const numericOk = (x: unknown) => x == null || typeof x === 'number';
  return (
    numericOk(v.duration_ms) &&
    numericOk(v.cost_usd) &&
    (v.last_tool == null || typeof v.last_tool === 'string')
  );
}

/**
 * Parse a [SUMMARY] line into structured data. Returns null if not a summary
 * line, if the payload does not parse, or if it does not match the shape.
 *
 * The shape check is the point: this is a data boundary (a subprocess's stdout),
 * and the previous implementation returned `JSON.parse(...)` straight into the
 * `ExecutionSummary` return type — the unnamed data-boundary assertion the repo
 * convention exists to stop. `safeJsonParse`'s `guard` parameter, in the same
 * utils folder, exists for exactly this.
 */
export function parseSummaryLine(line: string): ExecutionSummary | null {
  if (!line.startsWith('[SUMMARY]')) return null;
  const [summary] = safeJsonParse(line.slice('[SUMMARY]'.length), isExecutionSummary);
  return summary;
}
