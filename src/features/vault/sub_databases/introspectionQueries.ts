export type ConnectorFamily = 'postgres' | 'mysql' | 'redis' | 'convex' | 'sqlite' | 'notion' | 'airtable' | 'unsupported';

export function getConnectorFamily(serviceType: string): ConnectorFamily {
  switch (serviceType) {
    case 'supabase':
    case 'neon':
      return 'postgres';
    case 'planetscale':
      return 'mysql';
    case 'upstash':
    case 'redis':
      return 'redis';
    case 'convex':
      return 'convex';
    case 'personas_database':
      return 'sqlite';
    case 'notion':
      return 'notion';
    case 'airtable':
      return 'airtable';
    default:
      return 'unsupported';
  }
}

/** Whether this family uses API-based introspection (no SQL queries). */
export function isApiFamily(family: ConnectorFamily): boolean {
  return family === 'notion' || family === 'airtable';
}

export function getListTablesQuery(serviceType: string): string | null {
  const family = getConnectorFamily(serviceType);
  switch (family) {
    case 'postgres':
      return `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
    case 'mysql':
      return `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`;
    case 'sqlite':
      return `SELECT name AS table_name, type AS table_type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`;
    default:
      return null;
  }
}

/**
 * Escape a string for use inside a single-quoted SQL literal — doubles every
 * single quote per SQL-92. Use this for VALUES that go inside `'...'` (e.g.
 * `WHERE table_name = '...'` against the system catalog), NOT for identifier
 * interpolation. We don't allow control characters either.
 */
function escapeSqlStringLiteral(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, '').replace(/'/g, "''");
}

/** Escape a string for use as a Postgres / SQLite double-quoted identifier. */
function escapePostgresIdent(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, '').replace(/"/g, '""');
}

/** Escape a string for use as a MySQL backtick-quoted identifier. */
function escapeMysqlIdent(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, '').replace(/`/g, '``');
}

/**
 * Escape a string so Redis SCAN/KEYS treats it as a LITERAL prefix.
 *
 * Redis MATCH glob metacharacters: `* ? [ ]` (and `\` itself). Without
 * escaping, a key prefix like `cache[v1]` is interpreted as a character
 * class and silently mismatches; a key with a leading `*` or `?` matches
 * far more than the user intended; backslash sequences eat the next
 * character. Treat the supplied prefix as literal data and let the caller
 * append `*` for prefix-match semantics.
 */
function escapeRedisGlob(value: string): string {
  return value.replace(/[\\*?[\]]/g, '\\$&');
}

export function getListColumnsQuery(serviceType: string, tableName: string): string | null {
  // The introspection queries below match table_name as a STRING LITERAL
  // against the catalog (information_schema.columns / sqlite_master) — they
  // are NOT identifier interpolation. The previous strip regex
  // [^a-zA-Z0-9_] silently rewrote 'My Table' → 'MyTable' and 'users-prod'
  // → 'usersprod', causing zero-column results for any table name with a
  // hyphen, space, or case-sensitive Postgres quoted identifier. Now: quote-
  // escape the literal so the user's actual name reaches the catalog query.
  const safeLiteral = escapeSqlStringLiteral(tableName);
  const family = getConnectorFamily(serviceType);
  switch (family) {
    case 'postgres':
      return `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${safeLiteral}' ORDER BY ordinal_position`;
    case 'mysql':
      return `SELECT column_name, column_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${safeLiteral}' ORDER BY ordinal_position`;
    case 'sqlite':
      return `PRAGMA table_info('${safeLiteral}')`;
    default:
      return null;
  }
}

export function getRedisKeyScanCommand(): string {
  return 'SCAN 0 MATCH * COUNT 100';
}

/** Generate a DB-specific SELECT-all query for clipboard copy. */
export function getSelectAllQuery(serviceType: string, tableName: string): string {
  // Postgres / SQLite: double-quote and escape any literal `"` by doubling it.
  // MySQL: backtick-quote and escape any literal `` ` `` by doubling it.
  // The default branch previously emitted `SELECT * FROM order-items LIMIT 100;`
  // (no quoting) — Postgres parsed it as `order MINUS items` and the user
  // pasted-and-ran into a baffling syntax error.
  const family = getConnectorFamily(serviceType);
  switch (family) {
    case 'postgres':
      return `SELECT * FROM "${escapePostgresIdent(tableName)}" LIMIT 100;`;
    case 'mysql':
      return `SELECT * FROM \`${escapeMysqlIdent(tableName)}\` LIMIT 100;`;
    case 'redis':
      // The user's `tableName` is a Redis key prefix; escape glob metas so
      // `cache[v1]` doesn't get interpreted as a char class. The trailing
      // `*` IS the prefix-match wildcard (intentional, post-escape).
      return `SCAN 0 MATCH ${escapeRedisGlob(tableName)}* COUNT 100`;
    case 'convex':
      return `db.query("${escapeSqlStringLiteral(tableName)}").take(100)`;
    case 'sqlite':
      return `SELECT * FROM "${escapePostgresIdent(tableName)}" LIMIT 100;`;
    default:
      // Default to Postgres-style quoting since most SQL dialects accept it.
      // Better than naked interpolation that breaks on hyphens / spaces.
      return `SELECT * FROM "${escapePostgresIdent(tableName)}" LIMIT 100;`;
  }
}
