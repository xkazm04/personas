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
import { LITELLM_FIELDS } from '../popupFieldConfigs';

describe('ConfigurationPopup', () => {
  it('names every field by its label', async () => {
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
