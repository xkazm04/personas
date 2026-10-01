import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { TwinBlueprintModel } from '../../blueprintContract';
import DimensionLine from './DimensionLine';
import { Letter } from './Lettering';

type Identity = TwinBlueprintModel['identity'];

/**
 * Identity as a drawing: the bio's length as a dimension line against its
 * target, and each language as a balloon. `detailed` (L2) letters the scale
 * and names every language under its balloon.
 */
export default function IdentityDrawing({
  identity,
  detailed = false,
  compact = false,
  drawn,
  reduced,
}: {
  identity: Identity;
  detailed?: boolean;
  /** Stage mode: smaller balloons, so four fit the column beside the card. */
  compact?: boolean;
  drawn: boolean;
  reduced: boolean;
}) {
  const { t, language } = useTranslation();
  const m = t.twin.blueprint.metrics;
  const balloon = detailed ? 52 : compact ? 30 : 36;
  // An engine without DisplayNames still names the language by its balloon's code.
  const names = useMemo(
    () => (typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([language], { type: 'language' }) : null),
    [language],
  );

  return (
    <div className={`flex min-h-0 flex-col ${detailed ? 'gap-8' : compact ? 'gap-2' : 'gap-4'}`}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <Letter>{m.bio}</Letter>
          {identity.bioChars === null ? (
            <span className="typo-caption" data-measured="false">
              {t.twin.blueprint.states.notDrawn}
            </span>
          ) : (
            <Numeric value={identity.bioChars} className={detailed ? 'typo-data-lg text-foreground' : 'typo-data text-foreground'} />
          )}
        </div>
        <DimensionLine value={identity.bioChars} target={identity.bioTarget} detailed={detailed} drawn={drawn} reduced={reduced} />
      </div>
      <div className="flex flex-col gap-2">
        {compact ? <span className="sr-only">{m.languages}</span> : <Letter className={detailed ? '' : 'twd-head-l1'}>{m.languages}</Letter>}
        {identity.languages.length === 0 ? (
          <div className="flex items-center gap-3">
            <LanguageBalloon code="-" pending size={balloon} />
            <span className="typo-caption">{m.noLanguages}</span>
          </div>
        ) : (
          <ul className={`flex flex-wrap ${detailed ? 'gap-6' : compact ? 'gap-2' : 'gap-2.5'}`}>
            {identity.languages.map((code) => (
              <li key={code} className="flex flex-col items-center gap-2">
                <LanguageBalloon code={code} size={balloon} />
                {detailed && <span className="typo-body text-foreground">{names?.of(code) ?? code}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LanguageBalloon({ code, size, pending = false }: { code: string; size: number; pending?: boolean }) {
  return (
    <span
      className="typo-label inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        border: `1.5px ${pending ? 'dashed' : 'solid'} ${pending ? 'var(--ink-dim)' : 'var(--ink)'}`,
        color: 'var(--ink-strong)',
        boxShadow: pending ? undefined : '0 0 14px color-mix(in srgb, var(--primary) 16%, transparent)',
      }}
    >
      {code}
    </span>
  );
}
