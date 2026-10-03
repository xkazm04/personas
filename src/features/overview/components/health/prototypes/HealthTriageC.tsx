import { useCallback, useMemo, useState } from 'react';

import {
  Drawer, Section, Segmented, Stack, StatStrip, Surface, Toolbar, UnitStrip,
  type StatTile, type Tone,
} from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import type { HealthActionDeps } from '../HealthActions';
import { HealthDetail } from '../HealthDetail';
import { HealthRows, rowKey, sortRowsBySeverity, type HealthRow } from '../HealthRows';
import { needsAttention, statusSegments, tally } from '../healthModel';
import type { HealthBoard } from '../useHealthSections';

type View = 'attention' | 'all';

/** The list caps where home-2 put it; "Show all" expands in place. */
const ROW_CAP = 40;

/**
 * Prototype C, "Triage first" (kit batch home-3).
 *
 * **The bet: an all-green machine should cost the operator nothing.** Layer 1 is the whole machine
 * in two drawn things - four figures (passing / warning / failing / not configured) and ONE unit
 * strip of every check in the app, grouped by environment and toned by status, so the shape of the
 * machine is one bar. Under it, only what needs attention: a list that is EMPTY when there is
 * nothing to do, which is the argument. The `Segmented` switches to everything for the operator
 * who wants to audit rather than fix.
 *
 * Layer 2 is the `Drawer`: the pressed check's status, detail, remediation and action.
 *
 * Shoot this one against `home/system-check/healthy` as well as the mixed board; the contrast
 * between a green bar over an empty list and the same surface with five rows of work IS the
 * prototype's whole case.
 */
export function HealthTriageC({ board, deps }: { board: HealthBoard; deps: HealthActionDeps }) {
  const { t, tx } = useTranslation();
  const s = t.system_health;
  const [view, setView] = useState<View>('attention');
  const [picked, setPicked] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  const all = useMemo<HealthRow[]>(
    () => board.sections.flatMap((sec) => sec.items.map((item) => ({ sectionId: sec.id, item }))),
    [board.sections],
  );
  const counts = useMemo(() => tally(board.items), [board.items]);
  const shown = useMemo(
    () => sortRowsBySeverity(view === 'attention' ? all.filter((r) => needsAttention(r.item)) : all),
    [all, view],
  );
  const selected = all.find((r) => rowKey(r) === picked) ?? null;

  // The strip is one unit per check, in section order, each section's units toned by status: the
  // whole machine as one bar, grouped by environment. The quantum is one check, so no legend.
  const segments = useMemo(
    () => board.sections.flatMap((sec) => statusSegments(sec.items)),
    [board.sections],
  );

  const open = useCallback((row: HealthRow) => { setPicked(rowKey(row)); setDrawer(true); }, []);
  useAppKeyboard((e) => {
    if (e.key === 'Escape' && drawer) { setDrawer(false); return true; }
    return false;
  });

  const figure = (label: string, value: number, tone: Tone): StatTile => ({
    label,
    value,
    draw: value > 0
      ? <UnitStrip size="s" label={label} segments={[{ n: value, tone, glyph: tone === 'info' ? 'hollow' : 'solid' }]} />
      : undefined,
  });

  return (
    <>
      <Surface dense>
        <Section
          level={1}
          title={s.machine_title}
          count={counts.total || undefined}
          // Law 6's declared exception, named here as the law asks: this ONE region is a roll-up
          // of all six environments, so it cannot be retired by a single section's data. It is
          // not held waiting for the last one either (law 2): it ghosts only while NOTHING has
          // landed, and then counts up as each section settles. The six sections underneath it
          // each retire their own placeholder on their own fetch.
          state={board.items.length === 0 && !board.settled ? 'loading' : undefined}
          ghostRows={2}
        >
          <Stack>
            <StatStrip
              tiles={[
                figure(s.status_ok, counts.ok, 'success'),
                figure(s.status_warn, counts.warn, 'warning'),
                figure(s.status_error, counts.error, 'error'),
                figure(s.status_inactive, counts.inactive, 'info'),
              ]}
            />
            <UnitStrip size="l" rows={2} label={s.machine_label} segments={segments} />
          </Stack>
        </Section>

        <Section
          level={1}
          title={view === 'attention' ? s.attention_title : s.all_checks}
          count={shown.length}
          actions={
            <Toolbar label={s.view_label}>
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
            showSection
            cap={ROW_CAP}
            loading={!board.settled && all.length === 0}
            selected={picked}
            onSelect={open}
            deps={deps}
          />
        </Section>
      </Surface>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        closeLabel={t.common.close}
        label={selected ? tx(s.section_checks, { section: selected.item.label }) : s.detail_title}
      >
        <HealthDetail row={selected} deps={deps} onRecheck={board.runSection} />
      </Drawer>
    </>
  );
}
