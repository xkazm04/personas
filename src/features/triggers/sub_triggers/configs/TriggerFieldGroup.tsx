import type { ReactNode } from 'react';

export interface TriggerFieldGroupProps {
  label: ReactNode;
  helpText?: string;
  optional?: boolean;
  error?: string | null;
  errorId?: string;
  children: ReactNode;
}

export function TriggerFieldGroup({
  label, helpText, optional, error, errorId, children,
}: TriggerFieldGroupProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground">
        {label}
        {optional && <span className="text-foreground ml-1">(optional)</span>}
      </label>
      {children}
      {error && (
        <p id={errorId} className="text-sm text-red-400/80">{error}</p>
      )}
      {helpText && (
        <p className="text-sm text-foreground">{helpText}</p>
      )}
    </div>
  );
}
