// Passport Atlas — the portfolio's CHROME, once. The headline figures drawn as
// units, the lens / search / sort toolbar, the legend, and the readout of the
// current coordinate. Every count is derived from the passports in hand.
//
// This is structure, so the kit owns it (doctrine 6c): a figure never
// re-authors a toolbar or a stat strip. What it supplies is the drawing in the
// middle and, while the owner is comparing, the control that picks its look.
import { useMemo, useRef, type ReactNode } from 'react';
import { KitButton, SearchField, Segmented, StatStrip, Toolbar, UnitStrip } from '@/features/shared/components/kit';
import { NoResults } from '@/features/shared/components/feedback/ScenarioEmptyState';
import type { AppPassport } from '../passportModel';
import { inkOf, needCare, type AtlasLens, type AtlasRow, type AtlasSort } from './atlasModel';
import type { AtlasCoord, AtlasNames, AtlasSkin } from './atlasFigure';
import { InkDot, valueText } from './AtlasParts';
import { ATLAS_WORDS as W, INK_MARK, LEGEND_ORDER, LENSES, SORTS } from './atlasWords';

export interface PortfolioView { lens: AtlasLens; sort: AtlasSort; query: string; unfold: boolean; at: AtlasCoord }

export function AtlasPortfolioShell({ all, projects, rows, sharedSetup, names, view, onView, figure, skin, extraControls }: {
  all: AppPassport[];
  projects: AppPassport[];
  rows: AtlasRow[];
  sharedSetup: AtlasRow[];
  names: AtlasNames;
  view: PortfolioView;
  onView: (patch: Partial<PortfolioView>) => void;
  /** The figure, already wired to the model. Null when nothing matched. */
  figure: ReactNode;
  /** The benched look. Absent for the baseline, so its CSS is the bare class
   *  it always was; a look is an attribute the legend and readout share with
   *  the figure, which is why it is set here and not inside the matrix. */
  skin?: AtlasSkin;
  /** Dev-only look picker; absent in a production build. */
  extraControls?: ReactNode;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const care = needCare(all);
  const unknown = all.filter((p) => p.repoUnreadable).length;
  const current = projects[view.at.pi];
  const row = rows[view.at.di];
  const tiles = useMemo(() => [
    { label: W.repositories, value: all.length, draw: <UnitStrip size="s" label={`${all.length}`} segments={[{ n: all.length, tone: 'primary', glyph: 'solid' }]} /> },
    { label: W.needCare, value: care, draw: <UnitStrip size="s" label={`${care} of ${all.length}`} segments={[{ n: care, tone: 'error', glyph: 'solid' }, { n: all.length - care, tone: 'neutral', glyph: 'empty' }]} /> },
    { label: W.repoUnknown, value: unknown, draw: <UnitStrip size="s" label={`${unknown} of ${all.length}`} segments={[{ n: unknown, tone: 'neutral', glyph: 'soft' }, { n: all.length - unknown, tone: 'neutral', glyph: 'empty' }]} /> },
  ], [all.length, care, unknown]);

  return (
    <div
      className="atlas-portfolio"
      data-skin={skin}
      onKeyDown={(e) => {
        if (e.key === '/' && (e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); searchRef.current?.focus(); }
      }}
    >
      <StatStrip tiles={tiles} />
      <Toolbar label={W.portfolio}>
        <Segmented label={W.lens} options={LENSES} value={view.lens} onChange={(lens) => onView({ lens, at: { pi: view.at.pi, di: 0 } })} />
        <SearchField value={view.query} onChange={(query) => onView({ query, at: { pi: 0, di: view.at.di } })} placeholder={W.find} inputRef={searchRef} testId="atlas-search" />
        <Segmented label={W.sort} options={SORTS} value={view.sort} onChange={(sort) => onView({ sort, at: { pi: 0, di: view.at.di } })} />
        {sharedSetup.length > 0 && (
          <KitButton pressed={view.unfold} onClick={() => onView({ unfold: !view.unfold })} testId="atlas-shared-setup">
            <InkDot ink="setup" /> {W.sharedSetup(sharedSetup.length)}
          </KitButton>
        )}
        {extraControls}
      </Toolbar>
      <div className="atlas-legend typo-caption" aria-hidden="true">
        {LEGEND_ORDER.map((k) => <span key={k} className="atlas-legend__item"><InkDot ink={k} /> {INK_MARK[k].label}</span>)}
      </div>

      {/* The filtered-to-zero condition goes through the shared primitive, so it
          carries the app's recovery path instead of a local three-element row. */}
      {projects.length === 0
        ? <NoResults className="atlas-empty" onReset={() => onView({ query: '' })} title={W.noMatch} subtitle={W.noMatchHint} resetLabel={W.clearSearch} />
        : figure}

      <div className="atlas-readout typo-caption" aria-live="polite">
        {current && row ? (
          <>
            <InkDot ink={inkOf(current, row)} />
            <strong className="k-strong">{names.get(current.identity.slug)?.name ?? current.identity.name}</strong>
            <span className="k-quiet">/</span>
            <span>{row.label}</span>
            <span className="k-quiet k-ellipsis">{inkOf(current, row) === 'unknown' ? INK_MARK.unknown.label : valueText(row.get(current))}</span>
          </>
        ) : null}
        <span className="atlas-readout__keys k-quiet">{W.keysPortfolio}</span>
      </div>
    </div>
  );
}
