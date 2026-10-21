import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      agents: {
        persona_list: new Proxy({}, { get: (_t, key) => `list.${String(key)}` }),
        status: new Proxy({}, { get: (_t, key) => `status.${String(key)}` }),
      },
    },
  }),
}));

import { HEALTH_STYLES, StatusBadge } from '../PersonaOverviewBadges';

const health = (status: string) => ({ status }) as never;

describe('StatusBadge health', () => {
  it('does not badge a persona that has never run as healthy', () => {
    render(<StatusBadge enabled isDraft={false} health={health('dormant')} />);
    expect(screen.queryByText('status.healthy')).toBeNull();
    expect(screen.getByText('status.dormant')).toBeTruthy();
  });

  it('keeps healthy personas badged healthy', () => {
    render(<StatusBadge enabled isDraft={false} health={health('healthy')} />);
    expect(screen.getByText('status.healthy')).toBeTruthy();
  });

  it('knows every status the backend emits', () => {
    for (const s of ['healthy', 'degraded', 'failing', 'dormant']) expect(HEALTH_STYLES[s]).toBeTruthy();
  });
});
