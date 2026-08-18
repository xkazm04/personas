// Corpus-health warnings badge + popover — extracted from SubjectsView so the
// Subjects lane and the hierarchy graph render the identical readout. Renders
// nothing when the reader had nothing to warn about.
import { useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useTranslation } from '@/i18n/useTranslation';
import type { HierarchyWarning } from '@/lib/bindings/HierarchyWarning';

export function CorpusWarningsBadge({ warnings }: { warnings: readonly HierarchyWarning[] }) {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useClickOutside(ref, open, () => setOpen(false));

  if (warnings.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="typo-caption flex items-center gap-1.5 rounded-interactive border border-status-warning/30 bg-status-warning/10 px-2 py-1 text-status-warning hover:bg-status-warning/20 transition-colors"
      >
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
        {tx(p.warnings_badge, { count: warnings.length })}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-[420px] max-h-80 overflow-y-auto rounded-card border border-border/60 bg-background shadow-elevation-3 p-2">
          {/* muted-ok: popover section header, structural micro-label */}
          <h4 className="typo-label text-foreground/60 px-1.5 pb-1.5">{p.warnings_title}</h4>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={`${w.path}:${i}`} className="rounded-interactive bg-secondary/30 px-2 py-1.5">
                <code className="typo-caption font-mono text-foreground block truncate">
                  {w.path}
                </code>
                <span className="typo-caption text-foreground">{w.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
