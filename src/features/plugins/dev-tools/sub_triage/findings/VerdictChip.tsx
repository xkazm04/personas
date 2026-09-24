// Verdict chip (Phase 3A): did shipping this move the number? A verdict is a
// status (how the shipped work went), so each one speaks a status tone.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { TONE_CHIP, type TriageTone } from '../triageTones';

const VERDICT_META: Record<string, { label: string; tone: TriageTone; title: string }> = {
  cleared: {
    label: 'Cleared',
    tone: 'success',
    title: 'The sensor no longer reports this signal: it is gone.',
  },
  moved: {
    label: 'Moved',
    tone: 'info',
    title: 'The signal is still there, but the number improved materially.',
  },
  // Deliberately NOT quiet. A shipped fix that changed nothing is the single most
  // useful thing this loop can tell you, and the easiest to hide.
  unchanged: {
    label: 'Unchanged',
    tone: 'warning',
    title: 'Shipped, but the number did not move. Merged is not fixed.',
  },
  regressed: {
    label: 'Regressed',
    tone: 'error',
    title: 'Shipped, and the number got WORSE.',
  },
};

/** Renders nothing for `pending`/null: a finding that hasn't shipped makes no claim. */
export function VerdictChip({ verifyState }: { verifyState: string | null | undefined }) {
  if (!verifyState || verifyState === 'pending') return null;
  const meta = VERDICT_META[verifyState];
  if (!meta) return null;
  return (
    <Tooltip content={meta.title}>
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 typo-data ${TONE_CHIP[meta.tone]}`}>
        {meta.label}
      </span>
    </Tooltip>
  );
}
