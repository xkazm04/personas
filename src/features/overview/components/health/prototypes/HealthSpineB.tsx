import { useCallback, useMemo, useRef, useState } from 'react';

import { Drawer, KitButton, Section, Split, Surface, UnitStrip } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import type { HealthActionDeps } from '../HealthActions';
import { HealthDetail } from '../HealthDetail';
import { HealthRows, rowKey, sortRowsBySeverity, type HealthRow } from '../HealthRows';
import { sectionLabel, statusSegments, tally } from '../healthModel';
import type { HealthBoard } from '../useHealthSections';

/**
 * Prototype B, "One spine, columns" (kit batch home-3).
 *
 * **The bet: density.** A sysadmin wants the whole board at once, not six drawers. Layer 1 is one
 * `Surface` of six `Section`s on one spine, each a declared-column `Rows` list at the 48px row
 * step: the check's name on the reading line, its status as the Mark on the spine, its detail
 * ellipsized to exactly one line, its action in the last column. Every check on the machine is on
 * one page and nothing has to be opened to see that something is wrong. Each section head carries
 * its own `UnitStrip`, so the environment's shape is readable without reading its rows.
 *
 * Layer 2 is the `Split` pane: the pressed check's status, its FULL detail, its `remediation` and
 * its action, pinned beside the list. On a surface with no room for a pane (the kit's container
 * query, under 1271px) the same detail opens in the `Drawer`, exactly as the kit's reference page
 * does it.
 *
 * This is the one of the three that trades against the owner's "no detail sentences on layer 1":
 * it shows one ellipsized line per row, on purpose, because the sentence IS the density it bets
 * on. If that line is the thing he objects to, B is the prototype that loses.
 */
export function HealthSpineB({ board, deps }: { board: HealthBoard; deps: HealthActionDeps }) {
  const { t, tx } = useTranslation();
  const s = t.system_health;
  const [picked, setPicked] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const paneRef = useRef<HTMLElement>(null);

  const rows = useMemo<HealthRow[]>(
    () => board.sections.flatMap((sec) => sec.items.map((item) => ({ sectionId: sec.id, item }))),
    [board.sections],
  );
  const selected = rows.find((r) => rowKey(r) === picked) ?? null;

  const select = useCallback((row: HealthRow) => {
    setPicked(rowKey(row));
    // No room for the side pane: the detail opens in the drawer (the kit's reference behaviour).
    if (paneRef.current && paneRef.current.offsetWidth === 0) setDrawer(true);
  }, []);

  useAppKeyboard((e) => {
    if (e.key === 'Escape' && drawer) { setDrawer(false); return true; }
    return false;
  });

  const detail = <HealthDetail row={selected} deps={deps} onRecheck={board.runSection} />;

  return (
    <>
      <Split
        paneRef={paneRef}
        paneLabel={s.detail_title}
        pane={detail}
        main={
          <Surface dense>
            {board.sections.map((sec) => {
              const name = sectionLabel(t, sec.id);
              const counts = tally(sec.items);
              const sectionRows = sortRowsBySeverity(sec.items.map((item) => ({ sectionId: sec.id, item })));
              return (
                <Section
                  key={sec.id}
                  id={`health-section-${sec.id}`}
                  title={name}
                  count={sec.items.length || undefined}
                  level={1}
                  ghostRows={3}
                  state={sec.loading ? 'loading' : sec.failed ? 'empty' : undefined}
                  empty={{
                    title: s.section_unavailable,
                    tone: 'error',
                    action: <KitButton tone="quiet" onClick={() => board.runSection(sec.id)}>{s.check_again}</KitButton>,
                  }}
                  actions={sec.items.length
                    ? <UnitStrip size="m" label={tx(s.unit_label, { section: name })} segments={statusSegments(sec.items)} />
                    : undefined}
                  meta={counts.attention ? tx(s.attention_count, { count: counts.attention }) : undefined}
                >
                  <HealthRows
                    rows={sectionRows}
                    label={tx(s.section_checks, { section: name })}
                    selected={picked}
                    onSelect={select}
                    deps={deps}
                  />
                </Section>
              );
            })}
          </Surface>
        }
      />
      <Drawer open={drawer} onClose={() => setDrawer(false)} closeLabel={t.common.close} label={s.detail_title}>
        {detail}
      </Drawer>
    </>
  );
}
