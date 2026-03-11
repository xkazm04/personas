import { useMemo } from 'react';

export function HighlightedJson({ raw }: { raw: string }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      // intentional: non-critical — JSON parse fallback
      return null;
    }
  }, [raw]);

  if (!pretty) {
    return (
      <pre className="bg-background/40 p-2 rounded-lg text-foreground overflow-x-auto max-h-40 text-sm">
        {raw}
      </pre>
    );
  }

  return (
    <pre className="bg-background/40 p-2 rounded-lg text-foreground overflow-x-auto max-h-40 text-sm">
      {pretty}
    </pre>
  );
}
