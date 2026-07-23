// Sample-portfolio notice — shown centered over the canvas whenever the demo
// scene renders (no projects cross-scanned yet). The demo islands stay visible
// and interactive behind it, but the card makes "this is not your data"
// unmissable and offers the two ways out: scan the workspace or add a project.
// Dismissing keeps the session exploratory; the small corner badge remains.
import { FolderPlus, ScanSearch } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

export function DemoNotice({ scanning, onScan, onNewProject, onDismiss }: {
  /** A workspace scan is in flight — disables the CTA and swaps its label. */
  scanning: boolean;
  onScan: () => void;
  onNewProject: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <div
        className="pointer-events-auto max-w-sm mx-4 px-5 py-4 rounded-card border border-primary/20 bg-secondary/95 shadow-elevation-4 backdrop-blur-sm text-center"
        role="dialog"
        aria-label={t.mastermind.demo_title}
        data-testid="mm-demo-notice"
      >
        <h2 className="typo-body font-semibold text-foreground mb-1.5">{t.mastermind.demo_title}</h2>
        <p className="typo-caption text-foreground/65 mb-3.5">{t.mastermind.demo_body}</p>
        <div className="flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={<ScanSearch className="w-3.5 h-3.5" aria-hidden />}
            loading={scanning}
            loadingLabel={t.mastermind.demo_scanning}
            onClick={onScan}
            data-testid="mm-demo-scan"
          >
            {t.mastermind.demo_cta_scan}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<FolderPlus className="w-3.5 h-3.5" aria-hidden />}
            onClick={onNewProject}
            data-testid="mm-demo-new"
          >
            {t.mastermind.demo_cta_new}
          </Button>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2.5 typo-caption text-foreground/50 hover:text-foreground/80 transition-colors focus-ring rounded-interactive px-1"
          data-testid="mm-demo-dismiss"
        >
          {t.mastermind.demo_dismiss}
        </button>
      </div>
    </div>
  );
}
