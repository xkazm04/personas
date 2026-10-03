import { useCallback, useMemo, useState } from 'react';

import { Drawer, KitButton, Section, Segmented, Surface, Toolbar } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import type { HealthActionDeps } from '../HealthActions';
import { HealthDetail } from '../HealthDetail';
import { HealthRows, rowKey, sortRowsBySeverity, type HealthRow } from '../HealthRows';
import { MachineFigure } from '../figure/MachineFigure';
import { needsAttention, sectionLabel, tally, type HealthSectionId } from '../healthModel';
import type { HealthBoard } from '../useHealthSections';

type View = 'attention' | 'all';

/** The list caps where home-2 put it; "Show all" expands in place. */
const ROW_CAP = 40;

/**
 * Prototype E, "Machine" (kit batch home-3, builder FG) - and the DEFAULT.
 *
 * It is the fusion with ONE thing changed: layer 1 stops being six cards and becomes a figure.
 * Everything else is deliberately identical - C's attention list under it, C's Segmented, the
 * environment filter, the drawer on a row, the install flows, the six independent load cycles. 2b
 * asked for the figure to replace the card board, not the list, and 2c asked for every behaviour to
 * survive, so the diff against `HealthFusionD` is exactly the board.
 *
 * **Why this is a figure and not a tidier board.** 6c's own test: ask what is lost if the thing is
 * replaced by a labelled list of the same numbers. The board loses nothing - it IS a labelled list
 * of the same numbers, laid out in a grid, which is why the owner read it as a spreadsheet. The
 * figure loses its whole point, because the point is not the six numbers: it is that they are
 * supports under ONE deck. A pier's girth is how much of the machine that environment is, its
 * courses are its individual checks, and the deck is the machine being ready. A failing check does
 * not tint a cell - it shortens its pier and breaks the span above it, so the state of the whole
 * machine is a silhouette you read before any colour, and "where is it weak" is answered by where
 * the line steps down. Six marks in a grid cannot say that, because a grid has no load path.
 *
 * **The other three prototypes and the fusion stay mounted** behind the dev switch (2d): the owner
 * compares, and the field this one was composed from must still be one keypress away.
 */
export function HealthMachineE({ board, deps }: { board: HealthBoard; deps: HealthActionDeps }) {
  const { t, tx } = useTranslation();
  const s = t.system_health;
  const [view, setView] = useState<View>('attention');
  const [filter, setFilter] = useState<HealthSectionId | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  const all = useMemo<HealthRow[]>(
    () => board.sections.flatMap((sec) => sec.items.map((item) => ({ sectionId: sec.id, item }))),
    [board.sections],
  );
  const scoped = useMemo(() => (filter ? all.filter((r) => r.sectionId === filter) : all), [all, filter]);
  const counts = useMemo(() => tally(scoped.map((r) => r.item)), [scoped]);
  const shown = useMemo(
    () => sortRowsBySeverity(view === 'attention' ? scoped.filter((r) => needsAttention(r.item)) : scoped),
    [scoped, view],
  );
  const selected = all.find((r) => rowKey(r) === picked) ?? null;

  const openRow = useCallback((row: HealthRow) => { setPicked(rowKey(row)); setDrawer(true); }, []);
  // A second press on the lit pier clears the filter, so the figure is a toggle and never a trap.
  const toggleFilter = useCallback((id: HealthSectionId) => {
    setFilter((cur) => (cur === id ? null : id));
  }, []);

  useAppKeyboard((e) => {
    if (e.key !== 'Escape') return false;
    if (drawer) { setDrawer(false); return true; }
    if (filter) { setFilter(null); return true; }
    return false;
  });

  return (
    <>
      <Surface>
        {/* The figure is inside a Section, not beside one: 6c is explicit that the exemption covers
            the drawing and not its furniture, so the head over it is the kit's. */}
        <Section level={1} title={s.machine_title} meta={s.machine_label}>
          <MachineFigure board={board} selected={filter} onSelect={toggleFilter} />
        </Section>

        <Section
          level={1}
          eyebrow={filter ? tx(s.filtered_to, { section: sectionLabel(t, filter) }) : undefined}
          title={view === 'attention' ? s.attention_title : s.all_checks}
          count={shown.length}
          actions={
            <Toolbar label={s.view_label}>
              {filter && (
                <KitButton tone="quiet" onClick={() => setFilter(null)}>{s.filter_all}</KitButton>
              )}
              <Segmented<View>
                label={s.view_label}
                value={view}
                onChange={setView}
                options={[
                  { v: 'attention', label: s.view_attention, count: counts.attention, tone: 'warning', glyph: 'solid' },
                  { v: 'all', label: s.view_all, count: counts.total, tone: 'neutral', glyph: 'soft' },
                ]}
              />
            </Toolbar>
          }
        >
          <HealthRows
            rows={shown}
            label={view === 'attention' ? s.attention_title : s.all_checks}
            // The environment is already named by the lit pier when the list is filtered, so the
            // column earns its track only when the list spans every environment.
            showSection={!filter}
            cap={ROW_CAP}
            loading={!board.settled && all.length === 0}
            selected={picked}
            onSelect={openRow}
            deps={deps}
          />
        </Section>
      </Surface>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        closeLabel={t.common.close}
        label={s.detail_title}
      >
        <HealthDetail row={selected} deps={deps} onRecheck={board.runSection} />
      </Drawer>
    </>
  );
}
