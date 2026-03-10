import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Zap,
  Loader2,
  Users,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  Brain,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { useAutoTeam } from './useAutoTeam';
import { BlueprintPreview, EXAMPLE_PROMPTS } from './BlueprintPreview';

interface AutoTeamModalProps {
  open: boolean;
  onClose: () => void;
}

export function AutoTeamModal({ open, onClose }: AutoTeamModalProps) {
  const at = useAutoTeam();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      at.reset();
    }
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && at.phase === 'idle') {
      at.suggest();
    }
    if (e.key === 'Enter' && at.phase === 'previewing') {
      at.apply();
    }
    if (e.key === 'Escape') {
      if (at.phase === 'previewing') {
        at.reset();
      } else {
        onClose();
      }
    }
  };

  const handleDone = () => {
    at.reset();
    onClose();
  };

  if (!open) return null;

  const isWorking = at.phase === 'suggesting' || at.phase === 'applying' || at.phase === 'seeding';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => { if (!isWorking) onClose(); }}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        className="relative w-full max-w-lg mx-4 bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/25 flex items-center justify-center">
              <Zap className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Auto-Team</h2>
              <p className="text-xs text-muted-foreground/60">Describe an outcome, get a team</p>
            </div>
          </div>
          {!isWorking && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-5 pb-5 space-y-4">
          {/* Input */}
          <div className="space-y-2">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={at.query}
                onChange={(e) => at.setQuery(e.target.value)}
                disabled={isWorking || at.phase === 'done'}
                placeholder="What do you want the team to do?"
                className="w-full px-4 py-3 rounded-xl bg-secondary/30 border border-primary/15 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/25 disabled:opacity-60 pr-10"
              />
              {at.phase === 'idle' && at.query.trim() && (
                <button
                  onClick={() => at.suggest()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 transition-colors"
                  title="Generate team"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
              )}
              {at.phase === 'suggesting' && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 animate-spin" />
              )}
            </div>

            {/* Example prompts */}
            {at.phase === 'idle' && !at.query && (
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => { at.setQuery(prompt); }}
                    className="text-xs px-2.5 py-1 rounded-lg bg-secondary/40 border border-primary/10 text-muted-foreground/60 hover:text-foreground/80 hover:bg-secondary/60 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {/* Suggesting */}
            {at.phase === 'suggesting' && (
              <motion.div
                key="suggesting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-3 py-6 justify-center"
              >
                <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                <span className="text-sm text-muted-foreground/70">Assembling your team...</span>
              </motion.div>
            )}

            {/* Preview */}
            {at.phase === 'previewing' && at.blueprint && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <BlueprintPreview blueprint={at.blueprint} />

                <div className="flex gap-2">
                  <button
                    onClick={at.reset}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-secondary/40 border border-primary/15 text-muted-foreground/80 hover:text-foreground hover:bg-secondary/60 transition-colors"
                  >
                    Try different
                  </button>
                  <button
                    onClick={at.apply}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 transition-all"
                  >
                    Create Team
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* Applying / Seeding */}
            {(at.phase === 'applying' || at.phase === 'seeding') && (
              <motion.div
                key="applying"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3 py-4"
              >
                <div className="flex items-center gap-3">
                  {at.phase === 'applying' ? (
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  )}
                  <span className="text-sm text-foreground/80">
                    Creating team with {at.blueprint?.members.length ?? 0} agents...
                  </span>
                </div>
                {at.phase === 'seeding' && (
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-4 h-4 text-violet-400 animate-spin flex-shrink-0" />
                    <span className="text-sm text-foreground/80 flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5 text-violet-400" />
                      Seeding memories from similar teams...
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            {/* Done */}
            {at.phase === 'done' && (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">Team created</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" /> {at.memberCount} agents
                    </span>
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" /> {at.connectionCount} connections
                    </span>
                    {at.memoriesSeeded > 0 && (
                      <span className="flex items-center gap-1">
                        <Brain className="w-3 h-3" /> {at.memoriesSeeded} memories seeded
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleDone}
                  className="w-full py-2.5 rounded-xl text-sm font-medium bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 transition-all"
                >
                  Open Team Canvas
                </button>
              </motion.div>
            )}

            {/* Error */}
            {at.phase === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2 p-3 rounded-xl border border-red-500/20 bg-red-500/5">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{at.error}</p>
                </div>
                <button
                  onClick={at.reset}
                  className="w-full py-2 rounded-xl text-sm font-medium bg-secondary/40 border border-primary/15 text-muted-foreground/80 hover:text-foreground hover:bg-secondary/60 transition-colors"
                >
                  Try again
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
