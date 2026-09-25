// The council's state on the pinned technique's subject, in figures: its
// approvals, rejections and pending rounds, how many of its techniques are
// proven, which waiting decision lands here, and which council runs cited
// this technique as proof. Never councilled is "not measured", never zero.
import { interpolate as tx } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import type { TechniqueNode } from '../engine/types';
import type { DocProof } from './docModel';
import type { Decision } from './fusedModel';
import { useFusedStrings } from './fusedStrings';

interface Props {
  technique: TechniqueNode;
  decisions: Decision[];
  proofs: DocProof[] | null;
}

export function DocCouncil({ technique, decisions, proofs }: Props) {
  const s = useFusedStrings();
  const f = s.f;
  const subject = technique.subject;
  const o = subject.overlay;
  const here = decisions.filter((d) => d.stars.includes(subject));
  return (
    <>
      {o ? (
        <>
          <div className="cz">
            <div>
              <b style={{ color: 'var(--gx-ok)' }}>{s.n(o.approved)}</b>
              <span>{f.legend_approved}</span>
            </div>
            <div>
              <b style={{ color: 'var(--gx-err)' }}>{s.n(o.rejected)}</b>
              <span>{f.legend_rejected}</span>
            </div>
            <div>
              <b style={{ color: 'var(--gx-warn)' }}>{s.n(o.pending)}</b>
              <span>{f.legend_pending}</span>
            </div>
            <div>
              <b>
                {s.n(o.techniquesProven)} <small>{tx(f.doc_of, { count: s.n(subject.techniques.length) })}</small>
              </b>
              <span>{f.doc_proven}</span>
            </div>
          </div>
          <p className="d-p">
            {tx(f.doc_councilled_for, { projects: o.projects.join(', '), last: o.last ?? f.not_measured })}
          </p>
        </>
      ) : (
        <p className="d-none">{tx(f.doc_never, { subject: subject.title })}</p>
      )}
      {here.map((d) => (
        <p key={d.subject.id} className="d-p" style={{ color: 'var(--gx-warn)' }}>
          {tx(f.doc_waits, {
            title: d.subject.title,
            overall: d.subject.overall == null ? f.not_measured : formatCount(d.subject.overall, { precision: 2 }),
            round: d.subject.roundNo ?? f.not_measured,
          })}
        </p>
      ))}
      {proofs === null ? <p className="d-none">{f.doc_proofs_unmeasured}</p> : null}
      {(proofs ?? []).map((p) => (
        <div key={p.key} className="proof">
          {tx(f.doc_proof, { proof: p.proof, dimension: p.dimension, subject: p.subject, round: p.round })}
        </div>
      ))}
    </>
  );
}

export default DocCouncil;
