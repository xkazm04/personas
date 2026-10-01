import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { StepKind } from '../../blueprintContract';
import { kindShares } from './draftingTwinModel';

/**
 * The answered question kinds as one bar in section linings, each kind its
 * own pattern the way a drawing marks materials, each segment as wide as its
 * share of all answers. `legend` (L2) keys every pattern with its count.
 */
export default function KindMixStrip({
  mix,
  legend = false,
  highlight = null,
}: {
  mix: Partial<Record<StepKind, number>>;
  legend?: boolean;
  /** The kind the last answer was. */
  highlight?: StepKind | null;
}) {
  const { t } = useTranslation();
  const kinds = t.twin.blueprint.kinds;
  const parts = kindShares(mix);

  if (parts.length === 0) {
    return <span className="block h-4 w-full" style={{ border: '1px dashed var(--ink-dim)' }} data-kinds="0" />;
  }
  return (
    <div className="flex flex-col gap-2" data-kinds={parts.length}>
      <span className="flex h-4 w-full" style={{ border: '1px solid var(--ink)' }}>
        {parts.map((p, i) => (
          <Tooltip key={p.kind} content={kinds[p.kind]}>
            <span
              data-kind={p.kind}
              className={`twd-lining-${p.kind} h-full`}
              style={{
                width: `${p.share * 100}%`,
                borderLeft: i > 0 ? '1px solid var(--ink)' : undefined,
                boxShadow: highlight === p.kind ? 'inset 0 0 0 2px var(--ink-strong)' : undefined,
              }}
            />
          </Tooltip>
        ))}
      </span>
      {legend && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
          {parts.map((p) => (
            <li key={p.kind} className="flex items-center gap-2">
              <span aria-hidden className={`twd-lining-${p.kind} h-4 w-6 shrink-0`} style={{ border: '1px solid var(--ink)' }} />
              <span className="typo-body text-foreground">{kinds[p.kind]}</span>
              <Numeric value={p.n} className="typo-data text-foreground" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
