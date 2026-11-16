import { useState, useCallback } from 'react';
import { X, Sparkles, Users, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { synthesizeTeamFromTemplates } from '@/api/overview/intelligence/teamSynthesis';
import type { TeamSynthesisResult } from '@/api/overview/intelligence/teamSynthesis';
import { BaseModal } from './BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import { inlineErrorCopy } from '@/features/triggers/lib/inlineErrorCopy';
import Button from '@/features/shared/components/buttons/Button';

interface TeamSynthesisPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onTeamCreated?: (result: TeamSynthesisResult) => void;
}

export function TeamSynthesisPanel({ isOpen, onClose, onTeamCreated }: TeamSynthesisPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  // The raw rejection, resolved at render: invokeWithTimeout rejects with a
  // serialized AppError object, which `String(err)` printed as "[object Object]".
  const [error, setError] = useState<{ raw: unknown } | null>(null);
  const [result, setResult] = useState<TeamSynthesisResult | null>(null);

  const handleSynthesize = useCallback(async () => {
    if (!query.trim() || !teamName.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await synthesizeTeamFromTemplates(query, teamName);
      setResult(res);
      onTeamCreated?.(res);
    } catch (err) {
      setError({ raw: err });
    } finally {
      setLoading(false);
    }
  }, [query, teamName, onTeamCreated]);

  const handleClose = useCallback(() => {
    setQuery('');
    setTeamName('');
    setError(null);
    setResult(null);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      titleId="team-synthesis-title"
      maxWidthClass="max-w-lg"
    >
        {/* Header */}
        <div className="px-6 py-4 border-b border-hair flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-modal bg-role-agent/15 border border-role-agent/25 flex items-center justify-center">
              <Users className="w-4.5 h-4.5 text-role-agent" />
            </div>
            <div>
              <h2 id="team-synthesis-title" className="typo-heading text-ink-1">{t.templates.team_synthesis.title}</h2>
              <p className="typo-body text-foreground">
                {t.templates.team_synthesis.subtitle}
              </p>
            </div>
          </div>
          <Button type="button" onClick={handleClose} aria-label={t.common.close} variant="ghost" size="icon-sm">
            <X className="w-4 h-4 text-foreground" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-4">
          {!result ? (
            <>
              <div>
                <label htmlFor="team-synthesis-name" className="typo-body text-foreground block mb-1.5">
                  {t.templates.team_synthesis.team_name_label}
                </label>
                <input
                  id="team-synthesis-name"
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder={t.templates.team_synthesis.team_name_placeholder}
                  className="w-full px-3.5 py-2.5 typo-body rounded-modal border border-hair bg-background/40 text-foreground placeholder:text-ink-3 focus-visible:outline-none focus-visible:border-role-agent/30"
                  disabled={loading}
                />
              </div>

              <div>
                <label htmlFor="team-synthesis-query" className="typo-body text-foreground block mb-1.5">
                  {t.templates.team_synthesis.describe_team}
                </label>
                <textarea
                  id="team-synthesis-query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.templates.team_synthesis.describe_placeholder}
                  rows={4}
                  className="w-full px-3.5 py-2.5 typo-body rounded-modal border border-hair bg-background/40 text-foreground placeholder:text-ink-3 resize-none focus-visible:outline-none focus-visible:border-role-agent/30"
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2.5 p-3 rounded-modal bg-status-error/10 border border-status-error/20">
                  <AlertCircle className="w-4 h-4 text-status-error flex-shrink-0 mt-0.5" />
                  <p className="typo-body text-status-error/80">{inlineErrorCopy(t, error.raw)}</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-14 h-14 rounded-modal bg-status-success/10 border border-status-success/20 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-status-success" />
              </div>
              <div className="text-center">
                <h3 className="typo-body-lg text-ink-1">
                  {result.team_name}
                </h3>
                <p className="typo-body text-foreground mt-1">
                  {t.templates.team_synthesis.personas_created.replace('{count}', String(result.member_count))}
                </p>
                <p className="typo-body text-foreground mt-2 max-w-sm">
                  {result.description}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-hair flex items-center justify-end gap-2">
          {!result ? (
            <Button
              type="button"
              onClick={handleSynthesize}
              disabled={loading || !query.trim() || !teamName.trim()}
              variant="accent"
              tone="agent"
              size="md"
            >
              {loading ? (
                <>
                  <Sparkles className="w-4 h-4" />
                  {t.templates.team_synthesis.synthesizing}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {t.templates.team_synthesis.synthesize_team}
                </>
              )}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleClose}
              variant="accent"
              tone="success"
              size="md"
              iconRight={<ArrowRight className="w-4 h-4" />}
            >
              {t.templates.team_synthesis.done}
            </Button>
          )}
        </div>
    </BaseModal>
  );
}
