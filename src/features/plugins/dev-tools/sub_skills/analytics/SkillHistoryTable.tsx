// Skill history — the unified run log (Fleet skill dispatches + legacy Idea
// Scanner rows). Generalized from the scanner's ScanHistoryTable.
//
// The log is windowed: only the first PAGE_SIZE rows render (progressively
// revealed), and "load more" appends another page — so DOM cost stays flat
// as skill use grows while the header still reports the full count.
import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useProgressiveReveal } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';

import { SCAN_AGENTS } from '../../constants/scanAgents';
import { presetVisual } from '../../constants/presetSkills';
import type { SkillRunRow } from './useSkillsAnalytics';

const GRID = 'grid grid-cols-[minmax(0,1.6fr)_5.5rem_4rem_6rem_4.5rem_5rem_2.5rem] items-center gap-3';

function formatTokens(input: number | null, output: number | null): string {
  if (input == null && output == null) return '—';
  const total = (input ?? 0) + (output ?? 0);
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`;
  return String(total);
}

function formatDuration(row: SkillRunRow): string {
  if (row.endedAt == null) return '—';
  const ms = row.endedAt - row.startedAt;
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** Rows rendered per page — "load more" appends another page. */
const PAGE_SIZE = 50;

/** Column-header cell — module-scoped so headers don't remount per render. */
function H({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <span className={`text-[10.5px] uppercase tracking-[0.12em] text-foreground/40 ${right ? 'text-right' : ''}`}>{children}</span>
  );
}

const STATUS_TONE: Record<string, string> = {
  finished: 'text-status-success', complete: 'text-status-success', completed: 'text-status-success',
  running: 'text-status-info', spawning: 'text-status-info', awaiting_input: 'text-status-warning',
  error: 'text-status-error', failed: 'text-status-error', exited: 'text-foreground/60',
};

/** Skill cell: preset icon chip / legacy emoji strip + name. Fleet-run names
 *  open the info modal; legacy scan rows carry a CSV of agent keys, not a
 *  single skill, so they stay static. */
function SkillCell({ row, onOpenInfo }: { row: SkillRunRow; onOpenInfo: (skill: string) => void }) {
  if (row.kind === 'scan') {
    const keys = row.skill.split(',').map((s) => s.trim()).filter(Boolean);
    const emojis = keys
      .map((k) => SCAN_AGENTS.find((a) => a.key === k)?.emoji)
      .filter(Boolean)
      .slice(0, 4);
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="flex-shrink-0">{emojis.join(' ') || '💡'}</span>
        <span className="typo-caption text-foreground/70 truncate">{keys.length > 1 ? `${keys.length}×` : keys[0]}</span>
      </span>
    );
  }
  const visual = presetVisual(row.skill);
  return (
    <span className="flex items-center gap-2 min-w-0">
      {visual && (
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-interactive border flex-shrink-0"
          style={{ color: visual.color, borderColor: `${visual.color}40`, backgroundColor: `${visual.color}14` }}
        >
          <visual.icon className="w-3 h-3" aria-hidden strokeWidth={1.75} />
        </span>
      )}
      <span className="min-w-0">
        <button type="button" onClick={() => onOpenInfo(row.skill)} className="typo-caption font-medium text-foreground truncate block text-left hover:text-primary transition-colors" data-testid={`skill-history-name-${row.skill}`}>{row.skill}</button>
        {row.args && <span className="typo-label text-foreground/45 truncate block">{row.args}</span>}
      </span>
    </span>
  );
}

export function SkillHistoryTable({ runs, onRerun, onOpenInfo }: {
  runs: SkillRunRow[];
  /** Re-dispatch a fleet skill run (skill, args). Omitted while busy. */
  onRerun?: (skill: string, args: string) => void;
  onOpenInfo: (skill: string) => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const statusLabel = (s: string): string => {
    const key = `skills_run_status_${s}` as keyof typeof d;
    const v = d[key];
    return typeof v === 'string' ? v : s;
  };

  // Windowed page of the (potentially long) run log — DOM stays bounded while
  // the header count reports the full history.
  const [limit, setLimit] = useState(PAGE_SIZE);
  const visible = useMemo(() => runs.slice(0, limit), [runs, limit]);

  // Reveal the visible page across a short window instead of mounting all at
  // once (loading-pattern v2 §3); "load more" growth is chased and animated.
  const reveal = useProgressiveReveal(visible.length, { initialCount: 12 });
  const shown = useMemo(() => visible.slice(0, reveal.count), [visible, reveal.count]);

  return (
    <section className="rounded-card border border-primary/12 bg-secondary/[0.12]" data-testid="skill-history">
      <div className="flex items-baseline gap-2 px-3 py-2 bg-primary/[0.04] border-b border-primary/10 rounded-t-card">
        <span className="typo-body font-semibold text-foreground">{d.skills_history_title}</span>
        <span className="typo-label text-foreground/40 tabular-nums">{runs.length}</span>
      </div>
      <div className={`${GRID} px-3 py-1.5 border-b border-primary/10`}>
        <H>{d.skills_history_col_skill}</H>
        <H>{d.skills_history_col_status}</H>
        <H right>{d.skills_history_col_output}</H>
        <H right>{d.skills_history_col_tokens}</H>
        <H right>{d.skills_history_col_duration}</H>
        <H right>{d.skills_history_col_when}</H>
        <span />
      </div>
      <div className="max-h-80 overflow-y-auto px-3">
        {runs.length === 0 && (
          <p className="typo-caption text-foreground/45 py-8 text-center">{d.skills_history_empty}</p>
        )}
        <ul>
          {shown.map((row) => (
            <li key={`${row.kind}-${row.id}`} className={`${GRID} py-2 border-b border-foreground/[0.08] last:border-b-0`}>
              <SkillCell row={row} onOpenInfo={onOpenInfo} />
              <span
                className={`typo-label truncate ${STATUS_TONE[row.status] ?? 'text-foreground/60'}`}
                title={row.statusReason ?? undefined}
              >
                {statusLabel(row.status)}
              </span>
              <span className="typo-caption text-foreground/70 tabular-nums text-right">
                {row.ideaCount != null ? row.ideaCount : '—'}
              </span>
              <span className="typo-caption text-foreground/70 tabular-nums text-right">
                {formatTokens(row.inputTokens, row.outputTokens)}
              </span>
              <span className="typo-caption text-foreground/70 tabular-nums text-right">{formatDuration(row)}</span>
              <span className="typo-caption text-foreground/70 text-right">
                <RelativeTime timestamp={new Date(row.startedAt).toISOString()} />
              </span>
              <span className="flex justify-end">
                {row.kind === 'fleet' && onRerun && (
                  <button
                    type="button"
                    onClick={() => onRerun(row.skill, row.args)}
                    title={d.skills_history_rerun}
                    aria-label={d.skills_history_rerun}
                    className="p-1 rounded-interactive text-primary hover:bg-primary/10 border border-primary/20 transition-colors"
                    data-testid={`skill-history-rerun-${row.skill}`}
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {runs.length > limit && (
          <div className="py-2 flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
              data-testid="skill-history-load-more"
            >
              {/* Deliberate reuse: dev_runner.load_more IS this string ("Load
                  more"), same `plugins` section chunk — a dedicated duplicate
                  key would add 14 locale rows for identical copy. */}
              {t.plugins.dev_runner.load_more}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
