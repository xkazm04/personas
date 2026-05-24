import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';

export function downloadStringAsFile(filename: string, content: string, mimeType = 'text/markdown'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** @deprecated use `copyText` from @/hooks/utility/interaction/useCopyToClipboard directly. */
export const copyToClipboard = copyText;
