/**
 * L1 and stage: the sub-quantities each segment carries in the band outside
 * its coverage arc.
 * - Voice: one spoke per channel (samples, 0..5) with the style star at the tip.
 * - Training: six topic cells, approved solid and awaiting hatched (0..5).
 * - Knowledge: the approved / awaiting / rejected tri-arc, fact ticks outside it.
 * - Identity: the bio arc against its target, the language marks outside it.
 */
import type { SectionId, TopicId, TwinBlueprintModel } from '../../../blueprintContract';
import { CellRing, type Cell } from './CellRing';
import { LanguageDots } from './LanguageDots';
import { CompositionArc, ShareArc, TickRing, type RadialIds } from './primitives';
import { VoiceSpokes } from './VoiceSpokes';
import type { Band } from '../radialGeometry';
import { FACT_TICKS, LANGUAGE_MARKS, memoryParts, topicShares } from '../radialModel';

/** A band split at two depth fractions: the inner and outer sub-rings of one segment. */
export function splitBand(band: Band, innerTo: number, outerFrom: number): [Band, Band] {
  const depth = band.r1 - band.r0;
  return [
    { ...band, r1: band.r0 + innerTo * depth },
    { ...band, r0: band.r0 + outerFrom * depth },
  ];
}

export function topicCells(model: TwinBlueprintModel): Cell[] {
  return model.training.topics.map((t) => ({ key: t.id, ...topicShares(t) }));
}

interface SectionGlyphProps {
  section: SectionId;
  model: TwinBlueprintModel;
  band: Band;
  ids: RadialIds;
  /** Stage instant delta: the topic cell or channel spoke whose tick lights. */
  litTopic?: TopicId | null;
  litChannel?: string | null;
}

export function SectionGlyph({ section, model, band, ids, litTopic, litChannel }: SectionGlyphProps) {
  switch (section) {
    case 'voice':
      return <VoiceSpokes band={band} channels={model.voice.channels} lit={litChannel} />;
    case 'training':
      return <CellRing band={band} cells={topicCells(model)} ids={ids} lit={litTopic} gapPx={5} testId="radial-topics" />;
    case 'knowledge': {
      const [arc, ticks] = splitBand(band, 0.34, 0.56);
      return (
        <>
          <CompositionArc band={arc} parts={memoryParts(model.knowledge.memories)} ids={ids} testId="radial-memories" />
          <TickRing band={ticks} count={model.knowledge.facts} slots={FACT_TICKS} ids={ids} testId="radial-facts" />
        </>
      );
    }
    case 'identity': {
      const [bio, langs] = splitBand(band, 0.3, 0.62);
      return (
        <>
          <ShareArc band={bio} value={model.identity.bioChars} fullAt={model.identity.bioTarget} ids={ids} testId="radial-bio" />
          <LanguageDots band={{ ...langs, a1: langs.a1 - 4 }} count={model.identity.languages.length} slots={LANGUAGE_MARKS} />
        </>
      );
    }
  }
}
