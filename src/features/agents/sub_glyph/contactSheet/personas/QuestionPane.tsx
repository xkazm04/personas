/** QuestionPane - the inside of a frame when the camera pushes in to ask.
 *
 *  One clarifying question: numbered options (number keys pick them), an
 *  "own words" field, or the vault connector picker when the question is a
 *  connector-category question. Picking an option advances; typing waits for
 *  Enter or Next. Answers stay local until "Send answers" (see
 *  useQuestionRound). */
import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import Button from "@/features/shared/components/buttons/Button";
import { VaultConnectorPicker } from "@/features/vault/components/VaultConnectorPicker";
import { useTranslation } from "@/i18n/useTranslation";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { INPUT_FIELD } from "@/lib/utils/designTokens";
import { COPY } from "./copy";

interface QuestionPaneProps {
  question: BuildQuestion;
  index: number;
  total: number;
  draft: string;
  isLast: boolean;
  onDraft: (v: string) => void;
  onPick: (v: string) => void;
  onNext: () => void;
  onBack?: () => void;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

export function QuestionPane({ question, index, total, draft, isLast, onDraft, onPick, onNext, onBack }: QuestionPaneProps) {
  const { t } = useTranslation();
  const options = question.options ?? [];
  const category = question.connectorCategory ?? null;
  const picked = options.includes(draft) ? draft : null;

  // One listener for the pane's lifetime; it reads the latest props via a ref.
  const live = useRef({ options, draft, onPick, onNext });
  live.current = { options, draft, onPick, onNext };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const { options: opts, draft: d, onPick: pick, onNext: next } = live.current;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= opts.length) {
        e.preventDefault();
        pick(opts[n - 1]!);
      } else if (e.key === "Enter" && d.trim() && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <p className="typo-caption flex items-center gap-2">
        <span className="typo-data text-muted">{COPY.questionOf(index + 1, total)}</span>
        {options.length > 0 && !category && <span className="text-muted">· {COPY.pickHint}</span>}
      </p>
      <h2 className="typo-heading-lg text-foreground" id="cs-personas-qtext">{question.question}</h2>

      {category ? (
        <div className="min-h-0 overflow-y-auto">
          <VaultConnectorPicker category={category} value={draft} onChange={onDraft} suggested={question.suggested} />
        </div>
      ) : options.length > 0 ? (
        <div role="radiogroup" aria-labelledby="cs-personas-qtext" className="flex flex-col gap-1.5 min-h-0 overflow-y-auto">
          {options.map((opt, i) => {
            const on = picked === opt;
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onPick(opt)}
                className={`flex items-center gap-3 min-h-11 px-3 py-2 rounded-input border text-left typo-body text-foreground transition-colors focus-ring ${
                  on ? "border-primary bg-primary/10" : "border-card-border hover:border-primary/40 hover:bg-secondary/40"
                }`}
              >
                <span className={`w-6 h-6 flex-none grid place-items-center rounded-interactive border typo-code ${on ? "bg-primary border-primary text-background" : "border-card-border text-muted"}`}>
                  {on ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <span className="min-w-0">{opt}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!category && (
        <input
          type="text"
          value={picked ? "" : draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { e.preventDefault(); onNext(); } }}
          placeholder={t.templates.chronology.answer_own_words_placeholder}
          aria-label={t.templates.chronology.answer_own_words_placeholder}
          className={INPUT_FIELD}
          autoFocus={options.length === 0}
        />
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {onBack ? (
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={onBack}>{COPY.back}</Button>
        ) : <span />}
        <Button variant="primary" size="md" iconRight={<ArrowRight className="w-4 h-4" />} onClick={onNext} disabled={!draft.trim()}>
          {isLast ? COPY.questionsReview : COPY.next}
        </Button>
      </div>
    </div>
  );
}
