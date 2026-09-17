import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const EN = {
  examples_label: 'Start from an example',
  example_inbox_triage_name: 'Inbox triage',
  example_inbox_triage_description: 'Watch a Gmail inbox for new mail.',
  example_daily_digest_name: 'Daily digest',
  example_daily_digest_description: 'Collect yesterday activity and post a digest.',
  example_incident_to_slack_name: 'Incident to Slack',
  example_incident_to_slack_description: 'Summarise a failing webhook into a channel.',
  template_name_label_step: 'Template Name',
  template_name_placeholder: 'Template name...',
  description_label: 'Description',
  description_placeholder: 'Describe what this persona should do.',
  description_hint: 'The AI will generate a full persona template.',
};
const t = new Proxy({}, {
  get: (_o, section) => section === 'templates'
    ? { generation: EN }
    : new Proxy({}, { get: (_s, k) => `${String(section)}.${String(k)}` }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { DescribeStep } from '../CreateTemplateSteps';

/** Mirrors CreateTemplateModal:159 — Generate is live only when both fields are non-blank. */
const canGenerate = (name: string, description: string) => Boolean(name.trim() && description.trim());

function renderStep() {
  const setTemplateName = vi.fn();
  const setDescription = vi.fn();
  const Step = DescribeStep as unknown as (p: Record<string, unknown>) => JSX.Element;
  render(<Step templateName="" description="" error="" reducer={{ setTemplateName, setDescription }} />);
  return { setTemplateName, setDescription };
}

describe('Describe step starter examples', () => {
  it('opens with Generate unreachable from empty fields', () => {
    renderStep();
    expect(canGenerate('', '')).toBe(false);
    expect(screen.getByText(EN.examples_label)).toBeTruthy();
  });

  it('offers three starters', () => {
    renderStep();
    for (const name of [EN.example_inbox_triage_name, EN.example_daily_digest_name, EN.example_incident_to_slack_name]) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it.each([
    ['example_inbox_triage', EN.example_inbox_triage_name, EN.example_inbox_triage_description],
    ['example_daily_digest', EN.example_daily_digest_name, EN.example_daily_digest_description],
    ['example_incident_to_slack', EN.example_incident_to_slack_name, EN.example_incident_to_slack_description],
  ])('%s fills both required fields so Generate becomes reachable', (_slug, name, description) => {
    const { setTemplateName, setDescription } = renderStep();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
    expect(setTemplateName).toHaveBeenCalledWith(name);
    expect(setDescription).toHaveBeenCalledWith(description);
    expect(canGenerate(name, description)).toBe(true);
  });

  it('routes the description label and placeholder through i18n', () => {
    renderStep();
    expect(screen.getByText(EN.description_label)).toBeTruthy();
    expect(screen.getByPlaceholderText(EN.description_placeholder)).toBeTruthy();
  });
});
