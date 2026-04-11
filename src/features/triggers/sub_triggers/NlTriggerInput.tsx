import { useState, useCallback, useRef, useEffect } from 'react';
import { Sparkles, ArrowRight, RotateCcw, Check, AlertCircle } from 'lucide-react';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META } from '@/lib/utils/platform/triggerConstants';
import { parseNaturalLanguageTrigger, type NlParseResult } from './nlTriggerParser';
import { useTranslation } from '@/i18n/useTranslation';

export interface NlTriggerInputProps {
  onApplyResult: (result: NlParseResult) => void;
}

const PLACEHOLDER_EXAMPLES = [
  'Run this persona every 30 minutes',
  'When I save a .py file in my project',
  'Every weekday at 9am',
  'When I copy a URL to my clipboard',
  'When I switch to VS Code',
  'Watch for new .csv files',
];

const CONFIDENCE_STYLES = {
  high: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', label: 'High confidence' },
  medium: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', label: 'Needs review' },
  low: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', label: 'Best guess' },
};

export function NlTriggerInput({ onApplyResult }: NlTriggerInputProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<NlParseResult | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rotate placeholder examples
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const doParse = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (text.trim().length < 3) {
        setResult(null);
        setNoMatch(false);
        return;
      }
      const parsed = parseNaturalLanguageTrigger(text);
      setResult(parsed);
      setNoMatch(!parsed);
    }, 250);
  }, []);

  const handleChange = (value: string) => {
    setInput(value);
    doParse(value);
  };

  const handleApply = () => {
    if (result) {
      onApplyResult(result);
      setInput('');
      setResult(null);
      setNoMatch(false);
    }
  };

  const handleReset = () => {
    setInput('');
    setResult(null);
    setNoMatch(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && result) {
      e.preventDefault();
      handleApply();
    }
    if (e.key === 'Escape') {
      handleReset();
    }
  };

  const meta = result ? (TRIGGER_TYPE_META[result.triggerType] || DEFAULT_TRIGGER_META) : null;
  const confidence = result ? CONFIDENCE_STYLES[result.confidence] : null;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-sm font-medium text-foreground/80">
        <Sparkles className="w-3.5 h-3.5 text-violet-400" />
        {t.triggers.describe_trigger}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDER_EXAMPLES[placeholderIdx]}
          className="w-full pl-3 pr-10 py-2 bg-background/50 border border-primary/15 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 transition-all"
        />
        {input && (
          <button
            onClick={handleReset}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {result && (
          <div
            key="result"
            className={`animate-fade-slide-in flex items-center gap-3 p-2.5 rounded-xl border ${confidence!.border} ${confidence!.bg} transition-colors`}
          >
            {meta && <meta.Icon className={`w-4 h-4 shrink-0 ${meta.color}`} />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground/90 truncate">
                  {result.label}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded-md ${confidence!.bg} ${confidence!.text} border ${confidence!.border}`}>
                  {confidence!.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Type: <span className="text-foreground/70">{result.triggerType.replace(/_/g, ' ')}</span>
                {result.formOverrides.cronExpression && (
                  <> &middot; Cron: <span className="font-mono text-foreground/70">{result.formOverrides.cronExpression}</span></>
                )}
                {result.formOverrides.interval && result.formOverrides.scheduleMode === 'interval' && (
                  <> &middot; Interval: <span className="text-foreground/70">{result.formOverrides.interval}s</span></>
                )}
                {result.formOverrides.globFilter && (
                  <> &middot; Filter: <span className="font-mono text-foreground/70">{result.formOverrides.globFilter}</span></>
                )}
              </p>
            </div>
            <button
              onClick={handleApply}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded-lg text-xs font-medium transition-colors shrink-0 border border-violet-500/20"
            >
              <Check className="w-3 h-3" />
              Apply
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}

        {noMatch && input.trim().length >= 3 && (
          <div
            key="no-match"
            className="animate-fade-slide-in flex items-center gap-2 px-3 py-2 rounded-xl border border-border/30 bg-secondary/20 text-xs text-muted-foreground/60"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Could not parse a trigger from that description. Try something like &ldquo;{PLACEHOLDER_EXAMPLES[placeholderIdx]}&rdquo;</span>
          </div>
        )}
    </div>
  );
}
