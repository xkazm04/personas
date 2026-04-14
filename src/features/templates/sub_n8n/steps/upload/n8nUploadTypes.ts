import { FileCode2, FileJson } from 'lucide-react';

// Keep in sync with backend: n8n_sessions.rs MAX_WORKFLOW_JSON_BYTES
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_PASTE_LENGTH = 5 * 1024 * 1024; // 5MB text

export type ImportMode = 'file' | 'paste' | 'url';

export type FilePreview =
  | { kind: 'valid'; fileName: string; fileSize: string; workflowName: string; nodeCount: number; platform?: string }
  | { kind: 'error'; fileName: string; message: string };

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileIcon(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return FileCode2;
  }
  return FileJson;
}

/** Derive a filename hint from a URL for parseWorkflowFile extension detection. */
export function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const lastSegment = path.split('/').filter(Boolean).pop() || '';
    if (/\.(json|ya?ml)$/i.test(lastSegment)) return lastSegment;
  } catch { /* intentional: non-critical -- JSON parse fallback */ }
  return 'imported.json';
}

/** Resolve share/gist URLs to raw content URLs. */
export function resolveRawUrl(url: string): string {
  // GitHub Gist: gist.github.com/<user>/<id> -> raw
  const gistMatch = url.match(/^https?:\/\/gist\.github\.com\/[\w-]+\/([a-f0-9]+)/i);
  if (gistMatch) return `https://gist.githubusercontent.com/raw/${gistMatch[1]}`;

  // GitHub blob -> raw
  if (/github\.com\/.*\/blob\//.test(url)) {
    return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
  }

  return url;
}

export const URL_PATTERN = /^https?:\/\/.+/i;

/** Quick extraction of `name:` from YAML content without full parsing */
export function extractYamlName(content: string): string | null {
  // Supports both top-level and indented/nested `name:` fields.
  const topLevelMatch = content.match(/^\s*name\s*:\s*['"]?(.+?)['"]?\s*$/m);
  if (topLevelMatch?.[1]) return topLevelMatch[1];

  // Common nested form in workflow metadata blocks.
  const metadataBlock = content.match(/^[ \t]*metadata\s*:\s*([\s\S]*?)(?:^\S|$)/m)?.[1] ?? '';
  const metadataName = metadataBlock.match(/^[ \t]+name\s*:\s*['"]?(.+?)['"]?\s*$/m);
  return metadataName?.[1] ?? null;
}
