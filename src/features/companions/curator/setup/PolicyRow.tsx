/**
 * One policy row: what it is, what it means, the control, and - for a brake -
 * what has been spent against it today.
 *
 * `SettingRow` is the shared primitive for a label + description + TOGGLE;
 * none of these nine settings is a toggle, so this is the same type ramp
 * (full-opacity label, muted description) around an arbitrary control rather
 * than a second toggle row.
 */
import type { ReactNode } from 'react';

export function PolicyRow({ label, description, control, foot, htmlFor }: {
  label: string;
  description: string;
  control: ReactNode;
  /** The measured reading under the control - today's consumption, usually. */
  foot?: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-start gap-4 px-1 py-2.5 border-b border-foreground/5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <label className="typo-body text-foreground block" htmlFor={htmlFor}>
          {label}
        </label>
        <p className="typo-caption text-foreground opacity-70 mt-0.5">{description}</p>
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        {control}
        {foot}
      </div>
    </div>
  );
}
