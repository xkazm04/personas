import { motion } from 'framer-motion';
import {
  KeyRound,
  Settings2,
  ShieldCheck,
  Brain,
  Bell,
} from 'lucide-react';
import { N8nQuestionListbox } from './N8nQuestionListbox';
import type { TransformQuestion } from '../hooks/useN8nImportReducer';

const DIMENSION_LABELS: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  credentials: { label: 'Credentials', Icon: KeyRound },
  configuration: { label: 'Configuration', Icon: Settings2 },
  human_in_the_loop: { label: 'Human in the Loop', Icon: ShieldCheck },
  memory: { label: 'Memory & Learning', Icon: Brain },
  notifications: { label: 'Notifications', Icon: Bell },
};

const QUESTION_TONES = [
  { border: 'border-violet-500/15', bg: 'bg-violet-500/[0.04]', accent: 'text-violet-400', selectBg: 'bg-violet-500/15 text-violet-300 border-violet-500/25' },
  { border: 'border-blue-500/15', bg: 'bg-blue-500/[0.04]', accent: 'text-blue-400', selectBg: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
  { border: 'border-cyan-500/15', bg: 'bg-cyan-500/[0.04]', accent: 'text-cyan-400', selectBg: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25' },
  { border: 'border-emerald-500/15', bg: 'bg-emerald-500/[0.04]', accent: 'text-emerald-400', selectBg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' },
  { border: 'border-amber-500/15', bg: 'bg-amber-500/[0.04]', accent: 'text-amber-400', selectBg: 'bg-amber-500/15 text-amber-300 border-amber-500/25' },
  { border: 'border-rose-500/15', bg: 'bg-rose-500/[0.04]', accent: 'text-rose-400', selectBg: 'bg-rose-500/15 text-rose-300 border-rose-500/25' },
] as const;

interface N8nQuestionListViewProps {
  questions: TransformQuestion[];
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
}

export function N8nQuestionListView({ questions, userAnswers, onAnswerUpdated }: N8nQuestionListViewProps) {
  return (
    <div className="space-y-3">
      {questions.map((q, i) => {
        const tone = QUESTION_TONES[i % QUESTION_TONES.length]!;
        const prevCategory = i > 0 ? questions[i - 1]!.category : undefined;
        const showSeparator = q.category && q.category !== prevCategory;
        const dim = q.category ? DIMENSION_LABELS[q.category] : undefined;

        return (
          <div key={q.id}>
            {showSeparator && dim && (
              <div className="flex items-center gap-2.5 pt-4 pb-1.5">
                <dim.Icon className="w-4 h-4 text-foreground/60 flex-shrink-0" />
                <span className="text-sm uppercase tracking-wider text-foreground/60 font-semibold whitespace-nowrap">
                  {dim.label}
                </span>
                <hr className="flex-1 border-primary/10" />
              </div>
            )}

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`p-4 rounded-xl border ${tone.border} ${tone.bg}`}
            >
              <label className={`block text-sm font-medium mb-2 ${tone.accent}`}>
                {q.question}
              </label>

              {q.context && (
                <p className="text-sm text-foreground/50 mb-2 leading-relaxed">
                  {q.context}
                </p>
              )}

              {q.type === 'select' && q.options && (
                <N8nQuestionListbox
                  options={q.options}
                  value={userAnswers[q.id] ?? q.default ?? ''}
                  onChange={(val) => onAnswerUpdated(q.id, val)}
                  selectedClassName={tone.selectBg}
                />
              )}

              {q.type === 'text' && (
                <input
                  type="text"
                  value={userAnswers[q.id] ?? q.default ?? ''}
                  onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                  placeholder={q.default ?? 'Type your answer...'}
                  className="w-full px-3 py-2.5 text-sm rounded-xl border border-primary/15 bg-background/60 text-foreground placeholder-muted-foreground/40 focus-ring focus-visible:border-primary/30 transition-all"
                />
              )}

              {q.type === 'boolean' && (
                <div className="flex gap-3">
                  {(q.options ?? ['Yes', 'No']).map((opt) => {
                    const isSelected = (userAnswers[q.id] ?? q.default ?? '') === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => onAnswerUpdated(q.id, opt)}
                        className={`px-4 py-1.5 text-sm rounded-xl border transition-all ${
                          isSelected
                            ? tone.selectBg
                            : 'text-muted-foreground border-primary/10 hover:bg-secondary/30'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
