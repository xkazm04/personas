/**
 * Steer the draft that is already in the box: four chips, a directions field
 * and Regenerate. Shown only while a target is remembered (inserted / failed
 * after a pick), because a regenerate needs a box to write into and the lane
 * forgets the box on navigation.
 *
 * Inline row, no popover — see `TwinStatusRow.tsx` for why. Chip markup and
 * tint follow the Reply Outbox's quick-steer chips (`ReplyOutbox.tsx`) so the
 * twin steers the same way everywhere.
 */
import { RefreshCw } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinSteer } from '@/lib/bindings/TwinSteer';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import type { TwinDraftSnapshot } from '../twinDraftLane';

/** Chip id → the `browser.twin` key that labels it. */
const CHIPS: ReadonlyArray<{ steer: TwinSteer; key: 'chip_shorter' | 'chip_warmer' | 'chip_formal' | 'chip_question' }> = [
  { steer: 'shorter', key: 'chip_shorter' },
  { steer: 'warmer', key: 'chip_warmer' },
  { steer: 'formal', key: 'chip_formal' },
  { steer: 'question', key: 'chip_question' },
];

interface TwinSteerRowProps {
  lane: TwinDraftSnapshot;
  onSteer: (steer: TwinSteer | null) => void;
  onDirections: (directions: string) => void;
  onRegenerate: () => Promise<void>;
}

export default function TwinSteerRow({ lane, onSteer, onDirections, onRegenerate }: TwinSteerRowProps) {
  const { t } = useTranslation();
  const v = t.browser.twin;

  if (!lane.target) return null;
  const busy = lane.phase === 'drafting';

  return (
    <div
      className="flex items-center gap-2 flex-wrap px-3 min-w-0"
      data-testid="webview-twin-steer"
    >
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={v.steer_label}>
        {CHIPS.map(({ steer, key }) => {
          const active = lane.steer === steer;
          return (
            <button
              key={steer}
              type="button"
              aria-pressed={active}
              disabled={busy}
              onClick={() => onSteer(active ? null : steer)}
              className={`px-2 py-1 rounded-full border typo-caption transition-colors focus-ring disabled:is-disabled ${
                active
                  ? 'border-violet-500/40 bg-violet-500/15 text-violet-300'
                  : 'border-primary/15 bg-secondary/30 text-foreground hover:border-violet-500/30 hover:text-violet-300'
              }`}
            >
              {v[key]}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={lane.directions}
        disabled={busy}
        onChange={(event) => onDirections(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !busy) {
            event.preventDefault();
            void onRegenerate();
          }
        }}
        placeholder={v.directions_placeholder}
        aria-label={v.directions_placeholder}
        className={`${INPUT_FIELD} flex-1 min-w-[200px]`}
        data-testid="webview-twin-directions"
      />
      <AsyncButton
        size="xs"
        variant="secondary"
        icon={<RefreshCw className="w-3.5 h-3.5" />}
        isLoading={busy}
        onClick={onRegenerate}
        data-testid="webview-twin-regenerate"
      >
        {v.regenerate}
      </AsyncButton>
    </div>
  );
}
