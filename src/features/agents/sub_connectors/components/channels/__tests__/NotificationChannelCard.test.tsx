import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { NotificationChannelCard } from '../NotificationChannelCard';
import { channelTypes } from '../ChannelList';

vi.mock('@/api/agents/channelDelivery', () => ({
  testNotificationChannel: vi.fn().mockResolvedValue('ok'),
}));

function renderCard(type: 'slack' | 'telegram' | 'email') {
  const def = channelTypes.find((c) => c.type === type)!;
  return render(
    <NotificationChannelCard
      type={type}
      enabled
      config={{}}
      configFields={def.configFields}
      matchingCredentials={[]}
      hasValidationErrors={false}
      onToggleEnabled={() => {}}
      onRemove={() => {}}
      onConfigChange={() => {}}
      onCredentialChange={() => {}}
    />,
  );
}

function inputFor(container: HTMLElement, placeholder: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!el) throw new Error(`no input with placeholder ${placeholder}`);
  return el;
}

/**
 * The vault's own form masks these three fields (`builtin_connectors.rs`
 * declares them `"type":"password","sensitive":true`); this card used to
 * render every field as plain text. A secret must be masked and kept away
 * from browser autofill; a destination (channel, chat id, address) must not
 * be, or the user cannot read what they typed. The default is MASKED: a
 * field added to the catalog without a `public` verdict fails towards
 * over-masking, never towards disclosure (credential-capture-form golden path).
 */
describe('NotificationChannelCard secret fields', () => {
  it('masks the Telegram bot token but not the chat id', () => {
    const { container } = renderCard('telegram');
    const token = inputFor(container, '123456:ABC-DEF...');
    expect(token.type).toBe('password');
    expect(token.getAttribute('autocomplete')).toBe('off');
    expect(inputFor(container, '123456789').type).toBe('text');
  });

  it('masks the Slack webhook URL (the URL is the secret) but not the channel', () => {
    const { container } = renderCard('slack');
    expect(inputFor(container, 'e.g. https://hooks.slack.com/services/T00.../B00.../xxxx').type).toBe('password');
    expect(inputFor(container, '#general').type).toBe('text');
  });

  it('masks the SendGrid API key but not the addresses', () => {
    const { container } = renderCard('email');
    expect(inputFor(container, 'SG.xxxx').type).toBe('password');
    expect(inputFor(container, 'user@example.com').type).toBe('text');
  });

  it('no secret-shaped field in the channel catalog is declared public', () => {
    const secretKeys = channelTypes.flatMap((c) => c.configFields)
      .filter((f) => /token|key|webhook_url|secret|password/i.test(f.key))
      .map((f) => [f.key, f.public === true]);
    expect(secretKeys).toEqual(secretKeys.map(([k]) => [k, false]));
  });

  it('a field with no verdict masks (fail-secure default)', () => {
    const { container } = render(
      <NotificationChannelCard
        type="slack" enabled config={{}}
        configFields={[{ key: 'mystery', labelKey: 'ch_field_bot_token', placeholder: 'm' }]}
        matchingCredentials={[]} hasValidationErrors={false}
        onToggleEnabled={() => {}} onRemove={() => {}} onConfigChange={() => {}} onCredentialChange={() => {}}
      />,
    );
    expect(inputFor(container, 'm').type).toBe('password');
  });
});
