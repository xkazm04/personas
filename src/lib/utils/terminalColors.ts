export type TerminalLineStyle = 'meta' | 'tool' | 'error' | 'status' | 'summary' | 'text';

/** Classify a terminal output line into a visual category */
export function classifyLine(line: string): TerminalLineStyle {
  if (line.startsWith('[ERROR]') || line.startsWith('[TIMEOUT]') || line.startsWith('[WARN]')) return 'error';
  if (line.startsWith('[SUMMARY]')) return 'summary';
  if (line.startsWith('> Using tool:')) return 'tool';
  if (line.startsWith('  Tool result:')) return 'tool';
  if (line.startsWith('Session started') || line.startsWith('Completed in') || line.startsWith('Cost: $') || line.startsWith('=== ')) return 'status';
  if (line.startsWith('Process exited')) return 'meta';
  return 'text';
}

export const TERMINAL_STYLE_MAP: Record<TerminalLineStyle, string> = {
  meta: 'text-muted-foreground/80',
  tool: 'text-cyan-400/70',
  error: 'text-red-400/80',
  status: 'text-emerald-400/70 font-semibold',
  summary: '',
  text: 'text-foreground/90',
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
