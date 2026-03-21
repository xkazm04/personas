import { useMemo } from 'react';

/** Simple token-level JSON syntax colouring. */
function colorizeJson(json: string): React.ReactNode[] {
  const TOKEN_RE = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(true|false|null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = TOKEN_RE.exec(json)) !== null) {
    if (match.index > last) nodes.push(json.slice(last, match.index));
    if (match[1]) {
      nodes.push(<span key={key++} className="text-sky-400">{match[1]}</span>, ':');
    } else if (match[2]) {
      nodes.push(<span key={key++} className="text-emerald-400">{match[2]}</span>);
    } else if (match[3]) {
      nodes.push(<span key={key++} className="text-amber-400">{match[3]}</span>);
    } else if (match[4]) {
      nodes.push(<span key={key++} className="text-violet-400">{match[4]}</span>);
    }
    last = match.index + match[0].length;
  }
  if (last < json.length) nodes.push(json.slice(last));
  return nodes;
}

export function HighlightedJson({ raw }: { raw: string }) {
  const colored = useMemo(() => {
    try {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      return colorizeJson(pretty);
    } catch {
      return null;
    }
  }, [raw]);

  return (
    <pre className="bg-background/60 p-3 rounded-lg overflow-auto flex-1 text-sm font-mono leading-relaxed">
      {colored ?? <span className="text-foreground">{raw}</span>}
    </pre>
  );
}
