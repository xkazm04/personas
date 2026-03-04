export type TerminalLineStyle = 'meta' | 'tool' | 'error' | 'status' | 'summary' | 'text' | 'code' | 'info';

/** Classify a terminal output line into a visual category */
export function classifyLine(line: string): TerminalLineStyle {
  if (line.startsWith('[ERROR]') || line.startsWith('[TIMEOUT]') || line.startsWith('[WARN]')) return 'error';
  if (line.startsWith('[SUMMARY]')) return 'summary';
  if (line.startsWith('[System]')) return 'meta';
  if (line.startsWith('> Using tool:')) return 'tool';
  if (line.startsWith('  Tool result:')) return 'tool';
  if (line.startsWith('> Analyzing') || line.startsWith('> Attempt') || line.startsWith('> Resuming') || line.startsWith('> Query succeeded') || line.startsWith('> Max retries')) return 'info';
  if (line.startsWith('> ') && !line.startsWith('> _')) return 'code';
  if (line.startsWith('Session started') || line.startsWith('Completed in') || line.startsWith('Cost: $') || line.startsWith('=== ')) return 'status';
  if (line.startsWith('Process exited') || line.startsWith('> Cancelled')) return 'meta';
  return 'text';
}

export const TERMINAL_STYLE_MAP: Record<TerminalLineStyle, string> = {
  meta: 'text-muted-foreground/50 italic',
  tool: 'text-cyan-400/70',
  error: 'text-red-400/80 font-medium',
  status: 'text-emerald-400/70 font-semibold',
  summary: '',
  text: 'text-foreground/80',
  code: 'text-violet-300/80 font-mono',
  info: 'text-blue-400/70 font-medium',
};

export interface ExecutionSummary {
  status: string;
  duration_ms: number | null;
  cost_usd: number | null;
  last_tool?: string | null;
}

/** Parse a [SUMMARY] line into structured data. Returns null if not a summary line. */
export function parseSummaryLine(line: string): ExecutionSummary | null {
  if (!line.startsWith('[SUMMARY]')) return null;
  try {
    return JSON.parse(line.slice('[SUMMARY]'.length));
  } catch {
    return null;
  }
}
