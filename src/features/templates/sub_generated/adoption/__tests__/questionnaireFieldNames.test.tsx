import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

// DW-248. A field that sets only a placeholder announces the template default or
// a generic hint, not the question. The real QuestionCard and credential modal
// are mounted; only the connector catalog is narrowed to one inline connector.

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/useTranslation')>()),
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

vi.mock('@/lib/credentials/builtinConnectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/credentials/builtinConnectors')>()),
  connectorsInCategory: () => [
    {
      name: 'acme_api',
      label: 'Acme',
      fields: [{ key: 'api_key', label: 'API Key', type: 'password', required: true }],
      metadata: {},
    },
  ],
}));

import { QuestionCard } from '../QuestionnaireFormGridParts';
import { QuickAddCredentialModal } from '../QuickAddCredentialModal';

const QUESTION_TEXT = 'Which workspace should the digest post to?';
const DEFAULT_VALUE = 'general-channel';

const question = (fields: Record<string, unknown>) =>
  ({ id: 'q1', question: QUESTION_TEXT, category: 'configuration', ...fields }) as unknown as TransformQuestionResponse;

// A failed lookup falls back to a typed value so adoption is not fully blocked.
const FAILED_LOOKUP = {
  loading: false,
  ready: false,
  waitingOnParent: false,
  items: [],
  error: 'Could not load the list',
  errorKind: 'fetch_failed',
};
const DYNAMIC_SOURCE = { source: 'vault', service_type: 'slack', operation: 'list_channels' };

const FIELDS = [
  ['the single-line input', { type: 'text' }, undefined],
  ['the textarea', { type: 'textarea' }, undefined],
  ['the long_text textarea', { type: 'long_text' }, undefined],
  ['the fallback input of a failed lookup', { type: 'select', dynamic_source: DYNAMIC_SOURCE }, FAILED_LOOKUP],
] as const;

const MODES = [
  ['with its question chrome', false],
  ['in inputOnly mode', true],
] as const;

const renderField = (
  fields: Record<string, unknown>,
  dynamicState: unknown,
  inputOnly: boolean,
) =>
  render(
    <QuestionCard
      question={question(fields)}
      answer=""
      onAnswer={() => {}}
      dynamicState={dynamicState as never}
      onRetryDynamic={() => {}}
      inputOnly={inputOnly}
    />,
  );

afterEach(() => {
  cleanup();
});

describe.each(MODES)('questionnaire fields %s', (_mode, inputOnly) => {
  it.each(FIELDS)('%s is named by its question', (_name, fields, dynamicState) => {
    renderField(fields, dynamicState, inputOnly);

    expect(screen.getByRole('textbox', { name: QUESTION_TEXT })).toBeInTheDocument();
  });

  it.each(FIELDS)('%s does not announce the default as its name', (_name, fields, dynamicState) => {
    renderField({ ...fields, default: DEFAULT_VALUE }, dynamicState, inputOnly);

    expect(screen.queryByRole('textbox', { name: DEFAULT_VALUE })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: QUESTION_TEXT })).toBeInTheDocument();
  });
});

describe('quick-add credential form', () => {
  it('names the credential Name field', () => {
    render(
      <QuickAddCredentialModal category="messaging" onCredentialAdded={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText('Acme'));

    expect(screen.getByLabelText('Name')).toHaveValue('My Acme');
  });
});
