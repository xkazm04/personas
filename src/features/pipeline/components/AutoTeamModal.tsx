import { useRef, useEffect } from 'react';
import {
  X,
  Zap,
  Users,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  Brain,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useAutoTeam } from './useAutoTeam';
import { BlueprintPreview, EXAMPLE_PROMPTS } from './BlueprintPreview';
import { useTranslation } from '@/i18n/useTranslation';

interface AutoTeamModalProps {
  open: boolean;
  onClose: () => void;
}

export function AutoTeamModal({ open, onClose }: AutoTeamModalProps) {
  const { t, tx } = useTranslation();
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
    if (e.key === 'Escape' && at.phase === 'previewing') {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      at.reset();
    }
  };

  const handleDone = () => {
    at.reset();
    onClose();
  };

  const isWorking = at.phase === 'suggesting' || at.phase === 'applying' || at.phase === 'seeding';

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="auto-team-title"
      size="md"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden"
    >
      <div onKeyDown={handleKeyDown}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-card bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/25 flex items-center justify-center">
              <Zap className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 id="auto-team-title" className="typo-heading font-semibold text-foreground">{t.pipeline.auto_team}</h2>
              <p className="typo-caption text-foreground">{t.pipeline.auto_team_subtitle}</p>
            </div>
          </div>
          {!isWorking && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </Button>
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
                placeholder={t.pipeline.auto_team_placeholder}
                className="w-full px-4 py-3 rounded-modal bg-secondary/30 border border-primary/15 typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 focus-visible:border-indigo-500/25 disabled:opacity-60 pr-10"
              />
              {at.phase === 'idle' && at.query.trim() && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => at.suggest()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25"
                  title={t.pipeline.generate_team}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </Button>
              )}
              {at.phase === 'suggesting' && (
                <LoadingSpinner className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-400" />
              )}
            </div>

            {/* Example prompts */}
            {at.phase === 'idle' && !at.query && (
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <Button
                    key={prompt}
                    variant="ghost"
                    size="xs"
                    onClick={() => { at.setQuery(prompt); }}
                    className="typo-caption px-2.5 py-1 bg-secondary/40 border border-primary/10 text-foreground hover:text-foreground/80 hover:bg-secondary/60"
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Suggesting */}
            {at.phase === 'suggesting' && (
              <div
                key="suggesting"
                className="animate-fade-slide-in flex items-center gap-3 py-6 justify-center"
              >
                <LoadingSpinner size="lg" className="text-indigo-400" />
                <span className="typo-body text-foreground">{t.pipeline.assembling_team}</span>
              </div>
            )}

            {/* Preview */}
            {at.phase === 'previewing' && at.blueprint && (
              <div
                key="preview"
                className="animate-fade-slide-in space-y-4"
              >
                <BlueprintPreview blueprint={at.blueprint} />

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={at.reset}
                    className="flex-1"
                  >
                    {t.pipeline.try_different}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={at.apply}
                    iconRight={<ArrowRight className="w-3.5 h-3.5" />}
                    className="flex-1 bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30"
                  >
                    {t.pipeline.create_team}
                  </Button>
                </div>
              </div>
            )}

            {/* Applying / Seeding */}
            {(at.phase === 'applying' || at.phase === 'seeding') && (
              <div
                key="applying"
                className="animate-fade-slide-in space-y-3 py-4"
              >
                <div className="flex items-center gap-3">
                  {at.phase === 'applying' ? (
                    <LoadingSpinner className="text-indigo-400 flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  )}
                  <span className="typo-body text-foreground">
                    {tx(t.pipeline.creating_team, { count: at.blueprint?.members.length ?? 0 })}
                  </span>
                </div>
                {at.phase === 'seeding' && (
                  <div className="flex items-center gap-3">
                    <LoadingSpinner className="text-violet-400 flex-shrink-0" />
                    <span className="typo-body text-foreground flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5 text-violet-400" />
                      {t.pipeline.seeding_memories}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Done */}
            {at.phase === 'done' && (
              <div
                key="done"
                className="animate-fade-slide-in space-y-3"
              >
                <div className="p-4 rounded-modal border border-emerald-500/20 bg-emerald-500/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="typo-body font-medium text-emerald-400">{t.pipeline.team_created}</span>
                  </div>
                  <div className="flex items-center gap-4 typo-caption text-foreground">
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

                <Button
                  variant="primary"
                  size="sm"
                  block
                  onClick={handleDone}
                  className="bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30"
                >
                  {t.pipeline.open_team_canvas}
                </Button>
              </div>
            )}

            {/* Error */}
            {at.phase === 'error' && (
              <div
                key="error"
                className="animate-fade-slide-in space-y-3"
              >
                <div className="flex items-center gap-2 p-3 rounded-modal border border-red-500/20 bg-red-500/5">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="typo-body text-red-400">{at.error}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  block
                  onClick={at.reset}
                >
                  {t.pipeline.try_again}
                </Button>
              </div>
            )}
        </div>
      </div>
    </BaseModal>
  );
}
