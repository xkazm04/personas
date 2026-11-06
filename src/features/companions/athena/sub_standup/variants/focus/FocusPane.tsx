import { memo, useEffect, useRef } from 'react';
import { BookOpen, MessageCircle } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Section, Surface } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView, StandupView, TickState } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { StateChip } from '../../parts/StateChip';
import { TodayPanel, TonightPanel } from './ContextPanels';
import { FOCUS_COPY as F } from './copy';
import { DirectionDecision } from './DirectionDecision';
import { AgentDecision, AskDecision, NoteDecision } from './OtherDecisions';
import type { RowActions } from './useRowActions';

const TICK: Record<TickState, string> = { armed: 'is-armed', off: 'is-off', none: '' };

/** The project's last standups, oldest first, with the sentence that reads them. */
function History({ ticks }: { ticks: TickState[] }) {
  const { t, tx } = useTranslation();
  const armed = ticks.filter((x) => x === 'armed').length;
  return (
    <span className="sf-hist">
      <span className="sf-hist__ticks" role="img" aria-label={t.athena.standup.row.history_label}>
        {ticks.map((h, i) => <i key={i} className={TICK[h]} />)}
      </span>
      <span className="typo-caption">{tx(t.athena.standup.dossier.history_armed, { n: armed, of: ticks.length })}</span>
    </span>
  );
}

/** The line's quiet tools: talk it through (asks answer through their own press; held lines have no one to talk to) and the dossier. */
function Tools({ row, a }: { row: RowView; a: RowActions }) {
  const talk = row.itemId && row.state !== 'refused' && row.kind !== 'hold';
  return (
    <>
      {talk && <Button variant="ghost" size="sm" icon={<MessageCircle className="w-4 h-4" />} iconRight={<Kbd>T</Kbd>} onClick={() => a.talk(row)}>{F.talk}</Button>}
      <Button variant="ghost" size="sm" icon={<BookOpen className="w-4 h-4" />} iconRight={<Kbd>↵</Kbd>} onClick={a.dossier}>{F.dossier}</Button>
    </>
  );
}

function Decision({ row, view, typing, proposing, a }: { row: RowView; view: StandupView; typing: boolean; proposing: boolean; a: RowActions }) {
  const editable = view.life === 'decide' && Boolean(row.itemId);
  const tools = <Tools row={row} a={a} />;
  if (row.kind === 'hold') return <AskDecision row={row} a={a} tools={tools} />;
  if (row.state === 'refused' || row.kind === 'filler') return <NoteDecision row={row} tools={tools} />;
  if (row.kind === 'agent') return <AgentDecision row={row} editable={editable} a={a} tools={tools} />;
  return <DirectionDecision row={row} editable={editable} typing={typing} proposing={proposing} a={a} tools={tools} />;
}

interface Props {
  view: StandupView;
  row: RowView | undefined;
  typing: boolean;
  proposing: boolean;
  a: RowActions;
}

/**
 * The one thing in front of the operator: the selected line's name and
 * history, Athena's read as a lead, the decision, then today and tonight for
 * this line only. The body is keyed by the line, so moving on fades the new
 * content in once and the pane starts at its top.
 */
export const FocusPane = memo(function FocusPane({ view, row, typing, proposing, a }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const key = row?.key;
  useEffect(() => { ref.current?.scrollTo({ top: 0 }); }, [key]);
  if (!row) return <div className="sf-pane" ref={ref} />;
  return (
    <div className="sf-pane" ref={ref} role="region" aria-label={F.pane_label}>
      <Surface fluid>
        <div key={row.key} className="sf-pane__in">
          <Section
            level={1}
            title={row.name}
            meta={<><StateChip row={row} />{row.history && <History ticks={row.history} />}</>}
            className="sf-head"
          >
            <div className="sf-body">
              {row.evidence && <p className="typo-body text-foreground sf-lead"><span className="sr-only">{t.athena.standup.dossier.read}: </span>{row.evidence}</p>}
              <Decision row={row} view={view} typing={typing} proposing={proposing} a={a} />
            </div>
          </Section>
          <div className="sf-context">
            <TodayPanel view={view} row={row} onDossier={a.dossier} />
            <TonightPanel view={view} row={row} />
          </div>
        </div>
      </Surface>
    </div>
  );
});
