import { Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { isOpen } from '../../model/keymap';
import { BRIEFING } from './copy';
import { DirectionBlock } from './DirectionBlock';
import type { ItemCtx } from './itemTypes';
import { AgentLine, DecidedLine, HeldLine, WaitLine } from './Lines';

const S = BRIEFING.sections;

/**
 * The briefing's body, in the order the operator should think: what needs
 * him, the directions (open ones as blocks, decided ones folded to a line, so
 * the document shrinks as he decides), the agent changes, fill and held work.
 * One listbox over every item; sections are its groups.
 */
export function Document({ ctx }: { ctx: ItemCtx }) {
  const { t, tx } = useTranslation();
  const { view, api } = ctx;
  const waits = api.entries(['waits']);
  const directions = api.entries(['decide', 'blank']);
  const agents = api.entries(['agents']);
  const held = api.entries(['filler', 'refused']);
  const openDirections = directions.filter((e) => isOpen(e.row)).length;
  const selected = view.rows[ctx.c.ui.sel];
  return (
    <div
      className="sb-doc"
      role="listbox"
      tabIndex={0}
      aria-label={t.athena.standup.table_label}
      aria-activedescendant={selected ? `sb-item-${selected.key}` : undefined}
      data-testid="standup-table"
    >
      {waits.length > 0 && (
        <Section title={S.needs} count={waits.length}>
          {waits.map((e) => <WaitLine key={e.row.key} entry={e} ctx={ctx} />)}
        </Section>
      )}
      {directions.length > 0 && (
        <Section
          title={S.directions}
          count={view.life === 'decide' ? tx(S.open_of, { open: openDirections, all: directions.length }) : directions.length}
        >
          {directions.map((e) => (view.life === 'decide' && isOpen(e.row)
            ? <DirectionBlock key={e.row.key} entry={e} ctx={ctx} />
            : <DecidedLine key={e.row.key} entry={e} ctx={ctx} />))}
        </Section>
      )}
      {agents.length > 0 && (
        <Section title={S.agents} count={agents.length}>
          {agents.map((e) => <AgentLine key={e.row.key} entry={e} ctx={ctx} />)}
        </Section>
      )}
      {held.length > 0 && (
        <Section title={S.held} count={held.length}>
          {held.map((e) => <HeldLine key={e.row.key} entry={e} ctx={ctx} />)}
        </Section>
      )}
    </div>
  );
}
