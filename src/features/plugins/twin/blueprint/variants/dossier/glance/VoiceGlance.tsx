/**
 * Dossier (WP9), Voice at a glance: one row per channel - where its style came
 * from (a kit dot), its name, its eight style dimensions as a fingerprint on
 * the 1..5 range, and (layer one only) its exemplars and rules against the
 * slots the prompt compiler reads. Past five channels the rest fold into one
 * "+N" row of dots; the full list is the L2 board.
 */
import { Dot } from '@/features/shared/components/kit';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

import {
  EXEMPLARS_FULL_AT, RULES_FULL_AT, VOICE_ROWS_L1, VOICE_ROWS_ROOMY, VOICE_ROWS_STAGE, VOICE_ROWS_STAGE_ROOMY,
  channelLabel, foldRows, originMark,
} from '../dossierModel';
import { PipMeter } from '../PipMeter';
import { StyleFingerprint } from '../StyleFingerprint';
import type { GlanceProps } from './glanceTypes';

export function VoiceGlance({ model, compact, roomy, delta, spring, reduced }: GlanceProps) {
  const { t, tx } = useTranslation();
  const tb = t.twin.blueprint;
  const copy = tb.variantCopy.dossier;
  const everywhere = t.twin.experience.sheet.everywhere;
  const cap = compact ? (roomy ? VOICE_ROWS_STAGE_ROOMY : VOICE_ROWS_STAGE) : roomy ? VOICE_ROWS_ROOMY : VOICE_ROWS_L1;
  const { shown, more } = foldRows(model.voice.channels, cap);
  const folded = model.voice.channels.slice(shown.length);
  const hotChannel = delta?.channel ?? null;

  return (
    <div className="dossier-voice k-in" data-compact={compact ? 'true' : undefined} data-testid="dossier-voice">
      {!compact && (
        <div className="dossier-voice__row dossier-voice__head" aria-hidden="true">
          <span className="typo-label dossier-key">{tb.metrics.channels}</span>
          <span className="typo-label dossier-key">{tb.metrics.style}</span>
          <span className="typo-label dossier-key">{tb.metrics.samples}</span>
          <span className="typo-label dossier-key">{tb.metrics.rules}</span>
        </div>
      )}
      {shown.map((c) => {
        const name = channelLabel(c.channel, everywhere);
        const mark = originMark(c.origin);
        const hot = hotChannel === c.channel;
        return (
          <div key={c.channel} className="dossier-voice__row" data-hot={hot ? 'true' : undefined} data-channel={c.channel}>
            <span className="dossier-voice__name">
              <Dot tone={mark.tone} glyph={mark.glyph} />
              <span className="typo-body">{name}</span>
            </span>
            <StyleFingerprint dims={c.dims} channel={name} testId={`dossier-print-${c.channel}`} />
            {!compact && (
              <>
                <PipMeter
                  value={c.exemplars}
                  slots={EXEMPLARS_FULL_AT}
                  label={tx(copy.samplesOf, { count: c.exemplars, max: EXEMPLARS_FULL_AT })}
                  size={roomy ? 'm' : 's'}
                  spring={spring && hot}
                  reduced={reduced}
                />
                <PipMeter
                  value={c.rules}
                  slots={RULES_FULL_AT}
                  label={tx(copy.rulesOf, { count: c.rules, max: RULES_FULL_AT })}
                  tone="info"
                  size={roomy ? 'm' : 's'}
                  spring={spring && hot}
                  reduced={reduced}
                />
              </>
            )}
          </div>
        );
      })}
      {more > 0 && (
        <div className="dossier-voice__row dossier-voice__more" data-testid="dossier-voice-more">
          <span className="dossier-voice__name">
            <span aria-hidden="true">
              <Numeric className="typo-data">
                +<Numeric value={more} />
              </Numeric>
            </span>
            <span className="sr-only">{tx(copy.moreChannels, { count: more })}</span>
          </span>
          <span className="dossier-voice__dots" aria-hidden="true">
            {folded.map((c) => {
              const mark = originMark(c.origin);
              return <Dot key={c.channel} tone={mark.tone} glyph={mark.glyph} />;
            })}
          </span>
        </div>
      )}
    </div>
  );
}
