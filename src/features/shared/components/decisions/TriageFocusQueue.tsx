/** @catalog TriageFocus part: the optional 330px queue rail, built from the kit Rows/ListRow. */
// TriageFocusQueue — the optional 330px rail of everything still waiting.
//
// OPTIONAL, and the default is OFF. The Monitor's docked rail is
// `RAIL_DEFAULT_WIDTH = 320`px (min 280) and this sidebar ALONE is 330, so a
// surface that small cannot carry it — and does not need to, because the dock's
// own tab list already IS the queue. Overview, which owns a whole page, passes
// `queueSidebar` and gets the donor's experience unchanged. One component, two
// honest densities.
//
// The donor hand-rolled this as a `<button>` per row with its own severity dot,
// its own two-line stack and its own selected tint. All three are kit parts
// (`Rows` / `ListRow` / its spine `mark`), so the rail is composed rather than
// drawn: one tab stop per row, the kit's selected segment, its alternating
// band, and a tone that comes from the item's own vocabulary instead of a
// `bg-red-400` literal.
import { useMemo } from 'react';

import { KitHost, ListRow, Rows } from '@/features/shared/components/kit';
import type { Tone } from '@/features/shared/components/kit/types';
import { useTranslation } from '@/i18n/useTranslation';
import type { TriageItem, TriageTone } from '@/features/shared/triage/triageFocusBridge';

import type { TriagePersonaAccent } from './useTriageFocus';

/** The item vocabulary's tone, in the kit's words. One map, no hues. */
const KIT_TONE: Record<TriageTone, Tone> = {
  neutral: 'neutral',
  accent: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

/** The loudest tone any of the item's tags carries — the row's spine mark. */
function rowTone(item: TriageItem): { tone: Tone; label: string } {
  const rank: TriageTone[] = ['danger', 'warning', 'accent', 'success', 'neutral'];
  for (const tone of rank) {
    const tag = item.tags.find((x) => x.tone === tone);
    if (tag) return { tone: KIT_TONE[tone], label: tag.label };
  }
  return { tone: 'neutral', label: item.source.label };
}

export function TriageFocusQueue({
  items,
  index,
  onSelect,
  personaAccent,
}: {
  items: readonly TriageItem[];
  index: number;
  onSelect: (index: number) => void;
  /** Ink for each row's persona line. See {@link TriagePersonaAccent}. */
  personaAccent?: TriagePersonaAccent;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  // `meta` is a ReactNode, so the accent rides as a span INSIDE the kit's own
  // `k-row__meta` rather than as a class on it: the row keeps the kit's type
  // and density and only the ink is the caller's. The donor tinted the same
  // line in its own rail, and a tint that appeared on the card but not in the
  // queue beside it would read as two different personas.
  const rows = useMemo(
    () => items.map((item) => {
      const accent = personaAccent?.(item);
      return {
        item,
        mark: rowTone(item),
        meta: accent
          ? <span className={accent.className} style={accent.style}>{item.source.label}</span>
          : item.source.label,
      };
    }),
    [items, personaAccent],
  );

  return (
    <aside
      aria-label={m.triage_focus_queue_region}
      className="flex w-[330px] flex-shrink-0 flex-col border-r border-primary/10 bg-secondary/20"
      data-testid="triage-focus-queue"
    >
      <div className="flex items-center justify-between border-b border-primary/10 px-3 py-2.5">
        <span className="typo-label text-foreground">{m.triage_focus_queue}</span>
        <span className="typo-caption">{items.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <KitHost>
          <Rows count={rows.length} empty={{ title: m.triage_focus_empty_title }}>
            {rows.map(({ item, mark, meta }, i) => (
              <ListRow
                key={item.id}
                name={item.title}
                meta={meta}
                mark={mark}
                state={i === index ? 'selected' : 'default'}
                onPress={() => onSelect(i)}
                testId={`triage-focus-queue-row-${i}`}
              />
            ))}
          </Rows>
        </KitHost>
      </div>
    </aside>
  );
}
