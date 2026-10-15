import { useMemo } from 'react';
import { ChipRow, Section, StatStrip } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { outcomeName, stationName } from '../../../labels';
import { dur } from '../words';
import { rawSteps, runsOf, sessionById } from './detail';
import { StepStrip } from './StepStrip';
import type { SheetProps } from './SurveySheet';

const RUN_CAP = 160;

/** The third depth: one session's voyage log. Shown by id, repository, model, timing and step sequence only. */
export function VoyageSheet({ scene, reading, model, view, id }: SheetProps & { id: string }) {
  const { t, tx, language } = useTranslation();
  const p = t.companions.process;
  const w = p.watershed;
  const src = sessionById(reading, id);
  const inst = view.find((x) => x.id === id);
  const steps = useMemo(() => (src ? rawSteps(reading, src) : []), [reading, src]);
  const tr = scene.fates.per.get(id), fate = scene.fates.fate.get(id);
  if (!src || !inst || !tr || !fate) return null;
  const runs = runsOf(steps);
  const when = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(src.start));
  const where = fate.type === 'sea'
    ? w.where_sea
    : tx(fate.type === 'marsh' ? w.where_marsh : w.where_lake, { name: stationName(p, model.stations[fate.q]?.keys ?? []) });
  const fails = inst.outcome === 'errored' || inst.outcome === 'interrupted';

  return (
    <>
      <div className="typo-eyebrow k-quiet">{w.voyage}</div>
      <h2 className="ws-s-title is-mono typo-heading-lg">{id}</h2>
      <p className="typo-caption">
        {[src.project, inst.mode === 'interactive' ? p.mode_interactive : p.mode_headless, src.model, src.effort ? tx(w.effort, { value: src.effort }) : '', when].filter(Boolean).join(' · ')}
      </p>
      <div className="ws-where">
        <span className={`typo-label ${fails ? 'ws-red' : ''}`}>{outcomeName(p, inst.outcome)}</span>
        <span className="typo-body">{where}</span>
      </div>
      <StatStrip
        tiles={[
          { label: w.fact_active, value: dur(inst.active) },
          { label: w.fact_steps, value: steps.length },
          { label: w.fact_prompts, value: src.prompts },
          { label: w.fact_interrupts, value: <span className={src.interrupts ? 'ws-amb' : undefined}>{src.interrupts}</span> },
          { label: w.fact_compactions, value: src.compactions },
          { label: w.fact_errors, value: <span className={src.errors ? 'ws-red' : undefined}>{src.errors}</span> },
          { label: w.fact_commits, value: src.commits },
        ]}
      />
      <Section level={2} title={w.course_title}>
        <div className="ws-seq typo-body">
          {model.stations.map((s, q) => {
            const reached = q < tr.reach, matched = reached && tr.matched[q], fr = tr.frictionAt.includes(q);
            const note = !reached ? w.course_not_reached : !matched ? w.course_skipped : fr ? w.course_stumbled : '';
            return (
              <span key={q} className={!reached ? 'is-off' : fr ? 'is-warn' : undefined}>
                {q ? '→ ' : ''}<b>{stationName(p, s.keys)}</b>{note ? ` (${note})` : ''}
              </span>
            );
          })}
        </div>
      </Section>
      <Section level={2} title={w.strip_title} count={tx(w.strip_count, { count: steps.length, time: dur(inst.active) })}>
        <StepStrip steps={steps} />
        <div className="ws-seq typo-code mt-3">
          {runs.slice(0, RUN_CAP).map((r, i) => (
            <span key={i}><b>{r.kind}</b> ×{r.n}{r.err ? <span className="ws-red"> {tx(w.errors_n, { count: r.err })}</span> : null}</span>
          ))}
          {runs.length > RUN_CAP && <span>{tx(w.more_runs, { count: runs.length - RUN_CAP })}</span>}
        </div>
      </Section>
      {src.skills.length > 0 && (
        <Section level={2} title={w.skills_title} count={src.skills.length}>
          <ChipRow chips={src.skills.map((s) => ({ id: s, label: s }))} label={w.skills_title} emptyLabel={w.list_empty} />
        </Section>
      )}
      <p className="typo-caption mt-4">{w.privacy}</p>
    </>
  );
}
