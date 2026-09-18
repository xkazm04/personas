import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { deriveDraftCompleteness } from '../draftCompleteness';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, { get: (_s, sub) => leaf(`${String(section)}.${String(sub)}`) }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (sel: (s: unknown) => unknown) =>
    sel({
      credentials: [],
      connectorDefinitions: [],
      fetchCredentials: vi.fn(async () => {}),
      fetchConnectorDefinitions: vi.fn(async () => {}),
    }),
}));

import { DraftEditStep } from '../DraftEditStep';

const draft = (over: Partial<N8nPersonaDraft> = {}): N8nPersonaDraft => ({
  name: null,
  description: null,
  system_prompt: '',
  structured_prompt: null,
  icon: null,
  color: null,
  model_profile: null,
  max_budget_usd: null,
  max_turns: null,
  design_context: null,
  ...over,
});

function renderStep(d: N8nPersonaDraft) {
  const onCompletenessChange = vi.fn();
  const Step = DraftEditStep as unknown as (p: Record<string, unknown>) => JSX.Element;
  render(
    <Step
      draft={d}
      draftJson="{}"
      draftJsonError={null}
      adjustmentRequest=""
      transforming={false}
      disabled={false}
      updateDraft={vi.fn()}
      onDraftUpdated={vi.fn()}
      onJsonEdited={vi.fn()}
      onAdjustmentChange={vi.fn()}
      onApplyAdjustment={vi.fn()}
      onCompletenessChange={onCompletenessChange}
    />,
  );
  return { onCompletenessChange };
}

describe('draft completeness derivation', () => {
  it('blocks an empty draft on both requirements', () => {
    const c = deriveDraftCompleteness(draft());
    expect(c.missing).toEqual(['name', 'identity']);
    expect(c.complete).toBe(false);
  });

  it('still blocks on a whitespace-only name', () => {
    expect(deriveDraftCompleteness(draft({ name: '   ' })).missing).toContain('name');
  });

  it('accepts a raw system prompt as the identity requirement', () => {
    const c = deriveDraftCompleteness(draft({ name: 'Digest', system_prompt: 'You post digests.' }));
    expect(c.missing).toEqual([]);
    expect(c.complete).toBe(true);
  });

  it('accepts a structured identity section', () => {
    const c = deriveDraftCompleteness(
      draft({ name: 'Digest', structured_prompt: { identity: 'A digest writer.' } }),
    );
    expect(c.complete).toBe(true);
  });

  it('treats an empty structured prompt as no identity', () => {
    const c = deriveDraftCompleteness(draft({ name: 'Digest', structured_prompt: { identity: '  ' } }));
    expect(c.missing).toEqual(['identity']);
  });

  it('treats a null draft as wholly incomplete rather than throwing', () => {
    expect(deriveDraftCompleteness(null).complete).toBe(false);
  });
});

describe('draft completeness in the editor', () => {
  it('names each missing requirement and reports them up', () => {
    const { onCompletenessChange } = renderStep(draft());
    expect(screen.getByTestId('draft-completeness-checklist')).toBeTruthy();
    expect(screen.getByTestId('draft-missing-name')).toBeTruthy();
    expect(screen.getByTestId('draft-missing-identity')).toBeTruthy();
    expect(onCompletenessChange).toHaveBeenCalledWith(['name', 'identity']);
  });

  it('shows no checklist and reports nothing missing once both are filled', () => {
    const { onCompletenessChange } = renderStep(
      draft({ name: 'Digest', system_prompt: 'You post digests.' }),
    );
    expect(screen.queryByTestId('draft-completeness-checklist')).toBeNull();
    expect(onCompletenessChange).toHaveBeenCalledWith([]);
  });
});
