/**
 * The one line of feedback the Twin lane gets — INLINE, between the header row
 * and the tab strip, because nothing may float over the page host (a separate
 * OS window). It says what the lane is doing per phase, shows the registry-
 * resolved error on failure, and carries the Submit confirmation as a
 * one-liner ("Submit the form? [Submit] [Cancel]") rather than a dialog:
 * `structure.test.ts` forbids `<BaseModal>` on this route for exactly this
 * reason.
 *
 * Classes match the navigation-refusal line under the address field
 * (`AddressBar.tsx`): `typo-caption`, amber for a refusal, foreground for the
 * rest. Renders nothing while idle so the page rect is not taxed for a lane
 * nobody armed.
 */
import { AlertCircle, Check, MousePointerClick } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';

import type { TwinDraftSnapshot } from '../twinDraftLane';

interface TwinStatusRowProps {
  lane: TwinDraftSnapshot;
  onConfirmSubmit: () => Promise<void>;
  onDismissSubmit: () => void;
}

export default function TwinStatusRow({ lane, onConfirmSubmit, onDismissSubmit }: TwinStatusRowProps) {
  const { t, tx } = useTranslation();
  const v = t.browser.twin;

  if (lane.phase === 'idle') return null;

  const label = lane.target?.label.trim() || v.untitled_box;

  if (lane.confirmingSubmit) {
    return (
      <div
        role="status"
        data-testid="webview-twin-status"
        className="flex items-center gap-2 px-3 py-1.5 rounded-card border border-primary/15 bg-secondary/30 min-w-0"
      >
        <span className="typo-caption text-foreground truncate">{v.confirm_submit}</span>
        <AsyncButton size="xs" variant="primary" onClick={onConfirmSubmit} data-testid="webview-twin-submit-confirm">
          {v.submit}
        </AsyncButton>
        <Button size="xs" variant="ghost" onClick={onDismissSubmit} data-testid="webview-twin-submit-dismiss">
          {v.cancel}
        </Button>
      </div>
    );
  }

  const failed = lane.phase === 'failed';
  const Icon = failed ? AlertCircle : lane.phase === 'inserted' ? Check : MousePointerClick;
  const tone = failed ? 'text-amber-400' : lane.phase === 'inserted' ? 'text-emerald-400' : 'text-foreground/70';
  const text =
    lane.phase === 'armed'
      ? v.armed_hint
      : lane.phase === 'drafting'
        ? tx(v.drafting_into, { label })
        : lane.phase === 'inserted'
          ? tx(v.inserted, { label })
          : `${v.failed_prefix}: ${lane.error ?? ''}`;

  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="webview-twin-status"
      data-phase={lane.phase}
      className={`flex items-center gap-2 px-3 typo-caption ${tone} min-w-0`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </p>
  );
}
