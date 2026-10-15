import type { CuratorProcessSession } from '@/lib/bindings/CuratorProcessSession';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevInstance } from '../../engine/devAdapter';
import { stationName } from '../../labels';
import { DialStrip } from './DialStrip';
import { kindName } from './dialLabels';
import type { TimelineStep } from './dialDetail';
import { fmtDateTime, fmtDur, fmtInt } from './dialFormat';

const WORK_ROWS = 24;
const PHASES = ['brief', 'explore', 'edit', 'verify', 'ship'];

/** One session in full: its strip, the facts the record holds, and its steps. Nothing else is shown about it. */
export function DialSheet({ session, raw, steps, outcome, onBack }: { session: DevInstance; raw: CuratorProcessSession; steps: TimelineStep[]; outcome: string; onBack: () => void }) {
  const { t, tx, language } = useTranslation();
  const p = t.companions.process;
  const d = p.dial;
  const work = steps.filter((s) => s.work);
  const facts: [string, string | number][] = [
    [d.f_repo, raw.project],
    [d.f_mode, session.mode === 'headless' ? p.mode_headless : p.mode_interactive],
    [d.f_model, `${raw.model?.replace(/^[a-z]+-/, '') ?? ''}${raw.effort ? ` · ${raw.effort}` : ''}`],
    [d.f_started, fmtDateTime(raw.start, language)],
    [d.f_active, fmtDur(raw.active)],
    [d.f_steps, fmtInt(raw.steps.length)],
    [d.f_prompts, fmtInt(raw.prompts)],
    [d.f_errors, fmtInt(raw.errors)],
    [d.f_interrupts, fmtInt(raw.interrupts)],
    [d.f_commits, fmtInt(raw.commits)],
    [d.f_ended, outcome],
  ];
  return (
    <div>
      <button type="button" data-back onClick={onBack}>&larr; {d.sx_back}</button>
      <h3 className="typo-heading text-foreground"><i className="dial-od" data-o={session.outcome} aria-hidden="true" /> <span className="font-mono">{session.id}</span> · {outcome}</h3>
      <p className="typo-caption">{d.sx_note}</p>
      <DialStrip steps={steps} large />
      <p className="dial-legend-line typo-caption">
        {PHASES.map((k) => (
          <span key={k}><i className={`dial-sw i-${k}`} aria-hidden="true" />{stationName(p, [k])}</span>
        ))}
        <span><i className="dial-sw i-err" aria-hidden="true" />{d.lg_error}</span>
        <span><i className="dial-sw i-fric" aria-hidden="true" />{d.lg_friction}</span>
      </p>
      <dl className="dial-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="typo-caption">{k}</dt>
            <dd className="typo-body tabular-nums text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {raw.skills.length > 0 && <p className="typo-caption">{tx(d.sx_skills, { list: raw.skills.join(', ') })}</p>}
      <table className="dial-steps typo-body">
        <thead>
          <tr>
            {[d.th_step, d.th_calls, d.th_errors, d.th_at, d.th_took].map((h) => <th key={h} className="typo-caption">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {work.slice(0, WORK_ROWS).map((s, i) => (
            <tr key={i}>
              <td>{kindName(d, s.kind)}{s.extra && s.kind === 'skill' ? ` · ${s.extra}` : ''}</td>
              <td>&times;{s.calls}</td>
              <td data-e={s.err ? '' : undefined}>{s.err ? tx(d.kind_errors, { count: s.err }) : '-'}</td>
              <td>{fmtDur(s.at)}</td>
              <td>{fmtDur(s.span)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {work.length > WORK_ROWS && <p className="typo-caption">{tx(d.sx_more_steps, { count: work.length - WORK_ROWS })}</p>}
    </div>
  );
}
