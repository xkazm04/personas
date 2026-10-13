import { useTranslation } from '@/i18n/useTranslation';
import type { EffortBand } from '@/lib/bindings/EffortBand';
import type { ResourceProfile } from '@/lib/bindings/ResourceProfile';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { formatNumeric } from '@/lib/utils/formatters';
import { EFFORT_BAND_CODES } from '../libs/charterSpec';
import { useCharterMeasured } from '../libs/useCharterMeasured';
import { CharterMeasuredAxes } from './CharterMeasuredAxes';

/**
 * Declared vs measured. Static label chrome always renders; the ghost sits
 * under it only while the first fetch for this persona is in flight. Two
 * measurements share the box: plan effort from token counts (passes), and the
 * machine load from process sampling (resource runs) - each says "not yet" on
 * its own terms, since a charter can have one without the other.
 *
 * Split out of `CharterResourceCard` (spark device-mesh WP3).
 */
export function CharterMeasuredRow({
  personaId,
  charterId,
  declared,
  stored,
}: {
  personaId: string;
  charterId: string;
  declared: EffortBand;
  /** The saved profile, for the measured-load mismatch badge. */
  stored: ResourceProfile | null;
}) {
  const { t, tx, language } = useTranslation();
  const c = t.agents.responsibilities;
  const { measured, isLoading } = useCharterMeasured(personaId, charterId);
  const band = measured?.measuredEffort ?? null;
  const mismatch = band != null && band !== declared;

  return (
    <div
      className={`rounded-card border px-3 py-2 flex flex-col gap-1.5 ${
        mismatch ? 'border-status-warning/40 bg-status-warning/10' : 'border-primary/10 bg-secondary/20'
      }`}
      data-testid="resp-profile-measured"
      data-mismatch={mismatch ? 'true' : 'false'}
    >
      <span className="typo-label text-foreground">{c.profile_measured_label}</span>
      {isLoading ? (
        <div className="h-4 w-2/3 rounded-interactive bg-secondary/40" aria-hidden="true" data-testid="resp-profile-measured-ghost" />
      ) : band == null || !measured ? (
        <Tooltip content={c.profile_not_measured_tooltip}>
          <span className="typo-caption text-foreground" data-testid="resp-profile-not-measured">
            {measured && measured.passes > 0
              ? tx(c.profile_not_measured_passes, { passes: formatNumeric(measured.passes, 'count', { language }) })
              : c.profile_not_measured}
          </span>
        </Tooltip>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 typo-caption text-foreground">
            <div className="flex gap-1.5">
              <dt className="text-foreground">{c.profile_measured_passes}</dt>
              <dd><Numeric value={measured.passes} unit="count" /></dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-foreground">{c.profile_measured_cost}</dt>
              <dd><Numeric value={measured.avgCostUsd} unit="usd" /></dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-foreground">{c.profile_measured_tokens}</dt>
              <dd><Numeric value={measured.avgTokens} unit="compact" /></dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-foreground">{c.profile_measured_band}</dt>
              <dd className={mismatch ? 'text-status-warning' : undefined} data-testid="resp-profile-measured-band">
                {EFFORT_BAND_CODES[band]}
              </dd>
            </div>
          </dl>
          {mismatch && (
            <p className="typo-caption text-status-warning" data-testid="resp-profile-mismatch">
              {tx(c.profile_mismatch_line, {
                measured: EFFORT_BAND_CODES[band],
                passes: formatNumeric(measured.passes, 'count', { language }),
                declared: EFFORT_BAND_CODES[declared],
              })}
            </p>
          )}
        </>
      )}
      {!isLoading && measured && <CharterMeasuredAxes measured={measured} stored={stored} />}
    </div>
  );
}
