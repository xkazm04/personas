import { useEffect } from 'react';
import { CornerDownLeft, Sparkles } from 'lucide-react';

// A1 — Athena's decision as a first-class steering moment: a titled card with the
// question, concrete numbered option rows (click OR press 1–N to answer), and a
// free-text fallback (type in the chat input). Built Studio-native so A3 can
// anchor the orb to it.
export default function StudioDecision({
  question,
  options,
  onAnswer,
}: {
  question: string;
  options: string[];
  onAnswer: (answer: string) => void;
}) {
  // Keyboard select: 1–N picks an option — unless the user is typing an answer.
  useEffect(() => {
    if (options.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > options.length) return;
      const opt = options[n - 1];
      if (opt === undefined) return;
      e.preventDefault();
      onAnswer(opt);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options, onAnswer]);

  return (
    <div className="pointer-events-auto mt-2 overflow-hidden rounded-card border border-primary/40 bg-primary/[0.07] shadow-elevation-2">
      <div className="flex items-center gap-1.5 border-b border-primary/20 bg-primary/10 px-3 py-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="typo-caption font-medium uppercase tracking-wide text-primary">Your call</span>
      </div>
      <div className="px-3 py-2.5">
        <p className="text-md leading-snug text-foreground">{question}</p>
        {options.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1">
            {options.map((o, i) => (
              <button
                key={o}
                type="button"
                data-testid="studio-decision-option"
                onClick={() => onAnswer(o)}
                className="group flex items-center gap-2.5 rounded-interactive border border-border bg-background/70 px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:border-primary/50 hover:bg-primary/15"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/60 font-mono text-[11px] text-foreground/60 transition-colors group-hover:border-primary/40 group-hover:text-primary">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">{o}</span>
                <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-transparent transition-colors group-hover:text-primary/70" />
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 typo-caption text-foreground/45">
          {options.length > 0
            ? `Press 1–${options.length}, or type your own answer below.`
            : 'Type your answer in the chat below.'}
        </p>
      </div>
    </div>
  );
}
