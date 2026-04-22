/**
 * QuestionnaireForm — three-pane synthesis with a decorative background
 * orbit. See ../questionnaire/ for the composed parts. This file is the
 * orchestrator: state, derived data, wiring, and the outer layout.
 *
 * Layout:
 *   QuestionnaireHeaderBand (title + counters + stepper)
 *   ├── QuestionnaireCategoryRail (left — category nav)
 *   ├── Centre pane (background constellation absolute behind QuestionnaireHeroQuestion)
 *   └── QuestionnaireStoryThread (right — question chain)
 *   QuestionnaireFooterNav (back / next / submit)
 */
import { useCallback, useMemo, useState } from 'react';
import { QuestionnaireBackgroundConstellation } from './QuestionnaireBackgroundConstellation';
import { QuestionnaireCategoryRail } from './QuestionnaireCategoryRail';
import { QuestionnaireFooterNav } from './QuestionnaireFooterNav';
import { QuestionnaireHeaderBand } from './QuestionnaireHeaderBand';
import { QuestionnaireHeroQuestion } from './QuestionnaireHeroQuestion';
import { QuestionnaireStoryThread } from './QuestionnaireStoryThread';
import { isStackable, resolveStackableOptions } from './questionnaireHelpers';
import { useQuestionnaireCategoryData } from './useQuestionnaireCategoryData';
import { useQuestionnaireKeyboardNav } from './useQuestionnaireKeyboardNav';
import { useQuestionnairePulses } from './useQuestionnairePulses';
import type { QuestionnaireFormProps } from './types';

export function QuestionnaireForm({
  questions,
  userAnswers,
  autoDetectedIds,
  blockedQuestionIds,
  filteredOptions,
  dynamicOptions,
  onRetryDynamic,
  onAddCredential,
  onAnswerUpdated,
  onSubmit,
  templateName,
  useCaseTitleById,
}: QuestionnaireFormProps) {
  const [activeIdx, setActiveIdx] = useState(() => {
    // Land on the first UNANSWERED question regardless of blocked-state.
    // Blocked questions are where credentials must be added — we want the
    // user to land on the "Add credential" card, not silently skip past it.
    const first = questions.findIndex((q) => !userAnswers[q.id]);
    return first >= 0 ? first : 0;
  });

  const currentQuestion = questions[activeIdx];
  const totalCount = questions.length;
  const answeredCount = useMemo(
    () => questions.filter((q) => !!userAnswers[q.id]).length,
    [questions, userAnswers],
  );
  const blockedCount = blockedQuestionIds?.size ?? 0;
  const canSubmit = answeredCount === totalCount && blockedCount === 0;
  const isAtEnd = activeIdx === totalCount - 1;
  const progressPct = totalCount > 0 ? answeredCount / totalCount : 0;
  const currentAnswered = !!userAnswers[currentQuestion?.id ?? ''];
  const currentCat = currentQuestion?.category ?? '__other__';
  const isCurrentBlocked = !!currentQuestion && !!blockedQuestionIds?.has(currentQuestion.id);

  const { categoryKeys, categoryProgress, categoryHasBlocked } = useQuestionnaireCategoryData(
    questions,
    userAnswers,
    blockedQuestionIds,
  );
  const pulses = useQuestionnairePulses(questions, userAnswers);

  const currentOptions = useMemo(
    () => (currentQuestion ? resolveStackableOptions(currentQuestion, filteredOptions?.[currentQuestion.id]) : []),
    [currentQuestion, filteredOptions],
  );
  const currentIsStackable = currentQuestion
    ? isStackable(currentQuestion, currentOptions.length)
    : false;

  const next = useCallback(
    () => setActiveIdx((i) => Math.min(i + 1, totalCount - 1)),
    [totalCount],
  );
  const prev = useCallback(() => setActiveIdx((i) => Math.max(i - 1, 0)), []);
  const jumpToCategory = useCallback(
    (cat: string) => {
      const firstUnanswered = questions.findIndex(
        (q) => (q.category ?? '__other__') === cat && !userAnswers[q.id],
      );
      if (firstUnanswered >= 0) return setActiveIdx(firstUnanswered);
      const firstAny = questions.findIndex((q) => (q.category ?? '__other__') === cat);
      if (firstAny >= 0) setActiveIdx(firstAny);
    },
    [questions, userAnswers],
  );

  useQuestionnaireKeyboardNav({
    currentQuestion,
    currentOptions,
    currentIsStackable,
    isCurrentBlocked,
    currentAnswered,
    isAtEnd,
    canSubmit,
    next,
    prev,
    onSubmit,
    onAnswerUpdated,
  });

  if (!currentQuestion) return null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <QuestionnaireHeaderBand
        templateName={templateName}
        questions={questions}
        userAnswers={userAnswers}
        blockedQuestionIds={blockedQuestionIds}
        activeIdx={activeIdx}
        answeredCount={answeredCount}
        totalCount={totalCount}
        blockedCount={blockedCount}
        progressPct={progressPct}
        onJumpTo={setActiveIdx}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <QuestionnaireCategoryRail
          categoryKeys={categoryKeys}
          categoryProgress={categoryProgress}
          categoryHasBlocked={categoryHasBlocked}
          currentCat={currentCat}
          onJumpToCategory={jumpToCategory}
        />

        <main className="flex-1 min-w-0 relative overflow-hidden">
          <QuestionnaireBackgroundConstellation
            categoryKeys={categoryKeys}
            categoryProgress={categoryProgress}
            currentCat={currentCat}
            progressPct={progressPct}
            pulses={pulses}
          />
          <div className="absolute inset-0 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-10 py-10">
              <QuestionnaireHeroQuestion
                question={currentQuestion}
                answer={userAnswers[currentQuestion.id] ?? ''}
                options={currentOptions}
                isStackable={currentIsStackable}
                isBlocked={isCurrentBlocked}
                isAutoDetected={!!autoDetectedIds?.has(currentQuestion.id)}
                activeIdx={activeIdx}
                totalCount={totalCount}
                isAtEnd={isAtEnd}
                canSubmit={canSubmit}
                onAnswerUpdated={onAnswerUpdated}
                onAddCredential={onAddCredential}
                filteredOptions={filteredOptions?.[currentQuestion.id]}
                dynamicState={dynamicOptions?.[currentQuestion.id]}
                onRetryDynamic={onRetryDynamic}
                useCaseTitleById={useCaseTitleById}
              />
            </div>
          </div>
        </main>

        <QuestionnaireStoryThread
          questions={questions}
          userAnswers={userAnswers}
          activeIdx={activeIdx}
          autoDetectedIds={autoDetectedIds}
          blockedQuestionIds={blockedQuestionIds}
          answeredCount={answeredCount}
          totalCount={totalCount}
          onJumpTo={setActiveIdx}
        />
      </div>

      <QuestionnaireFooterNav
        activeIdx={activeIdx}
        isAtEnd={isAtEnd}
        canSubmit={canSubmit}
        onPrev={prev}
        onNext={next}
        onSubmit={onSubmit}
      />
    </div>
  );
}
