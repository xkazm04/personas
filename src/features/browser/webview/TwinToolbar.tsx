/**
 * The two Twin icons on the address-bar row: ARM the active twin to draft
 * into the next box the user clicks, and SUBMIT the form the draft landed in.
 *
 * NOTHING HERE OVERLAYS THE PAGE. The page host is a separate OS window
 * painted above the React tree, so this toolbar has no popover, no menu and
 * no draft panel — feedback is the icon's own state (pressed while armed, a
 * real spinner while drafting) plus the inline `TwinStatusRow` under this row.
 * A `Tooltip` is the one floating thing it uses, and it floats UP from the
 * header row, above the slot's top edge, never over the page.
 */
import { Send, Sparkles } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import type { TwinDraftPhase } from '../twinDraftLane';

interface TwinToolbarProps {
  phase: TwinDraftPhase;
  /** Null when no twin is active — the Draft icon is disabled with a pointer to Profiles. */
  activeTwinId: string | null;
  /** No tab, nothing to arm. */
  hasTab: boolean;
  onArm: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export default function TwinToolbar({
  phase,
  activeTwinId,
  hasTab,
  onArm,
  onCancel,
  onSubmit,
}: TwinToolbarProps) {
  const { t } = useTranslation();
  const v = t.browser.twin;

  const armed = phase === 'armed';
  const drafting = phase === 'drafting';
  const noTwin = activeTwinId === null;
  const draftDisabled = noTwin || !hasTab;
  const draftLabel = noTwin ? v.no_active_twin : armed ? v.cancel_pick : v.draft_with_twin;

  return (
    <div className="flex items-center gap-1 shrink-0" role="group" aria-label={v.draft_with_twin} data-testid="webview-twin-toolbar">
      <Tooltip content={draftLabel} triggerFocusable={draftDisabled}>
        <Button
          size="icon-sm"
          variant={armed ? 'primary' : 'ghost'}
          icon={<Sparkles className="w-4 h-4" />}
          loading={drafting}
          disabled={draftDisabled}
          aria-pressed={armed}
          aria-label={draftLabel}
          className={draftDisabled ? 'pointer-events-none' : undefined}
          onClick={armed ? onCancel : onArm}
          data-testid="webview-twin-draft"
        />
      </Tooltip>
      <Tooltip content={v.submit_form} triggerFocusable={phase !== 'inserted'}>
        <Button
          size="icon-sm"
          variant="ghost"
          icon={<Send className="w-4 h-4" />}
          disabled={phase !== 'inserted'}
          aria-label={v.submit_form}
          className={phase !== 'inserted' ? 'pointer-events-none' : undefined}
          onClick={onSubmit}
          data-testid="webview-twin-submit"
        />
      </Tooltip>
    </div>
  );
}
