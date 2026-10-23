import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// invokeWithTimeout rejects with a serialized AppError OBJECT, never an Error.
const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  download: vi.fn(),
}));

vi.mock('@/api/companion', () => ({
  STT_DOWNLOAD_EVENT: 'stt-download',
  STT_INSTALL_EVENT: 'stt-install',
  companionSttInstallEngine: vi.fn(),
  companionSttDeleteModel: vi.fn(),
  companionSttDownloadModel: apiMocks.download,
  companionSttEngineStatus: vi.fn(() => Promise.resolve(null)),
  companionSttListModels: apiMocks.list,
}));

vi.mock('../SttCompareModal', () => ({ SttCompareModal: () => null }));
vi.mock('../GlobalHotkeyCard', () => ({ GlobalHotkeyCard: () => null }));
vi.mock('../voiceEngineShared', () => ({ VoiceEngineInstallBlock: () => null }));

import SttPanel from '../SttPanel';
import { useSystemStore } from '@/stores/systemStore';

// The model browser is a collapsed SectionCard; open it by its title.
function openModels() {
  fireEvent.click(screen.getByText('Models'));
}

describe('SttPanel IPC error rendering', () => {
  beforeEach(() => {
    apiMocks.list.mockReset();
    apiMocks.download.mockReset();
    useSystemStore.setState({ athenaSttEngine: 'whisper' } as never);
  });

  it('shows the AppError reason when the model list rejects with an object', async () => {
    apiMocks.list.mockRejectedValue({ error: 'usage limit reached', kind: 'validation' });
    render(<SttPanel />);
    openModels();
    await waitFor(() => expect(screen.getByText('usage limit reached')).toBeTruthy());
    expect(screen.queryByText('[object Object]')).toBeNull();
  });

  it('shows the AppError reason on a failed model download row', async () => {
    apiMocks.list.mockResolvedValue([
      { modelId: 'tiny', isDownloaded: false, approxSizeMb: 75, description: 'tiny model' } as never,
    ]);
    apiMocks.download.mockRejectedValue({ error: 'disk full', kind: 'io' });
    const { container } = render(<SttPanel />);
    openModels();
    await waitFor(() => expect(container.querySelector('button svg.lucide-download')).toBeTruthy());
    fireEvent.click(container.querySelector('button svg.lucide-download')!.closest('button')!);
    await waitFor(() => expect(screen.getByText('disk full')).toBeTruthy());
    expect(screen.queryByText('[object Object]')).toBeNull();
  });
});
