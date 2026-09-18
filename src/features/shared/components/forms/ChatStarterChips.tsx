/**
 * @catalog ChatStarterChips — durable example prompts above an empty chat composer; a chip fills the field instead of vanishing like a placeholder. Rendered for you by `ChatInputBar`'s `starters` prop.
 */
export interface ChatStarter {
  id: string;
  /** Already-translated chip text. */
  label: string;
  /** Text written into the composer when the chip is pressed. */
  fill: string;
}

interface ChatStarterChipsProps {
  starters: ChatStarter[];
  onPick: (starter: ChatStarter) => void;
  compact?: boolean;
}

/**
 * Durable example prompts shown above an empty composer. A placeholder cannot
 * do this job - it disappears at the first keystroke, which is exactly why the
 * form golden path forbids placeholder-as-tutorial. Extracted from
 * `ChatInputBar` so that file stays under the size limit.
 */
export function ChatStarterChips({ starters, onPick, compact }: ChatStarterChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1">
      {starters.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s)}
          className={`rounded-full border border-border bg-background/70 text-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground ${
            compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
