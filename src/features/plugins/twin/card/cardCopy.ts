import type { TwinCardPartition } from '@/api/twin/twinCard';
import type { useTranslation } from '@/i18n/useTranslation';

type CardCopy = ReturnType<typeof useTranslation>['t']['twin']['card'];

/** Partition order everywhere a card is shown: the always-present voice core first. */
export const CARD_PARTITIONS: readonly TwinCardPartition[] = ['voice', 'knowledge', 'training', 'evidence'];

/** The partitions a passphrase can seal (the personal ones; voice and evidence stay readable). */
export const SEALABLE_PARTITIONS: readonly TwinCardPartition[] = ['knowledge', 'training'];

/** The spec's floor for a sealing passphrase. */
export const MIN_PASSPHRASE = 8;

/** A partition's name as a person reads it; an unknown name (a newer card) shows as written. */
export function partitionLabel(c: CardCopy, name: string): string {
  switch (name) {
    case 'voice':
      return c.partVoice;
    case 'knowledge':
      return c.partKnowledge;
    case 'training':
      return c.partTraining;
    case 'evidence':
      return c.partEvidence;
    default:
      return name;
  }
}

export function partitionHint(c: CardCopy, name: TwinCardPartition): string {
  return { voice: c.partVoiceHint, knowledge: c.partKnowledgeHint, training: c.partTrainingHint, evidence: c.partEvidenceHint }[name];
}

/** `<slug>.twin.json` per the spec; the slug keeps letters and digits of any script. */
export function cardFileName(twinName: string, format: 'twin-card' | 'ccv3'): string {
  const slug = twinName
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'twin'}${format === 'ccv3' ? '.card.json' : '.twin.json'}`;
}
