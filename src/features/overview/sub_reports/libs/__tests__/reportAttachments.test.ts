import { describe, it, expect } from 'vitest';
import { fileNameOf, isImagePath, parseReportAttachments } from '../reportAttachments';

const SHOT = 'C:\\Users\\kazda\\.personas\\reports\\r1\\01-shot.png';

describe('parseReportAttachments', () => {
  it('reads attachments, captions, kind and file name from the backend shape', () => {
    const view = parseReportAttachments(JSON.stringify({
      projectId: 'p1',
      source: 'headless-app-master',
      attachments: [
        { path: SHOT, caption: 'Dashboard after the change' },
        { path: 'C:\\Users\\kazda\\.personas\\reports\\r1\\notes.pdf' },
      ],
      attachmentsCleaned: false,
    }));
    expect(view.cleaned).toBe(false);
    expect(view.cleanedAt).toBeNull();
    expect(view.attachments).toEqual([
      { path: SHOT, name: '01-shot.png', caption: 'Dashboard after the change', kind: 'image' },
      { path: 'C:\\Users\\kazda\\.personas\\reports\\r1\\notes.pdf', name: 'notes.pdf', caption: null, kind: 'file' },
    ]);
  });

  it('reports the cleaned state and its time', () => {
    const view = parseReportAttachments(JSON.stringify({
      attachments: [{ path: SHOT }],
      attachmentsCleaned: true,
      cleanedAt: '2026-10-07T09:30:00Z',
    }));
    expect(view.cleaned).toBe(true);
    expect(view.cleanedAt).toBe('2026-10-07T09:30:00Z');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['not JSON', 'plain text note'],
    ['a JSON string', '"hello"'],
    ['a JSON number', '42'],
    ['JSON null', 'null'],
    ['an object without attachments', '{"projectId":"p1"}'],
    ['attachments that is not an array', '{"attachments":"nope"}'],
  ])('is safe on %s', (_label, metadata) => {
    expect(parseReportAttachments(metadata)).toEqual({ attachments: [], cleaned: false, cleanedAt: null });
  });

  it('drops entries without a usable path and keeps the rest', () => {
    const view = parseReportAttachments(JSON.stringify({
      attachments: [null, 7, {}, { path: '' }, { path: 12 }, { path: '   ' }, { path: SHOT, caption: 5 }],
    }));
    expect(view.attachments).toHaveLength(1);
    expect(view.attachments[0]?.caption).toBeNull();
  });

  it('treats only a literal true as cleaned', () => {
    expect(parseReportAttachments('{"attachmentsCleaned":"true"}').cleaned).toBe(false);
    expect(parseReportAttachments('{"attachmentsCleaned":1}').cleaned).toBe(false);
  });
});

describe('path helpers', () => {
  it('classifies images by extension, case-insensitively', () => {
    for (const ext of ['png', 'PNG', 'jpg', 'jpeg', 'webp', 'gif']) {
      expect(isImagePath(`a/b/shot.${ext}`)).toBe(true);
    }
    expect(isImagePath('shot.png.zip')).toBe(false);
    expect(isImagePath('report.pdf')).toBe(false);
  });

  it('takes the last segment on either separator', () => {
    expect(fileNameOf(SHOT)).toBe('01-shot.png');
    expect(fileNameOf('/home/u/.personas/reports/r1/02-shot.webp')).toBe('02-shot.webp');
    expect(fileNameOf('bare.gif')).toBe('bare.gif');
  });
});
