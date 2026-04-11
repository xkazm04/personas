import { useState, useCallback } from 'react';
import { X, Sparkles, Users, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { synthesizeTeamFromTemplates } from '@/api/overview/intelligence/teamSynthesis';
import type { TeamSynthesisResult } from '@/api/overview/intelligence/teamSynthesis';
import { BaseModal } from './BaseModal';
import { useTranslation } from '@/i18n/useTranslation';

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
  const [error, setError] = useState<string | null>(null);
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
      setError(err instanceof Error ? err.message : String(err));
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
        <div className="px-6 py-4 border-b border-primary/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Users className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h2 id="team-synthesis-title" className="text-sm font-semibold text-foreground/90">{t.templates.team_synthesis.title}</h2>
              <p className="text-sm text-muted-foreground/60">
                AI selects templates and assembles a connected team
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4 text-muted-foreground/70" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-4">
          {!result ? (
            <>
              <div>
                <label className="text-sm font-medium text-foreground/70 block mb-1.5">
                  Team Name
                </label>
                <input
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="e.g., Content Pipeline Team"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-primary/15 bg-background/40 text-foreground/80 placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:border-violet-500/30"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground/70 block mb-1.5">
                  Describe what this team should do
                </label>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g., Monitor social media mentions, analyze sentiment, generate reports, and send alerts to Slack when negative trends are detected"
                  rows={4}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-primary/15 bg-background/40 text-foreground/80 placeholder-muted-foreground/30 resize-none focus-visible:outline-none focus-visible:border-violet-500/30"
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-400/80">{error}</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
              <div className="text-center">
                <h3 className="text-base font-semibold text-foreground/90">
                  {result.team_name}
                </h3>
                <p className="text-sm text-muted-foreground/60 mt-1">
                  {result.member_count} personas created and connected
                </p>
                <p className="text-sm text-muted-foreground/50 mt-2 max-w-sm leading-relaxed">
                  {result.description}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-primary/10 flex items-center justify-end gap-2">
          {!result ? (
            <button
              onClick={handleSynthesize}
              disabled={loading || !query.trim() || !teamName.trim()}
              className="px-4 py-2.5 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Sparkles className="w-4 h-4 animate-pulse" />
                  Synthesizing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Synthesize Team
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleClose}
              className="px-4 py-2.5 text-sm font-medium rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors flex items-center gap-2"
            >
              Done
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
    </BaseModal>
  );
}
