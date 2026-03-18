import { useMemo } from 'react';

/**
 * JSON syntax highlighter with themed colors for keys, strings, numbers, booleans, and null.
 */
export function HighlightedJson({ raw }: { raw: string }) {
  const tokens = useMemo(() => {
    let pretty: string;
    try {
      pretty = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return null;
    }
    return tokenize(pretty);
  }, [raw]);

  if (!tokens) {
    return (
      <pre className="text-sm font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed">
        {raw}
      </pre>
    );
  }

  return (
    <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-all">
      {tokens.map((token, i) => (
        <span key={i} className={token.className}>
          {token.text}
        </span>
      ))}
    </pre>
  );
}

interface Token { text: string; className: string }

function tokenize(json: string): Token[] {
  const tokens: Token[] = [];
  const re = /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],])|(\s+)/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = re.exec(json)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: json.slice(lastIndex, match.index), className: 'text-foreground/60' });
    }
    lastIndex = re.lastIndex;

    if (match[1] !== undefined) {
      const keyText = match[1];
      const colonAndSpace = match[0].slice(keyText.length);
      tokens.push({ text: keyText, className: 'text-cyan-400' });
      tokens.push({ text: colonAndSpace, className: 'text-foreground/40' });
    } else if (match[2] !== undefined) {
      tokens.push({ text: match[2], className: 'text-emerald-400' });
    } else if (match[3] !== undefined) {
      tokens.push({ text: match[3], className: 'text-amber-400' });
    } else if (match[4] !== undefined) {
      tokens.push({ text: match[4], className: 'text-violet-400' });
    } else if (match[5] !== undefined) {
      tokens.push({ text: match[5], className: 'text-red-400/70' });
    } else if (match[6] !== undefined) {
      tokens.push({ text: match[6], className: 'text-foreground/30' });
    } else if (match[7] !== undefined) {
      tokens.push({ text: match[7], className: '' });
    }
  }

  if (lastIndex < json.length) {
    tokens.push({ text: json.slice(lastIndex), className: 'text-foreground/60' });
  }

  return tokens;
}
