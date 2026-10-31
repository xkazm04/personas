import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import AppearanceBrightnessSettings from '../AppearanceBrightnessSettings';
import AppearanceTextSizeSettings from '../AppearanceTextSizeSettings';
import AppearanceDensitySettings from '../AppearanceDensitySettings';
import AppearanceTimezoneSettings from '../AppearanceTimezoneSettings';
import AppearanceLanguageSettings from '../AppearanceLanguageSettings';

/** Every sibling picker section opens with one hint paragraph in ONE treatment. */
function hintTreatment(ui: React.ReactElement): string | null {
  const { container, unmount } = render(ui);
  const hint = container.querySelector('p');
  const cls = hint ? hint.className : null;
  unmount();
  return cls;
}

describe('sibling picker sections share one hint treatment', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });

  it('five sections, one class string, none missing', () => {
    const treatments = [
      hintTreatment(<AppearanceBrightnessSettings />),
      hintTreatment(<AppearanceTextSizeSettings />),
      hintTreatment(<AppearanceDensitySettings />),
      hintTreatment(<AppearanceTimezoneSettings />),
      hintTreatment(<AppearanceLanguageSettings />),
    ];
    expect(new Set(treatments)).toEqual(new Set(['typo-caption']));
  });
});
