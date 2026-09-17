import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { KpiListItem } from '../lib/KpiListPopover';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { KpiListPopover } from '../lib/KpiListPopover';

function kpi(id: string, status: KpiListItem['status'], current: number | null): KpiListItem {
  return { id, name: `KPI ${id}`, status, current, target: 100, unit: '' };
}

const items: KpiListItem[] = [
  kpi('met', 'met', 110),
  kpi('unmeasured', 'unmeasured', null),
  kpi('crit', 'crit', 5),
  kpi('warn', 'warn', 40),
  kpi('ok', 'ok', 80),
];

describe('KpiListPopover rows as doors', () => {
  it('a crit row opens the KPI surface and closes the popover', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<KpiListPopover items={items} x={0} y={0} onOpen={onOpen} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('mm-kpi-row-crit'));
    expect(onOpen).toHaveBeenCalledWith('crit');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('every measured status is a button; unmeasured stays inert', () => {
    render(<KpiListPopover items={items} x={0} y={0} onOpen={vi.fn()} onClose={vi.fn()} />);

    for (const id of ['crit', 'warn', 'ok', 'met']) {
      expect(screen.getByTestId(`mm-kpi-row-${id}`).tagName).toBe('BUTTON');
    }
    expect(screen.getByTestId('mm-kpi-row-unmeasured').tagName).not.toBe('BUTTON');
  });

  it('clicking an unmeasured row fires nothing', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<KpiListPopover items={items} x={0} y={0} onOpen={onOpen} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('mm-kpi-row-unmeasured'));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
