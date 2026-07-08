/**
 * Small presentational atoms shared by the Overview directional variants
 * (Briefing, Console). Tone maps + a calm static health dot + a relative-time
 * formatter + the cross-tab activity glyph map — no always-on motion, so the
 * variants stay quiet at idle.
 */
import type { LucideIcon } from 'lucide-react';
import { ScanSearch, Sparkles, CheckCircle2, XCircle, Target } from 'lucide-react';
import type { OverviewTone } from './overviewViewModel';
import type { ActivityKind } from './overviewHelpers';

export const TONE_TEXT: Record<OverviewTone, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  info: 'text-status-info',
  neutral: 'text-foreground',
};

export const TONE_BG: Record<OverviewTone, string> = {
  success: 'bg-status-success/10 border-status-success/25',
  warning: 'bg-status-warning/10 border-status-warning/25',
  error: 'bg-status-error/10 border-status-error/25',
  info: 'bg-status-info/10 border-status-info/25',
  neutral: 'bg-card/40 border-primary/10',
};

export const TONE_DOT: Record<OverviewTone, string> = {
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  info: 'bg-status-info',
  neutral: 'bg-status-neutral',
};

/** A quiet health dot — solid core with a soft glow halo, no infinite pulse. */
export function HealthDot({ tone, size = 10 }: { tone: OverviewTone; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden
        className={`absolute inset-0 rounded-full ${TONE_DOT[tone]} opacity-40`}
        style={{ filter: 'blur(3px)' }}
      />
      <span className={`relative rounded-full ${TONE_DOT[tone]}`} style={{ width: size, height: size }} />
    </span>
  );
}

/** Icon + tint for each cross-tab activity kind. */
export const ACTIVITY_META: Record<ActivityKind, { icon: LucideIcon; tint: string }> = {
  scan_run: { icon: ScanSearch, tint: 'text-amber-400' },
  task_created: { icon: Sparkles, tint: 'text-blue-400' },
  task_completed: { icon: CheckCircle2, tint: 'text-emerald-400' },
  task_failed: { icon: XCircle, tint: 'text-red-400' },
  goal_signal: { icon: Target, tint: 'text-violet-400' },
};

/** Compact "2h ago" formatter (absolute source stays in the raw ISO). */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  return `${w}w ago`;
}
