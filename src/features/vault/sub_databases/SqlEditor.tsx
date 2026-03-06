import { useRef, useCallback, useMemo } from 'react';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  placeholder?: string;
  onExecute?: () => void;
  minHeight?: string;
}

type TokenType = 'keyword' | 'string' | 'number' | 'comment' | 'operator' | 'function' | 'identifier' | 'text';

interface Token {
  type: TokenType;
  value: string;
}

// ── SQL Keywords ──────────────────────────────────────────────────────

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE',
  'TABLE', 'ALTER', 'DROP', 'INDEX', 'VIEW', 'AS', 'ON', 'JOIN',
  'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'NATURAL',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION',
  'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IF',
  'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'ASC', 'DESC', 'TRUE', 'FALSE',
  'WITH', 'RECURSIVE', 'RETURNING', 'CASCADE', 'RESTRICT', 'PRIMARY',
  'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
  'CONSTRAINT', 'NOT', 'NULL', 'BEGIN', 'COMMIT', 'ROLLBACK',
  'TRANSACTION', 'EXPLAIN', 'ANALYZE', 'GRANT', 'REVOKE',
]);

const SQL_FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF',
  'CAST', 'CONVERT', 'CONCAT', 'SUBSTRING', 'TRIM', 'UPPER', 'LOWER',
  'LENGTH', 'REPLACE', 'NOW', 'CURRENT_TIMESTAMP', 'DATE', 'EXTRACT',
  'ARRAY_AGG', 'STRING_AGG', 'JSON_AGG', 'JSONB_AGG', 'ROW_NUMBER',
  'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
]);

const REDIS_COMMANDS = new Set([
  'GET', 'SET', 'DEL', 'EXISTS', 'EXPIRE', 'TTL', 'PERSIST',
  'KEYS', 'SCAN', 'TYPE', 'RENAME', 'MGET', 'MSET',
  'HGET', 'HSET', 'HDEL', 'HGETALL', 'HMGET', 'HMSET', 'HKEYS', 'HVALS',
  'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'LRANGE', 'LLEN', 'LINDEX',
  'SADD', 'SREM', 'SMEMBERS', 'SISMEMBER', 'SCARD', 'SUNION', 'SINTER',
  'ZADD', 'ZREM', 'ZRANGE', 'ZRANGEBYSCORE', 'ZCARD', 'ZSCORE', 'ZRANK',
  'INCR', 'DECR', 'INCRBY', 'DECRBY', 'APPEND', 'STRLEN',
  'SUBSCRIBE', 'PUBLISH', 'UNSUBSCRIBE',
  'MULTI', 'EXEC', 'DISCARD', 'WATCH',
  'INFO', 'PING', 'ECHO', 'DBSIZE', 'FLUSHDB', 'FLUSHALL',
]);

// ── Tokenizers ────────────────────────────────────────────────────────

function tokenizeSql(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;

    // Whitespace
    if (/\s/.test(ch)) {
      let ws = '';
      while (i < text.length && /\s/.test(text[i]!)) { ws += text[i]!; i++; }
      tokens.push({ type: 'text', value: ws });
      continue;
    }

    // Single-line comment --
    if (ch === '-' && text[i + 1] === '-') {
      let comment = '';
      while (i < text.length && text[i] !== '\n') { comment += text[i]!; i++; }
      tokens.push({ type: 'comment', value: comment });
      continue;
    }

    // Block comment /* */
    if (ch === '/' && text[i + 1] === '*') {
      let comment = '/*';
      i += 2;
      while (i < text.length && !(text[i - 1] === '*' && text[i] === '/')) {
        comment += text[i]!;
        i++;
      }
      if (i < text.length) { comment += text[i]!; i++; }
      tokens.push({ type: 'comment', value: comment });
      continue;
    }

    // Strings
    if (ch === "'" || ch === '"') {
      let str = ch;
      const quote = ch;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') { str += text[i]!; i++; }
        if (i < text.length) { str += text[i]!; i++; }
      }
      if (i < text.length) { str += quote; i++; }
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Numbers
    if (/\d/.test(ch)) {
      let num = '';
      while (i < text.length && /[\d.]/.test(text[i]!)) { num += text[i]!; i++; }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Operators and punctuation
    if (/[=<>!+\-*/(),.;:]/.test(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i++;
      continue;
    }

    // Words (keywords, functions, identifiers)
    if (/[a-zA-Z_]/.test(ch)) {
      let word = '';
      while (i < text.length && /[a-zA-Z0-9_]/.test(text[i]!)) { word += text[i]!; i++; }
      const upper = word.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (SQL_FUNCTIONS.has(upper)) {
        tokens.push({ type: 'function', value: word });
      } else {
        tokens.push({ type: 'identifier', value: word });
      }
      continue;
    }

    // Fallback
    tokens.push({ type: 'text', value: ch });
    i++;
  }

  return tokens;
}

function tokenizeRedis(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;

    if (/\s/.test(ch)) {
      let ws = '';
      while (i < text.length && /\s/.test(text[i]!)) { ws += text[i]!; i++; }
      tokens.push({ type: 'text', value: ws });
      continue;
    }

    if (ch === '"') {
      let str = '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') { str += text[i]!; i++; }
        if (i < text.length) { str += text[i]!; i++; }
      }
      if (i < text.length) { str += '"'; i++; }
      tokens.push({ type: 'string', value: str });
      continue;
    }

    if (/\d/.test(ch)) {
      let num = '';
      while (i < text.length && /[\d.]/.test(text[i]!)) { num += text[i]!; i++; }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    if (/[a-zA-Z_*]/.test(ch)) {
      let word = '';
      while (i < text.length && /[a-zA-Z0-9_:.*-]/.test(text[i]!)) { word += text[i]!; i++; }
      const upper = word.toUpperCase();
      if (REDIS_COMMANDS.has(upper)) {
        tokens.push({ type: 'keyword', value: word });
      } else {
        tokens.push({ type: 'identifier', value: word });
      }
      continue;
    }

    tokens.push({ type: 'text', value: ch });
    i++;
  }

  return tokens;
}

function tokenizeJson(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;

    // Whitespace
    if (/\s/.test(ch)) {
      let ws = '';
      while (i < text.length && /\s/.test(text[i]!)) { ws += text[i]!; i++; }
      tokens.push({ type: 'text', value: ws });
      continue;
    }

    // Strings
    if (ch === '"') {
      let str = '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) { str += text[i]! + text[i + 1]!; i += 2; }
        else { str += text[i]!; i++; }
      }
      if (i < text.length) { str += '"'; i++; }
      // Check if this is a key (followed by colon)
      let j = i;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      tokens.push({ type: j < text.length && text[j] === ':' ? 'keyword' : 'string', value: str });
      continue;
    }

    // Numbers
    if (/[-\d]/.test(ch)) {
      let num = '';
      if (ch === '-') { num += ch; i++; }
      while (i < text.length && /[\d.eE+-]/.test(text[i]!)) { num += text[i]!; i++; }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Keywords: true, false, null
    if (/[tfn]/.test(ch)) {
      const rest = text.slice(i);
      const match = rest.match(/^(true|false|null)\b/);
      if (match) {
        tokens.push({ type: 'function', value: match[1]! });
        i += match[1]!.length;
        continue;
      }
    }

    // Structural characters
    if ('{}[]:,'.includes(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i++;
      continue;
    }

    tokens.push({ type: 'text', value: ch });
    i++;
  }
  return tokens;
}

function tokenize(text: string, language: string): Token[] {
  switch (language) {
    case 'json':
    case 'convex':
      return tokenizeJson(text);
    case 'redis':
      return tokenizeRedis(text);
    case 'mongodb':
      return tokenizeSql(text);
    default:
      return tokenizeSql(text);
  }
}

// ── Token colors ──────────────────────────────────────────────────────

const TOKEN_CLASSES: Record<TokenType, string> = {
  keyword: 'text-blue-400',
  string: 'text-emerald-400',
  number: 'text-amber-400',
  comment: 'text-muted-foreground/40 italic',
  operator: 'text-muted-foreground/70',
  function: 'text-violet-400',
  identifier: 'text-foreground/80',
  text: '',
};

// ── Component ─────────────────────────────────────────────────────────

export function SqlEditor({ value, onChange, language = 'sql', placeholder, onExecute, minHeight = '120px' }: SqlEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const tokens = useMemo(() => tokenize(value, language), [value, language]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab → insert 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newVal = value.substring(0, start) + '  ' + value.substring(end);
        onChange(newVal);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
      // Ctrl+Enter → execute
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        onExecute?.();
      }
    },
    [value, onChange, onExecute],
  );

  // Sync scroll between textarea and pre
  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  return (
    <div className="relative rounded-lg border border-primary/10 bg-secondary/20 overflow-hidden" style={{ minHeight }}>
      {/* Syntax-highlighted layer */}
      <pre
        ref={preRef}
        className="absolute inset-0 p-3 text-sm font-mono whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
        aria-hidden
      >
        {tokens.map((token, i) => (
          <span key={i} className={TOKEN_CLASSES[token.type]}>
            {token.value}
          </span>
        ))}
        {/* Trailing newline to match textarea height */}
        {'\n'}
      </pre>

      {/* Textarea (transparent text, handles input) */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        placeholder={placeholder}
        spellCheck={false}
        className="relative w-full h-full p-3 text-sm font-mono bg-transparent text-transparent caret-foreground/80 resize-none focus:outline-none placeholder:text-muted-foreground/30"
        style={{ minHeight }}
      />
    </div>
  );
}
