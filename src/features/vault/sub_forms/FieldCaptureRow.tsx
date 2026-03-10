import { useEffect, useRef, useState } from 'react';
import { Copy, ClipboardPaste, Eye, EyeOff, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';

type FieldCaptureSource = 'schema' | 'negotiator' | 'auto';
type FieldCaptureMode = 'readonly' | 'editable' | 'confirming';
type FieldInputType = 'text' | 'password' | 'url' | 'select';

interface FieldCaptureRowProps {
  source: FieldCaptureSource;
  mode: FieldCaptureMode;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  helpText?: string;
  error?: string;
  inputType?: FieldInputType;
  options?: string[];
  allowPaste?: boolean;
  allowCopy?: boolean;
  testIdBase?: string;
}

const SOURCE_ACCENT: Record<FieldCaptureSource, string> = {
  schema: 'focus:ring-primary/40',
  negotiator: 'focus:ring-violet-500/40',
  auto: 'focus:ring-emerald-500/35',
};

export function FieldCaptureRow({
  source,
  mode,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  required,
  hint,
  helpText,
  error,
  inputType = 'text',
  options,
  allowPaste = false,
  allowCopy = true,
  testIdBase,
}: FieldCaptureRowProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEditable = mode !== 'readonly' && !!onChange;
  const isSecret = inputType === 'password';

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const handlePaste = async () => {
    if (!isEditable || !onChange) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) onChange(text.trim());
    } catch {
      // intentional: non-critical — clipboard paste may be denied by browser
    }
  };

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // intentional: non-critical — clipboard copy may be denied by browser
    }
  };

  const valueClass = mode === 'confirming'
    ? (value ? 'border-emerald-500/25 bg-emerald-500/5 text-foreground' : 'border-primary/15 bg-secondary/25 text-muted-foreground/60')
    : 'border-border/50 bg-background/50 text-foreground';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-foreground/80">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </label>
        <div className="flex items-center gap-1">
          {mode === 'confirming' && value && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm">
              <Check className="w-2.5 h-2.5" />
              captured
            </span>
          )}
          {isSecret && (
            <button
              type="button"
              onClick={() => setIsVisible((v) => !v)}
              className="p-0.5 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
              data-testid={testIdBase ? `${testIdBase}-eye-btn` : undefined}
            >
              {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
          {allowCopy && (
            <div className="relative flex flex-col items-center">
              <button
                type="button"
                onClick={handleCopy}
                disabled={!value}
                className="p-0.5 text-muted-foreground/60 hover:text-foreground/80 disabled:opacity-30 transition-colors"
                title="Copy value"
                data-testid={testIdBase ? `${testIdBase}-copy-btn` : undefined}
              >
                {copied ? (
                  <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  </motion.div>
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              {isSecret && copied && (
                <span className="absolute top-full mt-0.5 text-sm text-muted-foreground/70 whitespace-nowrap">
                  Copied to clipboard
                </span>
              )}
            </div>
          )}
          {allowPaste && isEditable && (
            <button
              type="button"
              onClick={handlePaste}
              className="p-0.5 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
              title="Paste from clipboard"
              data-testid={testIdBase ? `${testIdBase}-paste-btn` : undefined}
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {hint && <p className="text-sm text-muted-foreground/80">{hint}</p>}

      {inputType === 'select' && options ? (
        <ThemedSelect
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={onBlur}
          disabled={!isEditable}
          className={`rounded-xl ${error ? 'border-red-500/50' : ''}`}
        >
          <option value="">{placeholder || 'Select...'}</option>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </ThemedSelect>
      ) : (
        <input
          type={isSecret && !isVisible ? 'password' : inputType === 'url' ? 'url' : 'text'}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={onBlur}
          disabled={!isEditable}
          placeholder={placeholder}
          className={`w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all placeholder-muted-foreground/30 disabled:opacity-70 disabled:cursor-not-allowed ${SOURCE_ACCENT[source]} ${error ? 'border-red-500/50' : valueClass}`}
          data-testid={testIdBase ? `${testIdBase}-input` : undefined}
        />
      )}

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        (helpText ? <p className="text-sm text-muted-foreground/60">{helpText}</p> : null)
      )}
    </div>
  );
}
