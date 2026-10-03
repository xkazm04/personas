import { useCallback, useMemo, useState } from 'react';

import {
  ContextCard, ContextCards, Drawer, Stack, Surface, UnitStrip,
} from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import type { HealthActionDeps } from '../HealthActions';
import { HealthDetail } from '../HealthDetail';
import { HealthRows, rowKey, sortRowsBySeverity, type HealthRow } from '../HealthRows';
import {
  sectionLabel, statusMark, statusSegments, tally, worstStatus, type HealthSectionId,
} from '../healthModel';
import type { HealthBoard } from '../useHealthSections';

/**
 * Prototype A, "Board, then drawer" (kit batch home-3).
 *
 * **The bet: spatial.** Six environments, one glance, drill where it is red. Layer 1 is six peer
 * tiles and carries no prose at all: the environment's name, its worst status as the Mark on the
 * card's rail, the share of checks that are fine as the card's background `fill`, that share
 * stated as the corner `figure`, and one unit per check toned by status on the foot. Layer 2 is
 * the Drawer: that environment's checks as a declared-column list, and the pressed check's
 * detail, remediation and action under it.
 *
 * **Deviation from the batch brief, with its reason.** The brief specified `Tiles` / `Tile mark`
 * and "pressing a tile opens the Drawer", and also "nothing else - no sentences, no buttons".
 * `Tile` has no `onPress` (only `ContextCard` does), so a `Tiles` board can only be entered
 * through a footer `KitButton` - a button, which the brief forbids. `ContextCard` is the kit's
 * part for exactly this case ("one peer as a tile when the peers are FEW"), is the same band on
 * the same rail (`Tile` is drawn as ContextCard's band), carries `mark` on its rail identically,
 * and grow-4 gave it `fill` + `figure`, which is precisely a pass ratio stated without spending a
 * row. The kit gap this leaves is recorded for the Director: `Tile` wants `onPress`.
 */
export function HealthBoardA({ board, deps }: { board: HealthBoard; deps: HealthActionDeps }) {
  const { t, tx } = useTranslation();
  const s = t.system_health;
  const [open, setOpen] = useState<HealthSectionId | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const section = open ? board.sections.find((sec) => sec.id === open) ?? null : null;
  const rows = useMemo<HealthRow[]>(
    () => (section ? sortRowsBySeverity(section.items.map((item) => ({ sectionId: section.id, item }))) : []),
    [section],
  );
  // The worst check is selected on arrival, so the drawer's detail is never blank (as the kit's
  // reference page does with its first row).
  const selected = rows.find((r) => rowKey(r) === picked) ?? rows[0] ?? null;

  const close = useCallback(() => setOpen(null), []);
  useAppKeyboard((e) => {
    if (e.key === 'Escape' && open) { close(); return true; }
    return false;
  });

  return (
    <>
      <Surface>
        <ContextCards label={s.board_label} min="26rem">
          {board.sections.map((sec) => {
            const counts = tally(sec.items);
            const name = sectionLabel(t, sec.id);
            return (
              <ContextCard
                key={sec.id}
                title={name}
                testId={`health-card-${sec.id}`}
                state={sec.loading ? 'loading' : sec.failed ? 'empty' : open === sec.id ? 'selected' : undefined}
                empty={{ title: s.section_unavailable, tone: 'error', markLabel: s.section_unavailable }}
                mark={sec.items.length ? statusMark(t, worstStatus(sec.items)) : undefined}
                figure={sec.items.length ? `${counts.ok}/${counts.total}` : undefined}
                // The fill is the share of checks that pass, drawn in the theme's own `primary`
                // rather than in `success`: it is a PROGRESS quantity (grow-4's precedent is the
                // tour card's progress), and a success-green slab reads far louder on a light
                // theme than on a dark one. The status itself stays on the rail as the Mark.
                fill={counts.total ? { value: counts.ok / counts.total, tone: 'primary' } : undefined}
                onPress={sec.items.length ? () => { setOpen(sec.id); setPicked(null); } : undefined}
                figures={sec.items.length
                  ? <UnitStrip size="m" label={tx(s.unit_label, { section: name })} segments={statusSegments(sec.items)} />
                  : undefined}
              />
            );
          })}
        </ContextCards>
      </Surface>

      <Drawer
        open={!!section}
        onClose={close}
        closeLabel={t.common.close}
        label={section ? tx(s.section_checks, { section: sectionLabel(t, section.id) }) : s.detail_title}
      >
        {section && (
          <Stack divided>
            <HealthRows
              rows={rows}
              label={tx(s.section_checks, { section: sectionLabel(t, section.id) })}
              selected={selected ? rowKey(selected) : null}
              onSelect={(row) => setPicked(rowKey(row))}
              deps={deps}
            />
            <HealthDetail row={selected} deps={deps} onRecheck={board.runSection} />
          </Stack>
        )}
      </Drawer>
    </>
  );
}
