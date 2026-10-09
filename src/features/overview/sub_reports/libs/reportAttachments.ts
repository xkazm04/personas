/**
 * Report attachments - the screenshots a headless App Master posts with a report.
 *
 * The backend writes them into `persona_reports.metadata`, a JSON string on the
 * row the Reports list already loads:
 *
 *   { "projectId": "...", "source": "headless-app-master",
 *     "attachments": [{ "path": "C:\\Users\\...\\.personas\\reports\\<id>\\01-shot.png", "caption": "..." }],
 *     "attachmentsCleaned": false, "cleanedAt": "<iso>" }
 *
 * `cleanedAt` appears only after the files were deleted (the operator decided
 * the linked approval). Any key may be absent on an old report, and `metadata`
 * on most reports is null or not this shape at all, so every read here is
 * defensive: the answer to "no usable attachment data" is an empty view, never
 * a throw.
 */

export type AttachmentKind = 'image' | 'file';

export interface ReportAttachment {
  /** Absolute path on this machine, exactly as the backend wrote it. */
  path: string;
  /** File name only, for chips and alt text. */
  name: string;
  caption: string | null;
  kind: AttachmentKind;
}

export interface ReportAttachmentsView {
  attachments: ReportAttachment[];
  /** True once the files were removed after the decision. */
  cleaned: boolean;
  /** ISO time the files were removed, when the backend recorded it. */
  cleanedAt: string | null;
}

const EMPTY_VIEW: ReportAttachmentsView = { attachments: [], cleaned: false, cleanedAt: null };

const IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path);
}

/** The last path segment, on either separator (the backend writes Windows paths). */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function readAttachment(raw: unknown): ReportAttachment | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as { path?: unknown; caption?: unknown };
  if (typeof entry.path !== 'string' || entry.path.trim() === '') return null;
  const caption = typeof entry.caption === 'string' && entry.caption.trim() !== '' ? entry.caption : null;
  return {
    path: entry.path,
    name: fileNameOf(entry.path),
    caption,
    kind: isImagePath(entry.path) ? 'image' : 'file',
  };
}

/**
 * Read the attachment view out of a report's `metadata` string. Malformed JSON,
 * a non-object payload, a non-array `attachments` and entries without a path all
 * degrade to "none" - an old or foreign report must still open.
 */
export function parseReportAttachments(metadata: string | null | undefined): ReportAttachmentsView {
  if (!metadata) return EMPTY_VIEW;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    // Most reports carry no JSON metadata at all; "not parseable" is the normal case.
    return EMPTY_VIEW;
  }
  if (!parsed || typeof parsed !== 'object') return EMPTY_VIEW;
  // JSON.parse output: the typeof guard above is the invariant; every field is
  // re-checked below before use.
  const meta = parsed as { attachments?: unknown; attachmentsCleaned?: unknown; cleanedAt?: unknown };
  const attachments = Array.isArray(meta.attachments)
    ? meta.attachments.map(readAttachment).filter((a): a is ReportAttachment => a !== null)
    : [];
  return {
    attachments,
    cleaned: meta.attachmentsCleaned === true,
    cleanedAt: typeof meta.cleanedAt === 'string' && meta.cleanedAt !== '' ? meta.cleanedAt : null,
  };
}
