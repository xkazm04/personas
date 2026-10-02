import { useTranslation } from '@/i18n/useTranslation';
import { Dot, type Glyph, type Tone } from '@/features/shared/components/kit';
import type { ReadinessSlot, ReadinessStatus, TwinBlueprintModel } from '../../blueprintContract';
import Write from './draw/Write';

const SLOTS: readonly ReadinessSlot[] = ['identity', 'tone', 'channels', 'memories'];

/** The twin status vocabulary's roles and shapes, as kit glyphs. */
const SLOT_DOT: Record<ReadinessStatus, { tone: Tone; glyph: Glyph }> = {
  set: { tone: 'success', glyph: 'solid' },
  partial: { tone: 'warning', glyph: 'soft' },
  empty: { tone: 'neutral', glyph: 'hollow' },
};

/**
 * The four readiness slots in the app's own vocabulary: the kit's status dot
 * in the twin status roles (set success filled, partial warning, empty
 * neutral hollow; `shared/twinStatus.ts`). Each slot is a container: its dot
 * rises, then its name is written.
 */
export default function ReadinessSlots({
  slots,
  large = false,
}: {
  slots: TwinBlueprintModel['readiness']['slots'];
  large?: boolean;
}) {
  const { t } = useTranslation();
  const label: Record<ReadinessSlot, string> = {
    identity: t.twin.slots.identity,
    tone: t.twin.slots.tone,
    channels: t.twin.blueprint.metrics.channels,
    memories: t.twin.slots.memories,
  };
  return (
    <ul className={`grid w-fit grid-cols-2 ${large ? 'gap-x-10 gap-y-3' : 'gap-x-4 gap-y-1'}`}>
      {SLOTS.map((s) => (
        <li key={s} className="flex min-w-0 items-center gap-2" data-slot={s} data-status={slots[s]} data-draw-scope="">
          <span aria-hidden data-draw="rise" className="inline-flex shrink-0">
            <Dot {...SLOT_DOT[slots[s]]} />
          </span>
          <Write
            text={label[s]}
            className={`min-w-0 truncate ${large ? 'typo-body text-foreground' : 'typo-label'}`}
            style={large ? undefined : { color: 'var(--ink-strong)' }}
          />
        </li>
      ))}
    </ul>
  );
}
