// Section a: every typo-* token, current beside proposed on one row, with the
// size, weight, line-height and tracking the browser computed at the active
// text scale, and whether the token sets a colour of its own.
import { Measured, Section, type Mode, type View } from '../parts';
import { PHANTOM_MAP, SAMPLE, TYPE_ROWS } from '../specimenData';
import measure from '../measure.generated.json';

const uses = measure.tokens as Record<string, number>;
const phantomUses = measure.phantoms as Record<string, number>;

function Phantoms({ mode }: { mode: Mode }) {
  return (
    <div className="sp-cell sp-stack" data-mode={mode} {...(mode === 'proposed' ? { 'data-style-proposal': '' } : {})}>
      {PHANTOM_MAP.map((p) => (
        <div key={p.cls} className="typo-body text-foreground">
          {mode === 'current'
            ? <><code className="typo-code">{p.cls}</code> <span className={p.cls}>{SAMPLE.agent}</span> <span className="typo-caption">{phantomUses[p.cls] ?? 0} uses</span></>
            : <><code className="typo-code">{p.to}</code> <span className={p.to}>{SAMPLE.agent}</span> <span className="typo-caption">{p.why}</span></>}
        </div>
      ))}
    </div>
  );
}

export function TypeScale({ view, env }: { view: View; env: string }) {
  const modes: Mode[] = view === 'side' ? ['current', 'proposed'] : [view];
  return (
    <Section id="type" title="Type scale" note="Computed live at the active text scale. Hierarchy by size and weight; no token sets a colour.">
      <div className={`sp-typegrid ${modes.length === 1 ? 'is-single' : ''}`}>
        <div className="sp-typehead typo-label text-foreground">Token and role</div>
        {modes.map((m) => <div key={m} className="sp-typehead typo-label text-foreground uppercase">{m}</div>)}
        {TYPE_ROWS.map((row) => (
          <div key={row.token} className="sp-typerow" data-token={row.token}>
            <div className="sp-spec">
              <code className="typo-code text-foreground">{row.token}</code>
              <span className="typo-caption">
                {row.proposed.isNew ? 'NEW. ' : ''}
                {row.proposed.retiresInto ? `Retires into ${row.proposed.retiresInto}.` : row.proposed.role}
                {` (${uses[row.token] ?? 0} uses)`}
              </span>
              <span className="typo-caption">Today: {row.current.role}</span>
            </div>
            {modes.map((m) => (
              <Measured key={m} mode={m} cls={m === 'current' ? row.current.cls : row.proposed.cls} env={env}>
                {row.sample}
              </Measured>
            ))}
          </div>
        ))}
        <div className="sp-typerow" data-token="phantoms">
          <div className="sp-spec">
            <span className="typo-heading text-foreground">Phantom names</span>
            <span className="typo-caption">Written at call sites, defined nowhere: each renders as whatever surrounds it. Proposed: the token each maps to.</span>
          </div>
          {modes.map((m) => <Phantoms key={m} mode={m} />)}
        </div>
      </div>
    </Section>
  );
}
