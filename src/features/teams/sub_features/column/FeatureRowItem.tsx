// One row of the feature column: ONE line of identity, ONE line of figures.
//
// Nothing here is a sentence. The name is the only prose, and when it has to be
// clipped it carries the full name in the shared tooltip rather than leaving
// the reader with a word cut in half.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { CouncilGlyph } from '@/features/plugins/dev-tools/sub_context/councilGlyph';
import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';
import { RowGlyph } from '@/features/teams/sub_council/table/svg/RowGlyph';

import { FEATURE_THRESHOLD, type FeatureRow } from '../featureRules';
import type { TFeatures } from '../featuresModel';
import { SpanStrip } from '../svg/RowFigures';

export interface FeatureRowItemProps {
  row: FeatureRow;
  totalGroups: number;
  selected: boolean;
  onSelect: (featureId: string) => void;
  onOpen: (featureId: string) => void;
  t: TFeatures;
  tDev: TDevTools;
  tx: (template: string, vars: Record<string, string | number>) => string;
  stateName: string;
}

export function FeatureRowItem({
  row,
  totalGroups,
  selected,
  onSelect,
  onOpen,
  t,
  tDev,
  tx,
  stateName,
}: FeatureRowItemProps) {
  const { feature } = row;
  const overall = feature.council?.overall ?? null;
  const coverage = feature.council?.coverage ?? null;
  const spanText = tx(t.span_label, { crossed: row.span, total: totalGroups });

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-testid="features-row"
      data-feature-slug={feature.slug}
      onClick={() => onSelect(feature.id)}
      onDoubleClick={() => onOpen(feature.id)}
      className={`flex w-full items-start gap-2.5 border-l-2 px-3 py-2 text-left focus-ring ${
        selected
          ? 'border-l-primary bg-primary/10'
          : 'border-l-transparent hover:bg-secondary/50'
      }`}
    >
      <RowGlyph
        overall={overall}
        coverage={coverage}
        threshold={FEATURE_THRESHOLD}
        floorHit={(feature.council?.floorHits ?? 0) > 0}
        size={34}
        label={tx(t.row_label, { name: feature.name, state: stateName })}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-1.5">
          <CouncilGlyph kind={row.kind} t={tDev} />
          {/* At ~300px the row has room for two lines, and a truncated name
              is the one thing a reader cannot recover from a glance. It wraps
              to two and only then clips; the tooltip carries the rare third. */}
          <Tooltip content={feature.name}>
            <span className="line-clamp-2 min-w-0 flex-1 break-words typo-body text-foreground">
              {feature.name}
            </span>
          </Tooltip>
          {feature.tier === 'major' ? (
            <Tooltip content={t.tier_major}>
              <span
                aria-label={t.tier_major}
                className="rounded-pill border border-primary/50 px-1.5 typo-caption text-primary"
              >
                {t.tier_major}
              </span>
            </Tooltip>
          ) : null}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <Tooltip content={spanText}>
            <SpanStrip crossed={row.span} total={totalGroups} label={spanText} />
          </Tooltip>
          {overall == null ? (
            <span className="typo-caption">{t.not_measured}</span>
          ) : (
            <Numeric value={overall} precision={2} className="typo-data text-foreground" />
          )}
        </span>
      </span>
    </button>
  );
}
