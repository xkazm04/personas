import { useMemo } from 'react';
import { CopyButton } from '@/features/shared/components/buttons';

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

/** Split colorized nodes by newline into per-line groups. */
function splitIntoLines(nodes: React.ReactNode[]): React.ReactNode[][] {
  const lines: React.ReactNode[][] = [[]];
  for (const node of nodes) {
    if (typeof node === 'string') {
      const parts = node.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) lines.push([]);
        const cur = lines[lines.length - 1]!;
        if (parts[i]) cur.push(parts[i]);
      }
    } else {
      lines[lines.length - 1]!.push(node);
    }
  }
  return lines;
}

export function HighlightedJson({ raw }: { raw: string }) {
  const { pretty, lines } = useMemo(() => {
    try {
      const p = JSON.stringify(JSON.parse(raw), null, 2);
      return { pretty: p, lines: splitIntoLines(colorizeJson(p)) };
    } catch {
      return { pretty: raw, lines: null };
    }
  }, [raw]);

  return (
    <div className="group/json relative">
      {/* Copy button — visible on hover */}
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover/json:opacity-100 transition-opacity duration-200">
        <CopyButton text={pretty} iconSize="w-3.5 h-3.5" />
      </div>

      <pre className="json-lines bg-background/60 p-3 rounded-card overflow-auto flex-1 typo-code font-mono leading-relaxed">
        {lines
          ? lines.map((lineNodes, i) => (
              <span key={i} className="json-line block">
                {lineNodes.length > 0 ? lineNodes : '\u00A0'}
              </span>
            ))
          : <span className="text-foreground">{raw}</span>
        }
      </pre>
    </div>
  );
}
