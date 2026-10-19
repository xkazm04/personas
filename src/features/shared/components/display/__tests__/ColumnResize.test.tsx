import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useColumnWidths } from '../ColumnResize';

const cols = [
  { key: 'name', width: '1fr' },
  { key: 'age', width: '80px' },
  { key: 'cost', width: '100px' },
];

describe('useColumnWidths persisted layout', () => {
  beforeEach(() => localStorage.clear());

  it('applies valid persisted widths', () => {
    localStorage.setItem('table-col-widths:t1', JSON.stringify({ name: 200 }));
    const { result } = renderHook(() => useColumnWidths('t1'));
    expect(result.current.template(cols)).toBe('200px 80px 100px');
  });

  it('drops corrupt entries instead of writing them into the grid template', () => {
    localStorage.setItem('table-col-widths:t2', JSON.stringify({ name: 'wide', age: null, cost: 12 }));
    const { result } = renderHook(() => useColumnWidths('t2'));
    expect(result.current.template(cols)).toBe('1fr 80px 100px');
  });

  it('ignores a persisted array', () => {
    localStorage.setItem('table-col-widths:t3', JSON.stringify([300, 400]));
    const { result } = renderHook(() => useColumnWidths('t3'));
    expect(result.current.template(cols)).toBe('1fr 80px 100px');
  });
});
