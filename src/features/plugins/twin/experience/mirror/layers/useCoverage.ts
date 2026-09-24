/**
 * How thin each training topic is for the active twin: approved memories
 * credited to the topic they were trained under, keyword-matched only where no
 * session tagged them (`scoreTopicCoverage`).
 *
 * Re-read whenever `refreshToken` changes, which the stage ties to the length
 * of the transcript — so a saved answer moves its topic's count without a
 * manual refresh. A failed read leaves the last counts in place and the deck
 * stays usable: these are a hint on a card, not the flow.
 */

import { useEffect, useState } from 'react';
import * as twinApi from '@/api/twin/twin';
import { silentCatch } from '@/lib/silentCatch';
import {
  scoreTopicCoverage,
  topicByCommunication,
  type TopicCoverage,
} from '../../../sub_training/topicCoverage';
import { TRAINING_TOPIC_WINDOW } from '../../../sub_training/useTrainingSession';

export function useCoverage(twinId: string | null, refreshToken: unknown): TopicCoverage[] {
  const [coverage, setCoverage] = useState<TopicCoverage[]>(() => scoreTopicCoverage([]));

  useEffect(() => {
    if (!twinId) return;
    let cancelled = false;
    Promise.all([
      twinApi.listPendingMemories(twinId, 'approved'),
      twinApi.listCommunications(twinId, 'training', TRAINING_TOPIC_WINDOW),
    ])
      .then(([memories, comms]) => {
        if (!cancelled) setCoverage(scoreTopicCoverage(memories, topicByCommunication(comms)));
      })
      .catch(silentCatch('features/plugins/twin/experience/mirror/layers/useCoverage'));
    return () => {
      cancelled = true;
    };
  }, [twinId, refreshToken]);

  return coverage;
}
