import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { VoiceOrigin } from '../../blueprintContract';
import Write from './draw/Write';

const ORIGINS: readonly VoiceOrigin[] = ['preset', 'rolled', 'learned', 'manual'];

/** Where a channel's style came from, as a drafting symbol: circle, square, triangle, diamond. */
export function OriginMark({ origin }: { origin: VoiceOrigin | null }) {
  const label = useOriginLabel(origin);
  return (
    <Tooltip content={label}>
      <span className="inline-flex" data-origin={origin ?? 'none'}>
        <Symbol origin={origin} />
      </span>
    </Tooltip>
  );
}

/** The schedule's key: each symbol beside its words, each key drawn as its own container. */
export function OriginLegend() {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  const words: Record<VoiceOrigin, string> = { preset: m.originPreset, rolled: m.originRolled, learned: m.originLearned, manual: m.originManual };
  return (
    <ul className="flex flex-wrap items-center gap-x-6 gap-y-1 pt-1">
      {ORIGINS.map((o) => (
        <li key={o} className="flex items-center gap-2" data-draw-scope="">
          <Symbol origin={o} />
          <Write text={words[o]} className="typo-caption" />
        </li>
      ))}
    </ul>
  );
}

function useOriginLabel(origin: VoiceOrigin | null): string {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  if (origin === null) return m.noStyle;
  return { preset: m.originPreset, rolled: m.originRolled, learned: m.originLearned, manual: m.originManual }[origin];
}

/** A symbol is traced as a stroke; the learned triangle's tint goes in once it is closed. */
function Symbol({ origin }: { origin: VoiceOrigin | null }) {
  const stroke = origin === null ? 'var(--ink-dim)' : 'var(--ink-strong)';
  const line = { fill: 'none', stroke, strokeWidth: 1.5, pathLength: 100, 'data-draw': 'stroke' } as const;
  return (
    <svg aria-hidden width={18} height={18} className="shrink-0 overflow-visible">
      {origin === 'preset' && <circle cx={9} cy={9} r={7} {...line} />}
      {origin === 'rolled' && <rect x={2} y={2} width={14} height={14} {...line} />}
      {origin === 'learned' && (
        <>
          <path d="M9 1.5 L16.5 15.5 L1.5 15.5 Z" {...line} />
          <path d="M9 1.5 L16.5 15.5 L1.5 15.5 Z" fill="color-mix(in srgb, var(--ink) 35%, transparent)" data-draw="mark" />
        </>
      )}
      {origin === 'manual' && <path d="M9 1 L17 9 L9 17 L1 9 Z" {...line} />}
      {origin === null && <circle cx={9} cy={9} r={7} fill="none" stroke={stroke} strokeDasharray="3 2" data-draw="mark" />}
    </svg>
  );
}
