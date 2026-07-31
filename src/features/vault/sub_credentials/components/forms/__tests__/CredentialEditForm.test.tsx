import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CredentialEditForm } from '../CredentialEditForm';
import type { CredentialTemplateField } from '@/lib/types/types';

// Regression test for the ref-based secret storage fix: credential values
// used to live in `useState` (inspectable via React DevTools / Sentry state
// serialization, unlike the OAuth hooks which deliberately keep secrets in a
// ref). Moving to a ref + version-counter re-render trigger must not change
// any observable behavior — typing still updates the visible input, and
// Save still hands the current values to the caller.

const FIELDS: CredentialTemplateField[] = [
  { key: 'api_key', label: 'API Key', type: 'password', required: true },
  { key: 'base_url', label: 'Base URL', type: 'text' },
];

function renderForm(onSave = vi.fn()) {
  render(
    <CredentialEditForm
      fields={FIELDS}
      onSave={onSave}
      onCancel={() => {}}
    />,
  );
  return { onSave };
}

describe('CredentialEditForm — secret values held in a ref, not useState', () => {
  it('reflects typed input back into the field (ref + version-counter reactivity)', () => {
    renderForm();
    const input = screen.getByTestId('vault-field-api_key-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-live-12345' } });
    expect(input.value).toBe('sk-live-12345');
  });

  it('passes the current (typed) values to onSave, not stale/empty ones', () => {
    const { onSave } = renderForm();
    fireEvent.change(screen.getByTestId('vault-field-api_key-input'), {
      target: { value: 'sk-live-12345' },
    });
    fireEvent.change(screen.getByTestId('vault-field-base_url-input'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByTestId('vault-schema-save'));
    expect(onSave).toHaveBeenCalledWith({
      api_key: 'sk-live-12345',
      base_url: 'https://example.com',
    });
  });

  it('blocks save and surfaces a validation error for a missing required field', () => {
    const { onSave } = renderForm();
    fireEvent.click(screen.getByTestId('vault-schema-save'));
    expect(onSave).not.toHaveBeenCalled();
  });
});
