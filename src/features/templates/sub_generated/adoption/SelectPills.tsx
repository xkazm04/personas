/**
 * SelectPills — reusable pill-button multi/single-select widget used in
 * the questionnaire form and dynamic question options.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

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
  allowCustom = false,
  multi,
  includeAllOption,
}: {
  options: PillOption[];
  value: string;
  onChange: (v: string) => void;
  /** Opt IN to a "Custom…/Other" pill that lets the user enter an off-list
   *  value. Defaults to FALSE: an authored option list is a closed parameter
   *  surface, and the grid passes `question.allow_custom`, which is undefined
   *  on most questions — so defaulting to true grew an Other pill on every
   *  closed select and stored answers the template cannot bind. With this off
   *  there is no Other pill and incoming off-list values are ignored rather
   *  than rendered as custom pills. `questionnaireHelpers.isStackable` already
   *  reads a missing `allow_custom` as "no custom escape hatch". */
  allowCustom?: boolean;
  multi?: boolean;
  includeAllOption?: boolean;
}) {
  const { t } = useTranslation();
  const effectiveAllowCustom = allowCustom;
  const optionValueSet = useMemo(() => new Set(options.map((o) => o.value)), [options]);

  const selectedValues = useMemo(
    () => (multi ? new Set(parseCsv(value)) : new Set([value])),
    [value, multi],
  );
  const isAllSelected = multi && (value === ALL_SENTINEL || selectedValues.has(ALL_SENTINEL));

  // In multi-select mode, any selected value that isn't in the options set
  // counts as a user-typed custom entry (and persists across re-renders).
  const customValuesFromAnswer = useMemo(() => {
    if (!effectiveAllowCustom) return [] as string[];
    if (!multi) {
      return value && !optionValueSet.has(value) && value !== ALL_SENTINEL ? [value] : [];
    }
    return [...selectedValues].filter((v) => v && v !== ALL_SENTINEL && !optionValueSet.has(v));
  }, [effectiveAllowCustom, multi, value, selectedValues, optionValueSet]);

  const hasCustomValue = customValuesFromAnswer.length > 0;
  const [showCustomInput, setShowCustomInput] = useState(hasCustomValue);
  const [customDraft, setCustomDraft] = useState(
    multi ? '' : customValuesFromAnswer[0] ?? '',
  );
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showCustomInput) return;
    const timer = setTimeout(() => customInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
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

  // Arrow key navigation for multi-select pills — users can walk through
  // options with ↑/↓ and toggle with Space/Enter. Single-selects keep the
  // plain click model (Enter there is reserved for advancing the questionnaire).
  const containerRef = useRef<HTMLDivElement>(null);
  const onPillKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (!multi) return;
    const root = containerRef.current;
    if (!root) return;
    const pills = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-pill="1"]'));
    if (pills.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      pills[(idx + 1) % pills.length]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      pills[(idx - 1 + pills.length) % pills.length]?.focus();
    } else if (e.key === ' ' || e.key === 'Enter') {
      // Space always toggles; Enter toggles only if the user explicitly
      // targeted a pill (the outer questionnaire owns Enter for "advance").
      if (e.key === ' ') e.preventDefault();
    }
  };

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <div className="flex flex-wrap gap-1.5">
        {multi && includeAllOption && (
          <Button
            type="button"
            data-pill="1"
            onClick={pickAll}
            onKeyDown={(e) => onPillKeyDown(e, 0)}
            variant={isAllSelected ? 'accent' : 'secondary'}
            tone={isAllSelected ? 'highlight' : undefined}
            size="sm"
          >
            {t.templates.adopt_modal.all_option}
          </Button>
        )}
        {options.map((opt, i) => {
          const selected =
            !showCustomInput &&
            !isAllSelected &&
            (multi ? selectedValues.has(opt.value) : value === opt.value);
          const pillIdx = (multi && includeAllOption ? 1 : 0) + i;
          return (
            <Button
              key={opt.value}
              type="button"
              data-pill="1"
              onClick={() => togglePill(opt.value)}
              onKeyDown={(e) => onPillKeyDown(e, pillIdx)}
              variant={selected ? 'accent' : 'secondary'}
              tone={selected ? 'highlight' : undefined}
              size="sm"
              tooltip={opt.sublabel ?? undefined}
            >
              {opt.label}
            </Button>
          );
        })}
        {/* Custom values that were previously entered appear as dismissable
            pills so the user can keep accumulating more in multi-select mode. */}
        {customValuesFromAnswer.map((v) => (
          <span
            key={`custom-${v}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-body-lg rounded-card border border-primary/30 bg-primary/15 text-primary"
          >
            {v}
            <Button
              type="button"
              onClick={() => removeCustomValue(v)}
              variant="ghost"
              size="icon-sm"
              className="opacity-60"
              aria-label={`Remove ${v}`}
            >
              <X className="w-3 h-3" />
            </Button>
          </span>
        ))}
        {effectiveAllowCustom && (
          <Button
            type="button"
            onClick={() => setShowCustomInput((v) => !v)}
            variant={showCustomInput ? 'accent' : 'secondary'}
            tone={showCustomInput ? 'highlight' : undefined}
            size="sm"
          >
            {multi ? t.templates.adopt_modal.custom_prefix : t.templates.adopt_modal.custom_plain}
          </Button>
        )}
      </div>
      {effectiveAllowCustom && showCustomInput && (
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
            className="flex-1 max-w-sm px-3 py-1.5 typo-body rounded-card border border-hair bg-foreground/[0.03] text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30 focus:bg-foreground/[0.05] transition-all"
          />
          {multi && (
            <Button
              type="button"
              onClick={commitCustom}
              disabled={!customDraft.trim()}
              variant="accent"
              tone="highlight"
              size="sm"
            >
              {t.templates.adopt_modal.add_custom}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
