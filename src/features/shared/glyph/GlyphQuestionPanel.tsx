import { useState } from 'react';
import { HelpCircle, Send, Hash } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { BuildQuestion } from '@/lib/types/buildTypes';
import { VaultConnectorPicker } from '@/features/shared/components/picker/VaultConnectorPicker';
import { DIM_META } from './dimMeta';
import type { GlyphDimension } from './types';

/** Maps the backend cell keys to our 8-dimension vocabulary. Used so the
 *  question card can tint itself with the right dim colour. */
const CELL_KEY_TO_DIM: Record<string, GlyphDimension> = {
  'use-cases': 'task',
  'connectors': 'connector',
  'triggers': 'trigger',
  'human-review': 'review',
  'messages': 'message',
  'memory': 'memory',
  'error-handling': 'error',
  'events': 'event',
};

interface GlyphQuestionCardProps {
  question: BuildQuestion;
  onAnswer: (cellKey: string, answer: string) => void;
}

function GlyphQuestionCard({ question, onAnswer }: GlyphQuestionCardProps) {
  const [freeText, setFreeText] = useState('');
  const dim = CELL_KEY_TO_DIM[question.cellKey];
  const color = dim ? DIM_META[dim].color : '#60a5fa';
  const options = question.options ?? [];
  const connectorCategory = question.connectorCategory ?? null;

  const submit = (value: string) => {
    const v = value.trim();
    if (!v) return;
    onAnswer(question.cellKey, v);
    setFreeText('');
  };

  // Route "Add from Catalog" to the Vault catalog so the user can create the
  // missing connector without losing the build session.
  const openVaultCatalog = () => {
    useSystemStore.getState().setSidebarSection('credentials');
  };

  return (
    <div
      className="relative rounded-modal bg-card-bg border border-card-border p-4 flex flex-col gap-3 shadow-elevation-2"
      style={{ boxShadow: `0 0 18px ${color}22, 0 2px 10px rgba(0,0,0,0.2)` }}
      data-testid={`glyph-question-${question.cellKey}`}
    >
      <div className="absolute top-0 left-0 w-full h-1 rounded-t-modal" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: `${color}33`, boxShadow: `0 0 8px ${color}55` }}>
          <HelpCircle className="w-3.5 h-3.5" style={{ color: '#fff' }} />
        </span>
        <span className="typo-label font-bold uppercase tracking-[0.18em] text-foreground/70">
          {question.cellKey.replace(/-/g, ' ')}
        </span>
      </div>
      <p className="typo-body-lg text-foreground leading-snug">{question.question}</p>

      {connectorCategory ? (
        /* scope=connector_category — route to the vault-aware picker.
           Selection IS the answer; no free-text path needed. */
        <VaultConnectorPicker
          category={connectorCategory}
          value=""
          onChange={(serviceType) => submit(serviceType)}
          onAddFromCatalog={openVaultCatalog}
        />
      ) : (
        <>
          {options.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="glyph-options">
              {options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => submit(opt)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 border border-card-border hover:border-primary/40 typo-body text-foreground transition-colors cursor-pointer"
                  data-testid={`glyph-option-${i}`}
                >
                  <Hash className="w-3 h-3 text-foreground/55" />
                  <span className="tabular-nums text-foreground/55">{i + 1}</span>
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(freeText); }}
              placeholder="Answer in your own words…"
              className="flex-1 px-3 py-2 rounded-modal bg-primary/5 border border-card-border typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
              data-testid="glyph-freetext-input"
            />
            <button
              type="button"
              onClick={() => submit(freeText)}
              disabled={!freeText.trim()}
              className="px-3 py-2 rounded-modal bg-primary/20 hover:bg-primary/30 border border-primary/30 typo-body text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
              data-testid="glyph-submit-button"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface GlyphQuestionPanelProps {
  questions: BuildQuestion[];
  onAnswer: (cellKey: string, answer: string) => void;
}

/** Inline replacement for SpatialQuestionPopover on the Glyph surface —
 *  surfaces every pending mid-build question as a prominent card at the top
 *  of the grid. Each card tints itself with the affected dimension's colour
 *  so the user can see at a glance which leaf the answer will refine. */
export function GlyphQuestionPanel({ questions, onAnswer }: GlyphQuestionPanelProps) {
  const { t } = useTranslation();
  if (questions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 mb-3">
      <span className="typo-label font-bold uppercase tracking-[0.18em] text-foreground/60">
        {t.templates.chronology.hub_phase_awaiting_input}
      </span>
      {questions.map((q) => (
        <GlyphQuestionCard key={q.cellKey} question={q} onAnswer={onAnswer} />
      ))}
    </div>
  );
}
