/**
 * Back / forward / address / go, for the tab Rust says is focused.
 *
 * A REFUSED NAVIGATION IS NOT A TOAST. Most attempts to leave the whitelist
 * are ordinary — a link on the page, a redirect, a typo — and a toast per
 * refusal would be a storm that teaches the operator to ignore it. The refusal
 * renders inline under the field, resolved through the error registry, and it
 * clears on the next keystroke. Toasts stay for things the operator did not
 * cause.
 */
import { ArrowLeft, ArrowRight, CornerDownLeft } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import type { BrowserTab } from '../types';

interface AddressBarProps {
  tab: BrowserTab | null;
  value: string;
  refusal: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  onForward: () => void;
}

export default function AddressBar({
  tab,
  value,
  refusal,
  onChange,
  onSubmit,
  onBack,
  onForward,
}: AddressBarProps) {
  const { t } = useTranslation();
  const v = t.browser.webview;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onBack}
          disabled={!tab?.can_go_back}
          aria-label={v.back}
          data-testid="webview-back"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onForward}
          disabled={!tab?.can_go_forward}
          aria-label={v.forward}
          data-testid="webview-forward"
        >
          <ArrowRight className="w-4 h-4" />
        </Button>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          aria-label={v.address_label}
          aria-invalid={!!refusal}
          aria-describedby={refusal ? 'webview-address-refusal' : undefined}
          placeholder={v.address_placeholder}
          className={`${INPUT_FIELD} flex-1 font-mono`}
          data-testid="webview-address"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onSubmit}
          aria-label={v.go}
          data-testid="webview-go"
        >
          <CornerDownLeft className="w-4 h-4" />
        </Button>
      </div>
      {/* The region is mounted EMPTY and stays mounted. A live region that
          appears already carrying its text enters the accessibility tree in the
          same commit as the text, so there is no change for a screen reader to
          observe and the announcement never fires. */}
      <p
        id="webview-address-refusal"
        role="status"
        className={`typo-caption text-amber-400 ${refusal ? '' : 'sr-only'}`}
      >
        {refusal ?? ''}
      </p>
    </div>
  );
}
