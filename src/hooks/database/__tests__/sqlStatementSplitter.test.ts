import { splitSqlStatements } from '../sqlStatementSplitter';

describe('splitSqlStatements', () => {
  it('splits basic statements on semicolons', () => {
    const sql = 'CREATE TABLE a (id INT); CREATE TABLE b (id INT);';
    expect(splitSqlStatements(sql)).toEqual([
      'CREATE TABLE a (id INT)',
      'CREATE TABLE b (id INT)',
    ]);
  });

  it('handles trailing statement without semicolon', () => {
    const sql = 'SELECT 1; SELECT 2';
    expect(splitSqlStatements(sql)).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('ignores semicolons inside single-quoted strings', () => {
    const sql = "INSERT INTO t (col) VALUES ('hello; world'); SELECT 1;";
    expect(splitSqlStatements(sql)).toEqual([
      "INSERT INTO t (col) VALUES ('hello; world')",
      'SELECT 1',
    ]);
  });

  it('handles escaped single quotes inside strings', () => {
    const sql = "INSERT INTO t (col) VALUES ('it''s; fine'); SELECT 1;";
    expect(splitSqlStatements(sql)).toEqual([
      "INSERT INTO t (col) VALUES ('it''s; fine')",
      'SELECT 1',
    ]);
  });

  it('ignores semicolons inside dollar-quoted strings (PostgreSQL)', () => {
    const sql =
      "CREATE FUNCTION f() RETURNS void AS $$ BEGIN RAISE NOTICE 'hi; there'; END; $$ LANGUAGE plpgsql; SELECT 1;";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('$$');
    expect(stmts[1]).toBe('SELECT 1');
  });

  it('handles BEGIN...END trigger bodies without splitting inside', () => {
    const sql = `CREATE TRIGGER tr AFTER INSERT ON t
BEGIN
  UPDATE counters SET n = n + 1;
  INSERT INTO log (msg) VALUES ('fired');
END; SELECT 1;`;
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('BEGIN');
    expect(stmts[0]).toContain('END');
    expect(stmts[1]).toBe('SELECT 1');
  });

  it('skips single-line comments', () => {
    const sql = '-- comment\nSELECT 1; -- trailing\nSELECT 2;';
    expect(splitSqlStatements(sql)).toEqual(['-- comment\nSELECT 1', '-- trailing\nSELECT 2']);
  });

  it('skips block comments', () => {
    const sql = '/* a; b */ SELECT 1; /* c */ SELECT 2;';
    expect(splitSqlStatements(sql)).toEqual(['/* a; b */ SELECT 1', '/* c */ SELECT 2']);
  });

  it('returns empty array for empty/whitespace input', () => {
    expect(splitSqlStatements('')).toEqual([]);
    expect(splitSqlStatements('   \n  ')).toEqual([]);
  });

  it('does not treat BACKEND or AMEND as BEGIN/END', () => {
    const sql = "INSERT INTO t (col) VALUES ('BACKEND'); SELECT 1;";
    expect(splitSqlStatements(sql)).toEqual([
      "INSERT INTO t (col) VALUES ('BACKEND')",
      'SELECT 1',
    ]);
  });
});
