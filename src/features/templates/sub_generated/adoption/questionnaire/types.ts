/**
 * Shared shapes for the questionnaire widgets that the persona-layout adoption
 * flow composes (`QuestionnaireHeroQuestion`, `QuestionnaireStackedOptions`,
 * `QuestionnaireStoryThread`).
 *
 * `QuestionnaireFormProps` and `QuestionnaireCategoryProgress` used to live here
 * too; they described the three-pane `QuestionnaireForm`, which nothing mounted
 * and which was deleted along with the six files only it reached.
 */

export interface QuestionnaireNormalizedOption {
  value: string;
  label: string;
  sublabel: string | null;
}

export type QuestionnaireThreadState = 'answered' | 'current' | 'pending' | 'blocked';
