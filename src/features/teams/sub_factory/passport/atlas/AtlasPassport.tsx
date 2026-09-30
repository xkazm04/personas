// Passport Atlas — the project layer: one project's passport as a document
// with room. The headline figures and their ladders, the actions (the
// product's consent-gated set), why it is not ready, then every dimension by
// section; a contents pane marks each dimension's state and jumps to it.
import type { ReactNode } from 'react';
import { KitButton, Section, Split, StatStrip, UnitStrip } from '@/features/shared/components/kit';
import { SECTIONS } from '../passportRows';
import { AUTOMATION_LABEL, AUTOMATION_SCALE, PROD_BAND_LABEL, PROD_BAND_SCALE, type AppPassport } from '../passportModel';
import { scoreAgainstRubric } from '../improve/goldenStandard';
import { ATLAS_ROWS, blockersOf, inkOf } from './atlasModel';
import { DimensionBody, type DimensionDoors } from './AtlasDimension';
import { InkDot, Ladder } from './AtlasParts';
import { ATLAS_WORDS as W } from './atlasWords';

const scoreDraw = (score: number, tone: 'success' | 'warning' | 'error') =>
  <UnitStrip size="s" label={`${score} of 100`} segments={[{ n: score / 10, tone, glyph: 'solid' }, { n: 10 - score / 10, tone: 'neutral', glyph: 'empty' }]} />;
const toneOf = (score: number) => (score >= 70 ? 'success' : score >= 45 ? 'warning' : 'error');

export function AtlasPassport({ p, name, qualifier, doors, actions, onBack, onStep, hasPrev, hasNext, onOpenWorkspace }: {
  p: AppPassport;
  name: string;
  qualifier: string | null;
  doors: DimensionDoors;
  /** The product's action row (PassportActionsCell), rendered labelled. */
  actions: ReactNode;
  onBack: () => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onOpenWorkspace?: () => void;
}) {
  const a = p.automationReadiness;
  const pr = p.productionReadiness;
  const golden = scoreAgainstRubric(p);
  const blockers = blockersOf(p);
  const unknown = Boolean(p.repoUnreadable);
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  const contents = (
    <nav className="atlas-toc" aria-label={W.contents}>
      <div className="typo-eyebrow k-quiet">{W.contents}</div>
      <KitButton quiet onClick={() => jump('atlas-sec-blockers')}>{W.whyNotReady} <span className="k-quiet">{blockers.length}</span></KitButton>
      {SECTIONS.map((s) => (
        <div key={s.key} className="atlas-toc__group">
          <div className="atlas-toc__section typo-label">{s.label}</div>
          {ATLAS_ROWS.filter((r) => r.section === s.key).map((r) => (
            <KitButton key={r.key} quiet className="atlas-toc__row" onClick={() => jump(`atlas-dim-${r.key}`)}>
              <InkDot ink={inkOf(p, r)} /> {r.label}
            </KitButton>
          ))}
        </div>
      ))}
    </nav>
  );

  const main = (
    <div className="atlas-doc">
      <Section
        eyebrow={W.eyebrowPassport}
        title={<>{name}{qualifier && <span className="k-quiet k-regular"> {qualifier}</span>}</>}
        meta={p.identity.root ? <span className="typo-code k-quiet">{p.identity.root}</span> : undefined}
        actions={onOpenWorkspace ? <KitButton onClick={onOpenWorkspace} testId="atlas-open-workspace">{W.openWorkspace}</KitButton> : undefined}
      >
        {unknown && (
          <div className="atlas-notice typo-body" role="note">
            <strong>{W.unreadable}</strong> {W.unreadableNote}
          </div>
        )}
        <div className="atlas-actions-row">{actions}</div>
        <StatStrip tiles={[
          { label: W.automation, value: unknown ? null : a.score, unit: AUTOMATION_LABEL[a.level], draw: unknown ? undefined : scoreDraw(a.score, toneOf(a.score)) },
          { label: W.production, value: unknown ? null : pr.score, unit: PROD_BAND_LABEL[pr.band], draw: unknown ? undefined : scoreDraw(pr.score, toneOf(pr.score)) },
          { label: W.golden, value: `${golden.goldenPct}%`, draw: <UnitStrip size="s" label={`${golden.dims.filter((d) => d.met).length} of ${golden.dims.length}`} segments={golden.dims.map((d) => ({ n: 1, tone: d.met ? 'success' : 'error', glyph: 'solid' }))} /> },
          { label: W.blockers, value: blockers.length, draw: <UnitStrip size="s" label={`${blockers.length}`} segments={[{ n: blockers.length, tone: 'error', glyph: 'solid' }]} /> },
        ]} />
        <div className="atlas-ladders">
          <Ladder steps={AUTOMATION_SCALE.map((l) => AUTOMATION_LABEL[l])} reached={AUTOMATION_SCALE.indexOf(a.level)} unverified={unknown} />
          <Ladder steps={PROD_BAND_SCALE.map((b) => PROD_BAND_LABEL[b])} reached={PROD_BAND_SCALE.indexOf(pr.band)} unverified={unknown} />
        </div>
      </Section>

      <Section id="atlas-sec-blockers" title={W.whyNotReady} count={blockers.length}>
        {blockers.length === 0
          ? <p className="k-in typo-body k-quiet">{W.noBlockers}</p>
          : <ul className="atlas-blockers">{blockers.map((b) => <li key={b} className="typo-body"><InkDot ink={unknown ? 'unknown' : 'bad'} />{b}</li>)}</ul>}
      </Section>

      {SECTIONS.map((s) => {
        const rows = ATLAS_ROWS.filter((r) => r.section === s.key);
        return (
          <Section key={s.key} id={`atlas-sec-${s.key}`} title={s.label} count={rows.length}>
            <div className="atlas-dims">
              {rows.map((r) => (
                <div key={r.key} id={`atlas-dim-${r.key}`} className="atlas-dims__row">
                  <DimensionBody p={p} row={r} doors={doors} />
                </div>
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );

  return (
    <div className="atlas-passport" data-testid={`atlas-passport-${p.identity.slug}`}>
      <div className="atlas-passport__bar">
        <KitButton onClick={onBack} hint="Esc" testId="atlas-back">← {W.back}</KitButton>
        <KitButton onClick={() => onStep(-1)} hint="[" disabled={!hasPrev}>{W.prev}</KitButton>
        <KitButton onClick={() => onStep(1)} hint="]" disabled={!hasNext}>{W.next}</KitButton>
        <span className="atlas-readout__keys typo-caption k-quiet">{W.keysPassport}</span>
      </div>
      <Split main={main} pane={contents} paneLabel={W.contents} />
    </div>
  );
}
