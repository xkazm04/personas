/**
 * The upload path used to hand the user English no matter the language: preview errors,
 * default workflow names, the element count, the session status words and the stepper's
 * screen-reader line were literals. The catalog is mocked here with each leaf replaced by
 * its own key path, so a literal fails the assertion and a catalog lookup passes it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import enJson from '@/i18n/locales/en.json';
import { useFileUpload } from '../useFileUpload';
import { usePasteImport } from '../usePasteImport';
import { useUrlImport } from '../useUrlImport';
import { PreviewCard } from '../PreviewCard';
import { MAX_FILE_SIZE, formatFileSize } from '../n8nUploadTypes';
import { N8nStepIndicator } from '../../../widgets/N8nStepIndicator';
import { SESSION_STATUS_STYLES } from '../../../colorTokens';

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const mark = (node: unknown, path: string): unknown =>
    typeof node === 'string'
      ? path
      : Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, mark(v, path ? `${path}.${k}` : k)]));
  const t = mark(en, '');
  const tx = (s: string, p?: Record<string, unknown>) => `${s}${p ? JSON.stringify(p) : ''}`;
  return { useTranslation: () => ({ t, tx }) };
});

const N = 'templates.n8n.';

function pick(file: File) {
  return { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
}

describe('upload previews speak through the catalog', () => {
  it('an unsupported file type', () => {
    const { result } = renderHook(() => useFileUpload());
    act(() => result.current.handleFileInputChange(pick(new File(['x'], 'notes.txt'))));
    expect(result.current.preview).toMatchObject({ kind: 'error', message: `${N}import_err_unsupported_type` });
  });

  it('an oversized file names the generated limit, not a literal 5 MB', () => {
    const { result } = renderHook(() => useFileUpload());
    const big = new File(['x'], 'big.json');
    Object.defineProperty(big, 'size', { value: MAX_FILE_SIZE + 1 });
    act(() => result.current.handleFileInputChange(pick(big)));
    const message = (result.current.preview as { message: string }).message;
    expect(message).toContain(`${N}import_err_file_too_large`);
    expect(message).toContain(formatFileSize(MAX_FILE_SIZE));
  });

  it('pasted text that is not JSON', () => {
    const { result } = renderHook(() => usePasteImport());
    act(() => result.current.validatePastedContent('not json'));
    expect(result.current.pastePreview).toMatchObject({ kind: 'error' });
    expect((result.current.pastePreview as { message: string }).message).toBe(`${N}import_err_invalid_json_paste`);
  });

  it('a URL that is not http(s)', async () => {
    const { result } = renderHook(() => useUrlImport(undefined, { current: true }));
    act(() => result.current.setUrlValue('ftp://example.com/a.json'));
    await act(async () => { await result.current.handleUrlFetch(); });
    expect(result.current.urlPreview).toMatchObject({ kind: 'error', message: `${N}import_err_url_invalid` });
  });
});

describe('upload chrome speaks through the catalog', () => {
  it('the element count on a valid preview is a plural catalog entry', () => {
    const preview = { kind: 'valid', fileName: 'a.json', fileSize: '1 KB', workflowName: 'W', nodeCount: 3 } as const;
    const { container } = render(<PreviewCard preview={preview} FileIcon={() => null} />);
    expect(container.textContent).toContain(`${N}preview_elements_other`);
  });

  it('the stepper screen-reader line is a catalog template', () => {
    const { container } = render(<N8nStepIndicator currentStep="upload" />);
    expect(container.querySelector('.sr-only')?.textContent).toContain(`${N}step_sr_label`);
  });

  it('every session status badge resolves to a catalog entry', () => {
    const n8n = (enJson as unknown as { templates: { n8n: Record<string, unknown> } }).templates.n8n;
    for (const style of Object.values(SESSION_STATUS_STYLES)) {
      expect(typeof n8n[style.labelKey]).toBe('string');
    }
  });
});
