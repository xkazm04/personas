/**
 * Voice at L2: one row per channel. Samples (full at the five the prompt
 * compiler renders) and rules (full at eight) as meters with their counts, a
 * directives mark, the eight style dims as a 1..5 profile (hatched when no
 * style is stored) and where the voice came from as a glyph. A row opens that
 * channel in L3.
 */
import { Check, Dices, Feather, Layers, PenLine } from 'lucide-react';

import { Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { BlueprintChannel, TwinBlueprintModel, VoiceOrigin } from '../../../blueprintContract';
import { STYLE_DIMENSIONS } from '../../../../setup/style/styleContract';
import { StrataFigure } from '../StrataFigure';
import { DIM_MAX, EXEMPLARS_FULL_AT, RULES_FULL_AT, channelLabel } from '../strataModel';
import { PressRow, StrataMeter } from './StrataMeter';

const ORIGIN_ICON: Record<VoiceOrigin, typeof Layers> = { preset: Layers, rolled: Dices, learned: Feather, manual: PenLine };
const LEVELS = ['l1', 'l2', 'l3', 'l4', 'l5'] as const;
/** A stored dim (an integer 1..5, the Rust style door's range) as its level-name key. */
const levelKey = (v: number) => LEVELS[Math.min(DIM_MAX, Math.max(1, Math.round(v))) - 1] ?? 'l3';

export function VoiceDetail({ model, onOpen }: { model: TwinBlueprintModel; onOpen: (key?: string) => void }) {
  const { t } = useTranslation();
  const tm = t.twin.blueprint.metrics;
  if (model.voice.channels.length === 0) {
    return <p className="typo-body text-foreground" data-measured="false">{t.twin.blueprint.states.emptyVoice}</p>;
  }
  return (
    <div className="strata-voice" role="list">
      <div className="strata-voice-row strata-voice-head" aria-hidden>
        <span className="typo-label">{tm.channels}</span>
        <span className="typo-label">{tm.samples}</span>
        <span className="typo-label">{tm.rules}</span>
        <span className="typo-label">{tm.directives}</span>
        <span className="typo-label">{tm.style}</span>
        <span />
      </div>
      {model.voice.channels.map((c) => (
        <div role="listitem" key={c.channel}>
          <ChannelRow channel={c} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

function ChannelRow({ channel: c, onOpen }: { channel: BlueprintChannel; onOpen: (key?: string) => void }) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const name = channelLabel(c.channel, t.twin.experience.sheet.everywhere);
  const originLabel: Record<VoiceOrigin, string> = {
    preset: tb.metrics.originPreset, rolled: tb.metrics.originRolled, learned: tb.metrics.originLearned, manual: tb.metrics.originManual,
  };
  const Origin = c.origin ? ORIGIN_ICON[c.origin] : null;
  const dims = c.dims;
  const dimsHint = dims
    ? STYLE_DIMENSIONS.map((d) => `${t.twin.style.dims[d].label}: ${t.twin.style.dims[d][levelKey(dims[d])]}`).join(' · ')
    : tb.metrics.noStyle;

  return (
    <PressRow label={name} onPress={() => onOpen(c.channel)} className="strata-voice-row" testId={`strata-channel-${c.channel}`}>
      <span className="typo-body text-foreground truncate">{name}</span>
      <span className="strata-meter-cell">
        <StrataMeter value={c.origin === null ? null : c.exemplars} fullAt={EXEMPLARS_FULL_AT} />
        <StrataFigure value={c.exemplars} className="typo-data text-foreground" />
      </span>
      <span className="strata-meter-cell">
        <StrataMeter value={c.origin === null ? null : c.rules} fullAt={RULES_FULL_AT} />
        <StrataFigure value={c.rules} className="typo-data text-foreground" />
      </span>
      <Hint content={c.hasDirectives ? tb.metrics.directives : tb.states.notDrawn}>
        <span className="strata-mark" data-on={c.hasDirectives ? 'true' : 'false'}>
          {c.hasDirectives && <Check className="w-4 h-4" aria-hidden />}
        </span>
      </Hint>
      <Hint content={dimsHint}>
        <span className="strata-dims" data-measured={dims ? 'true' : 'false'}>
          {STYLE_DIMENSIONS.map((d) => (
            <i key={d} style={{ height: dims ? `${(dims[d] / DIM_MAX) * 100}%` : '100%' }} />
          ))}
        </span>
      </Hint>
      <Hint content={c.origin ? originLabel[c.origin] : tb.states.notDrawn}>
        <span className="strata-origin" data-origin={c.origin ?? 'none'}>
          {Origin && <Origin className="w-4 h-4" aria-hidden />}
        </span>
      </Hint>
    </PressRow>
  );
}
