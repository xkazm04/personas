// The laws a technique answers to: each law's full statement at reading size,
// how far it reaches (a bar the length of its reach across the corpus, and
// the figures), and the sibling techniques in this subject it also binds, as
// chips that open them.
import { interpolate as tx } from '@/i18n/useTranslation';

import type { GalaxyEngine } from '../engine/GalaxyEngine';
import type { TechniqueNode } from '../engine/types';
import type { DocLaw } from './docModel';
import { techniqueTitle } from './fusedModel';
import { useFusedStrings } from './fusedStrings';

interface Props {
  engine: GalaxyEngine | null;
  technique: TechniqueNode;
  laws: DocLaw[];
  /** The widest reach among these laws, so the bars compare with each other. */
  maxReach: number;
}

export function DocLaws({ engine, technique, laws, maxReach }: Props) {
  const s = useFusedStrings();
  const f = s.f;
  if (!laws.length) return <p className="d-none">{f.doc_no_laws}</p>;
  return (
    <>
      {laws.map((law) => {
        const siblings = law.techniques.filter((x) => x.subject === technique.subject && x !== technique);
        const reach = Math.max(4, Math.round((law.techniques.length / Math.max(1, maxReach)) * 100));
        return (
          <div className="law" key={law.slug}>
            <div className="law-t">{law.title}</div>
            <p>{law.statement}</p>
            <div className="law-m">
              <i className="law-reach" style={{ width: `${reach}%` }} />
              {tx(f.doc_law_binds, { count: s.n(law.techniques.length), subjects: s.n(law.subjectSpan) })}
            </div>
            {siblings.length ? (
              <div className="law-sib">
                {siblings.map((x) => (
                  <button key={x.slug} type="button" onClick={() => engine?.goTo(x, true)}>
                    {x.rank} {techniqueTitle(x)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export default DocLaws;
