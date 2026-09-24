/**
 * The training deck: what a training round can be about.
 *
 * Same six ids as `TRAINING_TOPIC_PRESETS`, so every answer is still credited
 * to its topic by `topicCoverage` and nothing already saved loses its score.
 * What changed is what each topic ASKS, following the research in
 * `../RESEARCH.md`:
 *
 * - scenes over summaries ("take me to the day…" gets far more usable voice
 *   than "tell me about your background") — `background`;
 * - opinions beyond one field: "Tech Opinions" assumed an engineer — `opinions`;
 * - reply drills: a realistic message to answer as they would, because a real
 *   reply is the strongest voice signal there is — `communication`;
 * - boundaries: what the twin must never say or promise for them, the one
 *   Nomi-style field worth keeping for a real person — `values`;
 * - the questions people actually bring them, answered the way they'd answer
 *   a colleague — `expertise`.
 *
 * The prompt text is what the guide receives as the topic, translated with
 * the rest of the UI; the label is what the card shows.
 */

import { BookOpen, Coffee, Gavel, Mailbox, Shield, Swords, type LucideIcon } from 'lucide-react';
import type { PresetId } from '../../../sub_training/topicCoverage';

export interface TopicCard {
  id: PresetId;
  Icon: LucideIcon;
  /** Key under `twin.experience_opus.topics`. */
  key: 'stories' | 'takes' | 'drills' | 'lines' | 'asks' | 'offClock';
}

export const TOPIC_DECK: readonly TopicCard[] = [
  { id: 'communication', Icon: Mailbox, key: 'drills' },
  { id: 'background', Icon: BookOpen, key: 'stories' },
  { id: 'opinions', Icon: Swords, key: 'takes' },
  { id: 'expertise', Icon: Gavel, key: 'asks' },
  { id: 'values', Icon: Shield, key: 'lines' },
  { id: 'personal', Icon: Coffee, key: 'offClock' },
] as const;
