import { useEffect, useRef } from 'react';
import { Square, Terminal } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

/** Max log rows mounted in the overlay at once (the panel only shows ~15). */
const RENDER_TAIL = 200;

export default function ScanOverlay({
  scanning,
  lines,
  onCancel,
}: {
  scanning: boolean;
  lines: string[];
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  if (!scanning) return null;
  return (
    <div
      className="animate-fade-slide-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 surface-blur-modal"
    >
      <div className="bg-background border border-hair rounded-card p-6 w-full max-w-lg shadow-elevation-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-modal bg-surface-2 border border-hair flex items-center justify-center">
              <LoadingSpinner size="lg" className="text-status-warning" />
            </div>
            <div>
              <h3 className="typo-section-title">{t.plugins.dev_tools.scanning_codebase}</h3>
              <p className="typo-body text-foreground">{t.plugins.dev_tools.analyzing_codebase}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onCancel} title={t.plugins.dev_tools.cancel_scan}>
            <Square className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Terminal output */}
        <div
          ref={scrollRef}
          className="bg-black/40 border border-hair rounded-modal p-3 h-56 overflow-y-auto typo-caption"
        >
          {lines.length === 0 ? (
            <p className="text-foreground">{t.plugins.dev_tools.waiting_for_output}</p>
          ) : (
            // Render only the visible tail — the buffer is already tail-capped
            // upstream, but never mount more rows than the panel can scroll
            // through, so a fast burst can't spike DOM-node count.
            lines.slice(-RENDER_TAIL).map((line, i) => (
              <div
                key={i}
                className={`${
                  line.startsWith('[Milestone]')
                    ? 'text-status-warning'
                    : line.startsWith('[Created]')
                    ? 'text-status-success'
                    : line.startsWith('[Tool]')
                    ? 'text-status-info'
                    : line.startsWith('[Error]')
                    ? 'text-status-error'
                    : line.startsWith('[Complete]')
                    ? 'text-status-success font-medium'
                    : 'text-foreground'
                }`}
              >
                {line}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 mt-3 typo-caption text-foreground">
          <Terminal className="w-3 h-3" />
          <span>{lines.length} lines</span>
        </div>
      </div>
    </div>
  );
}
