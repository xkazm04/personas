// Passport Atlas — the portfolio layer: the headline figures drawn as units,
// the lens / search / sort toolbar, the matrix, and the readout of the
// current coordinate. Every count is derived from the passports in hand.
import { useMemo, useRef } from 'react';
import { KitButton, SearchField, Segmented, StatStrip, Toolbar, UnitStrip } from '@/features/shared/components/kit';
import type { AppPassport } from '../passportModel';
import { inkOf, needCare, type AtlasLens, type AtlasRow, type AtlasSort } from './atlasModel';
import { AtlasMatrix, type AtlasCoord } from './AtlasMatrix';
import { InkDot, valueText } from './AtlasParts';
import { ATLAS_WORDS as W, INK_MARK, LEGEND_ORDER, LENSES, SORTS } from './atlasWords';

export interface PortfolioView { lens: AtlasLens; sort: AtlasSort; query: string; unfold: boolean; at: AtlasCoord }

export function AtlasPortfolio({ all, projects, rows, sharedSetup, names, view, onView, onOpenCell, onOpenProject }: {
  all: AppPassport[];
  projects: AppPassport[];
  rows: AtlasRow[];
  sharedSetup: AtlasRow[];
  names: Map<string, { name: string; qualifier: string | null }>;
  view: PortfolioView;
  onView: (patch: Partial<PortfolioView>) => void;
  onOpenCell: (c: AtlasCoord) => void;
  onOpenProject: (slug: string) => void;
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
      </Toolbar>
      <div className="atlas-legend typo-caption" aria-hidden="true">
        {LEGEND_ORDER.map((k) => <span key={k} className="atlas-legend__item"><InkDot ink={k} /> {INK_MARK[k].label}</span>)}
      </div>

      {projects.length === 0 ? (
        <div className="atlas-empty typo-body">
          <strong>{W.noMatch}</strong> <span className="k-quiet">{W.noMatchHint}</span>
          <KitButton onClick={() => onView({ query: '' })}>{W.clearSearch}</KitButton>
        </div>
      ) : (
        <AtlasMatrix projects={projects} rows={rows} names={names} at={view.at} onMove={(at) => onView({ at })} onOpenCell={onOpenCell} onOpenProject={onOpenProject} />
      )}

      <div className="atlas-readout typo-caption" aria-live="polite">
        {current && row ? (
          <>
            <InkDot ink={inkOf(current, row)} />
            <strong>{names.get(current.identity.slug)?.name ?? current.identity.name}</strong>
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
