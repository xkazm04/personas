import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PropsWithChildren } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RenameEventDialog, RESERVED_EVENT_TYPES } from '../RenameEventDialog';

vi.mock('@/features/shared/components/modals', () => ({
  BaseModal: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/i18n/useTranslation', async () => {
  const { default: t } = await import('@/i18n/locales/en.json');
  return { useTranslation: () => ({ t }) };
});

describe('RenameEventDialog reserved names', () => {
  it('blocks a reserved old event type even when its row is not in the catalog', () => {
    render(<RenameEventDialog open oldEventType="chain_triggered" affectedCounts={{ sources: 1, connections: 1 }} reserved={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'custom_event' } });
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
  });

  it('keeps the client reserved list equal to the Rust validator', () => {
    const source = readFileSync(resolve(process.cwd(), 'src-tauri/db/src/repos/resources/triggers/event_wiring.rs'), 'utf8');
    const body = source.match(/pub\(crate\) const RESERVED_EVENT_TYPES:[\s\S]*?=\s*&\[([\s\S]*?)\];/)?.[1];
    expect(body).toBeDefined();
    const rustTypes = [...body!.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(RESERVED_EVENT_TYPES).toEqual(new Set(rustTypes));
  });
});
