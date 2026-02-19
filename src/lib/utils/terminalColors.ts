export type TerminalLineStyle = 'meta' | 'tool' | 'error' | 'status' | 'text';

/** Classify a terminal output line into a visual category */
export function classifyLine(line: string): TerminalLineStyle {
  if (line.startsWith('[ERROR]') || line.startsWith('[TIMEOUT]') || line.startsWith('[WARN]')) return 'error';
  if (line.startsWith('> Using tool:')) return 'tool';
  if (line.startsWith('  Tool result:')) return 'tool';
  if (line.startsWith('Session started') || line.startsWith('Completed in') || line.startsWith('Cost: $') || line.startsWith('=== ')) return 'status';
  if (line.startsWith('Process exited')) return 'meta';
  return 'text';
}

export const TERMINAL_STYLE_MAP: Record<TerminalLineStyle, string> = {
  meta: 'text-muted-foreground/40',
  tool: 'text-cyan-400/70',
  error: 'text-red-400/80',
  status: 'text-emerald-400/70 font-semibold',
  text: 'text-foreground/70',
};
