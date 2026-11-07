import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// The Ollama / LiteLLM key popups rendered each <label> beside its <input>
// with no htmlFor / id pair, so the API-key field had no accessible name: a
// screen reader announced "edit text, password" and clicking the label did
// not focus the field.

const settings = vi.hoisted(() => ({
  getAppSettingsBulk: vi.fn(),
  setAppSetting: vi.fn(),
  deleteAppSetting: vi.fn(),
}));

vi.mock('@/api/system/settings', () => settings);

import { ConfigurationPopup } from '../ConfigurationPopup';
import { litellmFields, ollamaFields } from '../popupFieldConfigs';
import { en } from '@/i18n/en';

const P = en.overview.popup_fields;

function renderPopup(fields: ReturnType<typeof litellmFields>) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfigurationPopup
      title="Provider"
      subtitle="Keys"
      accent="sky"
      fields={fields}
      saveLabel="Save"
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onClose };
}

/** The read has settled: the fields only stop being disabled once it has. */
async function field(label: string) {
  const input = (await screen.findByLabelText(label)) as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}

const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const removeKeyName = en.settings.byom.remove_key;
const removeKeyButton = () => screen.queryByRole('button', { name: removeKeyName });

/** Save has asked and has not acted: nothing is written or deleted until the dialog says so. */
async function pressSaveAndExpectTheDialog() {
  fireEvent.click(saveButton());
  const confirm = await screen.findByRole('button', { name: removeKeyName });
  expect(settings.deleteAppSetting).not.toHaveBeenCalled();
  expect(settings.setAppSetting).not.toHaveBeenCalled();
  return confirm;
}

beforeEach(() => {
  settings.getAppSettingsBulk.mockReset().mockResolvedValue({});
  settings.setAppSetting.mockReset().mockResolvedValue(undefined);
  settings.deleteAppSetting.mockReset().mockResolvedValue(true);
});

describe('ConfigurationPopup', () => {
  it('names every field by its label', async () => {
    const LITELLM_FIELDS = litellmFields(en.overview.popup_fields);
    renderPopup(LITELLM_FIELDS);
    for (const field of LITELLM_FIELDS) {
      const input = await screen.findByLabelText(field.label);
      expect(input.getAttribute('type')).toBe(field.type);
    }
  });
});

// DW-182: clearing a stored key and pressing Save closed the popup as if it
// had worked, while the old key stayed stored and in use. Someone removing a
// leaked key believed it was gone.
describe('ConfigurationPopup: clearing a stored key clears it', () => {
  it('LiteLLM: a cleared master key is deleted, the kept url is still written', async () => {
    settings.getAppSettingsBulk.mockResolvedValue({
      litellm_base_url: 'http://localhost:4000',
      litellm_master_key: 'sk-leaked',
    });
    const { onSaved } = renderPopup(litellmFields(P));

    const key = await field(P.litellm_master_key_label);
    await waitFor(() => expect(key.value).toBe('sk-leaked'));
    fireEvent.change(key, { target: { value: '' } });
    fireEvent.click(await pressSaveAndExpectTheDialog());

    await waitFor(() => expect(settings.deleteAppSetting).toHaveBeenCalledWith('litellm_master_key'));
    expect(settings.deleteAppSetting).toHaveBeenCalledTimes(1);
    expect(settings.setAppSetting).toHaveBeenCalledWith('litellm_base_url', 'http://localhost:4000');
    expect(settings.setAppSetting).not.toHaveBeenCalledWith('litellm_master_key', expect.anything());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('Ollama: the only field cleared leaves Save enabled, and pressing it deletes the key', async () => {
    settings.getAppSettingsBulk.mockResolvedValue({ ollama_api_key: 'sk-leaked' });
    const { onSaved } = renderPopup(ollamaFields(P));

    const key = await field(P.api_key_label);
    await waitFor(() => expect(key.value).toBe('sk-leaked'));
    fireEvent.change(key, { target: { value: '' } });

    expect(saveButton().disabled).toBe(false);
    fireEvent.click(await pressSaveAndExpectTheDialog());

    await waitFor(() => expect(settings.deleteAppSetting).toHaveBeenCalledWith('ollama_api_key'));
    expect(settings.setAppSetting).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('a delete that fails does not report a save', async () => {
    settings.getAppSettingsBulk.mockResolvedValue({ ollama_api_key: 'sk-leaked' });
    settings.deleteAppSetting.mockRejectedValue(new Error('ipc down'));
    const { onSaved } = renderPopup(ollamaFields(P));

    const key = await field(P.api_key_label);
    await waitFor(() => expect(key.value).toBe('sk-leaked'));
    fireEvent.change(key, { target: { value: '' } });
    fireEvent.click(await pressSaveAndExpectTheDialog());

    await waitFor(() => expect(settings.deleteAppSetting).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('cancel in the dialog deletes and writes nothing, and the popup stays', async () => {
    settings.getAppSettingsBulk.mockResolvedValue({
      litellm_base_url: 'http://localhost:4000',
      litellm_master_key: 'sk-leaked',
    });
    const { onSaved, onClose } = renderPopup(litellmFields(P));

    const key = await field(P.litellm_master_key_label);
    await waitFor(() => expect(key.value).toBe('sk-leaked'));
    fireEvent.change(key, { target: { value: '' } });

    const confirm = await pressSaveAndExpectTheDialog();
    // The popup has a Cancel of its own: this is the dialog's.
    const dialog = confirm.closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: en.common.cancel }));

    await waitFor(() => expect(removeKeyButton()).toBeNull());
    expect(settings.deleteAppSetting).not.toHaveBeenCalled();
    expect(settings.setAppSetting).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(P.litellm_master_key_label)).toBeTruthy();
    expect(saveButton()).toBeTruthy();
  });

  it('Ollama with nothing stored stays blank: Save is disabled', async () => {
    renderPopup(ollamaFields(P));
    await field(P.api_key_label);
    expect(saveButton().disabled).toBe(true);
    expect(settings.deleteAppSetting).not.toHaveBeenCalled();
  });

  it('LiteLLM with only a url stored and a blank key deletes nothing', async () => {
    settings.getAppSettingsBulk.mockResolvedValue({ litellm_base_url: 'http://localhost:4000' });
    const { onSaved } = renderPopup(litellmFields(P));

    const url = await field(P.litellm_base_url_label);
    await waitFor(() => expect(url.value).toBe('http://localhost:4000'));
    fireEvent.click(saveButton());

    expect(removeKeyButton()).toBeNull();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(settings.deleteAppSetting).not.toHaveBeenCalled();
  });

  it('a failed read deletes nothing: an unread key is never treated as cleared', async () => {
    settings.getAppSettingsBulk.mockRejectedValue(new Error('ipc down'));
    const { onSaved } = renderPopup(litellmFields(P));

    const url = await field(P.litellm_base_url_label);
    fireEvent.change(url, { target: { value: 'http://localhost:4000' } });
    fireEvent.click(saveButton());

    expect(removeKeyButton()).toBeNull();
    await waitFor(() => expect(settings.setAppSetting).toHaveBeenCalledWith('litellm_base_url', 'http://localhost:4000'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(settings.deleteAppSetting).not.toHaveBeenCalled();
  });
});
