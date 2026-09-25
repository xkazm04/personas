/**
 * The six training topics — ids the coverage scorer credits answers to, and
 * the `t.twin.training.*` keys their label and prompt resolve from.
 *
 * A module of its own, with no imports, because both `topicCoverage` and
 * `useTrainingSession` need it and each imports the other: reading it through
 * either of them made the load order decide whether it existed yet.
 */

/**
 * The prompt strings shape the LLM's question-generation output, so
 * non-English locales need translated prompts to get questions in the
 * user's language. `promptKey` indexes into `t.twin.training.*` —
 * resolve at call time, not at module init.
 */
export const TRAINING_TOPIC_PRESETS = [
  { id: 'background', labelKey: 'topicBackground', promptKey: 'topicPromptBackground' },
  { id: 'opinions', labelKey: 'topicOpinions', promptKey: 'topicPromptOpinions' },
  { id: 'communication', labelKey: 'topicCommunication', promptKey: 'topicPromptCommunication' },
  { id: 'values', labelKey: 'topicValues', promptKey: 'topicPromptValues' },
  { id: 'expertise', labelKey: 'topicExpertise', promptKey: 'topicPromptExpertise' },
  { id: 'personal', labelKey: 'topicPersonal', promptKey: 'topicPromptPersonal' },
] as const;
