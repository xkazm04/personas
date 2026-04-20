import { LayoutGrid } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Empty Mosaic variant shell for Phase 05. Real persona/output overview
 * lands in Phase 07 — this placeholder just gives the tab something to
 * render so the shell is navigable end-to-end.
 */
export default function MosaicVariant() {
  const { t, tx } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-foreground/60 p-8">
      <div className="w-14 h-14 rounded-3xl border border-primary/15 bg-foreground/[0.03] flex items-center justify-center">
        <LayoutGrid className="w-6 h-6 text-foreground/50" />
      </div>
      <div className="text-sm font-medium text-foreground">{t.simple_mode.tab_mosaic}</div>
      <div className="text-xs text-foreground/50 text-center max-w-sm">
        {tx(t.simple_mode.wiring_next_phase, { phase: '07' })} ·{' '}
        {t.simple_mode.wiring_mosaic_hint}
      </div>
    </div>
  );
}
