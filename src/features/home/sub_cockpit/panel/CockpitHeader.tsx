import { Compass, MessageCircle, X } from 'lucide-react';

import type { CompanionCockpitSpecBody } from '@/api/companion';
import type { ContextualCockpit } from '@/stores/slices/system/uiSlice';
import Button from '@/features/shared/components/buttons/Button';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { CockpitPhase } from './useCockpitSource';

type CockpitCopy = ReturnType<typeof useTranslation>['t']['overview']['cockpit'];

export interface CockpitHeading {
  /** The small context line above (ContentHeader's `title`): where this view comes from. */
  eyebrow: string;
  /** The dominant line: what this view is. */
  heading: string;
  /** Why the view is here, on hover and focus of the heading; never drawn on the surface. */
  hint?: string;
}

/**
 * The header's two lines, by phase. The view's own title is the dominant line
 * and its provenance the small one above it (the old header had them the other
 * way round, and repeated a message's title in a banner below it). An overlay's
 * explanation lives in the heading's Hint.
 */
export function cockpitHeading(
  c: CockpitCopy,
  phase: CockpitPhase,
  body: CompanionCockpitSpecBody | null,
  contextual: ContextualCockpit | null,
  locale?: string,
): CockpitHeading {
  if (contextual) {
    const src = contextual.source;
    if (src.kind === 'briefing') {
      const date = new Date(src.generatedAt).toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' });
      const hint = src.composedBy === 'athena' ? c.briefing_subtitle_athena
        : src.composedBy === 'fallback' ? c.briefing_subtitle_fallback : c.briefing_quiet_body;
      return { eyebrow: date, heading: body?.title || c.briefing_title, hint };
    }
    if (src.kind === 'explain') {
      return { eyebrow: c.title_default, heading: body?.title || src.decisionTitle || c.title_default, hint: c.subtitle_explaining };
    }
    return { eyebrow: c.title_default, heading: body?.title || src.messageTitle || c.title_default, hint: c.subtitle_contextual };
  }
  switch (phase) {
    case 'composed':
      return { eyebrow: c.subtitle_composed, heading: body?.title || c.title_default };
    case 'default':
      return { eyebrow: c.title_default, heading: c.default_title, hint: c.default_subtitle };
    // The title is not known yet: hold the line's height, never guess it.
    case 'loading':
      return { eyebrow: c.title_default, heading: ' ' };
    default:
      return { eyebrow: c.title_default, heading: c.subtitle_default };
  }
}

/**
 * Home > Cockpit header: the page chrome every phase keeps. Actions are the
 * overlay's Exit (only while an overlay shows; it carries the old context
 * banners' test ids) and Talk to Athena.
 */
export function CockpitHeader({ phase, body, contextual, onExit, onTalk }: {
  phase: CockpitPhase;
  body: CompanionCockpitSpecBody | null;
  contextual: ContextualCockpit | null;
  onExit: () => void;
  onTalk: () => void;
}) {
  const { t, language } = useTranslation();
  const c = t.overview.cockpit;
  const h = cockpitHeading(c, phase, body, contextual, language);
  const briefing = contextual?.source.kind === 'briefing';
  return (
    <ContentHeader
      icon={<Compass className="w-5 h-5 text-primary" />}
      iconColor="primary"
      title={h.eyebrow}
      subtitle={h.hint ? <Hint content={h.hint} focusable placement="bottom"><span>{h.heading}</span></Hint> : h.heading}
      actions={
        <div className="flex items-center gap-2 flex-shrink-0">
          {contextual && (
            <span className="inline-flex" data-testid={briefing ? 'cockpit-briefing-banner' : 'cockpit-context-banner'}>
              <Button variant="ghost" size="sm" icon={<X className="w-3.5 h-3.5" />} onClick={onExit}
                data-testid={briefing ? 'cockpit-briefing-exit' : 'cockpit-context-exit'}>
                {c.context_exit}
              </Button>
            </span>
          )}
          <Button variant="secondary" size="sm" icon={<MessageCircle className="w-3.5 h-3.5" />} onClick={onTalk}
            data-testid="cockpit-talk-to-athena">
            {c.talk_to_athena}
          </Button>
        </div>
      }
    />
  );
}
