import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <label className="block typo-body font-medium text-foreground">
        {label}
        {optional && <span className="text-foreground ml-1">{t.triggers.field_optional}</span>}
      </label>
      {children}
      {error && (
        <p id={errorId} className="typo-body text-red-400/80">{error}</p>
      )}
      {helpText && (
        <p className="typo-body text-foreground">{helpText}</p>
      )}
    </div>
  );
}
