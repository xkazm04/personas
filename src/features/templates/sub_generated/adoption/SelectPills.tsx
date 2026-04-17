/**
 * SelectPills — reusable pill-button multi/single-select widget used in
 * the questionnaire form and dynamic question options.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface PillOption {
  value: string;
  label: string;
  sublabel?: string | null;
}

// Multi-select values are stored CSV-encoded so the existing answer map
// (`Record<string,string>`) keeps working. The literal string "all" is the
// sentinel for "include_all_option" selections — easier to match than the
// empty string and survives round-tripping to templates unchanged.
const ALL_SENTINEL = 'all';

export function parseCsv(v: string): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

export function toCsv(values: string[]): string {
  return values.join(',');
}

export function SelectPills({
  options,
  value,
  onChange,
  allowCustom,
  multi,
  includeAllOption,
}: {
  options: PillOption[];
  value: string;
  onChange: (v: string) => void;
  allowCustom?: boolean;
  multi?: boolean;
  includeAllOption?: boolean;
}) {
  const { t } = useTranslation();
  const optionValueSet = useMemo(() => new Set(options.map((o) => o.value)), [options]);

  const selectedValues = useMemo(
    () => (multi ? new Set(parseCsv(value)) : new Set([value])),
    [value, multi],
  );
  const isAllSelected = multi && (value === ALL_SENTINEL || selectedValues.has(ALL_SENTINEL));

  // In multi-select mode, any selected value that isn't in the options set
  // counts as a user-typed custom entry (and persists across re-renders).
  const customValuesFromAnswer = useMemo(() => {
    if (!allowCustom) return [] as string[];
    if (!multi) {
      return value && !optionValueSet.has(value) && value !== ALL_SENTINEL ? [value] : [];
    }
    return [...selectedValues].filter((v) => v && v !== ALL_SENTINEL && !optionValueSet.has(v));
  }, [allowCustom, multi, value, selectedValues, optionValueSet]);

  const hasCustomValue = customValuesFromAnswer.length > 0;
  const [showCustomInput, setShowCustomInput] = useState(hasCustomValue);
  const [customDraft, setCustomDraft] = useState(
    multi ? '' : customValuesFromAnswer[0] ?? '',
  );
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCustomInput) {
      setTimeout(() => customInputRef.current?.focus(), 50);
    }
  }, [showCustomInput]);

  const togglePill = (optValue: string) => {
    if (!multi) {
      setShowCustomInput(false);
      onChange(optValue);
      return;
    }
    // Multi-select: toggle membership. Picking a real option clears "all".
    const next = new Set(selectedValues);
    next.delete(ALL_SENTINEL);
    if (next.has(optValue)) next.delete(optValue);
    else next.add(optValue);
    onChange(toCsv([...next]));
  };

  const pickAll = () => {
    setShowCustomInput(false);
    onChange(ALL_SENTINEL);
  };

  // Commit the draft custom value into the answer set.
  const commitCustom = () => {
    const trimmed = customDraft.trim();
    if (!trimmed) return;
    if (!multi) {
      onChange(trimmed);
      return;
    }
    const next = new Set(selectedValues);
    next.delete(ALL_SENTINEL);
    next.add(trimmed);
    onChange(toCsv([...next]));
    setCustomDraft('');
  };

  const removeCustomValue = (v: string) => {
    if (!multi) {
      onChange('');
      return;
    }
    const next = new Set(selectedValues);
    next.delete(v);
    onChange(toCsv([...next]));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {multi && includeAllOption && (
          <button
            type="button"
            onClick={pickAll}
            className={`px-3.5 py-1.5 text-base rounded-card border transition-all ${
              isAllSelected
                ? 'bg-primary/20 border-primary/30 text-primary font-medium'
                : 'bg-white/[0.03] border-white/[0.06] text-foreground hover:bg-white/[0.06] hover:border-white/[0.1]'
            }`}
          >
            {t.templates.adopt_modal.all_option}
          </button>
        )}
        {options.map((opt) => {
          const selected =
            !showCustomInput &&
            !isAllSelected &&
            (multi ? selectedValues.has(opt.value) : value === opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => togglePill(opt.value)}
              className={`px-3.5 py-1.5 text-base rounded-card border transition-all ${
                selected
                  ? 'bg-primary/20 border-primary/30 text-primary font-medium'
                  : 'bg-white/[0.03] border-white/[0.06] text-foreground hover:bg-white/[0.06] hover:border-white/[0.1]'
              }`}
              title={opt.sublabel ?? undefined}
            >
              {opt.label}
            </button>
          );
        })}
        {/* Custom values that were previously entered appear as dismissable
            pills so the user can keep accumulating more in multi-select mode. */}
        {customValuesFromAnswer.map((v) => (
          <span
            key={`custom-${v}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-base rounded-card border border-primary/30 bg-primary/15 text-primary font-medium"
          >
            {v}
            <button
              type="button"
              onClick={() => removeCustomValue(v)}
              className="opacity-60 hover:opacity-100 transition-opacity"
              aria-label={`Remove ${v}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {allowCustom && (
          <button
            type="button"
            onClick={() => setShowCustomInput((v) => !v)}
            className={`px-3 py-1.5 text-sm rounded-card border transition-all ${
              showCustomInput
                ? 'bg-primary/20 border-primary/30 text-primary font-medium'
                : 'bg-white/[0.03] border-white/[0.06] text-foreground hover:bg-white/[0.06] hover:border-white/[0.1]'
            }`}
          >
            {multi ? t.templates.adopt_modal.custom_prefix : t.templates.adopt_modal.custom_plain}
          </button>
        )}
      </div>
      {allowCustom && showCustomInput && (
        <div className="flex items-center gap-2">
          <input
            ref={customInputRef}
            type="text"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitCustom();
              } else if (e.key === 'Escape') {
                setShowCustomInput(false);
                setCustomDraft('');
              }
            }}
            onBlur={() => {
              // Single-select commits on blur for the existing one-shot UX.
              if (!multi) commitCustom();
            }}
            placeholder={t.templates.adopt_modal.type_custom_value}
            className="flex-1 max-w-sm px-3 py-1.5 text-sm rounded-card border border-primary/20 bg-white/[0.03] text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30 focus:bg-white/[0.05] transition-all"
          />
          {multi && (
            <button
              type="button"
              onClick={commitCustom}
              disabled={!customDraft.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-card bg-primary/20 border border-primary/30 text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/30 transition-colors"
            >
              {t.templates.adopt_modal.add_custom}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
