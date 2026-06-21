import { HelpCircle } from 'lucide-react';

// A1 — Athena's decision as a clickable card: the question plus concrete option
// buttons (click to answer), with a free-text fallback (type in the chat input).
// Built Studio-native so A3 can later anchor the orb to this card.
export default function StudioDecision({
  question,
  options,
  onAnswer,
}: {
  question: string;
  options: string[];
  onAnswer: (answer: string) => void;
}) {
  return (
    <div className="mt-2 rounded-card border-l-2 border-primary bg-primary/10 px-2.5 py-2">
      <div className="flex items-start gap-1.5">
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="text-md text-foreground">{question}</span>
      </div>
      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onAnswer(o)}
              className="rounded-interactive border border-primary/40 bg-background/60 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-primary/20 hover:text-primary"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
