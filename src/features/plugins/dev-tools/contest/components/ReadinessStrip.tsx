// What the focused project is missing to run a contest — a calm strip that
// names every missing piece, and renders nothing when all is ready.
import { AlertTriangle, CircleAlert, RefreshCw } from 'lucide-react';

import { AsyncButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage } from '@/lib/silentCatch';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';

import { useContestEnvironment } from '../hooks/useContests';
import { isBlockingProblem, problemLabel } from '../model/labels';

interface ReadinessStripProps {
  /** The project to probe; null renders nothing. */
  projectId: string | null;
  className?: string;
}

export function ReadinessStrip({ projectId, className = '' }: ReadinessStripProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const { environment, error, refresh } = useContestEnvironment(projectId);

  if (!projectId) return null;

  const problems = environment?.problems ?? [];
  const failed = error != null && environment === null;
  if (!failed && problems.length === 0) return null;

  const tone = STATUS_PALETTE.warning;
  return (
    <section
      aria-label={s.readiness_title}
      data-testid="contest-readiness-strip"
      className={`flex flex-wrap items-start gap-3 rounded-card border ${tone.border} ${tone.bg} px-3 py-2 ${className}`}
    >
      <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${tone.text}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="typo-title text-foreground">{s.readiness_title}</p>
        {failed ? (
          <p className="typo-caption text-foreground">
            {tx(s.readiness_error, {
              message: resolveErrorTranslated(t, extractMessage(error)).message,
            })}
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {problems.map((code) => (
              <li key={code} className="flex items-start gap-1.5 typo-caption text-foreground">
                <CircleAlert
                  aria-hidden
                  className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                    isBlockingProblem(code) ? STATUS_PALETTE.error.text : tone.text
                  }`}
                />
                <span>{problemLabel(s, code, tx)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AsyncButton
        size="sm"
        variant="ghost"
        icon={<RefreshCw className="w-3.5 h-3.5" />}
        onClick={refresh}
        data-testid="contest-readiness-recheck"
      >
        {s.readiness_recheck}
      </AsyncButton>
    </section>
  );
}
