/**
 * WelcomeHero — the first thing a user sees in an empty Athena transcript.
 *
 * Replaces the bare one-line "no messages yet" placeholder with an identity
 * hero (avatar + greeting) and a row of starter-prompt chips. Each chip sends
 * a real first-person user message through the normal send pipeline, so the
 * empty state is a launchpad, not a dead end.
 *
 * The starter chips reuse the already-translated slash-palette presets
 * (`slash_label_*` / `slash_message_*`), so this component adds only two new
 * strings (title + subtitle) and stays in sync with the slash palette's
 * wording for free.
 */
import { Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface Starter {
  key: string;
  label: string;
  message: string;
}

export function WelcomeHero({
  onPick,
  disabled,
}: {
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;

  const starters: Starter[] = [
    { key: 'intake', label: c.slash_label_intake, message: c.slash_message_intake },
    { key: 'capabilities', label: c.slash_label_capabilities, message: c.slash_message_capabilities },
    { key: 'goals', label: c.slash_label_goals, message: c.slash_message_goals },
    { key: 'decisions', label: c.slash_label_decisions, message: c.slash_message_decisions },
  ];

  return (
    <div
      className="flex flex-col items-center text-center px-4 py-10 gap-4 animate-fade-slide-in"
      data-testid="companion-welcome-hero"
    >
      <div className="relative">
        <img
          src="/athena/athena_baseline.jpg"
          alt=""
          aria-hidden
          draggable={false}
          className="w-16 h-16 rounded-full object-cover ring-2 ring-primary/30 select-none shadow-elevation-2"
        />
        <span
          className="absolute -bottom-0.5 -right-0.5 inline-flex w-6 h-6 items-center justify-center rounded-full bg-secondary border border-primary/30 text-primary"
          aria-hidden
        >
          <Sparkles className="w-3 h-3" />
        </span>
      </div>

      <div className="space-y-1.5 max-w-sm">
        <h2 className="typo-heading-sm font-semibold text-foreground">
          {c.welcome_title}
        </h2>
        <p className="typo-body text-foreground leading-relaxed">
          {c.welcome_subtitle}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {starters.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s.message)}
            data-testid={`companion-welcome-starter-${s.key}`}
            className="rounded-interactive bg-primary/10 border border-primary/20 hover:bg-primary/20 hover:border-primary/35 text-primary px-3 py-1.5 typo-caption font-medium transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
