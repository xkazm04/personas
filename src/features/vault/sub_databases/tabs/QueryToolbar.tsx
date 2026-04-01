import { Play, Wand2, Save, Check, Shield, ShieldOff } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

interface QueryToolbarProps {
  selectedTitle: string;
  language: string;
  saveState: 'idle' | 'saving' | 'saved';
  executing: boolean;
  editorValue: string;
  isAiRunning: boolean;
  safeMode: boolean;
  onSave: () => void;
  onExecute: () => void;
  onAiRun: () => void;
  onToggleSafeMode: () => void;
}

export function QueryToolbar({
  selectedTitle,
  language,
  saveState,
  executing,
  editorValue,
  isAiRunning,
  safeMode,
  onSave,
  onExecute,
  onAiRun,
  onToggleSafeMode,
}: QueryToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/8 bg-secondary/5 shrink-0">
      <span className="text-sm font-semibold text-foreground/70 flex-1 truncate">{selectedTitle}</span>
      <span className="text-sm uppercase tracking-wider text-muted-foreground/60 px-2 py-0.5 rounded-lg bg-secondary/40 border border-primary/8 font-medium">
        {language}
      </span>

      <button
        onClick={onSave}
        disabled={saveState === 'saving'}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-sm font-medium border transition-all duration-300 ${
          saveState === 'saved'
            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25 shadow-elevation-1 shadow-emerald-500/10'
            : saveState === 'saving'
              ? 'text-muted-foreground/40 border-transparent'
              : 'text-muted-foreground/50 hover:text-foreground/70 hover:bg-secondary/40 border-transparent hover:border-primary/10'
        }`}
      >
        {saveState === 'saved' ? <Check className="w-3 h-3" /> : saveState === 'saving' ? <LoadingSpinner size="xs" /> : <Save className="w-3 h-3" />}
        {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving...' : 'Save'}
      </button>

      <button
        onClick={onExecute}
        disabled={executing || !editorValue.trim()}
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        {executing ? <LoadingSpinner size="xs" /> : <Play className="w-3 h-3" />}
        {executing ? 'Running...' : 'Run'}
      </button>

      <button
        onClick={onAiRun}
        disabled={isAiRunning || !editorValue.trim()}
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium bg-gradient-to-r from-violet-500/15 to-fuchsia-500/10 text-violet-400 border border-violet-500/20 hover:from-violet-500/25 hover:to-fuchsia-500/20 hover:border-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-elevation-1 shadow-violet-500/5"
      >
        {isAiRunning ? <LoadingSpinner size="xs" /> : <Wand2 className="w-3 h-3" />}
        {isAiRunning ? 'Debugging...' : 'AI Run'}
      </button>

      <button
        onClick={onToggleSafeMode}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium border transition-all ${
          safeMode
            ? 'bg-emerald-500/8 text-emerald-400/80 border-emerald-500/20 hover:bg-emerald-500/15'
            : 'bg-amber-500/8 text-amber-400/80 border-amber-500/20 hover:bg-amber-500/15'
        }`}
        title={safeMode ? 'Safe mode ON: write queries require confirmation' : 'Safe mode OFF: all queries execute directly'}
      >
        {safeMode ? <Shield className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
        {safeMode ? 'Safe' : 'Write'}
      </button>
    </div>
  );
}
