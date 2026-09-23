// A pinned technique is a document, not a sidebar: a reading surface about
// 60% of the room right of the column, with the title, the trail, the
// figures, the triggers, the council's state on its subject and every law it
// answers to. The field re-frames the subject into the room left over (the
// engine eases the right inset), so the dial shrinks beside it. Previous and
// Next step through the subject's techniques; Close (or Esc) unpins.
import { useMemo } from 'react';

import { interpolate as tx } from '@/i18n/useTranslation';

import { useCouncilStore } from '../../councilStore';
import type { GalaxyEngine } from '../engine/GalaxyEngine';
import type { GalaxyLayout, TechniqueNode } from '../engine/types';
import { DocCouncil } from './DocCouncil';
import { DocLaws } from './DocLaws';
import { bindings, lawsOf, proofsOf } from './docModel';
import { techniqueTitle } from './fusedModel';
import { useFusedStrings } from './fusedStrings';
import type { FusedData } from './useFused';

/** A key legend, as printed on the key: not prose. */
const KEY_ESC = 'Esc';

interface Props {
  engine: GalaxyEngine | null;
  layout: GalaxyLayout;
  technique: TechniqueNode | null;
  data: FusedData;
  wide: boolean;
}

export function TechniqueDocument({ engine, layout, technique, data, wide }: Props) {
  const s = useFusedStrings();
  const f = s.f;
  const fixtureRuns = useCouncilStore((st) => st.fixtureRuns);
  const fixtureOn = useCouncilStore((st) => st.fixtureOn);
  const laws = useMemo(() => (technique ? lawsOf(technique, data.laws, layout) : []), [technique, data.laws, layout]);
  const proofs = useMemo(() => (technique ? proofsOf(technique, fixtureRuns, fixtureOn) : null), [technique, fixtureRuns, fixtureOn]);
  const t = technique;
  if (!t) return <aside className="fz-doc" aria-label={f.doc_label} aria-hidden="true" />;

  const S = t.subject;
  const b = bindings(t, laws);
  const sibs = S.techniques;
  const step = (d: 1 | -1) => {
    const next = sibs[t.rank - 1 + d];
    if (next) engine?.goTo(next, true);
  };
  const maxReach = Math.max(1, ...laws.map((l) => l.techniques.length));
  const figs: Array<[number, string]> = [
    [laws.length, s.plural(laws.length, f.fig_law_one, f.fig_law_other)],
    [t.useWhen.length, s.plural(t.useWhen.length, f.fig_trigger_one, f.fig_trigger_other)],
    [b.same, f.doc_siblings],
    [b.other, tx(f.doc_elsewhere, { count: s.n(b.otherSubjects) })],
  ];

  return (
    <aside className={`fz-doc open${wide ? ' wide' : ''}`} aria-label={f.doc_label} data-role="hud-doc">
      <div className="d-in">
        <div className="d-bar">
          <button className="d-btn" type="button" disabled={t.rank === 1} onClick={() => step(-1)}>
            <kbd>←</kbd> {f.doc_prev}
          </button>
          <button className="d-btn" type="button" disabled={t.rank === sibs.length} onClick={() => step(1)}>
            {f.doc_next} <kbd>→</kbd>
          </button>
          <button className="d-btn d-close" type="button" onClick={() => engine?.climb()}>
            {f.doc_close} <kbd>{KEY_ESC}</kbd>
          </button>
        </div>
        <div className="d-kick">{tx(f.doc_kick, { index: t.rank, count: sibs.length, subject: S.title })}</div>
        <h2 className="d-title" data-role="hud-doc-title">
          {techniqueTitle(t)}
        </h2>
        <div className="d-trail">{`${S.domain.title} / ${S.category.title} / ${S.title}`}</div>
        <div className="d-figs" data-role="hud-doc-figures">
          {figs.map(([v, label]) => (
            <div key={label}>
              <b>{s.n(v)}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="d-cols">
          <div>
            <h3 className="d-h">{f.doc_use_when}</h3>
            {t.useWhen.length ? (
              <ul className="d-list">
                {t.useWhen.map((u) => (
                  <li key={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</li>
                ))}
              </ul>
            ) : (
              <p className="d-none">{f.doc_no_triggers}</p>
            )}
            <h3 className="d-h">{tx(f.doc_council, { subject: S.title })}</h3>
            <DocCouncil technique={t} decisions={data.decisions} proofs={proofs} />
          </div>
          <div>
            <h3 className="d-h">{f.doc_laws}</h3>
            <DocLaws engine={engine} technique={t} laws={laws} maxReach={maxReach} />
          </div>
        </div>
      </div>
    </aside>
  );
}

export default TechniqueDocument;
