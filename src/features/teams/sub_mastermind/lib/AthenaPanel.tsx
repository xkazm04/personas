// Athena's composed panel, docked beside the canvas (WP3, 2026-08-04).
//
// The two-dimension doctrine: the canvas is the artifact she ACTS IN, chat and
// the orb are where she TALKS. So this is a dock, not a floating card and not a
// second chat — it sits in the page's right rail, holds exactly one project's
// composed surface, and closes back to the canvas.
//
// Rendering goes through `SurfaceRenderer` (the frozen SurfaceSpec vocabulary),
// never a bespoke widget registry: every block maps onto a blessed catalog
// component, so a hallucinated block is dropped rather than rendered, and
// nothing runs without the operator confirming it.
//
// The reset control is not a convenience — it is the mitigation for persisting
// panels at all. The Cockpit died partly because one hallucinated spec was
// saved forever with no way out. Per project, one click, gone.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, X } from 'lucide-react';

import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { SurfaceRenderer } from '@/features/shared/components/surface/SurfaceRenderer';
import { parseSurfaceSpec } from '@/features/shared/components/surface/surfaceSpec';
import type { DispatchRequest } from '@/features/shared/dispatch/DispatchChooser';
import { useTranslation } from '@/i18n/useTranslation';

import type { CanvasFocusTarget } from './focusStore';
import { removeAthenaPanel, type AthenaPanel as AthenaPanelDoc } from './layoutStore';

export interface AthenaPanelProps {
  /** What the panel is anchored to. v1 = a project island; the discriminated
   *  target is what makes island-anchoring later a renderer change. */
  target: CanvasFocusTarget;
  /** Stored panel for this target (the host reads `useAthenaPanels()`). */
  panel: AthenaPanelDoc;
  /** Display name of the focused project. */
  projectName: string;
  /** Repo target for the surface's `dispatch` actions; omitted for a project
   *  with no registered root path, which renders those actions disabled. */
  dispatchTarget?: DispatchRequest['target'];
  onClose: () => void;
}

export function AthenaPanel({ target, panel, projectName, dispatchTarget, onClose }: AthenaPanelProps) {
  const { t, tx } = useTranslation();
  const [confirmReset, setConfirmReset] = useState(false);

  // Salvage-instead-of-reject: individually broken blocks are dropped and
  // counted; only a wholly unrenderable spec falls through to the honest
  // "could not render" state below.
  const parsed = useMemo(() => parseSurfaceSpec(panel.spec), [panel.spec]);

  const reset = () => {
    removeAthenaPanel(target.slug);
    setConfirmReset(false);
    onClose();
  };

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.2, ease: 'linear' }}
      className="absolute top-0 right-0 bottom-0 w-[380px] max-w-full z-30 bg-secondary/95 backdrop-blur-sm border-l border-primary/15 shadow-elevation-4 overflow-y-auto"
      data-testid="mm-athena-panel"
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 bg-secondary/95 border-b border-primary/10">
        <div className="min-w-0">
          <span className="block typo-label text-foreground/90 truncate">{projectName}</span>
          {panel.composedAt && (
            <span className="flex items-center gap-1 typo-caption text-foreground">
              {t.mastermind.athena_panel_composed}
              <RelativeTime timestamp={panel.composedAt} />
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          title={t.mastermind.athena_panel_reset}
          aria-label={t.mastermind.athena_panel_reset}
          className="ml-auto p-1 rounded-interactive text-foreground hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-athena-panel-reset"
        >
          <RotateCcw className="w-4 h-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t.mastermind.athena_panel_close}
          aria-label={t.mastermind.athena_panel_close}
          className="p-1 rounded-interactive text-foreground hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-athena-panel-close"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <div className="px-4 py-3">
        {parsed.ok ? (
          <SurfaceRenderer
            spec={parsed.spec}
            dropped={parsed.dropped}
            context={{ dispatchTarget, fleetKey: `mastermind:${target.slug}` }}
          />
        ) : (
          // Degrade to a plain, resettable note — never a permanent error box.
          <div className="rounded-card border border-primary/10 bg-secondary/20 p-4" data-testid="mm-athena-panel-empty">
            <p className="typo-body text-foreground/90">{t.mastermind.athena_panel_unreadable}</p>
            <p className="typo-caption text-foreground mt-1">{t.mastermind.athena_panel_unreadable_hint}</p>
          </div>
        )}
      </div>

      {confirmReset && (
        <ConfirmDialog
          title={t.mastermind.athena_panel_reset_title}
          body={tx(t.mastermind.athena_panel_reset_body, { name: projectName })}
          confirmLabel={t.mastermind.athena_panel_reset_action}
          danger
          onConfirm={reset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </motion.aside>
  );
}
