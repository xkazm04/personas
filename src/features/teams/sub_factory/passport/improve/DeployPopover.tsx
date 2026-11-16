// The "Deploy Claude Code" popover (P3) — for code-requiring gaps (context graph,
// CLAUDE.md, tests, observability). Surfaces the applicable golden-standard
// upgrade actions for a row: a context SCAN, or a Claude-Code TASK whose precise
// prompt is previewable. Queue (safe, review-then-run) or Deploy now (runs the
// CLI). Portalled + anchored like the other improve popovers.
//
// The BODY lives in `ImproveClassicPanel`; this file is the positioned shell:
// placement, dismissal, chrome. Neither modal mounts that panel: Monitoring
// runs the same operations through `useImproveActions` in its console, and
// Database has no deploy action, ladder or connector spec keyed to its row.
import { createPortal } from 'react-dom';
import Button from '@/features/shared/components/buttons/Button';
import { Rocket, X } from 'lucide-react';

import { useImprove } from './ImproveContext';
import { hasClassicContent, ImproveClassicPanel } from './ImproveClassicPanel';
import { useAnchoredPopover } from './useAnchoredPopover';

const WIDTH = 442; // 340 +30% — roomier body for the icon-grid connector section

export function DeployPopover({
  slug, rowKey, anchor, onClose,
}: {
  slug: string;
  rowKey: string;
  anchor: DOMRect | null;
  onClose: () => void;
}) {
  const engine = useImprove();
  const raw = engine?.getRaw(slug);

  const { panelRef, style: popStyle } = useAnchoredPopover({ anchor, width: WIDTH, onClose, active: !!engine && !!raw && !!anchor && hasClassicContent(slug, rowKey, engine), estimatedHeight: 240 });

  if (!engine || !raw || !anchor || !hasClassicContent(slug, rowKey, engine)) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
      aria-label={`Deploy upgrade for ${raw.project.name}`}
      style={popStyle(anchor)}
      className="fixed z-[9995] outline-none rounded-modal border border-hair bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-hair bg-surface-1">
        <Rocket className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption text-ink-2 truncate">Upgrade {raw.project.name}</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="p-2 max-h-[420px] overflow-y-auto">
        <ImproveClassicPanel slug={slug} rowKey={rowKey} onDone={onClose} />
      </div>
    </div>,
    document.body,
  );
}
