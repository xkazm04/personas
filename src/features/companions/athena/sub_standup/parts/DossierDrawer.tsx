import { Drawer, Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { clockLabel } from '../model/timeAxis';
import type { RowView } from '../model/types';
import { StateChip } from './StateChip';

/** One away act, newest first: time, glyph colour by kind, what happened. */
function ActLine({ at, kind, summary }: { at: number; kind: string; summary: string }) {
  return (
    <li className="flex gap-3 items-baseline py-1">
      <span className="typo-code">{clockLabel(at)}</span>
      <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true" className="flex-none"><circle className={`su-k su-k--${kind}`} r="4" /></svg>
      <span className="typo-body text-foreground">{summary}</span>
    </li>
  );
}

/**
 * The dossier (Enter): the heavy content of one row on its own layer, B/1's
 * drawer on the kit Drawer. Esc or ArrowLeft closes it (the page keymap).
 */
export function DossierDrawer({ row, open, onClose }: { row: RowView | undefined; open: boolean; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.dossier;
  const acts = row ? [...row.pastMarks, ...row.nightMarks].sort((a, b) => b.at - a.at) : [];
  return (
    <Drawer open={open && Boolean(row)} onClose={onClose} closeLabel={s.close} label={s.label}>
      {row && (
        <div className="flex flex-col gap-5 px-3">
          <div className="flex items-center gap-3">
            <h2 className="typo-heading-lg text-foreground flex-1 min-w-0">{row.name}</h2>
            <StateChip row={row} />
          </div>
          {(row.refusal || row.evidence) && (
            <Section level={2} title={s.read}>
              {row.refusal && <p className="typo-body text-foreground">{row.refusal}</p>}
              {row.evidence && <p className="typo-body text-foreground">{row.evidence}</p>}
            </Section>
          )}
          {row.headline && (row.state === 'decided' || row.state === 'running' || row.state === 'done') && (
            <Section level={2} title={s.decided}><p className="typo-body text-foreground">{row.headline}</p></Section>
          )}
          {row.proposals.length > 0 && (
            <Section level={2} title={s.directions}>
              <ol className="flex flex-col gap-2">
                {row.proposals.map((p, i) => (
                  <li key={p.id}>
                    <p className="typo-body k-strong text-foreground">{i + 1}. {p.text}</p>
                    <p className="typo-caption">{p.rationale}</p>
                  </li>
                ))}
              </ol>
            </Section>
          )}
          <Section level={2} title={s.history}>
            <p className="typo-caption">
              {row.history ? tx(s.history_armed, { n: row.history.filter((h) => h === 'armed').length, of: row.history.length }) : s.history_unrecorded}
            </p>
          </Section>
          <Section level={2} title={tx(s.acts, { n: acts.length })}>
            {acts.length === 0 ? <p className="typo-caption">{s.no_acts}</p> : <ul>{acts.map((a) => <ActLine key={a.id} at={a.at} kind={a.kind} summary={a.summary} />)}</ul>}
          </Section>
          {row.moved > 0 && <Section level={2} title={s.moved}><p className="typo-body text-foreground">{tx(s.moved_n, { n: row.moved })}</p></Section>}
        </div>
      )}
    </Drawer>
  );
}
