/**
 * How thin each training topic is for the active twin: approved memories
 * credited to the topic they were trained under, keyword-matched only where no
 * session tagged them (`scoreTopicCoverage`). Re-read whenever `refreshToken`
 * changes, which the table ties to the transcript length, so a saved answer
 * moves its topic's count without a manual refresh.
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

export function useTopicCoverage(twinId: string | null, refreshToken: unknown): TopicCoverage[] {
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
      // The counts are a hint on the topic cards, not the flow: a failed read
      // leaves the last counts in place and the deck stays playable.
      .catch(silentCatch('features/plugins/twin/experience/table/useTopicCoverage'));
    return () => {
      cancelled = true;
    };
  }, [twinId, refreshToken]);

  return coverage;
}
