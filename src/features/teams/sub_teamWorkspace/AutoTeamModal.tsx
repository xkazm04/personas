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
import { BlueprintPreview, EXAMPLE_PROMPT_KEYS } from './BlueprintPreview';
import { useTranslation } from '@/i18n/useTranslation';

interface AutoTeamModalProps {
  open: boolean;
  onClose: () => void;
}

export function AutoTeamModal({ open, onClose }: AutoTeamModalProps) {
  const { t, tx } = useTranslation();
  const at = useAutoTeam();
  const inputRef = useRef<HTMLInputElement>(null);
  const { reset } = at;

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [open, reset]);

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
      panelClassName="bg-background border border-hair rounded-card shadow-elevation-4 overflow-hidden"
    >
      <div onKeyDown={handleKeyDown}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-card bg-surface-1 border border-role-agent/25 flex items-center justify-center">
              <Zap className="w-4 h-4 text-role-agent" />
            </div>
            <div>
              <h2 id="auto-team-title" className="typo-heading text-foreground">{t.pipeline.auto_team}</h2>
              <p className="typo-caption text-ink-2">{t.pipeline.auto_team_subtitle}</p>
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
                className="w-full px-4 py-3 rounded-modal bg-surface-1 border border-hair typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-role-agent/30 focus-visible:border-role-agent/25 disabled:is-disabled pr-10"
              />
              {at.phase === 'idle' && at.query.trim() && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => at.suggest()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-role-agent/15 text-role-agent hover:bg-role-agent/25"
                  title={t.pipeline.generate_team}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </Button>
              )}
              {at.phase === 'suggesting' && (
                <LoadingSpinner className="absolute right-3 top-1/2 -translate-y-1/2 text-role-agent" />
              )}
            </div>

            {/* Example prompts */}
            {at.phase === 'idle' && !at.query && (
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPT_KEYS.map((promptKey) => {
                  const prompt = t.pipeline[promptKey];
                  return (
                  <Button
                    key={prompt}
                    variant="ghost"
                    size="xs"
                    onClick={() => { at.setQuery(prompt); }}
                    className="typo-caption px-2.5 py-1 bg-surface-1 border border-hair text-foreground hover:text-ink-2 hover:bg-surface-2"
                  >
                    {prompt}
                  </Button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Suggesting */}
            {at.phase === 'suggesting' && (
              <div
                key="suggesting"
                className="animate-fade-slide-in flex items-center gap-3 py-6 justify-center"
              >
                <LoadingSpinner size="lg" className="text-role-agent" />
                <span className="typo-body text-foreground">{t.pipeline.assembling_team}</span>
              </div>
            )}

            {/* Preview */}
            {at.phase === 'previewing' && at.blueprint && (
              <div
                key="preview"
                className="animate-fade-slide-in space-y-4"
              >
                <BlueprintPreview blueprint={at.blueprint} onRoleChange={at.setMemberRole} onRemoveMember={at.removeMember} />

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
                    className="flex-1 bg-role-agent/20 border border-role-agent/30 text-role-agent hover:bg-role-agent/30"
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
                    <LoadingSpinner className="text-role-agent flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-status-success flex-shrink-0" />
                  )}
                  <span className="typo-body text-foreground">
                    {tx(t.pipeline.creating_team, { count: at.blueprint?.members.length ?? 0 })}
                  </span>
                </div>
                {at.phase === 'seeding' && (
                  <div className="flex items-center gap-3">
                    <LoadingSpinner className="text-role-agent flex-shrink-0" />
                    <span className="typo-body text-foreground flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5 text-role-agent" />
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
                <div className="p-4 rounded-modal border border-status-success/20 bg-status-success/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-status-success" />
                    <span className="typo-body text-status-success">{t.pipeline.team_created}</span>
                  </div>
                  <div className="flex items-center gap-4 typo-caption text-ink-2">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" /> {tx(at.memberCount === 1 ? t.pipeline.auto_team_agents_one : t.pipeline.auto_team_agents_other, { count: at.memberCount })}
                    </span>
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" /> {tx(at.connectionCount === 1 ? t.pipeline.auto_team_connections_one : t.pipeline.auto_team_connections_other, { count: at.connectionCount })}
                    </span>
                    {at.memoriesSeeded > 0 && (
                      <span className="flex items-center gap-1">
                        <Brain className="w-3 h-3" /> {t.pipeline.memories_seeded.replace('{count}', String(at.memoriesSeeded))}
                      </span>
                    )}
                  </div>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  block
                  onClick={handleDone}
                  className="bg-role-agent/20 border border-role-agent/30 text-role-agent hover:bg-role-agent/30"
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
                <div className="flex items-center gap-2 p-3 rounded-modal border border-status-error/20 bg-status-error/5">
                  <AlertCircle className="w-4 h-4 text-status-error flex-shrink-0" />
                  <p className="typo-body text-status-error">{at.error}</p>
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
