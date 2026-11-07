import { useState, useCallback, useRef, useEffect } from 'react';
import { Sparkles, ArrowRight, RotateCcw, Check, AlertCircle } from 'lucide-react';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META } from '@/lib/utils/platform/triggerConstants';
import { parseNaturalLanguageTrigger, type NlParseResult } from './nlTriggerParser';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

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
  high: { bg: 'bg-status-success/10', border: 'border-status-success/30', text: 'text-status-success', label: 'High confidence' },
  medium: { bg: 'bg-status-warning/10', border: 'border-status-warning/30', text: 'text-status-warning', label: 'Needs review' },
  low: { bg: 'bg-status-warning/10', border: 'border-status-warning/30', text: 'text-status-warning', label: 'Best guess' },
};

export function NlTriggerInput({ onApplyResult }: NlTriggerInputProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<NlParseResult | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rotate placeholder examples. Pause when focused or input has content — rotation is
  // purely decorative there, and keeping the timer running leaks CPU/battery.
  useEffect(() => {
    if (focused || input.length > 0) return;
    const intervalId = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length);
    }, 3000);
    return () => clearInterval(intervalId);
  }, [focused, input.length]);

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
      <label className="flex items-center gap-1.5 typo-body text-ink-1">
        <Sparkles className="w-3.5 h-3.5 text-role-agent" />
        {t.triggers.describe_trigger}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={PLACEHOLDER_EXAMPLES[placeholderIdx]}
          className="w-full pl-3 pr-10 py-2 bg-background/50 border border-hair rounded-modal typo-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-role-agent/40 focus:ring-1 focus:ring-role-agent/20 transition-all"
        />
        {input && (
          <Button variant="ghost" size="icon-xs" onClick={handleReset} className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {result && (
          <div
            key="result"
            className={`animate-fade-slide-in flex items-center gap-3 p-2.5 rounded-modal border ${confidence!.border} ${confidence!.bg} transition-colors`}
          >
            {meta && <meta.Icon className={`w-4 h-4 shrink-0 ${meta.color}`} />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="typo-body text-ink-1 truncate">
                  {result.label}
                </span>
                <span className={`typo-caption px-1.5 py-0.5 rounded-input ${confidence!.bg} ${confidence!.text} border ${confidence!.border}`}>
                  {confidence!.label}
                </span>
              </div>
              <p className="typo-caption text-ink-2 mt-0.5">
                {t.triggers.nl_type_colon} <span className="text-ink-1">{result.triggerType.replace(/_/g, ' ')}</span>
                {result.formOverrides.cronExpression && (
                  <> {t.triggers.nl_cron_colon} <span className="font-mono text-ink-1">{result.formOverrides.cronExpression}</span></>
                )}
                {result.formOverrides.interval && result.formOverrides.scheduleMode === 'interval' && (
                  <> {t.triggers.nl_interval_colon} <span className="text-ink-1">{result.formOverrides.interval}s</span></>
                )}
                {result.formOverrides.globFilter && (
                  <> {t.triggers.nl_filter_colon} <span className="font-mono text-ink-1">{result.formOverrides.globFilter}</span></>
                )}
              </p>
            </div>
            <Button
              type="button"
              onClick={handleApply}
              variant="accent"
              tone="agent"
              size="sm"
              className="shrink-0"
              icon={<Check className="w-3 h-3" />}
            >
              Apply
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        )}

        {/* Surface non-fatal parse warnings (e.g. interval clamped to 60s)
            so users see when the parser silently rewrote their input. */}
        {result && result.warnings.length > 0 && (
          <ul className="animate-fade-slide-in space-y-1">
            {result.warnings.map((w, i) => (
              <li
                key={`${w.code}-${i}`}
                className="flex items-start gap-2 px-3 py-2 rounded-modal border border-status-warning/25 bg-status-warning/10 typo-caption text-status-warning"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        )}

        {noMatch && input.trim().length >= 3 && (
          <div
            key="no-match"
            className="animate-fade-slide-in flex items-center gap-2 px-3 py-2 rounded-modal border border-hair bg-surface-1 typo-caption text-ink-1"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{t.triggers.nl_could_not_parse} &ldquo;{PLACEHOLDER_EXAMPLES[placeholderIdx]}&rdquo;</span>
          </div>
        )}
    </div>
  );
}
