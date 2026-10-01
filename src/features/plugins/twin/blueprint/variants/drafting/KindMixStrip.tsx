import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { StepKind } from '../../blueprintContract';
import { kindShares } from './draftingTwinModel';
import DrawFrame from './draw/DrawFrame';
import Write, { WriteNumber } from './draw/Write';

/**
 * The answered question kinds as one bar in section linings, each kind its
 * own pattern the way a drawing marks materials, each segment as wide as its
 * share of all answers. `legend` (L2) keys every pattern with its count. The
 * bar is a frame; its linings sweep in one after another; each key is its own
 * container.
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
    return (
      <span className="relative block h-4 w-full" style={{ border: '1px solid transparent' }} data-kinds="0">
        <DrawFrame stroke="var(--ink-dim)" dash="4 3" />
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-kinds={parts.length} data-draw-scope="">
      <span className="relative flex h-4 w-full" style={{ border: '1px solid transparent' }}>
        <DrawFrame stroke="var(--ink)" />
        {parts.map((p, i) => (
          <Tooltip key={p.kind} content={kinds[p.kind]}>
            <span
              data-kind={p.kind}
              data-draw="sweep"
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
            <li key={p.kind} className="flex items-center gap-2" data-draw-scope="">
              <span aria-hidden className="relative h-4 w-6 shrink-0" style={{ border: '1px solid transparent' }}>
                <DrawFrame stroke="var(--ink)" />
                <span data-draw="sweep" className={`twd-lining-${p.kind} absolute inset-0`} />
              </span>
              <Write text={kinds[p.kind]} className="typo-body text-foreground" />
              <WriteNumber value={p.n} className="typo-data text-foreground" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
