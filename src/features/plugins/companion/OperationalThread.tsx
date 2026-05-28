/**
 * OperationalThread — the inline "operational thread" rendered under an
 * assistant bubble. Shows Athena's live TodoWrite plan: what she's working
 * through, with each step's status (pending / in progress / completed)
 * updating in place. This is the surface that keeps the user informed during
 * a long or autonomous turn instead of leaving them staring at a single
 * silent bubble.
 *
 * Renders nothing when there are no steps, so it's safe to mount under every
 * bubble unconditionally.
 */

import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TodoStep } from './operationalSteps';

function StepIcon({ status }: { status: TodoStep['status'] }) {
  if (status === 'completed') {
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  }
  if (status === 'in_progress') {
    return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />;
  }
  // Pending: an empty outline circle. Shape (not opacity) signals
  // "not started", so we keep full contrast per the typography rule.
  return <Circle className="w-3.5 h-3.5 text-foreground shrink-0" />;
}

export function OperationalThread({ steps }: { steps: TodoStep[] }) {
  const { t } = useTranslation();
  if (!steps || steps.length === 0) return null;

  const c = t.plugins.companion;
  const completed = steps.filter((s) => s.status === 'completed').length;

  const statusLabel = (status: TodoStep['status']): string =>
    status === 'completed'
      ? c.ops_status_completed
      : status === 'in_progress'
        ? c.ops_status_in_progress
        : c.ops_status_pending;

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.04] px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="typo-caption uppercase tracking-wide text-foreground">
          {c.ops_thread_label}
        </span>
        <span className="typo-caption tabular-nums text-foreground">
          {completed}/{steps.length}
        </span>
      </div>
      <div className="h-1 rounded-full bg-foreground/[0.08] overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/70 transition-all duration-500"
          style={{ width: `${(completed / steps.length) * 100}%` }}
        />
      </div>
      <ul className="space-y-1">
        {steps.map((step, i) => (
          <li key={`${i}-${step.content}`} className="flex items-start gap-2">
            <span className="mt-0.5" title={statusLabel(step.status)}>
              <StepIcon status={step.status} />
            </span>
            <span
              className={
                step.status === 'completed'
                  ? 'typo-caption text-foreground line-through'
                  : 'typo-caption text-foreground'
              }
            >
              {step.status === 'in_progress'
                ? step.activeForm ?? step.content
                : step.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
