import { useId, type ReactNode } from 'react';

const FIELD_CLASS =
  'w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground focus:outline-none focus:border-primary/40';

interface FieldProps {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}

export function Field({ label, hint, children }: FieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="typo-caption text-foreground block mb-1">
        {label}
      </label>
      {children(id)}
      {hint && <p className="typo-micro text-foreground mt-1">{hint}</p>}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'url' | 'number';
  autoFocus?: boolean;
  required?: boolean;
}

export function TextField({ label, value, onChange, placeholder, type = 'text', autoFocus, required }: TextFieldProps) {
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          autoFocus={autoFocus}
          className={FIELD_CLASS}
        />
      )}
    </Field>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}

export function TextAreaField({ label, value, onChange, placeholder, rows = 3 }: TextAreaFieldProps) {
  return (
    <Field label={label}>
      {(id) => (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={`${FIELD_CLASS} resize-none`}
        />
      )}
    </Field>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}

export function SelectField<T extends string>({ label, value, onChange, options }: SelectFieldProps<T>) {
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={FIELD_CLASS}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
    </Field>
  );
}
