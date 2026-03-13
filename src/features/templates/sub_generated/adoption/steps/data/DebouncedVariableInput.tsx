import { useState, useEffect, useRef, useCallback } from 'react';
import type { AdoptionRequirement } from '@/lib/types/designTypes';

const VARIABLE_DEBOUNCE_MS = 300;

/**
 * Keeps local state for immediate keystroke feedback while debouncing
 * the write to the wizard reducer by 300ms. This avoids full
 * substituteVariables / filterDesignResult recomputation on every keystroke.
 */
export function DebouncedVariableInput({
  variable,
  value: externalValue,
  onUpdate,
  inputClass: cls,
  showError,
  errorId,
}: {
  variable: AdoptionRequirement;
  value: string;
  onUpdate: (key: string, value: string) => void;
  inputClass: string;
  showError: boolean;
  errorId?: string;
}) {
  const [localValue, setLocalValue] = useState(externalValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sync from external when it changes outside this component (e.g. restore)
  useEffect(() => {
    setLocalValue(externalValue);
  }, [externalValue]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setLocalValue(next);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onUpdate(variable.key, next), VARIABLE_DEBOUNCE_MS);
    },
    [onUpdate, variable.key],
  );

  // Flush pending debounce on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const inputType =
    variable.type === 'url' ? 'url'
      : variable.type === 'email' ? 'email'
        : 'text';

  const placeholder =
    variable.type === 'cron' ? (variable.default_value ?? '0 9 * * 1-5')
      : variable.type === 'email' ? (variable.default_value ?? 'user@example.com')
        : variable.type === 'url' ? (variable.default_value ?? 'https://...')
          : (variable.default_value ?? '');

  return (
    <input
      type={inputType}
      value={localValue}
      onChange={handleChange}
      placeholder={placeholder}
      aria-invalid={showError}
      aria-describedby={errorId}
      className={`${cls} ${showError ? '!border-red-500/30' : ''}`}
    />
  );
}
