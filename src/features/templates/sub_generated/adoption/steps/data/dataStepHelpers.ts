/**
 * Helpers for DataStep: database setup extraction and SQL parsing.
 */

/**
 * Extract database_setup from the design result payload.
 * Templates with predefined schemas include this in customSections or
 * as a top-level payload field.
 */
export function extractDatabaseSetup(designResult: Record<string, unknown> | null): {
  sql: string | null;
  description: string | null;
} {
  if (!designResult) return { sql: null, description: null };

  // Check direct database_setup field
  const setup = designResult.database_setup as Record<string, unknown> | undefined;
  if (setup?.migrations) {
    const migrations = setup.migrations as Array<{ sql?: string; description?: string }>;
    const allSQL = migrations.map((m) => m.sql ?? '').filter(Boolean).join('\n\n');
    const desc = (setup.description as string) ?? migrations[0]?.description ?? null;
    return { sql: allSQL || null, description: desc };
  }

  // Check customSections for "Database Schema" section
  const prompt = designResult.structured_prompt as Record<string, unknown> | undefined;
  const sections = prompt?.customSections as Array<{ title: string; content: string }> | undefined;
  if (sections) {
    const dbSection = sections.find((s) =>
      s.title.toLowerCase().includes('database') || s.title.toLowerCase().includes('schema'),
    );
    if (dbSection) {
      // Extract SQL from code blocks
      const sqlMatch = dbSection.content.match(/```sql\n([\s\S]*?)```/);
      return {
        sql: sqlMatch?.[1]?.trim() ?? null,
        description: dbSection.title,
      };
    }
  }

  return { sql: null, description: null };
}

/** Parse SQL to extract table names from CREATE TABLE statements */
export function extractTableNames(sql: string): string[] {
  const matches = sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi);
  return [...matches].map((m) => m[1]!);
}
