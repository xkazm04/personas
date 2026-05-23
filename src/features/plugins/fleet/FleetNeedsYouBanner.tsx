import { Hourglass } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSession } from '@/lib/bindings/FleetSession';

/**
 * Attention banner — the desktop precursor to the "something needs a human"
 * push alert in the mobile companion. Renders only when one or more sessions
 * are `awaiting_input`, listing each as a click-to-focus chip so the operator
 * can jump straight to the terminal that's blocked on them.
 *
 * Pure presentation: the awaiting subset + jump handler are supplied by the
 * grid page, which owns the session store read and active-session setter.
 */
interface FleetNeedsYouBannerProps {
  /** Sessions currently in the `awaiting_input` state. */
  waiting: FleetSession[];
  /** Focus a session by id (mounts its terminal pane). */
  onJump: (id: string) => void;
}

export function FleetNeedsYouBanner({ waiting, onJump }: FleetNeedsYouBannerProps) {
  const { t, tx } = useTranslation();
  if (waiting.length === 0) return null;

  const label =
    waiting.length === 1
      ? tx(t.plugins.fleet.needs_input_one, { count: waiting.length })
      : tx(t.plugins.fleet.needs_input_other, { count: waiting.length });

  return (
    <div
      role="region"
      aria-label={t.plugins.fleet.needs_you_aria}
      data-testid="fleet-needs-you"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-violet-400/30 bg-violet-400/10 px-3 py-2"
    >
      <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-violet-400 opacity-60 animate-ping" />
        <span className="relative h-2 w-2 rounded-full bg-violet-400" />
      </span>
      <Hourglass className="w-3.5 h-3.5 text-violet-300 shrink-0" aria-hidden="true" />
      <span className="typo-caption font-semibold text-violet-200 mr-1">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {waiting.map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid={`fleet-needs-you-chip-${s.id}`}
            onClick={() => onJump(s.id)}
            title={t.plugins.fleet.jump_to_session}
            className="rounded-interactive border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-[11px] text-violet-100 transition-colors hover:bg-violet-400/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400/60"
          >
            {s.name ?? s.projectLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
