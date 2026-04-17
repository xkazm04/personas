import { useEffect, useRef } from 'react';
import { Square, Terminal } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

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
      className="animate-fade-slide-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-background border border-primary/10 rounded-2xl p-6 w-full max-w-lg shadow-elevation-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-modal bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <LoadingSpinner size="lg" className="text-amber-400" />
            </div>
            <div>
              <h3 className="typo-section-title">{t.plugins.dev_tools.scanning_codebase}</h3>
              <p className="text-md text-foreground">{t.plugins.dev_tools.analyzing_codebase}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onCancel} title="Cancel scan">
            <Square className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Terminal output */}
        <div
          ref={scrollRef}
          className="bg-black/40 border border-primary/10 rounded-modal p-3 h-56 overflow-y-auto font-mono text-[11px] leading-relaxed"
        >
          {lines.length === 0 ? (
            <p className="text-foreground">{t.plugins.dev_tools.waiting_for_output}</p>
          ) : (
            lines.map((line, i) => (
              <div
                key={i}
                className={`${
                  line.startsWith('[Milestone]')
                    ? 'text-amber-400'
                    : line.startsWith('[Created]')
                    ? 'text-emerald-400'
                    : line.startsWith('[Tool]')
                    ? 'text-blue-400/60'
                    : line.startsWith('[Error]')
                    ? 'text-red-400'
                    : line.startsWith('[Complete]')
                    ? 'text-emerald-300 font-medium'
                    : 'text-foreground'
                }`}
              >
                {line}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 mt-3 text-[10px] text-foreground">
          <Terminal className="w-3 h-3" />
          <span>{lines.length} lines</span>
        </div>
      </div>
    </div>
  );
}
