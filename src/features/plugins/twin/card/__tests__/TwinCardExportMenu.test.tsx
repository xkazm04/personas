/**
 * Export from the Detail header: the trigger keeps the WP0 test id, the
 * dialog sends the chosen partitions (voice always) and format with the save
 * path, the passphrase travels as its OWN argument (never inside the options
 * struct), a short passphrase blocks the export, and an unsigned result says
 * so.
 *
 * The i18n layer is NOT mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: h.save }));
vi.mock('@/api/twin/twinCard', () => ({ cardExport: vi.fn() }));

import * as cardApi from '@/api/twin/twinCard';
import TwinCardExportMenu from '../TwinCardExportMenu';
import { cardFileName } from '../cardCopy';

const cardExport = vi.mocked(cardApi.cardExport);

function openDialog() {
  render(<TwinCardExportMenu twinId="t1" twinName="Ada Lovelace" />);
  const trigger = screen.getByTestId('twin-card-export');
  expect(trigger).toHaveAttribute('data-twin', 't1');
  fireEvent.click(trigger);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cardFileName', () => {
  it('slugs the twin name, any script, per format', () => {
    expect(cardFileName('Ada Lovelace', 'twin-card')).toBe('ada-lovelace.twin.json');
    expect(cardFileName('  Žofie Nováková ', 'ccv3')).toBe('žofie-nováková.card.json');
    expect(cardFileName('!!!', 'twin-card')).toBe('twin.twin.json');
  });
});

describe('TwinCardExportMenu', () => {
  it('exports every partition as a Twin Card by default, unsealed', async () => {
    openDialog();
    h.save.mockResolvedValueOnce('C:/out/ada-lovelace.twin.json');
    cardExport.mockResolvedValueOnce({
      path: 'C:/out/ada-lovelace.twin.json', partitions: ['voice', 'knowledge', 'training', 'evidence'],
      sealed: [], signed: true, warnings: [],
    });
    fireEvent.click(screen.getByTestId('twin-card-export-run'));

    await screen.findByTestId('twin-card-export-done');
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'ada-lovelace.twin.json' }));
    expect(cardExport).toHaveBeenCalledWith(
      't1',
      { partitions: ['voice', 'knowledge', 'training', 'evidence'], format: 'twin-card', path: 'C:/out/ada-lovelace.twin.json' },
      null,
    );
    expect(screen.getByTestId('twin-card-export-done')).toHaveTextContent('Exported to C:/out/ada-lovelace.twin.json');
    expect(screen.getByTestId('twin-card-export-done')).not.toHaveTextContent('without a signature');
  });

  it('voice cannot be dropped; other partitions can; CCv3 and a sealing passphrase go through separately', async () => {
    openDialog();
    fireEvent.click(screen.getByTestId('twin-card-part-voice'));
    fireEvent.click(screen.getByTestId('twin-card-part-evidence'));
    fireEvent.click(screen.getByTestId('twin-card-format-ccv3'));
    fireEvent.click(screen.getByTestId('twin-card-seal'));

    const field = screen.getByTestId('twin-card-passphrase');
    fireEvent.change(field, { target: { value: 'short' } });
    expect(screen.getByTestId('twin-card-export-run')).toBeDisabled();
    fireEvent.change(field, { target: { value: 'long enough phrase' } });
    expect(screen.getByTestId('twin-card-export-run')).toBeEnabled();

    h.save.mockResolvedValueOnce('C:/out/ada.card.json');
    cardExport.mockResolvedValueOnce({
      path: 'C:/out/ada.card.json', partitions: ['voice', 'knowledge', 'training'], sealed: ['knowledge', 'training'],
      signed: false, warnings: [],
    });
    fireEvent.click(screen.getByTestId('twin-card-export-run'));

    await screen.findByTestId('twin-card-export-done');
    const [, options, passphrase] = cardExport.mock.calls[0];
    expect(options).toEqual({ partitions: ['voice', 'knowledge', 'training'], format: 'ccv3', path: 'C:/out/ada.card.json' });
    expect(options).not.toHaveProperty('passphrase');
    expect(passphrase).toBe('long enough phrase');
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'ada-lovelace.card.json' }));
    expect(screen.getByTestId('twin-card-export-done')).toHaveTextContent('Saved without a signature');
  });

  it('sealing is off the table when no personal partition is included', () => {
    openDialog();
    fireEvent.click(screen.getByTestId('twin-card-part-knowledge'));
    fireEvent.click(screen.getByTestId('twin-card-part-training'));
    expect(screen.getByTestId('twin-card-seal').querySelector('[role="switch"]')).toBeDisabled();
  });

  it('a cancelled save dialog exports nothing', async () => {
    openDialog();
    h.save.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('twin-card-export-run'));
    await waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(cardExport).not.toHaveBeenCalled();
  });

  it('a rejected export (backend not built yet) is answered inline', async () => {
    openDialog();
    h.save.mockResolvedValueOnce('C:/out/a.twin.json');
    cardExport.mockRejectedValueOnce({ kind: 'internal', error: 'twin_card_export is not built yet' });
    fireEvent.click(screen.getByTestId('twin-card-export-run'));
    expect(await screen.findByTestId('twin-card-export-error')).toHaveTextContent('not built yet');
  });
});
