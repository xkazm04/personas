import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// The shared setup mocks this module with `invoke` only; the attachments need
// the asset-protocol URL builder, so it is stubbed here with a recognisable shape.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

import { ReportAttachmentsSection } from '../ReportAttachments';

const SHOT_1 = 'C:\\Users\\kazda\\.personas\\reports\\r1\\01-shot.png';
const SHOT_2 = 'C:\\Users\\kazda\\.personas\\reports\\r1\\02-shot.webp';
const NOTES = 'C:\\Users\\kazda\\.personas\\reports\\r1\\notes.pdf';

const meta = (over: Record<string, unknown> = {}) => JSON.stringify({
  projectId: 'p1',
  source: 'headless-app-master',
  attachments: [
    { path: SHOT_1, caption: 'Council home' },
    { path: SHOT_2, caption: 'Module review' },
    { path: NOTES, caption: 'Findings' },
  ],
  attachmentsCleaned: false,
  ...over,
});

describe('ReportAttachmentsSection - from metadata', () => {
  it('renders image attachments as thumbnails through the asset protocol, with captions', () => {
    render(<ReportAttachmentsSection metadata={meta()} />);

    const tiles = screen.getAllByTestId('report-attachment-image');
    expect(tiles).toHaveLength(2);
    const img = within(tiles[0]!).getByRole('img', { name: 'Council home' });
    expect(img).toHaveAttribute('src', `asset://localhost/${encodeURIComponent(SHOT_1)}`);
    expect(within(tiles[0]!).getByText('Council home')).toBeInTheDocument();
    expect(within(tiles[1]!).getByRole('img', { name: 'Module review' })).toBeInTheDocument();
  });

  it('renders a non-image attachment as a file chip with its caption, not an image', () => {
    render(<ReportAttachmentsSection metadata={meta()} />);

    const chip = screen.getByTestId('report-attachment-file');
    expect(chip).toHaveTextContent('notes.pdf');
    expect(chip).toHaveTextContent('Findings');
    expect(within(chip).queryByRole('img')).toBeNull();
    expect(screen.getAllByTestId('report-attachment-image')).toHaveLength(2);
  });

  it('opens the larger view from a thumbnail and closes it again', () => {
    render(<ReportAttachmentsSection metadata={meta()} />);
    expect(screen.queryByTestId('report-attachment-lightbox')).toBeNull();

    fireEvent.click(screen.getAllByTestId('report-attachment-open')[0]!);
    const box = screen.getByTestId('report-attachment-lightbox');
    expect(within(box).getByRole('img', { name: 'Council home' })).toHaveAttribute(
      'src',
      `asset://localhost/${encodeURIComponent(SHOT_1)}`,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('report-attachment-lightbox')).toBeNull();
  });

  it('swaps an image that fails to load for a quiet placeholder, never a broken image', () => {
    render(<ReportAttachmentsSection metadata={meta()} />);
    const tile = screen.getAllByTestId('report-attachment-image')[0]!;

    fireEvent.error(within(tile).getByRole('img', { name: 'Council home' }));

    expect(within(tile).getByTestId('report-attachment-missing')).toHaveTextContent('File no longer available');
    expect(within(tile).queryByRole('img', { name: 'Council home' })).toBeNull();
    expect(within(tile).queryByTestId('report-attachment-open')).toBeNull();
    // The sibling is untouched.
    expect(within(screen.getAllByTestId('report-attachment-image')[1]!).queryByTestId('report-attachment-missing')).toBeNull();
  });
});

describe('ReportAttachmentsSection - cleaned', () => {
  it('shows one muted line with the time instead of the images', () => {
    render(
      <ReportAttachmentsSection
        metadata={meta({ attachmentsCleaned: true, cleanedAt: '2026-10-07T09:30:00Z' })}
      />,
    );

    const line = screen.getByTestId('report-attachments-cleaned');
    expect(line).toHaveTextContent('Screenshots removed after the decision');
    // The time rides beside the sentence (separator + a rendered time), not inside the string.
    expect(line.textContent).toMatch(/Screenshots removed after the decision · \S+/);
    expect(screen.queryByTestId('report-attachment-image')).toBeNull();
    expect(screen.queryByTestId('report-attachment-file')).toBeNull();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('still shows the line when the backend recorded no cleanedAt', () => {
    render(<ReportAttachmentsSection metadata={meta({ attachmentsCleaned: true })} />);
    const line = screen.getByTestId('report-attachments-cleaned');
    expect(line).toHaveTextContent('Screenshots removed after the decision');
    expect(line.textContent).not.toContain('·');
  });

  it('shows the line for a cleaned report whose attachment list was dropped', () => {
    render(<ReportAttachmentsSection metadata={JSON.stringify({ attachmentsCleaned: true })} />);
    expect(screen.getByTestId('report-attachments-cleaned')).toBeInTheDocument();
  });
});

describe('ReportAttachmentsSection - absent or unusable metadata', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['not JSON', 'free text'],
    ['an object with no attachments', '{"projectId":"p1","source":"headless-app-master"}'],
    ['an empty attachment list', '{"attachments":[]}'],
  ])('renders nothing for %s', (_label, metadata) => {
    const { container } = render(<ReportAttachmentsSection metadata={metadata} />);
    expect(container).toBeEmptyDOMElement();
  });
});
