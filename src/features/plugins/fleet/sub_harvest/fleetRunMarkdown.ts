import type { FleetRunReport } from '@/lib/bindings/FleetRunReport';

/**
 * Render a run report as the markdown the operator used to hand-compile after
 * every dispatch (per-session FLEET:DONE summary + per-area stats + run
 * totals). Pure and locale-independent on purpose: this is an artefact meant to
 * be pasted into a ledger / PR / handoff note, not a UI surface, so it stays in
 * English technical register rather than going through i18n.
 */

const n = (v: bigint | number): number => Number(v);

/** Compact token count: 1_234_567 → "1.2M", 12_300 → "12.3k". */
export function formatTokens(value: bigint | number): string {
  const v = n(value);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

const OUTCOME: Record<string, string> = {
  finished: 'delivered',
  exited: 'exited',
  hibernated: 'asleep',
  stale: 'stalled',
  awaiting_input: 'needs you',
  running: 'working',
  spawning: 'starting',
  idle: 'idle',
};

export function outcomeToken(state: string): string {
  return OUTCOME[state] ?? state;
}

export function buildRunMarkdown(report: FleetRunReport): string {
  const { totals } = report;
  const title = report.runLabel ?? `Fleet run ${report.runId.slice(0, 8)}`;
  const started = report.startedAtMs ? new Date(n(report.startedAtMs)).toLocaleString() : '—';

  const lines: string[] = [
    `# ${title}`,
    '',
    `- Started: ${started}`,
    `- Delivered: ${totals.finishedCount}/${totals.sessionCount}` +
      (totals.activeCount > 0 ? ` (${totals.activeCount} still live)` : '') +
      (totals.exitedCount > 0 ? ` · ${totals.exitedCount} exited` : ''),
    `- Files touched: ${totals.filesTouched}`,
    `- Tokens: ${formatTokens(totals.tokens.input)} in / ${formatTokens(totals.tokens.output)} out` +
      ` · ${formatTokens(totals.tokens.cacheRead)} cache-read`,
    '',
    '## Sessions',
    '',
  ];

  if (report.sessions.length === 0) {
    lines.push('_No sessions in this run._');
    return lines.join('\n');
  }

  for (const s of report.sessions) {
    lines.push(`### ${s.label} — ${outcomeToken(s.state)}`);
    if (s.summary) lines.push('', s.summary);
    lines.push(
      '',
      `- Project: ${s.projectLabel}`,
      `- Files: ${s.filesTouched} · turns: ${s.assistantMessages} · tokens: ` +
        `${formatTokens(s.tokens.input)} in / ${formatTokens(s.tokens.output)} out`,
      '',
    );
  }
  return lines.join('\n').trimEnd();
}
