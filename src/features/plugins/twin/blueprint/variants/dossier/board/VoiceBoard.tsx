/**
 * Dossier (WP9), the Voice board (L2): every channel as a column of one spec
 * matrix - the eight style dimensions as pips on the declared 1..5 range,
 * then exemplars and rules against the slots the prompt compiler reads, then
 * whether directives are written. A channel's head opens its full detail (L3).
 * Where each style came from is the dot before the channel's name; the
 * legend under the matrix names only the origins present. Past six channels
 * on a narrow board the channel names stand on two alternating tiers, so each
 * name keeps its full size without reaching into its neighbour's.
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import { ChipRow, Dot } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { BlueprintChannel, SectionId, VoiceOrigin } from '../../../blueprintContract';
import { STYLE_DIMENSIONS } from '../../../../setup/style/styleContract';
import { DIM_MAX, EXEMPLARS_FULL_AT, RULES_FULL_AT, channelLabel, originMark } from '../dossierModel';
import { NotMeasured } from '../Figure';
import { PipMeter } from '../PipMeter';
import { useOriginLabel } from './useOriginLabel';

/** Channels past which a narrow board staggers the column heads. */
const STAGGER_FROM = 7;

interface VoiceBoardProps {
  channels: readonly BlueprintChannel[];
  /** A wide content area: larger pips. */
  roomy?: boolean;
  onOpenDetail: (section: SectionId, itemKey?: string) => void;
  reduced: boolean;
}

export function VoiceBoard({ channels, roomy, onOpenDetail, reduced }: VoiceBoardProps) {
  const { t, tx } = useTranslation();
  const tb = t.twin.blueprint;
  const copy = tb.variantCopy.dossier;
  const everywhere = t.twin.experience.sheet.everywhere;
  const originLabel = useOriginLabel();
  const origins = [...new Set(channels.map((c) => c.origin))] as Array<VoiceOrigin | null>;

  const open = (channel: string) => onOpenDetail('voice', channel);
  const onKey = (channel: string) => (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(channel);
    }
  };

  const row = (key: string, head: string, cell: (c: BlueprintChannel) => ReactNode) => (
    <div key={key} role="row" className="dossier-matrix__row">
      <span role="rowheader" className="typo-label dossier-key dossier-matrix__label">{head}</span>
      {channels.map((c) => (
        <span key={c.channel} role="cell" className="dossier-matrix__cell">{cell(c)}</span>
      ))}
    </div>
  );

  return (
    <div className="dossier-board" data-testid="dossier-board-voice">
      <div
        className="dossier-matrix k-in"
        role="table"
        aria-label={tb.sections.voice}
        data-many={channels.length >= STAGGER_FROM ? 'true' : undefined}
        data-roomy={roomy ? 'true' : undefined}
        style={{ '--cols': channels.length } as CSSProperties}
      >
        <div role="row" className="dossier-matrix__row dossier-matrix__head">
          <span role="columnheader" className="dossier-matrix__label" />
          {channels.map((c) => {
            const name = channelLabel(c.channel, everywhere);
            const mark = originMark(c.origin);
            return (
              <span key={c.channel} role="columnheader" className="dossier-matrix__cell dossier-matrix__colhead">
                <span
                  role="button"
                  tabIndex={0}
                  className="dossier-chan"
                  aria-label={tx(tb.nav.zoomInto, { section: name })}
                  data-testid={`dossier-open-channel-${c.channel}`}
                  onClick={() => open(c.channel)}
                  onKeyDown={onKey(c.channel)}
                >
                  <Dot tone={mark.tone} glyph={mark.glyph} />
                  <span className="typo-label">{name}</span>
                </span>
              </span>
            );
          })}
        </div>
        {STYLE_DIMENSIONS.map((d) =>
          row(d, t.twin.style.dims[d].label, (c) =>
            c.dims ? (
              <PipMeter
                value={c.dims[d]}
                slots={DIM_MAX}
                size={roomy ? 'l' : 'm'}
                bare
                reduced={reduced}
                label={tx(copy.dimValue, { label: t.twin.style.dims[d].label, value: c.dims[d], max: DIM_MAX })}
              />
            ) : (
              <NotMeasured width="var(--dz-pip5-w)" height="var(--dz-pip-h)" />
            ),
          ),
        )}
        {row('samples', tb.metrics.samples, (c) => (
          <PipMeter value={c.exemplars} slots={EXEMPLARS_FULL_AT} size={roomy ? 'l' : 'm'} reduced={reduced}
            label={tx(copy.samplesOf, { count: c.exemplars, max: EXEMPLARS_FULL_AT })} />
        ))}
        {row('rules', tb.metrics.rules, (c) => (
          <PipMeter value={c.rules} slots={RULES_FULL_AT} tone="info" size={roomy ? 'm' : 's'} reduced={reduced}
            label={tx(copy.rulesOf, { count: c.rules, max: RULES_FULL_AT })} />
        ))}
        {row('directives', tb.metrics.directives, (c) => (
          <span role="img" aria-label={c.hasDirectives ? copy.directivesWritten : t.twin.detail.noDirectives}>
            <Dot tone={c.hasDirectives ? 'success' : 'neutral'} glyph={c.hasDirectives ? 'solid' : 'hollow'} />
          </span>
        ))}
      </div>
      <ChipRow
        label={tb.metrics.style}
        emptyLabel={tb.metrics.noStyle}
        chips={origins.map((o) => ({ id: o ?? 'none', label: originLabel(o), ...originMark(o) }))}
      />
    </div>
  );
}
