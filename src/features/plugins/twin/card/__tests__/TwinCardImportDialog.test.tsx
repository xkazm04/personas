/**
 * Import a twin from a Twin Card: choose -> inspect (nothing written) -> the
 * inspection's variants (signed / unsigned / invalid signature, unsupported
 * version, invalid file, sealed part, hash mismatch) -> passphrase when sealed
 * -> conflict choice when the name exists -> import -> roster refresh + toast.
 *
 * The i18n layer is NOT mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { TwinCardInspection } from '@/lib/bindings/TwinCardInspection';

const h = vi.hoisted(() => ({
  open: vi.fn(),
  addToast: vi.fn(),
  state: {
    twinProfiles: [{ id: 't1', name: 'Ada' }] as Array<{ id: string; name: string }>,
    fetchTwinProfiles: vi.fn(async () => undefined),
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: h.open }));

vi.mock('@/api/twin/twinCard', () => ({
  cardInspect: vi.fn(),
  cardImport: vi.fn(),
}));

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: <T,>(selector: (s: typeof h.state) => T): T => selector(h.state),
}));

vi.mock('@/stores/toastStore', () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof h.addToast }) => T): T => selector({ addToast: h.addToast }),
}));

import * as cardApi from '@/api/twin/twinCard';
import { TwinCardImportDialog } from '../TwinCardImportDialog';

const cardInspect = vi.mocked(cardApi.cardInspect);
const cardImport = vi.mocked(cardApi.cardImport);

function inspection(over: Partial<TwinCardInspection> = {}): TwinCardInspection {
  return {
    specVersion: '1.0',
    supported: true,
    valid: true,
    name: 'Grace',
    partitions: [
      { name: 'voice', sealed: false, hashOk: true },
      { name: 'knowledge', sealed: false, hashOk: true },
    ],
    signature: 'valid',
    warnings: [],
    ...over,
  };
}

async function pickCard(found: TwinCardInspection) {
  h.open.mockResolvedValueOnce('C:/cards/grace.twin.json');
  cardInspect.mockResolvedValueOnce(found);
  fireEvent.click(screen.getByTestId('twin-card-import-pick'));
  await screen.findByTestId('twin-card-inspection');
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.twinProfiles = [{ id: 't1', name: 'Ada' }];
});

describe('TwinCardImportDialog', () => {
  it('a clean signed card imports as a new twin, refreshes the roster and announces it', async () => {
    const onClose = vi.fn();
    render(<TwinCardImportDialog onClose={onClose} />);
    expect(screen.getByTestId('twin-card-import-run')).toBeDisabled();

    await pickCard(inspection());
    expect(cardInspect).toHaveBeenCalledWith('C:/cards/grace.twin.json', null);
    expect(screen.getByTestId('twin-card-signature')).toHaveAttribute('data-signature', 'valid');
    expect(screen.getByTestId('twin-card-signature')).toHaveTextContent('Signed');
    expect(screen.getByTestId('twin-card-partition-voice')).toHaveTextContent('Voice and identity');
    expect(screen.getByTestId('twin-card-partition-knowledge')).toHaveTextContent('Self-knowledge');
    expect(screen.queryByTestId('twin-card-import-passphrase')).not.toBeInTheDocument();
    expect(screen.queryByTestId('twin-card-conflict')).not.toBeInTheDocument();

    cardImport.mockResolvedValueOnce({ twinId: 't9', imported: ['voice', 'knowledge'], warnings: [] });
    fireEvent.click(screen.getByTestId('twin-card-import-run'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(cardImport).toHaveBeenCalledWith('C:/cards/grace.twin.json', null, 'duplicate');
    expect(h.state.fetchTwinProfiles).toHaveBeenCalledWith({ force: true });
    expect(h.addToast).toHaveBeenCalledWith('Imported Grace', 'success');
  });

  it('a cancelled file dialog inspects nothing', async () => {
    render(<TwinCardImportDialog onClose={vi.fn()} />);
    h.open.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('twin-card-import-pick'));
    await waitFor(() => expect(h.open).toHaveBeenCalled());
    expect(cardInspect).not.toHaveBeenCalled();
  });

  it('a newer major version is reported as unsupported and cannot be imported', async () => {
    render(<TwinCardImportDialog onClose={vi.fn()} />);
    await pickCard(inspection({ specVersion: '2.0', supported: false, valid: false }));
    expect(screen.getByTestId('twin-card-unsupported')).toHaveTextContent('version 2.0');
    expect(screen.queryByTestId('twin-card-invalid')).not.toBeInTheDocument();
    expect(screen.getByTestId('twin-card-import-run')).toBeDisabled();
  });

  it('an invalid file is reported as invalid and cannot be imported', async () => {
    render(<TwinCardImportDialog onClose={vi.fn()} />);
    await pickCard(inspection({ valid: false, name: null }));
    expect(screen.getByTestId('twin-card-invalid')).toHaveTextContent('not a valid Twin Card');
    expect(screen.getByTestId('twin-card-import-run')).toBeDisabled();
  });

  it('unsigned and invalid signatures are told apart', async () => {
    const first = render(<TwinCardImportDialog onClose={vi.fn()} />);
    await pickCard(inspection({ signature: 'unsigned' }));
    expect(screen.getByTestId('twin-card-signature')).toHaveTextContent('Unsigned');
    first.unmount();
    render(<TwinCardImportDialog onClose={vi.fn()} />);
    await pickCard(inspection({ signature: 'invalid' }));
    expect(screen.getByTestId('twin-card-signature')).toHaveTextContent('Signature does not match');
  });

  it('a sealed part asks for the passphrase, a changed part is flagged, and the passphrase reaches import', async () => {
    render(<TwinCardImportDialog onClose={vi.fn()} />);
    await pickCard(inspection({
      partitions: [
        { name: 'voice', sealed: false, hashOk: false },
        { name: 'training', sealed: true, hashOk: null },
      ],
    }));
    expect(screen.getByTestId('twin-card-hash-mismatch')).toHaveTextContent('The Voice and identity part was changed after export');
    const field = screen.getByTestId('twin-card-import-passphrase');
    fireEvent.change(field, { target: { value: 'correct horse' } });

    cardImport.mockResolvedValueOnce({ twinId: 't9', imported: ['voice', 'training'], warnings: [] });
    fireEvent.click(screen.getByTestId('twin-card-import-run'));
    await waitFor(() => expect(cardImport).toHaveBeenCalledWith('C:/cards/grace.twin.json', 'correct horse', 'duplicate'));
  });

  it('a name collision asks what to do, and the choice reaches import', async () => {
    h.state.twinProfiles = [{ id: 't1', name: 'Grace' }];
    render(<TwinCardImportDialog onClose={vi.fn()} />);
    await pickCard(inspection());
    expect(screen.getByTestId('twin-card-conflict')).toHaveTextContent('A twin named Grace already exists');
    expect(screen.getByTestId('twin-card-conflict-duplicate')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('twin-card-conflict-replace'));
    expect(screen.getByTestId('twin-card-conflict-replace')).toHaveAttribute('aria-pressed', 'true');
    cardImport.mockResolvedValueOnce({ twinId: 't1', imported: ['voice'], warnings: [] });
    fireEvent.click(screen.getByTestId('twin-card-import-run'));
    await waitFor(() => expect(cardImport).toHaveBeenCalledWith('C:/cards/grace.twin.json', null, 'replace'));
  });

  it('a skipped collision imports nothing and announces nothing', async () => {
    h.state.twinProfiles = [{ id: 't1', name: 'Grace' }];
    const onClose = vi.fn();
    render(<TwinCardImportDialog onClose={onClose} />);
    await pickCard(inspection());
    fireEvent.click(screen.getByTestId('twin-card-conflict-skip'));
    cardImport.mockResolvedValueOnce({ twinId: 't1', imported: [], warnings: [] });
    fireEvent.click(screen.getByTestId('twin-card-import-run'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(cardImport).toHaveBeenCalledWith('C:/cards/grace.twin.json', null, 'skip');
    expect(h.addToast).not.toHaveBeenCalled();
  });

  it('a rejected inspect (backend not built yet) is answered inline', async () => {
    render(<TwinCardImportDialog onClose={vi.fn()} />);
    h.open.mockResolvedValueOnce('C:/cards/x.twin.json');
    cardInspect.mockRejectedValueOnce({ kind: 'internal', error: 'twin_card_inspect is not built yet' });
    fireEvent.click(screen.getByTestId('twin-card-import-pick'));
    expect(await screen.findByTestId('twin-card-import-error')).toHaveTextContent('not built yet');
    expect(screen.getByTestId('twin-card-import-run')).toBeDisabled();
  });

  it('a rejected import (wrong passphrase) keeps the dialog open with the reason', async () => {
    const onClose = vi.fn();
    render(<TwinCardImportDialog onClose={onClose} />);
    await pickCard(inspection({ partitions: [{ name: 'knowledge', sealed: true, hashOk: null }] }));
    fireEvent.change(screen.getByTestId('twin-card-import-passphrase'), { target: { value: 'wrong-pass' } });
    cardImport.mockRejectedValueOnce(new Error('wrong passphrase'));
    fireEvent.click(screen.getByTestId('twin-card-import-run'));
    expect(await screen.findByTestId('twin-card-import-error')).toHaveTextContent('wrong passphrase');
    expect(onClose).not.toHaveBeenCalled();
  });
});
