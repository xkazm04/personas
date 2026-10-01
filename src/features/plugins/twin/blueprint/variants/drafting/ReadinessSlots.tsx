import { useTranslation } from '@/i18n/useTranslation';
import type { ReadinessSlot, ReadinessStatus, TwinBlueprintModel } from '../../blueprintContract';
import DrawFrame from './draw/DrawFrame';
import Write from './draw/Write';

const SLOTS: readonly ReadinessSlot[] = ['identity', 'tone', 'channels', 'memories'];

/**
 * The four readiness slots as drawing marks: a set slot is a solid square, a
 * partial one half inked over a hatch, an empty one a dashed outline. Each
 * slot is a frame and a container: its fill goes in, then its name.
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
          <SlotMark status={slots[s]} size={large ? 20 : 14} />
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

function SlotMark({ status, size }: { status: ReadinessStatus; size: number }) {
  return (
    <span aria-hidden className="relative block shrink-0" style={{ width: size, height: size, border: '1.5px solid transparent' }}>
      <DrawFrame stroke={status === 'empty' ? 'var(--ink-dim)' : 'var(--ink)'} width={1.5} edge={1.5} dash={status === 'empty' ? '3 2' : undefined} />
      {status === 'set' && <span data-draw="sweep" className="absolute inset-0" style={{ background: 'var(--ink)' }} />}
      {status === 'partial' && (
        <>
          <span data-draw="sweep" className="twd-hatch absolute inset-0" />
          <span data-draw="extend" className="absolute inset-y-0 left-0 w-1/2" style={{ background: 'var(--ink)' }} />
        </>
      )}
    </span>
  );
}
