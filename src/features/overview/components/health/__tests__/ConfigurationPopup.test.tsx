import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The Ollama / LiteLLM key popups rendered each <label> beside its <input>
// with no htmlFor / id pair, so the API-key field had no accessible name: a
// screen reader announced "edit text, password" and clicking the label did
// not focus the field.

vi.mock('@/api/system/settings', () => ({
  getAppSettingsBulk: () => Promise.resolve({}),
  setAppSetting: () => Promise.resolve(),
}));

import { ConfigurationPopup } from '../ConfigurationPopup';
import { litellmFields } from '../popupFieldConfigs';
import { en } from '@/i18n/en';


describe('ConfigurationPopup', () => {
  it('names every field by its label', async () => {
    const LITELLM_FIELDS = litellmFields(en.overview.popup_fields);
    render(
      <ConfigurationPopup
        title="LiteLLM"
        subtitle="Proxy"
        accent="sky"
        fields={LITELLM_FIELDS}
        saveLabel="Save"
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    for (const field of LITELLM_FIELDS) {
      const input = await screen.findByLabelText(field.label);
      expect(input.getAttribute('type')).toBe(field.type);
    }
  });
});
