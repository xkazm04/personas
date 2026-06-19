import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { Copy, ClipboardPaste, Eye, EyeOff, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';


export type ValidationGlow = 'none' | 'valid' | 'warning';

const MIN_KEY_LENGTH = 8;

// Auto-clear copied secrets from the OS clipboard after this many ms.
// Only fires when the clipboard still contains the value we wrote — never overwrites
// a value the user copied afterwards.
const SECRET_CLIPBOARD_TTL_MS = 30_000;

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
  isVisible: boolean;
  setIsVisible: Dispatch<SetStateAction<boolean>>;
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
  isVisible,
  setIsVisible,
}: FieldActionButtonsProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardWipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (clipboardWipeTimerRef.current) clearTimeout(clipboardWipeTimerRef.current);
    };
  }, []);

  const handlePaste = async () => {
    if (!isEditable || !onChange) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) onChange(text.trim());
    } catch (err) { silentCatch("features/vault/sub_credentials/components/forms/FieldCaptureHelpers:catch1")(err); }
  };

  const handleCopy = async () => {
    if (!value) return;
    try {
      await copyText(value);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);

      // For secrets, wipe the clipboard after a TTL — but only if the user hasn't
      // copied anything else in the meantime (don't trample later copies).
      if (isSecret) {
        if (clipboardWipeTimerRef.current) clearTimeout(clipboardWipeTimerRef.current);
        const copiedValue = value;
        clipboardWipeTimerRef.current = setTimeout(async () => {
          try {
            const current = await navigator.clipboard.readText();
            if (current === copiedValue) {
              await copyText('');
            }
          } catch (err) { silentCatch("features/vault/sub_credentials/components/forms/FieldCaptureHelpers:catch2")(err); }
        }, SECRET_CLIPBOARD_TTL_MS);
      }
    } catch (err) { silentCatch("features/vault/sub_credentials/components/forms/FieldCaptureHelpers:catch3")(err); }
  };

  return (
    <div className="flex items-center gap-1">
      {mode === 'confirming' && value && (
        <StatusBadge variant="success" size="sm" icon={<Check className="w-2.5 h-2.5" />}>
          captured
        </StatusBadge>
      )}
      {isSecret && (
        <button
          type="button"
          onClick={() => setIsVisible((v) => !v)}
          className="p-0.5 text-foreground hover:text-foreground/80 transition-colors"
          data-testid={testIdBase ? `${testIdBase}-eye-btn` : undefined}
          aria-label={isVisible ? 'Hide value' : 'Show value'}
          aria-pressed={isVisible}
          title={isVisible ? 'Hide value' : 'Show value'}
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
            <span className="absolute top-full mt-0.5 typo-body text-foreground whitespace-nowrap">
              {t.vault.forms.copied_to_clipboard}
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
  );
}
