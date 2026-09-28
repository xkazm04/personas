import { useTranslation } from '@/i18n/useTranslation';
import { ListRow } from '@/features/shared/components/kit';
import { launchPowerMove } from './launchPowerMove';
import { usePowerMovesStore } from './powerMovesStore';
import type { PowerMove } from './registry';

/**
 * One quest row: the move's name is the row's one button (kit ListRow `onPress`), and a press
 * anywhere on the row deep links into the real surface and flashes the landing anchor. A success
 * Mark sits on the spine once the move has been used. The separate "Try it" button went with the
 * pressable row (doctrine rule 3): the row's hover band, pointer and focus ring say it launches.
 */
export function PowerMoveRow({ move }: { move: PowerMove }) {
  const { t } = useTranslation();
  const ht = t.home.learning;
  const used = usePowerMovesStore((s) => Boolean(s.done[move.id] || s.tried[move.id]));

  return (
    <ListRow
      size="s"
      name={<span data-testid={`power-move-${move.id}`}>{ht[move.titleKey]}</span>}
      mark={used ? { tone: 'success', glyph: 'solid', label: ht.used_badge } : undefined}
      onPress={() => launchPowerMove(move)}
    />
  );
}
