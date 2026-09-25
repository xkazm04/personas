// Counted things, drawn as dots rather than written as numbers: how often a
// finding has been seen before, how many named rivals are ahead, and how
// much confidence a member had. Three dots is a shape the eye reads without
// parsing a sentence.

/** How often this finding has already been raised. Three is the cap it draws. */
export function RecurrenceDots({ recurrence, text }: { recurrence: number; text: string }) {
  return (
    <span className="inline-flex items-center gap-[3px] typo-caption text-muted" role="img" aria-label={text}>
      {[0, 1, 2].map((i) => (
        <i
          key={i}
          aria-hidden="true"
          className={`h-[9px] w-[9px] rounded-full border-[1.5px] ${
            i < recurrence ? 'border-status-warning bg-status-warning' : 'border-muted-dark'
          }`}
        />
      ))}
      <em className="ml-1.5 not-italic">{text}</em>
    </span>
  );
}

/** Named rivals, and how many of them are ahead of us on this dimension. */
export function RivalDots({ total, ahead, text }: { total: number; ahead: number; text: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="img" aria-label={text}>
      {Array.from({ length: total }).map((_, i) => (
        <i
          key={i}
          aria-hidden="true"
          className={`h-[18px] w-[18px] rounded-full border-2 ${
            i < ahead ? 'border-status-warning bg-status-warning' : 'border-muted-dark'
          }`}
        />
      ))}
      <span className="ml-2 typo-body text-muted">{text}</span>
    </div>
  );
}

/** low / med / high, as a rising three-bar mark. */
export function ConfidenceBars({ confidence, text }: { confidence: string | null; text: string }) {
  if (!confidence) return null;
  const n = confidence === 'high' ? 3 : confidence === 'med' ? 2 : confidence === 'low' ? 1 : 0;
  const heights = ['h-1.5', 'h-2.5', 'h-3.5'];
  return (
    <span className="inline-flex items-center gap-[3px] typo-caption text-muted" role="img" aria-label={text}>
      {heights.map((h, i) => (
        <i
          key={h}
          aria-hidden="true"
          className={`w-1 rounded-[1px] ${h} ${i < n ? 'bg-muted-foreground' : 'bg-border'}`}
        />
      ))}
      <em className="ml-1.5 not-italic">{text}</em>
    </span>
  );
}
