import { useEffect, useState } from 'react';
import { Wand2, Send } from 'lucide-react';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { answerBuildQuestion } from '@/api/agents/buildSession';
import { createLogger } from '@/lib/log';

const logger = createLogger('use-cases-refine');

interface LatestBuildSession {
  id: string;
  personaId: string;
  phase: string;
}

interface Props {
  personaId: string;
}

// Relocated from the former Matrix tab: lets users describe a change and push
// it through the same _refine build-question channel that refined capabilities
// from the matrix view. A build session must already exist for the persona;
// otherwise the card stays hidden.
export function UseCasesRefineCard({ personaId }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSessionId(null);
    invokeWithTimeout<LatestBuildSession | null>('get_latest_build_session', { personaId })
      .then((s) => { if (!cancelled) setSessionId(s?.id ?? null); })
      .catch(() => { if (!cancelled) setSessionId(null); });
    return () => { cancelled = true; };
  }, [personaId]);

  if (!sessionId) return null;

  const handleSubmit = async () => {
    const trimmed = feedback.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await answerBuildQuestion(sessionId, '_refine', trimmed);
      setLastSent(trimmed);
      setFeedback('');
    } catch (err) {
      logger.error('Refine failed', { error: err });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-primary" />
        <span className="typo-heading text-foreground">Refine capabilities</span>
      </div>
      <p className="typo-caption text-foreground/70">
        Describe what to change — the design pass will adjust this agent accordingly.
      </p>
      <div className="flex items-start gap-2">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="e.g. Add a nightly Slack digest of open reviews"
          rows={2}
          disabled={submitting}
          className="flex-1 rounded-card border border-primary/10 bg-secondary/30 px-3 py-2 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30 disabled:opacity-60 resize-none"
        />
        <button
          type="button"
          onClick={() => { void handleSubmit(); }}
          disabled={!feedback.trim() || submitting}
          className="flex items-center gap-1.5 px-3 py-2 rounded-card border border-primary/20 bg-primary/10 text-primary typo-body hover:bg-primary/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          {submitting ? 'Sending…' : 'Apply'}
        </button>
      </div>
      {lastSent && (
        <p className="typo-caption text-emerald-400/80 truncate">Sent: {lastSent}</p>
      )}
    </div>
  );
}
