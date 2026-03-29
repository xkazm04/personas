/**
 * Splits a SQL script into individual statements, correctly handling:
 * - Semicolons inside single-quoted string literals (with '' escapes)
 * - Semicolons inside dollar-quoted strings (PostgreSQL $$...$$)
 * - Semicolons inside BEGIN...END blocks (triggers / procedures)
 * - Single-line (--) and block comments
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const len = sql.length;

  // Track nesting for BEGIN/END blocks (triggers, procedures)
  let beginEndDepth = 0;

  while (i < len) {
    const ch = sql[i];
    const rest = sql.slice(i);

    // -- Single-line comment: skip to end of line
    if (ch === '-' && sql[i + 1] === '-') {
      const eol = sql.indexOf('\n', i);
      if (eol === -1) {
        current += sql.slice(i);
        i = len;
      } else {
        current += sql.slice(i, eol + 1);
        i = eol + 1;
      }
      continue;
    }

    // /* Block comment */: skip to closing */
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) {
        current += sql.slice(i);
        i = len;
      } else {
        current += sql.slice(i, end + 2);
        i = end + 2;
      }
      continue;
    }

    // Single-quoted string literal: consume until unescaped closing quote
    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2; // escaped quote
        } else if (sql[j] === "'") {
          j++;
          break;
        } else {
          j++;
        }
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // Dollar-quoted string (PostgreSQL): $tag$...$tag$
    if (ch === '$') {
      const tagMatch = rest.match(/^(\$[A-Za-z0-9_]*\$)/);
      if (tagMatch?.[1]) {
        const tag = tagMatch[1];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        if (closeIdx === -1) {
          current += sql.slice(i);
          i = len;
        } else {
          current += sql.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
        }
        continue;
      }
    }

    // BEGIN keyword — increase depth (only at word boundary)
    if (/^BEGIN\b/i.test(rest) && isWordBoundaryBefore(sql, i)) {
      beginEndDepth++;
      current += sql.slice(i, i + 5);
      i += 5;
      continue;
    }

    // END keyword — decrease depth (only at word boundary)
    if (/^END\b/i.test(rest) && isWordBoundaryBefore(sql, i) && beginEndDepth > 0) {
      beginEndDepth--;
      current += sql.slice(i, i + 3);
      i += 3;
      continue;
    }

    // Semicolon: split point only when not inside a BEGIN...END block
    if (ch === ';' && beginEndDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // Capture any trailing statement without semicolon
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}

/** Returns true if position `i` is preceded by a non-word character (or is at the start). */
function isWordBoundaryBefore(sql: string, i: number): boolean {
  if (i === 0) return true;
  const prev = sql[i - 1];
  return prev === undefined || !/[A-Za-z0-9_]/.test(prev);
}
