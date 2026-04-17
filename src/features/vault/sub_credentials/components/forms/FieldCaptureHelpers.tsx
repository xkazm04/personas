import { useEffect, useRef, useState } from 'react';
import { Copy, ClipboardPaste, Eye, EyeOff, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export type ValidationGlow = 'none' | 'valid' | 'warning';

const MIN_KEY_LENGTH = 8;

export type FieldInputType = 'text' | 'password' | 'url' | 'select';

export function computeValidationGlow(value: string, inputType: FieldInputType): ValidationGlow {
  if (!value) return 'none';
  const trimmed = value.trim();
  if (!trimmed) return 'warning';
  if (inputType === 'url') {
    try { new URL(trimmed); return 'valid'; } catch { return 'warning'; }
  }
  // For password/key fields: warn if too short or contains interior spaces (likely paste error)
  if (inputType === 'password') {
    if (trimmed.length < MIN_KEY_LENGTH) return 'warning';
    if (/\s/.test(trimmed)) return 'warning';
    return 'valid';
  }
  // Generic text: valid when non-empty
  return trimmed.length > 0 ? 'valid' : 'none';
}

export const GLOW_CLASSES: Record<ValidationGlow, string> = {
  none: '',
  valid: 'border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.15)]',
  warning: 'border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.12)]',
};

interface FieldActionButtonsProps {
  mode: 'readonly' | 'editable' | 'confirming';
  value: string;
  isSecret: boolean;
  isEditable: boolean;
  allowCopy: boolean;
  allowPaste: boolean;
  testIdBase?: string;
  onChange?: (value: string) => void;
}

export function FieldActionButtons({
  mode,
  value,
  isSecret,
  isEditable,
  allowCopy,
  allowPaste,
  testIdBase,
  onChange,
}: FieldActionButtonsProps) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // intentional: non-critical
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
      // intentional: non-critical
    }
  };

  return {
    isVisible,
    copied,
    buttons: (
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
            className="p-0.5 text-foreground hover:text-foreground/80 transition-colors"
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
              className="p-0.5 text-foreground hover:text-foreground/80 disabled:opacity-30 transition-colors"
              title={t.vault.credential_forms.copy_value}
              data-testid={testIdBase ? `${testIdBase}-copy-btn` : undefined}
            >
              {copied ? (
                <div className="animate-fade-scale-in">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            {isSecret && copied && (
              <span className="absolute top-full mt-0.5 text-sm text-foreground whitespace-nowrap">
                Copied to clipboard
              </span>
            )}
          </div>
        )}
        {allowPaste && isEditable && (
          <button
            type="button"
            onClick={handlePaste}
            className="p-0.5 text-foreground hover:text-foreground/80 transition-colors"
            title={t.vault.credential_forms.paste_from_clipboard}
            data-testid={testIdBase ? `${testIdBase}-paste-btn` : undefined}
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    ),
  };
}
