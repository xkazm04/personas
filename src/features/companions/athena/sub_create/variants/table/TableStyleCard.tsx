import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaEngine, CreateAthenaStepId } from '../../engine/createAthenaTypes';
import type { TableFacts } from './useTableFacts';

/**
 * Right rail: her card, writing itself in plain words as the person decides.
 * Only what is real today - how she sounds, how she reaches you, how she
 * hears you. A decided line is a way back to the step that decided it; an
 * undecided one reads "not yet". The seal fills with the share decided.
 */
interface Line {
  step: CreateAthenaStepId;
  text: string;
  pending: string;
}

function CardLine({ line, engine }: { line: Line; engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const status = engine.steps.find((s) => s.id === line.step)?.status;
  const decided = status === 'done';
  if (!decided) {
    return (
      <li>
        <span className="tb-sc-line pending typo-body" data-testid={`create-athena-table-card-${line.step}`}>{line.pending}</span>
      </li>
    );
  }
  return (
    <li>
      <Button variant="ghost" className="tb-sc-line" onClick={() => engine.actions.goTo(line.step)} data-testid={`create-athena-table-card-${line.step}`}>
        <span className="typo-body">{line.text}</span>
        <span className="tb-sc-ch typo-body">{t.athena.table_change}</span>
      </Button>
    </li>
  );
}

export function TableStyleCard({ engine, facts }: { engine: CreateAthenaEngine; facts: TableFacts }) {
  const { t, tx } = useTranslation();
  const c = t.athena;
  const pend = (item: string) => tx(c.table_card_pending, { item });
  const feature = (name: string, on: boolean) => tx(c.table_receipt_feature, { feature: name, state: on ? c.table_on : c.table_off });
  const sounds: Line[] = [
    { step: 'voice_pick', text: tx(c.table_card_voice, { voice: facts.voice ?? '' }), pending: pend(c.create_step_voice_pick) },
    { step: 'voice_pick', text: facts.speed === null ? c.table_card_pace_natural : c.table_card_pace_set, pending: pend(c.table_card_pace) },
  ];
  const reaches: Line[] = [
    { step: 'footer_icon', text: feature(c.create_step_footer_icon, facts.footer), pending: pend(c.create_step_footer_icon) },
    { step: 'orb', text: feature(c.create_step_orb, facts.orb), pending: pend(c.create_step_orb) },
    { step: 'chime', text: feature(c.create_step_chime, facts.chime), pending: pend(c.create_step_chime) },
  ];
  const hears: Line[] = [{ step: 'stt', text: tx(c.table_receipt_stt, { engine: facts.stt }), pending: pend(c.create_step_stt) }];
  const all = [...sounds, ...reaches, ...hears];
  const filled = all.filter((l) => engine.steps.find((s) => s.id === l.step)?.status === 'done').length / all.length;

  const group = (title: string, lines: Line[]) => (
    <>
      <h4 className="tb-sc-h typo-label">{title}</h4>
      <ul>
        {lines.map((l, i) => (
          <CardLine key={`${l.step}-${i}`} line={l} engine={engine} />
        ))}
      </ul>
    </>
  );

  return (
    <aside className="tb-rail right" aria-label={c.table_card_title} data-testid="create-athena-table-card">
      <div className="tb-sc">
        <div className="tb-sc-head">
          <span className="tb-sc-seal" style={{ ['--filled' as string]: filled }} aria-hidden="true" />
          <div>
            <h2 className="typo-title-lg text-foreground">{c.table_card_title}</h2>
            <div className="tb-sc-sub typo-body">{c.table_card_sub}</div>
          </div>
        </div>
        {group(c.table_card_sounds, sounds)}
        {group(c.table_card_reaches, reaches)}
        {group(c.table_card_hears, hears)}
        <div className="tb-sc-fixed typo-body">
          <b>{c.table_card_fixed}</b> {c.table_card_fixed_text}
        </div>
      </div>
    </aside>
  );
}
