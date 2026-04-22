import { useEffect, useRef, useState } from 'react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { QuestionnairePulse } from './types';

/**
 * Emits a coloured `QuestionnairePulse` per freshly-committed answer, keyed by the
 * question's category. Consumers render the pulse list against the
 * constellation so a particle streaks from the relevant planet to the core
 * each time the user commits an answer. Pulses are GC'd ~1.4s after the
 * animation has played so the DOM stays thin during heavy answering.
 */
export function useQuestionnairePulses(
  questions: TransformQuestionResponse[],
  userAnswers: Record<string, string>,
): QuestionnairePulse[] {
  const [pulses, setPulses] = useState<QuestionnairePulse[]>([]);
  const pulseSeq = useRef(0);
  const prevAnswersRef = useRef(userAnswers);

  useEffect(() => {
    const prev = prevAnswersRef.current;
    const freshlyAnswered: string[] = [];
    for (const q of questions) {
      const was = prev[q.id] ?? '';
      const now = userAnswers[q.id] ?? '';
      if (!was && now) freshlyAnswered.push(q.category ?? '__other__');
    }
    if (freshlyAnswered.length > 0) {
      setPulses((p) => [
        ...p.slice(-8),
        ...freshlyAnswered.map((cat) => ({ id: ++pulseSeq.current, cat })),
      ]);
    }
    prevAnswersRef.current = userAnswers;
  }, [userAnswers, questions]);

  useEffect(() => {
    if (pulses.length === 0) return;
    const timer = setTimeout(() => {
      setPulses((p) => (p.length > 3 ? p.slice(p.length - 3) : p));
    }, 1400);
    return () => clearTimeout(timer);
  }, [pulses]);

  return pulses;
}
