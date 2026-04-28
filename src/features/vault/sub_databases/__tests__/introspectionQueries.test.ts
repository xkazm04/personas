import { describe, it, expect } from 'vitest';
import {
  getListColumnsQuery,
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

  describe('getListColumnsQuery', () => {
    it('produces a literal SQL with hyphenated table name preserved', () => {
      const q = getListColumnsQuery('supabase', 'users-prod');
      expect(q).not.toBeNull();
      // The table name appears as a single-quoted SQL literal; hyphen survives.
      expect(q).toContain("'users-prod'");
    });

    it('escapes single quotes by doubling per SQL-92', () => {
      const q = getListColumnsQuery('supabase', "O'Brien");
      expect(q).not.toBeNull();
      expect(q).toContain("'O''Brien'");
    });

    it('strips ASCII control characters from the table-name literal', () => {
      const q = getListColumnsQuery('supabase', 'foo\x00bar');
      expect(q).not.toBeNull();
      expect(q).toContain("'foobar'");
    });

    it('returns null for unsupported families', () => {
      expect(getListColumnsQuery('redis', 'whatever')).toBeNull();
      expect(getListColumnsQuery('mongodb', 'whatever')).toBeNull();
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

    it('returns unsupported for unknown service types', () => {
      expect(getConnectorFamily('cobol-db-2026')).toBe('unsupported');
    });
  });
});
