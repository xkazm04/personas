import { AlertCircle, Compass, PenLine } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ContextCard, ContextCards, KitButton, Section, type Glyph, type Tone } from '@/features/shared/components/kit';
import { useResumeAction, type ResumeAction } from './useResumeAction';

/** A failure is an error, a paused tour is guidance (info), an edit is the theme's own hue. */
const MARK: Record<ResumeAction['kind'], { tone: Tone; glyph: Glyph; Icon: typeof PenLine }> = {
  failure: { tone: 'error', glyph: 'solid', Icon: AlertCircle },
  tour: { tone: 'info', glyph: 'soft', Icon: Compass },
  edit: { tone: 'primary', glyph: 'soft', Icon: PenLine },
};

/** A lone card spans the reading line up to a comfortable measure. */
const CARD_MIN = 'min(100%, 26rem)';

/**
 * The "continue where you left off" pointer on the Welcome surface: a kit Section holding one
 * pressable card (the card is the resume door; Dismiss clears the signal). Renders nothing when
 * there is no signal. Must sit inside a kit surface (WelcomeLayout's KitHost).
 */
export default function ResumeSection() {
  const action = useResumeAction();
  const { t } = useTranslation();
  if (!action) return null;
  const { tone, glyph, Icon } = MARK[action.kind];
  return (
    <Section title={t.common.continue}>
      <ContextCards label={t.common.continue} min={CARD_MIN}>
        <ContextCard
          title={<span data-testid="resume-banner">{action.label}</span>}
          mark={{ tone, glyph, label: action.label }}
          onPress={action.resume}
          actions={<KitButton quiet stopPropagation onClick={action.dismiss}>{t.common.dismiss}</KitButton>}
          figures={<Icon className={`ml-auto -mb-1 w-10 h-10 k-toned t-${tone}`} strokeWidth={1.25} aria-hidden />}
        />
      </ContextCards>
    </Section>
  );
}
