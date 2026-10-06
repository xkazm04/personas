// THESIS — a reader who came for ONE project should not have to find a column.
// The project is the unit: its tile carries its two scores, its gap count and
// the dimensions that are actually failing, NAMED in the lens's reading order
// instead of drawn as marks the eye has to map back to a heading. The portfolio
// becomes a scan of named faults.
//
// A project-major reading of the same model: same projects, same lens rows,
// same two doors. Not a grid, so no roving coordinate of its own; pressing a
// tile opens the passport and pressing a named gap opens that cell, which is
// the matrix's two doors in the order a project-first reader wants them.
import { Tile, Tiles } from '@/features/shared/components/kit';
import { Button } from '@/features/shared/components/buttons';
import type { AppPassport } from '../../../passportModel';
import { countInk, inkOf } from '../../atlasModel';
import { InkDot } from '../../AtlasParts';
import { ATLAS_WORDS as W, INK_MARK } from '../../atlasWords';
import type { AtlasFigureProps } from '../../atlasFigure';

/** Named gaps per tile before the rest are counted; a tile is a summary, not a list. */
const NAMED = 6;

const worstOf = (p: AppPassport) =>
  p.repoUnreadable ? 'unknown' as const
    : countInk(p, 'bad') ? 'bad' as const
      : countInk(p, 'warn') ? 'warn' as const : 'good' as const;

export function DossierFigure({ projects, rows, names, onOpenCell, onOpenProject }: AtlasFigureProps) {
  return (
    <div className="atlas-dossier" data-testid="atlas-dossier">
      <Tiles label={W.dossierLabel}>
        {projects.map((p, pi) => {
          const nm = names.get(p.identity.slug);
          const worst = worstOf(p);
          // Failing first, then attention: the lens's own order inside each band.
          const gaps = [
            ...rows.map((r, di) => ({ r, di, ink: inkOf(p, r) })).filter((g) => g.ink === 'bad'),
            ...rows.map((r, di) => ({ r, di, ink: inkOf(p, r) })).filter((g) => g.ink === 'warn'),
          ];
          const unreadable = Boolean(p.repoUnreadable);
          return (
            <Tile
              key={p.identity.slug}
              span={4}
              title={nm?.name ?? p.identity.name}
              count={unreadable ? '?' : gaps.length}
              mark={{ tone: INK_MARK[worst].tone, glyph: INK_MARK[worst].glyph, label: INK_MARK[worst].label }}
              meta={
                <span className="atlas-dossier__meta typo-caption tabular-nums">
                  {W.scoresOf(
                    unreadable ? '-' : p.automationReadiness.score,
                    unreadable ? '-' : p.productionReadiness.score,
                  )}
                  {nm?.qualifier && <span className="k-quiet"> {nm.qualifier}</span>}
                </span>
              }
              onPress={() => onOpenProject(p.identity.slug)}
              testId={`atlas-dossier-${p.identity.slug}`}
            >
              {unreadable ? (
                <p className="atlas-dossier__note typo-caption">{W.unreadable}</p>
              ) : gaps.length === 0 ? (
                <p className="atlas-dossier__note typo-caption"><InkDot ink="good" /> {INK_MARK.good.label}</p>
              ) : (
                <div className="atlas-dossier__gaps">
                  {gaps.slice(0, NAMED).map((g) => (
                    <Button
                      key={g.r.key}
                      variant="ghost"
                      size="sm"
                      className="atlas-dossier__gap"
                      onClick={(e) => { e.stopPropagation(); onOpenCell({ pi, di: g.di }); }}
                      data-testid={`atlas-dossier-${p.identity.slug}-${g.r.key}`}
                    >
                      <InkDot ink={g.ink} />
                      <span className="k-ellipsis">{g.r.label}</span>
                    </Button>
                  ))}
                  {gaps.length > NAMED && (
                    <span className="atlas-dossier__gap-more typo-caption tabular-nums">{W.more(gaps.length - NAMED)}</span>
                  )}
                </div>
              )}
            </Tile>
          );
        })}
      </Tiles>
    </div>
  );
}
