// Live table/column introspection runs through the backend's PARAMETERIZED
// commands (`introspect_db_tables` / `introspect_db_columns`, see
// db_query.rs + db_schema.rs) via useTableIntrospection — a single
// injection-defense implementation. The former frontend interpolated SQL
// builders (getListTablesQuery / getListColumnsQuery / getRedisKeyScanCommand)
// were a weaker second implementation and have been deleted. What remains here
// is connector-family CLASSIFICATION plus getSelectAllQuery, a clipboard helper
// that emits a copy-paste SELECT for the user (not an executed introspection).
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

/**
 * Escape a string for use inside a single-quoted SQL literal — doubles every
 * single quote per SQL-92. Use this for VALUES that go inside `'...'` (e.g.
 * `WHERE table_name = '...'` against the system catalog), NOT for identifier
 * interpolation. We don't allow control characters either.
 */
function stripSqlControlChars(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return (code > 0x1f && code !== 0x7f);
    })
    .join('');
}

function escapeSqlStringLiteral(value: string): string {
  return stripSqlControlChars(value).replace(/'/g, "''");
}

/** Escape a string for use as a Postgres / SQLite double-quoted identifier. */
function escapePostgresIdent(value: string): string {
  return stripSqlControlChars(value).replace(/"/g, '""');
}

/** Escape a string for use as a MySQL backtick-quoted identifier. */
function escapeMysqlIdent(value: string): string {
  return stripSqlControlChars(value).replace(/`/g, '``');
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
