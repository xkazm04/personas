import { useTranslation } from '@/i18n/useTranslation';

/**
 * Small bottom-of-hero strip advertising the nav/submit shortcuts. `Enter`
 * is only listed on the last step when submission is possible — otherwise
 * Enter is wired to "advance one step" and doesn't need a dedicated label.
 */
export function QuestionnaireKeyboardHint({
  isAtEnd,
  canSubmit,
}: {
  isAtEnd: boolean;
  canSubmit: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-8 flex flex-wrap items-center gap-2 text-sm text-foreground/60">
      <kbd className="px-1.5 py-0.5 rounded border border-border bg-foreground/[0.04] font-mono text-xs">
        ←
      </kbd>
      <kbd className="px-1.5 py-0.5 rounded border border-border bg-foreground/[0.04] font-mono text-xs">
        →
      </kbd>
      <span>{t.templates.adopt_modal.navigate_hint}</span>
      {isAtEnd && canSubmit && (
        <>
          <span className="text-foreground/40">·</span>
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-foreground/[0.04] font-mono text-xs">
            Enter
          </kbd>
          <span>{t.templates.adopt_modal.enter_to_advance}</span>
        </>
      )}
    </div>
  );
}
