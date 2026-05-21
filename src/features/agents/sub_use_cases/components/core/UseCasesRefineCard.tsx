import { useEffect, useState } from 'react';
import { Wand2, Send } from 'lucide-react';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { answerBuildQuestion } from '@/api/agents/buildSession';
import { createLogger } from '@/lib/log';
import { AsyncButton } from '@/features/shared/components/buttons';
import { DebtText, debtText } from '@/i18n/DebtText';


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
        <span className="typo-heading text-foreground"><DebtText k="auto_refine_capabilities_1d4bbd5f" /></span>
      </div>
      <p className="typo-caption text-foreground">
        <DebtText k="auto_describe_what_to_change_the_design_pass_wi_25e2cc2b" />
      </p>
      <div className="flex items-start gap-2">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={debtText("auto_e_g_add_a_nightly_slack_digest_of_open_rev_20c0d73f")}
          rows={2}
          disabled={submitting}
          className="flex-1 rounded-card border border-primary/10 bg-secondary/30 px-3 py-2 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30 disabled:opacity-60 resize-none"
        />
        <AsyncButton
          variant="ghost"
          size="sm"
          icon={<Send className="w-3.5 h-3.5" />}
          onClick={() => { void handleSubmit(); }}
          disabled={!feedback.trim()}
          isLoading={submitting}
          loadingText="Sending…"
          className="rounded-card border border-primary/20 bg-primary/10 !text-primary hover:!bg-primary/15"
        >
          Apply
        </AsyncButton>
      </div>
      {lastSent && (
        <p className="typo-caption text-emerald-400/80 truncate"><DebtText k="auto_sent_150d33d8" /> {lastSent}</p>
      )}
    </div>
  );
}
