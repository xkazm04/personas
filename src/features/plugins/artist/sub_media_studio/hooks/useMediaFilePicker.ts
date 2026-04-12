import { useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { artistProbeMedia, type MediaProbeResult } from '@/api/artist/index';
import { VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from '../constants';

/**
 * File picker helpers — each opens the native dialog with type-appropriate
 * extension filters, then probes the selected file for metadata.
 */
export function useMediaFilePicker() {
  const pickVideo = useCallback(async (): Promise<MediaProbeResult | null> => {
    const result = await open({
      multiple: false,
      filters: [{ name: 'Video files', extensions: VIDEO_EXTENSIONS }],
    });
    if (!result) return null;
    const filePath = typeof result === 'string' ? result : result;
    return artistProbeMedia(filePath as string);
  }, []);

  const pickAudio = useCallback(async (): Promise<MediaProbeResult | null> => {
    const result = await open({
      multiple: false,
      filters: [{ name: 'Audio files', extensions: AUDIO_EXTENSIONS }],
    });
    if (!result) return null;
    const filePath = typeof result === 'string' ? result : result;
    return artistProbeMedia(filePath as string);
  }, []);

  const pickImage = useCallback(async (): Promise<MediaProbeResult | null> => {
    const result = await open({
      multiple: false,
      filters: [{ name: 'Image files', extensions: IMAGE_EXTENSIONS }],
    });
    if (!result) return null;
    const filePath = typeof result === 'string' ? result : result;
    return artistProbeMedia(filePath as string);
  }, []);

  return { pickVideo, pickAudio, pickImage };
}
