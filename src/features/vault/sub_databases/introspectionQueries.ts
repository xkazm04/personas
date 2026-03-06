export type ConnectorFamily = 'postgres' | 'mysql' | 'redis' | 'convex' | 'unsupported';

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
    default:
      return 'unsupported';
  }
}

export function getListTablesQuery(serviceType: string): string | null {
  const family = getConnectorFamily(serviceType);
  switch (family) {
    case 'postgres':
      return `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
    case 'mysql':
      return `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`;
    default:
      return null;
  }
}

export function getListColumnsQuery(serviceType: string, tableName: string): string | null {
  const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const family = getConnectorFamily(serviceType);
  switch (family) {
    case 'postgres':
      return `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${safeName}' ORDER BY ordinal_position`;
    case 'mysql':
      return `SELECT column_name, column_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${safeName}' ORDER BY ordinal_position`;
    default:
      return null;
  }
}

export function getRedisKeyScanCommand(): string {
  return 'SCAN 0 MATCH * COUNT 100';
}

/** Generate a DB-specific SELECT-all query for clipboard copy. */
export function getSelectAllQuery(serviceType: string, tableName: string): string {
  const family = getConnectorFamily(serviceType);
  switch (family) {
    case 'postgres':
      return `SELECT * FROM "${tableName}" LIMIT 100;`;
    case 'mysql':
      return `SELECT * FROM \`${tableName}\` LIMIT 100;`;
    case 'redis':
      return `SCAN 0 MATCH ${tableName}* COUNT 100`;
    case 'convex':
      return `db.query("${tableName}").take(100)`;
    default:
      return `SELECT * FROM ${tableName} LIMIT 100;`;
  }
}
