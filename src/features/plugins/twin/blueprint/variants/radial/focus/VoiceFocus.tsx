/**
 * L2 Voice: the quadrant unfolded into a full ring. Inner cells: each
 * channel's share of the Voice headline (directives full, a stored style only
 * half). Outer spokes: samples (0..5) and rules (0..8) side by side, the style
 * star on one outer ring. The panel names every channel with its counts and
 * opens it in L3.
 */
import { useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { TwinBlueprintModel, VoiceOrigin } from '../../../blueprintContract';
import { CellRing } from '../glyphs/CellRing';
import type { RadialIds } from '../glyphs/primitives';
import { StyleStar } from '../glyphs/StyleStar';
import { VoiceSpokes } from '../glyphs/VoiceSpokes';
import { RadialFigure } from '../RadialFigure';
import { EXEMPLARS_FULL_AT, RULES_FULL_AT, channelCredit, channelLabel } from '../radialModel';
import { FocusBody, FocusFigure } from './FocusBody';
import { ItemRow, LegendKey, PanelGroup, StatLine, joinLabel } from './PanelParts';

interface VoiceFocusProps {
  model: TwinBlueprintModel;
  ids: RadialIds;
  panelW: number;
  reduced: boolean;
  onOpen: (itemKey?: string) => void;
}

const CREDIT: [number, number] = [0.29, 0.43];
const SPOKES: [number, number] = [0.5, 1];

export function VoiceFocus({ model, ids, panelW, reduced, onOpen }: VoiceFocusProps) {
  const { t, tx } = useTranslation();
  const tb = t.twin.blueprint;
  const rc = tb.variantCopy.radial;
  const [hot, setHot] = useState<string | null>(null);
  const channels = model.voice.channels;
  const everywhere = t.twin.experience.table.everywhere;
  const origin: Record<VoiceOrigin, string> = {
    preset: tb.metrics.originPreset,
    rolled: tb.metrics.originRolled,
    learned: tb.metrics.originLearned,
    manual: tb.metrics.originManual,
  };

  return (
    <FocusBody
      panelW={panelW}
      reduced={reduced}
      figure={(geo) => (
        <FocusFigure geo={geo} ids={ids} hub={{ value: channels.length, label: tb.metrics.channels }} guides={[...CREDIT, SPOKES[0], 1]}>
          <CellRing
            band={{ cx: geo.cx, cy: geo.cy, r0: geo.R * CREDIT[0], r1: geo.R * CREDIT[1], a0: 0, a1: 360 }}
            cells={channels.map((c) => ({ key: c.channel, solid: channelCredit(c) }))}
            ids={ids}
            hot={hot}
            onHot={setHot}
            onPick={onOpen}
            testId="radial-voice-credit"
          />
          <VoiceSpokes
            band={{ cx: geo.cx, cy: geo.cy, r0: geo.R * SPOKES[0], r1: geo.R * SPOKES[1], a0: 0, a1: 360 }}
            channels={channels}
            detail
            hot={hot}
            onHot={setHot}
            onPick={onOpen}
          />
        </FocusFigure>
      )}
      panel={
        <>
          <div className="rd-legend" data-testid="radial-voice-legend">
            <LegendKey kind="fill" ids={ids} label={tb.metrics.directives} />
            <LegendKey kind="half" also="star" ids={ids} label={tb.metrics.style} />
            <LegendKey kind="spoke" ids={ids} label={joinLabel(tb.metrics.samples, tx(rc.fullAt, { count: EXEMPLARS_FULL_AT }))} />
            <LegendKey kind="rule" ids={ids} label={joinLabel(tb.metrics.rules, tx(rc.fullAt, { count: RULES_FULL_AT }))} />
            <LegendKey kind="dash" ids={ids} label={tb.metrics.noStyle} />
          </div>
          <StatLine label={tb.metrics.samplesOpen} value={model.samples.open} testId="radial-samples-open" />
          <PanelGroup title={tb.metrics.channels} columns={[tb.metrics.samples, tb.metrics.rules]} testId="radial-voice-rows">
            {channels.length === 0 && <p className="typo-caption">{tb.states.emptyVoice}</p>}
            {channels.map((c) => {
              const name = channelLabel(c.channel, everywhere);
              return (
                <ItemRow
                  key={c.channel}
                  label={joinLabel(
                    name,
                    c.origin ? origin[c.origin] : null,
                    `${tb.metrics.samples} ${c.exemplars}`,
                    `${tb.metrics.rules} ${c.rules}`,
                  )}
                  hot={hot === c.channel}
                  onHot={(on) => setHot(on ? c.channel : null)}
                  onPress={() => onOpen(c.channel)}
                  testId={`radial-channel-${c.channel}`}
                >
                  <svg className="rd-row-glyph" width="26" height="26" viewBox="0 0 26 26" aria-hidden focusable="false">
                    <StyleStar x={13} y={13} r={11} dims={c.dims} />
                  </svg>
                  <span className="rd-row-main">
                    <span className="typo-body text-foreground">{name}</span>
                  </span>
                  <RadialFigure value={c.exemplars} className="rd-col typo-data text-foreground" />
                  <RadialFigure value={c.rules} className="rd-col typo-data text-foreground" />
                </ItemRow>
              );
            })}
          </PanelGroup>
        </>
      }
    />
  );
}
