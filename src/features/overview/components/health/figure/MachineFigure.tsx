/**
 * Layer 1 of System Check, as a FIGURE (kit batch home-3, builder FG; doctrine 6c).
 *
 * The frame is the kit's (`Figure`): the reading line, the declared height, the ghost and empty
 * band in the figure's own geometry, the announcement, the `--fig-*` ink, and the flat callout rail
 * that carries the six environment names at full type size. The drawing inside it is free
 * (`MachineDraw`). This file is the seam - it turns the board into piers and into callouts, and it
 * owns nothing else.
 *
 * **The callout is the control.** Strata's split exactly: the drawing is `aria-hidden` and the flat
 * thing beside it is the pointer target, except that here the target is the one that carries the
 * accessible name, because pressing an environment does something - it filters the list under the
 * figure, which is the behaviour the fusion's card board had and 2c says to keep. The kit's rail
 * stretches each callout's hit area up over its own column of the drawing, so the pier is the
 * target and the name is what is announced: one control, one announcement.
 *
 * **No motion.** Deliberate, and from the constraint rather than from laziness: `Figure` sits in a
 * `KitHost`, whose reduced-motion block kills every animation inside it, so an entrance written as
 * a keyframe would have to land at a settled state when it is removed. Everything here that changes
 * - the selected wash - is a transition, which the same block shortens to 1ms. Reduced motion and
 * "already settled" are therefore the same code path, with nothing to get wrong.
 */
import { useMemo } from 'react';

import { Figure, type FigureCallout } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { sectionLabel, statusWord, tally, worstStatus, type HealthSectionId } from '../healthModel';
import type { HealthBoard } from '../useHealthSections';
import { MachineDraw } from './MachineDraw';
import { piers as buildPiers } from './machineModel';
import './machine.css';

/**
 * The drawing band plus the kit rail, which the drawing insets itself by (`--fig-rail`). 250 was
 * the first try and it left a 1340 x 188 strip: at that aspect a support is wider than it is tall
 * whatever the view box says, and the figure read as a bar chart. 320 gives the drawing about
 * 258px, which is where a pier is finally taller than it is wide at both 1440 and 1920.
 */
const FIGURE_H = 320;

export function MachineFigure({ board, selected, onSelect }: {
  board: HealthBoard;
  selected: HealthSectionId | null;
  onSelect: (id: HealthSectionId) => void;
}) {
  const { t, tx } = useTranslation();
  const s = t.system_health;
  const piers = useMemo(() => buildPiers(board.sections), [board.sections]);
  const counts = tally(board.items);

  // The figure's text equivalent: what a reader is owed instead of the silhouette.
  const desc = [
    tx(s.figure_desc, { ok: counts.ok, total: counts.total, sections: piers.length }),
    counts.attention > 0 ? tx(s.attention_count, { count: counts.attention }) : '',
  ].filter(Boolean).join(' ');

  const callouts = useMemo<FigureCallout[]>(() => piers.map((p) => {
    const sec = board.sections.find((x) => x.id === p.id)!;
    const name = sectionLabel(t, p.id);
    const status = sec.failed ? s.section_unavailable : statusWord(t, worstStatus(sec.items));
    const idle = p.loading || p.failed || p.total === 0;
    return {
      id: p.id,
      label: name,
      // Not measured is never drawn as a zero (strata's rule); "-" is the placeholder app copy uses.
      figure: idle ? '-' : `${p.ok}/${p.total}`,
      name: tx(s.pier_label, { section: name, status, ok: p.ok, total: p.total }),
      pressed: selected === p.id,
      disabled: idle,
      onPress: () => onSelect(p.id),
      testId: `health-pier-${p.id}`,
    };
  }), [piers, board.sections, selected, onSelect, t, tx, s]);

  return (
    <Figure
      label={s.figure_label}
      desc={board.settled ? desc : undefined}
      height={FIGURE_H}
      callouts={callouts}
      testId="health-machine-figure"
    >
      <MachineDraw piers={piers} />
    </Figure>
  );
}
