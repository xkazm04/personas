import { useCallback, useMemo, useState } from 'react';

import {
  ContextCard, ContextCards, Drawer, KitButton, Section, Segmented, Surface, Toolbar, UnitStrip,
} from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import type { HealthActionDeps } from '../HealthActions';
import { HealthDetail } from '../HealthDetail';
import { HealthRows, rowKey, sortRowsBySeverity, type HealthRow } from '../HealthRows';
import {
  needsAttention, sectionLabel, statusMark, statusSegments, tally, worstStatus,
  type HealthSectionId,
} from '../healthModel';
import type { HealthBoard } from '../useHealthSections';

type View = 'attention' | 'all';

/** The list caps where home-2 put it; "Show all" expands in place. */
const ROW_CAP = 40;

/**
 * The FUSION, and the default (kit batch home-3, Director's call after seeing all three at 1920).
 *
 * The owner's taste record is that a field of variants resolves by COMPOSING, not by picking one.
 * The three prototypes each held one true thing and one cost:
 *
 *   A board   the only layer 1 that is literally what he asked for - six environments, graphical,
 *             no prose - but ~60% of a 1920 page was empty under it and acting cost six drawer opens
 *   B spine   the best audit surface, but every detail sentence sat on layer 1, which is the exact
 *             property that made the old panel unusable, and its pane read "No check selected"
 *   C triage  answers "is there anything for me to do" instantly and costs nothing when green, but
 *             demotes the environment to a table column
 *
 * So: layer 1 is A's board, unchanged. Directly under it is C's attention list with C's Segmented,
 * which fills the dead space with the only content that matters and lets the operator act without
 * opening anything. "Everything" gives B's full audit table, so none of the three is thrown away.
 * An all-green machine is six green cards over an empty band.
 *
 * **A board card FILTERS the list; it does not open the drawer.** My call, and the reason is the
 * cost the Director named in A: a card that opens a drawer re-introduces the six-opens-to-act
 * problem the fusion exists to remove. As a filter the board becomes meaningful navigation on ONE
 * surface - the pressed card lights its rail (`is-selected`, which the kit already draws) and the
 * list under it narrows - and it stays honest at grow-1 scale, where "stay on one surface" beats
 * "one drawer per group". The drawer still exists and is still the second layer, reached by
 * pressing a ROW: one check's status, full detail, remediation and action. The environment filter
 * and the attention/everything Segmented are orthogonal, so "this environment, everything" and
 * "every environment, only the work" are both one press away.
 */
export function HealthFusionD({ board, deps }: { board: HealthBoard; deps: HealthActionDeps }) {
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
  // A second press on the lit card clears the filter, so the board is a toggle and never a trap.
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
      <Surface dense>
        {/* 24rem, not A's 26rem: this surface is `dense`, so its grid is ~1278px wide and 26rem
            packs only TWO cards once the kit gap is paid - six environments as 2x3, taller than
            the list they are meant to sit over. 24rem packs the 3x2 board A actually shows. */}
        <ContextCards label={s.board_label} min="24rem">
          {board.sections.map((sec) => {
            const c = tally(sec.items);
            const name = sectionLabel(t, sec.id);
            return (
              <ContextCard
                key={sec.id}
                title={name}
                testId={`health-card-${sec.id}`}
                state={sec.loading ? 'loading' : sec.failed ? 'empty' : filter === sec.id ? 'selected' : undefined}
                empty={{ title: s.section_unavailable, tone: 'error', markLabel: s.section_unavailable }}
                mark={sec.items.length ? statusMark(t, worstStatus(sec.items)) : undefined}
                figure={sec.items.length ? `${c.ok}/${c.total}` : undefined}
                fill={c.total ? { value: c.ok / c.total, tone: 'primary' } : undefined}
                onPress={sec.items.length ? () => toggleFilter(sec.id) : undefined}
                figures={sec.items.length
                  ? <UnitStrip size="m" label={tx(s.unit_label, { section: name })} segments={statusSegments(sec.items)} />
                  : undefined}
              />
            );
          })}
        </ContextCards>

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
            // The environment is already named by the lit card when the list is filtered, so the
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
