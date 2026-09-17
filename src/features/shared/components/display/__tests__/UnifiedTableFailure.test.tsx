import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnifiedTable, type TableColumn } from '../UnifiedTable';
import { DataGrid } from '../DataGrid';

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [{ id: 'a', name: 'Alpha' }];

const columns: TableColumn<Row>[] = [
  { key: 'name', label: 'Name', width: '1fr', render: (r) => r.name },
];

describe('UnifiedTable failure state', () => {
  it('renders the failure banner instead of the empty state when a fetch failed with no rows', () => {
    render(
      <UnifiedTable<Row>
        columns={columns}
        data={[]}
        getRowKey={(r) => r.id}
        rowHeight={44}
        isLoading={false}
        emptyTitle="No executions yet"
        error="Could not reach the engine"
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Could not reach the engine');
    expect(screen.queryByText('No executions yet')).toBeNull();
  });

  it('keeps rows mounted when a refresh fails', () => {
    render(
      <UnifiedTable<Row>
        columns={columns}
        data={rows}
        getRowKey={(r) => r.id}
        rowHeight={44}
        isLoading={false}
        emptyTitle="No executions yet"
        error="Refresh failed"
      />,
    );
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Refresh failed')).toBeTruthy();
  });

  it('still shows the settled empty state when there is no error', () => {
    render(
      <UnifiedTable<Row>
        columns={columns}
        data={[]}
        getRowKey={(r) => r.id}
        rowHeight={44}
        isLoading={false}
        emptyTitle="No executions yet"
      />,
    );
    expect(screen.getByText('No executions yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('DataGrid failure state', () => {
  it('renders the failure banner instead of the empty state', () => {
    render(
      <DataGrid<Row>
        columns={[{ key: 'name', label: 'Name', width: '1fr', render: (r) => r.name }]}
        data={[]}
        getRowKey={(r) => r.id}
        pageSize={10}
        emptyTitle="No credentials yet"
        error="Vault is locked"
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Vault is locked');
    expect(screen.queryByText('No credentials yet')).toBeNull();
  });

  it('keeps rows mounted when a refresh fails', () => {
    render(
      <DataGrid<Row>
        columns={[{ key: 'name', label: 'Name', width: '1fr', render: (r) => r.name }]}
        data={rows}
        getRowKey={(r) => r.id}
        pageSize={10}
        emptyTitle="No credentials yet"
        error="Refresh failed"
      />,
    );
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Refresh failed')).toBeTruthy();
  });
});
