import { describe, it, expect } from 'vitest';
import {
  parseTablesResult,
  parseColumnsResult,
} from '@/hooks/database/useTableIntrospection';
import type { QueryResult } from '@/api/vault/database/dbSchema';

/**
 * Rendered-output parity for the unified introspection path.
 *
 * Live table/column discovery now flows exclusively through the backend's
 * PARAMETERIZED `introspect_db_tables` / `introspect_db_columns` commands, whose
 * QueryResult is shaped by these frontend parsers before TablesTab /
 * TableDetailPanel render it. The former frontend interpolated SQL builders were
 * deleted; this test pins the rendered shape so the remaining single defense
 * keeps producing exactly what the UI consumes — including the printable-char
 * preservation (hyphens, spaces) the deleted builder's tests used to guard.
 */

function qr(columns: string[], rows: unknown[][]): QueryResult {
  return { columns, rows, row_count: rows.length, duration_ms: 1 } as unknown as QueryResult;
}

describe('introspection parity — backend result → rendered shape', () => {
  it('parses the tables result into the shape TablesTab renders', () => {
    // Shape emitted by introspect_db_tables (information_schema.tables / catalog).
    const result = qr(
      ['table_name', 'table_type'],
      [
        ['users-prod', 'BASE TABLE'],
        ['My View', 'VIEW'],
      ],
    );

    expect(parseTablesResult(result)).toEqual([
      { table_name: 'users-prod', table_type: 'BASE TABLE' },
      { table_name: 'My View', table_type: 'VIEW' },
    ]);
  });

  it('preserves an API display_label when the backend supplies one', () => {
    const result = qr(
      ['table_name', 'table_type', 'display_label'],
      [['tbl_abc123', 'BASE TABLE', 'Customers']],
    );

    expect(parseTablesResult(result)).toEqual([
      { table_name: 'tbl_abc123', table_type: 'BASE TABLE', display_label: 'Customers' },
    ]);
  });

  it('parses the columns result (postgres data_type) into the rendered shape', () => {
    const result = qr(
      ['column_name', 'data_type', 'is_nullable', 'column_default'],
      [
        ['id', 'integer', 'NO', "nextval('users_id_seq')"],
        ['email', 'text', 'YES', null],
      ],
    );

    expect(parseColumnsResult(result)).toEqual([
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: "nextval('users_id_seq')" },
      { column_name: 'email', data_type: 'text', is_nullable: 'YES', column_default: null },
    ]);
  });

  it('accepts the mysql column_type alias for data_type (parity across families)', () => {
    const result = qr(
      ['column_name', 'column_type', 'is_nullable', 'column_default'],
      [['status', 'enum(\'a\',\'b\')', 'NO', 'a']],
    );

    expect(parseColumnsResult(result)).toEqual([
      { column_name: 'status', data_type: "enum('a','b')", is_nullable: 'NO', column_default: 'a' },
    ]);
  });
});
