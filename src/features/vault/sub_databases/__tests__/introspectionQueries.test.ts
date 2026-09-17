import { describe, it, expect } from 'vitest';
import {
  getSelectAllQuery,
  getConnectorFamily,
} from '../introspectionQueries';

// These tests guard the table-name escape pipeline against a re-introduction
// of the historical bug where the strip regex was [^a-zA-Z0-9_], silently
// rewriting 'users-prod' → 'usersprod' and 'My Table' → 'MyTable'. The fix
// replaced that regex with [\x00-\x1F\x7F] (control chars only) — these
// tests assert the printable-character preservation invariant.

describe('introspectionQueries — printable-char preservation', () => {
  describe('getSelectAllQuery', () => {
    it('preserves hyphen in postgres-family table names (regression: users-prod)', () => {
      // 'supabase' maps to postgres family in getConnectorFamily.
      const sql = getSelectAllQuery('supabase', 'users-prod');
      expect(sql).toBe('SELECT * FROM "users-prod" LIMIT 100;');
    });

    it('preserves space in postgres-family table names (regression: My Table)', () => {
      const sql = getSelectAllQuery('neon', 'My Table');
      expect(sql).toBe('SELECT * FROM "My Table" LIMIT 100;');
    });

    it('preserves hyphen in mysql-family table names', () => {
      // 'planetscale' maps to mysql family.
      const sql = getSelectAllQuery('planetscale', 'users-prod');
      expect(sql).toBe('SELECT * FROM `users-prod` LIMIT 100;');
    });

    it('escapes embedded double quotes by doubling them (postgres)', () => {
      const sql = getSelectAllQuery('supabase', 'tbl"with"quotes');
      expect(sql).toBe('SELECT * FROM "tbl""with""quotes" LIMIT 100;');
    });

    it('escapes embedded backticks by doubling them (mysql)', () => {
      const sql = getSelectAllQuery('planetscale', 'tbl`with`ticks');
      expect(sql).toBe('SELECT * FROM `tbl``with``ticks` LIMIT 100;');
    });

    it('strips ASCII control characters but keeps surrounding chars', () => {
      const sql = getSelectAllQuery('supabase', 'a\x00b\x1Fc\x7Fd');
      expect(sql).toBe('SELECT * FROM "abcd" LIMIT 100;');
    });

    it('preserves non-ASCII unicode in table names', () => {
      const sql = getSelectAllQuery('supabase', 'users_α_β');
      expect(sql).toBe('SELECT * FROM "users_α_β" LIMIT 100;');
    });

    it('falls back to postgres-style quoting for unsupported families', () => {
      // 'mongodb' has no entry in getConnectorFamily → 'unsupported' →
      // getSelectAllQuery default branch uses postgres-style quoting.
      const sql = getSelectAllQuery('mongodb', 'order-items');
      expect(sql).toBe('SELECT * FROM "order-items" LIMIT 100;');
    });
  });

  describe('getConnectorFamily', () => {
    it('classifies postgres-compatible services', () => {
      expect(getConnectorFamily('supabase')).toBe('postgres');
      expect(getConnectorFamily('neon')).toBe('postgres');
    });

    it('classifies mysql-compatible services', () => {
      expect(getConnectorFamily('planetscale')).toBe('mysql');
    });

    it('classifies sqlite (personas_database)', () => {
      expect(getConnectorFamily('personas_database')).toBe('sqlite');
    });

    it('classifies redis-compatible services', () => {
      expect(getConnectorFamily('redis')).toBe('redis');
      expect(getConnectorFamily('upstash')).toBe('redis');
    });

    it('classifies convex', () => {
      expect(getConnectorFamily('convex')).toBe('convex');
    });

    it('classifies the API-introspection families', () => {
      expect(getConnectorFamily('notion')).toBe('notion');
      expect(getConnectorFamily('airtable')).toBe('airtable');
    });

    it('returns unsupported for unknown service types', () => {
      expect(getConnectorFamily('cobol-db-2026')).toBe('unsupported');
    });
  });

  /**
   * Census over the connector seed files themselves, not a hand-listed set of
   * four names.
   *
   * Without this, a new database connector can ship in
   * `scripts/connectors/builtin/*.json`, appear in the databases explorer
   * (DatabaseListView filters on `category === 'database'`) and silently
   * classify as `unsupported` -- no test, no build failure, just an explorer
   * row that can do nothing. The census reads the seed directory rather than
   * the TS catalog module so a connector that ships its JSON but is never
   * imported is still visible here.
   *
   * Every database-tagged builtin must either declare a family or appear in
   * NO_FAMILY_YET with a reason. The allowlist is checked in both directions:
   * a name that gains a family must leave it, so the list cannot rot into a
   * blanket exemption.
   */
  describe('family census over the builtin connector seeds', () => {
    /**
     * Database-tagged builtins that deliberately have no family today. Each
     * one also has no execution lane in the backend (`connector_capability`
     * in engine/db_query.rs returns IntrospectionOnly and `execute_query`
     * rejects it), so `unsupported` is the honest classification rather than
     * a gap to paper over.
     */
    const NO_FAMILY_YET = new Set([
      // No driver lane: db_query.rs dispatches supabase / neon / upstash /
      // planetscale / convex only. `postgres`, `duckdb` and `mongodb` are
      // catalogued for credential storage, not for the explorer's query
      // surface.
      'postgres',
      'duckdb',
      'mongodb',
      // Internal / non-tabular surfaces that carry a `database` tag for
      // catalog search, not for the SQL explorer.
      'operations_database',
      'personas_vector_db',
      // Spreadsheet connectors tagged `database` for template matching.
      'google_sheets',
      'microsoft_excel',
    ]);

    const SEEDS = import.meta.glob<{ name?: string; category?: string; categories?: string[] }>(
      '../../../../../scripts/connectors/builtin/*.json',
      { eager: true, import: 'default' },
    );

    const DATABASE_BUILTINS = Object.values(SEEDS)
      .filter((c) => [c.category, ...(c.categories ?? [])].includes('database'))
      .map((c) => c.name)
      .filter((n): n is string => typeof n === 'string')
      .sort();

    it('finds the database-tagged seeds at all (fail-loud: an empty census is a broken census)', () => {
      expect(DATABASE_BUILTINS.length).toBeGreaterThanOrEqual(10);
    });

    it.each(DATABASE_BUILTINS)('classifies %s, or allowlists it explicitly', (name) => {
      const family = getConnectorFamily(name);
      if (NO_FAMILY_YET.has(name)) {
        expect(family).toBe('unsupported');
      } else {
        expect(family).not.toBe('unsupported');
      }
    });

    it('carries no stale allowlist entry', () => {
      const catalog = new Set(DATABASE_BUILTINS);
      for (const name of NO_FAMILY_YET) {
        expect(catalog.has(name)).toBe(true);
      }
    });
  });
});
