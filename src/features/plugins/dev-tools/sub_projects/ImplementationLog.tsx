import { useState } from 'react';
import { CheckCircle2, AlertCircle, ThumbsUp, BarChart3, MessageSquare, Search, Circle, Plus } from 'lucide-react';
import type { DevGoalSignal } from '@/lib/bindings/DevGoalSignal';
import { useTranslation } from '@/i18n/useTranslation';

const SIGNAL_ICONS: Record<string, { icon: typeof Circle; color: string }> = {
  task_completed: { icon: CheckCircle2, color: 'text-emerald-400' },
  task_failed: { icon: AlertCircle, color: 'text-red-400' },
  idea_accepted: { icon: ThumbsUp, color: 'text-blue-400' },
  progress_update: { icon: BarChart3, color: 'text-amber-400' },
  manual_note: { icon: MessageSquare, color: 'text-violet-400' },
  context_scan_completed: { icon: Search, color: 'text-teal-400' },
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

interface ImplementationLogProps {
  goalId: string;
  signals: DevGoalSignal[];
  onAddNote: (message: string) => void;
}

export function ImplementationLog({ signals, onAddNote }: ImplementationLogProps) {
  const { t } = useTranslation();
  const [noteText, setNoteText] = useState('');

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    onAddNote(noteText.trim());
    setNoteText('');
  };

  const sorted = [...signals].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="space-y-3">
      <h4 className="typo-label font-semibold text-primary uppercase tracking-wider">
        Implementation Log
      </h4>

      {/* Add note input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
          placeholder={t.plugins.dev_tools.add_note_placeholder}
          className="flex-1 px-2.5 py-1.5 typo-caption bg-secondary/50 border border-border/30 rounded-card text-foreground placeholder:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <button
          onClick={handleAddNote}
          disabled={!noteText.trim()}
          className="px-2.5 py-1.5 typo-caption font-medium rounded-card bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Timeline */}
      {sorted.length === 0 ? (
        <p className="typo-caption text-foreground italic py-4 text-center">{t.plugins.dev_tools.no_activity}</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {sorted.map((signal) => {
            const config = SIGNAL_ICONS[signal.signal_type] ?? { icon: Circle, color: 'text-foreground' };
            const Icon = config.icon;
            return (
              <div key={signal.id} className="flex items-start gap-2 py-1.5 px-1">
                <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${config.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="typo-caption text-foreground leading-relaxed">{signal.message}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-foreground">{relativeTime(signal.created_at)}</span>
                    {signal.delta != null && signal.delta !== 0 && (
                      <span className={`text-[10px] font-mono ${signal.delta > 0 ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
                        {signal.delta > 0 ? '+' : ''}{signal.delta}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
