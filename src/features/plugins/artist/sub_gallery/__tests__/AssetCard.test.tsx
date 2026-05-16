import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ArtistAsset } from '@/api/artist';

// Mocks: image loader, system store, toast store. Stubbed before the
// component import below so the SUT picks them up.
vi.mock('../../hooks/useLocalImage', () => ({
  useLocalImage: () => 'data:image/png;base64,FAKE',
}));

const queueMediaStudioAsset = vi.fn();
const setArtistTab = vi.fn();
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ queueMediaStudioAsset, setArtistTab }),
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast }) },
}));

import AssetCard from '../AssetCard';

const ASSET: ArtistAsset = {
  id: 'asset-1',
  fileName: 'leonardo_2026-05-16_142312.png',
  filePath: '/test/artist/leonardo_2026-05-16_142312.png',
  assetType: '2d',
  mimeType: 'image/png',
  fileSize: 500_000,
  width: 1024,
  height: 1024,
  thumbnailPath: null,
  tags: 'portrait, cyberpunk',
  source: null,
  createdAt: '2026-05-16T14:23:12Z',
};

beforeEach(() => {
  queueMediaStudioAsset.mockReset();
  setArtistTab.mockReset();
  addToast.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AssetCard — render basics', () => {
  it('renders filename and tag chips', () => {
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
      />,
    );
    expect(screen.getByText('leonardo_2026-05-16_142312.png')).toBeInTheDocument();
    expect(screen.getByText('portrait')).toBeInTheDocument();
    expect(screen.getByText('cyberpunk')).toBeInTheDocument();
  });
});

describe('AssetCard — click behavior', () => {
  it('calls onClick when not in select mode', () => {
    const onClick = vi.fn();
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByText('leonardo_2026-05-16_142312.png').closest('.group')!);
    expect(onClick).toHaveBeenCalled();
  });

  it('calls onToggleSelect (not onClick) when in select mode', () => {
    const onClick = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        onClick={onClick}
        inSelectMode
        onToggleSelect={onToggleSelect}
      />,
    );
    fireEvent.click(screen.getByText('leonardo_2026-05-16_142312.png').closest('.group')!);
    expect(onClick).not.toHaveBeenCalled();
    expect(onToggleSelect).toHaveBeenCalledOnce();
  });

  it('shift+click on the card passes shiftKey through to onToggleSelect', () => {
    const onToggleSelect = vi.fn();
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        inSelectMode
        onToggleSelect={onToggleSelect}
      />,
    );
    fireEvent.click(screen.getByText('leonardo_2026-05-16_142312.png').closest('.group')!, {
      shiftKey: true,
    });
    expect(onToggleSelect).toHaveBeenCalledOnce();
    const event = onToggleSelect.mock.calls[0]?.[0];
    expect(event.shiftKey).toBe(true);
  });

  it('renders the selection checkbox when onToggleSelect is provided', () => {
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        onToggleSelect={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/select/i)).toBeInTheDocument();
  });

  it('renders the deselect label when selected=true', () => {
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        onToggleSelect={vi.fn()}
        selected
      />,
    );
    expect(screen.getByLabelText(/deselect/i)).toBeInTheDocument();
  });

  it('clicking the checkbox stops propagation (does not open lightbox)', () => {
    const onClick = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        onClick={onClick}
        onToggleSelect={onToggleSelect}
      />,
    );
    fireEvent.click(screen.getByLabelText(/select/i));
    expect(onToggleSelect).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('AssetCard — inline rename', () => {
  it('switches the filename to an input on double-click and pre-selects the basename', () => {
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        onRename={vi.fn()}
      />,
    );
    fireEvent.doubleClick(screen.getByText('leonardo_2026-05-16_142312.png'));
    const input = screen.getByLabelText(/rename/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('leonardo_2026-05-16_142312.png');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('leonardo_2026-05-16_142312'.length);
  });

  it('does not enable double-click rename when onRename is omitted', () => {
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
      />,
    );
    fireEvent.doubleClick(screen.getByText('leonardo_2026-05-16_142312.png'));
    expect(screen.queryByLabelText(/rename/i)).toBeNull();
  });

  it('does not enter rename mode while in select mode (double-click toggles selection instead)', () => {
    const onToggleSelect = vi.fn();
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        onRename={vi.fn()}
        inSelectMode
        onToggleSelect={onToggleSelect}
      />,
    );
    fireEvent.doubleClick(screen.getByText('leonardo_2026-05-16_142312.png'));
    expect(screen.queryByLabelText(/rename/i)).toBeNull();
  });

  it('Enter commits the rename via onRename(id, trimmed)', () => {
    const onRename = vi.fn();
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        onRename={onRename}
      />,
    );
    fireEvent.doubleClick(screen.getByText('leonardo_2026-05-16_142312.png'));
    const input = screen.getByLabelText(/rename/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'forest-keyframe.png' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('asset-1', 'forest-keyframe.png');
  });

  it('Escape cancels the rename without calling onRename', () => {
    const onRename = vi.fn();
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        onRename={onRename}
      />,
    );
    fireEvent.doubleClick(screen.getByText('leonardo_2026-05-16_142312.png'));
    const input = screen.getByLabelText(/rename/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'something-else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('skips onRename when the trimmed name equals the existing fileName', () => {
    const onRename = vi.fn();
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
        onRename={onRename}
      />,
    );
    fireEvent.doubleClick(screen.getByText('leonardo_2026-05-16_142312.png'));
    const input = screen.getByLabelText(/rename/i) as HTMLInputElement;
    // No change to the value — blur commits but should not fire onRename.
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe('AssetCard — send-to-media-studio', () => {
  it('queues the asset and switches tabs (image assets only)', async () => {
    render(
      <AssetCard
        asset={ASSET}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle(/send to media studio/i));
    await waitFor(() => expect(queueMediaStudioAsset).toHaveBeenCalledOnce());
    expect(queueMediaStudioAsset).toHaveBeenCalledWith({
      id: 'asset-1',
      filePath: ASSET.filePath,
      fileName: ASSET.fileName,
    });
    expect(setArtistTab).toHaveBeenCalledWith('media-studio');
    expect(addToast).toHaveBeenCalled();
  });

  it('does not render the send-to-media-studio button for 3D assets', () => {
    render(
      <AssetCard
        asset={{ ...ASSET, assetType: '3d', fileName: 'model.glb' }}
        onDelete={vi.fn()}
        onUpdateTags={vi.fn()}
      />,
    );
    expect(screen.queryByTitle(/send to media studio/i)).toBeNull();
  });
});
