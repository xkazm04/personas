/**
 * The polling URL the engine fetches is the URL the operator sees.
 *
 * `buildTriggerConfig` writes `config.url` (the key the Rust poller reads);
 * `config.endpoint` is the earlier spelling the engine never read. Both
 * display surfaces used to render `endpoint` only, so every trigger created
 * since the rename looked destination-less on the list and in the detail.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TriggerStatusSummary } from '@/features/triggers/sub_triggers/TriggerStatusSummary';
import { ConfigSection } from '@/features/triggers/sub_triggers/TriggerConfigSection';
import { getPollingUrl, parseTriggerConfig } from '@/lib/utils/platform/triggerConstants';
import type { PersonaTrigger } from '@/lib/types/types';
import type { useTriggerDetail } from '@/features/triggers/hooks/useTriggerDetail';

const mk = (config: Record<string, unknown>): PersonaTrigger =>
  ({
    id: 't1',
    persona_id: 'p1',
    trigger_type: 'polling',
    config: JSON.stringify(config),
    enabled: true,
    created_at: 0,
    updated_at: 0,
  }) as unknown as PersonaTrigger;

// ConfigSection only reaches `detail` on the webhook branch; polling needs none.
const detail = {} as ReturnType<typeof useTriggerDetail>;

const polling = (config: Record<string, unknown>) => {
  const parsed = parseTriggerConfig('polling', JSON.stringify(config));
  if (parsed.type !== 'polling') throw new Error('expected polling config');
  return parsed;
};

describe('getPollingUrl', () => {
  it('prefers url, the key the poller reads', () => {
    expect(getPollingUrl(polling({ url: 'https://a.example.com', endpoint: 'https://b.example.com' })))
      .toBe('https://a.example.com');
  });

  it('falls back to the legacy endpoint spelling', () => {
    expect(getPollingUrl(polling({ endpoint: 'https://legacy.example.com' })))
      .toBe('https://legacy.example.com');
  });

  it('treats a blank value as absent', () => {
    expect(getPollingUrl(polling({ url: '   ' }))).toBeUndefined();
    expect(getPollingUrl(polling({}))).toBeUndefined();
  });
});

describe('polling URL on the display surfaces', () => {
  it('TriggerStatusSummary shows the hostname from url', () => {
    render(<TriggerStatusSummary trigger={mk({ url: 'https://api.example.com/feed', interval_seconds: 300 })} />);
    expect(screen.getByText(/api\.example\.com/)).toBeTruthy();
  });

  it('TriggerStatusSummary still shows the hostname from a legacy endpoint', () => {
    render(<TriggerStatusSummary trigger={mk({ endpoint: 'https://legacy.example.com/feed' })} />);
    expect(screen.getByText(/legacy\.example\.com/)).toBeTruthy();
  });

  it('ConfigSection shows the full url', () => {
    render(<ConfigSection trigger={mk({ url: 'https://api.example.com/feed' })} credentialEventsList={[]} detail={detail} />);
    expect(screen.getByText(/https:\/\/api\.example\.com\/feed/)).toBeTruthy();
  });

  it('ConfigSection still shows a legacy endpoint', () => {
    render(<ConfigSection trigger={mk({ endpoint: 'https://legacy.example.com/feed' })} credentialEventsList={[]} detail={detail} />);
    expect(screen.getByText(/https:\/\/legacy\.example\.com\/feed/)).toBeTruthy();
  });
});
