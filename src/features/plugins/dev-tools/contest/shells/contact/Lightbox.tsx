// The focused roll. Permanent chrome (LightboxHeader) paints from the list
// summary; under it, a calm ghost while the detail is cold, then either the
// developing trays (no frames collected yet) or the loupe (frames to sort).
// The brief sits one click down.
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { extractMessage } from '@/lib/silentCatch';

import type { ContestKey } from '../../focus';
import { useContest, useContests } from '../../hooks/useContests';
import { useReviewDraft } from '../../hooks/useReviewDraft';
import { GhostFrames } from './ContactStrip';
import { CONTACT_COPY as C } from './copy';
import { isOnLoupe } from './contactModel';
import { DevelopingTrays } from './DevelopingTrays';
import { LightboxHeader } from './LightboxHeader';
import { LoupePanel } from './LoupePanel';

export interface LightboxProps {
  focus: ContestKey;
  initialFrame: string | null;
  onBack: () => void;
}

export function Lightbox({ focus, initialFrame, onBack }: LightboxProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const { contests } = useContests();
  const { detail, isLoading, error, refresh } = useContest(focus.projectId, focus.contestId);
  const draft = useReviewDraft(detail);
  const [briefOpen, setBriefOpen] = useState(false);

  const listed = contests.find((c) => c.projectId === focus.projectId && c.contestId === focus.contestId);
  const summary: ContestSummary | null = detail?.summary ?? listed ?? null;
  const rounds = contests.filter((c) => c.projectId === focus.projectId && c.parentId === focus.contestId);

  return (
    <div className="space-y-4" data-testid="contact-lightbox">
      {summary ? (
        <LightboxHeader summary={summary} rounds={rounds} onBack={onBack} />
      ) : (
        <Button size="sm" variant="ghost" onClick={onBack} data-testid="contact-lightbox-back">
          {C.back}
        </Button>
      )}

      {detail ? (
        <>
          {detail.brief && (
            <div className="space-y-2">
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={briefOpen}
                icon={briefOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                onClick={() => setBriefOpen((v) => !v)}
              >
                {C.briefTitle}
              </Button>
              {briefOpen && (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-card border border-primary/10 bg-secondary/15 p-3 typo-body text-foreground">
                  {detail.brief}
                </pre>
              )}
            </div>
          )}
          {isOnLoupe(detail) ? (
            <LoupePanel detail={detail} draft={draft} initialKey={initialFrame} onBack={onBack} />
          ) : (
            <DevelopingTrays detail={detail} />
          )}
        </>
      ) : error ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="typo-body text-foreground flex-1">
            {tx(s.detail_load_failed, { message: resolveErrorTranslated(t, extractMessage(error)).message })}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            {C.retry}
          </Button>
        </div>
      ) : isLoading ? (
        <div className="space-y-3" aria-hidden data-testid="contact-lightbox-ghost">
          <div className="aspect-[16/10] w-full max-w-4xl rounded-card border border-primary/8 bg-secondary/20 animate-fade-in" style={{ animationDelay: '120ms' }} />
          <GhostFrames count={5} />
        </div>
      ) : null}
    </div>
  );
}
