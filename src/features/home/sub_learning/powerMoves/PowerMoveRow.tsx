import { useTranslation } from '@/i18n/useTranslation';
import { KitButton, ListRow } from '@/features/shared/components/kit';
import { launchPowerMove } from './launchPowerMove';
import { usePowerMovesStore } from './powerMovesStore';
import type { PowerMove } from './registry';

/**
 * One quest row: the move's name, a success Mark on the spine once it has been
 * used, and a "Try it" button that deep links into the real surface and flashes
 * the landing anchor. The button is always shown: it is the row's one control.
 */
export function PowerMoveRow({ move }: { move: PowerMove }) {
  const { t } = useTranslation();
  const ht = t.home.learning;
  const used = usePowerMovesStore((s) => Boolean(s.done[move.id] || s.tried[move.id]));

  return (
    <ListRow
      size="s"
      name={ht[move.titleKey]}
      mark={used ? { tone: 'success', glyph: 'solid', label: ht.used_badge } : undefined}
      figures={
        <KitButton quiet testId={`power-move-${move.id}`} onClick={() => launchPowerMove(move)}>
          {ht.try_it}
        </KitButton>
      }
    />
  );
}
