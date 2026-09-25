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

/**
 * The five words the caption beside a state chip needs.
 *
 * Passed IN rather than read from `useTranslation` here, because this caption
 * renders on the Council page (`council` section), in the Features feature
 * tab and in the context ledger's feature popover (`plugins.dev_tools`
 * section, on a route that never loads `council`). A component that reached
 * for one section would render the key name on the other two surfaces.
 */
export interface TrustWords {
  uncalibrated: string;
  untrusted: string;
  trusted: string;
  unknown: string;
  /** "{percent} measured" */
  measured: string;
}

/**
 * WHAT THE STATE WORD DOES NOT SAY, in the same glance as the state word.
 *
 * `machine_pass` reads as a pass. On the real kp run it stood over an overall
 * of 0.63 - below the rubric's own 0.70 - and it was CORRECT, because that
 * threshold only binds once the instrument is `trusted`. The word and the
 * number are each right and together they overstate, so the trust state and
 * the coverage sit beside the chip on every surface that shows one: the
 * ledger popover row, the bench row, the Features feature tab header and the
 * round table header.
 *
 * The bench header's one "uncalibrated" sentence stays; this is its per-row
 * companion, not its replacement.
 */
export function VerdictCaption({
  trustState,
  coverage,
  words,
  percent,
  tx,
}: {
  trustState: string | null;
  coverage: number | null;
  words: TrustWords;
  percent: (ratio: number) => string;
  tx: (template: string, vars: Record<string, string | number>) => string;
}) {
  const trust =
    trustState === 'trusted'
      ? words.trusted
      : trustState === 'untrusted'
        ? words.untrusted
        : trustState === 'uncalibrated'
          ? words.uncalibrated
          : words.unknown;
  const parts = [trust];
  // Coverage is omitted rather than shown as 0%: "never measured" and
  // "measured nothing" are different facts and this caption exists to stop
  // exactly that kind of overstatement.
  if (coverage != null) parts.push(tx(words.measured, { percent: percent(coverage) }));
  return (
    <span data-testid="council-verdict-caption" className="typo-caption text-muted">
      {parts.join(' · ')}
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
