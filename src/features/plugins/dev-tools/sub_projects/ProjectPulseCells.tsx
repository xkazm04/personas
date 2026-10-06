import { AlertCircle, CheckCircle2, CircleDashed, HelpCircle } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { ProjectPulse } from './useProjectPulse';

/* ----------------------------------------------------------------------------
 * The two cells that turn the Projects wall from a directory into a portfolio
 * face. Both obey one rule (`nullable-never-zero`): an UNMEASURED project — one
 * that has never had a finding raised, or whose measurement has not landed yet
 * — renders an em dash and says "unwatched", never `0` and never "healthy".
 * A quiet project may simply be one nobody is looking at.
 *
 * Neither cell navigates. The row's own click already makes the project active,
 * which is what the (project-scoped) backlog reads; a second destination from
 * inside a table cell would be a cross-surface jump this context does not own.
 * -------------------------------------------------------------------------- */

/** Findings still waiting for triage. Null = never measured. */
export function AttentionCell({ pulse }: { pulse: ProjectPulse | undefined }) {
  const { t, tx } = useTranslation();
  const k = t.plugins.dev_projects;

  if (!pulse || pulse.attention === null) {
    return (
      <Tooltip content={k.attention_unwatched} placement="top">
        <span
          className="inline-flex items-center gap-1.5 typo-caption text-foreground opacity-40"
          data-testid="project-attention-unknown"
          aria-label={k.attention_unwatched}
        >
          {/* The icon alone. An em dash beside it restated "nothing measured"
              a second time, in a 96px column, and the Tooltip plus aria-label
              already carry the meaning for anyone who needs the words. */}
          <HelpCircle className="w-3.5 h-3.5" />
        </span>
      </Tooltip>
    );
  }

  if (pulse.attention === 0) {
    return (
      <Tooltip content={k.attention_clear} placement="top">
        <span
          className="inline-flex items-center gap-1.5 typo-caption text-foreground opacity-60"
          data-testid="project-attention-clear"
          aria-label={k.attention_clear}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span className="tabular-nums">0</span>
        </span>
      </Tooltip>
    );
  }

  const label = tx(
    pulse.truncated ? k.attention_at_least : k.attention_open_findings,
    { count: pulse.attention },
  );
  return (
    <Tooltip content={label} placement="top">
      <span
        className="inline-flex items-center gap-1.5 typo-caption text-amber-400"
        data-testid="project-attention-count"
        aria-label={label}
      >
        <AlertCircle className="w-3.5 h-3.5" />
        <span className="tabular-nums">
          {pulse.truncated ? `${pulse.attention}+` : pulse.attention}
        </span>
      </span>
    </Tooltip>
  );
}

/** How long since anything was raised for this project. Null = never. */
export function PulseCell({ pulse }: { pulse: ProjectPulse | undefined }) {
  const { t } = useTranslation();
  const k = t.plugins.dev_projects;

  if (!pulse || pulse.lastSignalAt === null) {
    return (
      <Tooltip content={k.pulse_never_hint} placement="top">
        <span
          className="typo-caption text-foreground opacity-40"
          data-testid="project-pulse-never"
          aria-label={k.pulse_never_hint}
        >
          {/* A mark, not a sentence. Every unscanned row printed "Never
              scanned" in full, which is the longest string in the narrowest
              column and reads as an error rather than an absence. The dashed
              ring says "nothing here yet"; the words stay in the tooltip and
              the aria-label, so nothing is lost to a screen reader. */}
          <CircleDashed className="w-3.5 h-3.5" aria-hidden />
        </span>
      </Tooltip>
    );
  }

  return (
    <span data-testid="project-pulse-at">
      <RelativeTime
        timestamp={pulse.lastSignalAt}
        className="typo-caption text-foreground"
        format="elapsed"
      />
    </span>
  );
}
