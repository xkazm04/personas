// The chips the queue row, the preview and the round-table header all wear.
// One component, so a subject's state never reads differently in two places.
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { useTranslation } from '@/i18n/useTranslation';

const TONE: Record<string, string> = {
  ready: 'border-status-pending/55 text-status-pending',
  machine_pass: 'border-status-info/50 text-status-info',
  approved: 'border-status-success/50 text-status-success',
  approved_drifted: 'border-status-success/40 text-status-success',
  rejected: 'border-status-error/50 text-status-error',
  fail: 'border-status-error/40 text-status-error',
  incomplete: 'border-status-warning/45 text-status-warning',
  stalled: 'border-muted-dark/50 text-muted',
  none: 'border-border text-muted',
};

/** The state word, with its own dot, never colour alone. */
export function StateChip({ state }: { state: string }) {
  const { t } = useTranslation();
  const words = t.council.state;
  const label =
    state === 'ready'
      ? words.ready
      : state === 'machine_pass'
        ? words.machine_pass
        : state === 'approved'
          ? words.approved
          : state === 'approved_drifted'
            ? words.approved_drifted
            : state === 'rejected'
              ? words.rejected
              : state === 'fail'
                ? words.fail
                : state === 'incomplete'
                  ? words.incomplete
                  : state === 'stalled'
                    ? words.stalled
                    : words.none;
  return (
    <span
      data-testid="council-state-chip"
      className={`inline-flex items-center gap-2 rounded-pill border px-2.5 py-1 typo-body ${
        TONE[state] ?? TONE.none
      }`}
    >
      <i aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/** A neutral fact about the subject: its project, its tier, its star count. */
export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-pill border border-border bg-secondary/[0.05] px-2.5 py-1 typo-body text-foreground">
      {children}
    </span>
  );
}

/** "major feature" / "standard feature" / "architecture redesign". */
export function kindWord(
  subject: Pick<CouncilSubjectState, 'kind' | 'tier'>,
  bench: { tier_major: string; tier_standard: string; kind_architecture: string },
): string {
  if (subject.kind === 'architecture') return bench.kind_architecture;
  return subject.tier === 'major' ? bench.tier_major : bench.tier_standard;
}
