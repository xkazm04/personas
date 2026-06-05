import { useState, useCallback } from 'react';
import { Send, ExternalLink, HelpCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { BuildQuestion } from '@/lib/types/buildTypes';
import { isComplexQuestion, type QuestionGroup } from './usePendingInteractions';

interface QuickAnswerQuestionGroupProps {
  group: QuestionGroup;
  busy: boolean;
  onSubmit: (sessionId: string, answers: Record<string, string>) => Promise<void>;
  onOpenBuilder: (personaId: string) => void;
}

/** One persona's pending build questions. Simple questions (options /
 *  free-text) are answered inline and batch-sent; complex ones (connector
 *  picker, file/URL attachment, webhook source) defer to the full builder. */
export function QuickAnswerQuestionGroup({
  group,
  busy,
  onSubmit,
  onOpenBuilder,
}: QuickAnswerQuestionGroupProps) {
  const { t, tx } = useTranslation();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const setAnswer = useCallback((cellKey: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [cellKey]: value }));
  }, []);

  const answeredCount = Object.values(answers).filter((v) => v.trim()).length;

  const handleSend = useCallback(async () => {
    const filled = Object.fromEntries(
      Object.entries(answers).filter(([, v]) => v.trim()),
    );
    if (Object.keys(filled).length === 0) return;
    setSubmitting(true);
    try {
      await onSubmit(group.sessionId, filled);
      setAnswers({});
    } finally {
      setSubmitting(false);
    }
  }, [answers, group.sessionId, onSubmit]);

  return (
    <div
      className="rounded-card border border-card-border bg-card-bg/60 p-3 flex flex-col gap-3"
      data-testid={`quick-answer-group-${group.sessionId}`}
    >
      <div className="flex items-center gap-2">
        <PersonaIcon icon={group.personaIcon} color={group.personaColor} display="framed" frameSize="sm" />
        <span className="typo-body font-semibold text-foreground truncate min-w-0">
          {tx(t.monitor.quick_building, { persona: group.personaName })}
        </span>
      </div>

      {group.questions.map((q) =>
        isComplexQuestion(q) ? (
          <ComplexQuestion key={q.cellKey} question={q} onOpen={() => onOpenBuilder(group.personaId)} />
        ) : (
          <SimpleQuestion
            key={q.cellKey}
            question={q}
            value={answers[q.cellKey] ?? ''}
            onChange={(v) => setAnswer(q.cellKey, v)}
          />
        ),
      )}

      <Button
        variant="primary"
        size="sm"
        onClick={handleSend}
        disabled={answeredCount === 0 || busy}
        loading={submitting}
        data-testid={`quick-answer-send-${group.sessionId}`}
        className="self-end"
      >
        <Send className="w-3.5 h-3.5" />
        {answeredCount > 1 ? tx(t.monitor.quick_send_many, { count: answeredCount }) : t.monitor.quick_send_one}
      </Button>
    </div>
  );
}

function SimpleQuestion({
  question,
  value,
  onChange,
}: {
  question: BuildQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const options = question.options ?? [];
  return (
    <div className="flex flex-col gap-2">
      <p className="typo-body text-foreground leading-snug">{question.question}</p>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onChange(opt)}
              aria-pressed={value === opt}
              className={`px-2.5 py-1 rounded-full border typo-caption transition-colors ${
                value === opt
                  ? 'bg-primary/25 border-primary/50 text-foreground'
                  : 'bg-primary/10 border-card-border text-foreground hover:bg-primary/20'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.monitor.quick_answer_placeholder}
        className="px-3 py-1.5 rounded-input bg-primary/5 border border-card-border typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
        data-testid={`quick-answer-input-${question.cellKey}`}
      />
    </div>
  );
}

function ComplexQuestion({ question, onOpen }: { question: BuildQuestion; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 rounded-input border border-card-border/70 bg-secondary/20 p-2.5">
      <p className="typo-body text-foreground leading-snug flex items-start gap-1.5">
        <HelpCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-foreground" />
        {question.question}
      </p>
      <span className="typo-caption text-foreground">{t.monitor.quick_open_builder_hint}</span>
      <Button variant="secondary" size="xs" onClick={onOpen} className="self-start">
        <ExternalLink className="w-3 h-3" />
        {t.monitor.quick_open_builder}
      </Button>
    </div>
  );
}
