import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Video, Music, ImagePlus, Type, Upload, Film } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useFfmpegDetect } from './hooks/useFfmpegDetect';
import { useMediaStudio } from './hooks/useMediaStudio';
import { useTimelinePlayback } from './hooks/useTimelinePlayback';
import { useMediaFilePicker } from './hooks/useMediaFilePicker';
import { useTimelineKeyboard } from './hooks/useTimelineKeyboard';
import { artistProbeMedia } from '@/api/artist/index';
import { VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from './constants';
import type { VideoClip, AudioClip, TextItem, ImageItem } from './types';
import FfmpegStatusBanner from './FfmpegStatusBanner';
import CompositionPreview from './CompositionPreview';
import InspectorPanel from './InspectorPanel';
import TimelinePanel from './TimelinePanel';
import PlaybackControls from './PlaybackControls';
import ExportPanel from './ExportPanel';

export default function MediaStudioPage() {
  const { t } = useTranslation();
  const { status: ffmpegStatus, checking: ffmpegChecking, recheck: ffmpegRecheck } = useFfmpegDetect();
  const {
    composition,
    updateComposition,
    addItem,
    updateItem,
    removeItem,
    duplicateItem,
    splitItemAt,
    selectedItemId,
    setSelectedItemId,
    selectedItem,
    textItems,
    imageItems,
    videoItems,
    audioItems,
    totalDuration,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useMediaStudio();

  const { engine, playing, looping, play, pause, stop, seek, toggleLoop } =
    useTimelinePlayback(totalDuration);
  const { pickVideo, pickAudio, pickImage } = useMediaFilePicker();

  useTimelineKeyboard({
    engine,
    play,
    pause,
    seek,
    totalDuration,
    selectedItemId,
    removeItem,
    duplicateItem,
    deselectItem: () => setSelectedItemId(null),
    undo,
    redo,
  });

  // -- Gallery → Media Studio handoff -----------------------------------------
  //
  // When the user clicks "Send to Media Studio" on a gallery AssetCard, the
  // asset lands in the `pendingMediaStudioAssets` queue on the artist slice.
  // Drain the queue on mount (and whenever it grows while we're already
  // mounted) and add each asset as a ~5s ImageItem on the timeline.
  const pendingAssets = useSystemStore((s) => s.pendingMediaStudioAssets);
  const consumeMediaStudioAssets = useSystemStore((s) => s.consumeMediaStudioAssets);
  const imageItemsRef = useRef(imageItems);
  imageItemsRef.current = imageItems;

  useEffect(() => {
    if (pendingAssets.length === 0) return;
    const queue = consumeMediaStudioAssets();
    let cursor = imageItemsRef.current.reduce(
      (end, c) => Math.max(end, c.startTime + c.duration),
      0,
    );
    (async () => {
      for (const asset of queue) {
        let width: number | null = null;
        let height: number | null = null;
        try {
          const probe = await artistProbeMedia(asset.filePath);
          width = probe.width;
          height = probe.height;
        } catch {
          // Non-critical — dimensions fall back to null and the preview will
          // letterbox the image to its natural size.
        }
        const clip: ImageItem = {
          id: crypto.randomUUID(),
          type: 'image',
          label: asset.fileName,
          startTime: cursor,
          duration: 5,
          filePath: asset.filePath,
          width,
          height,
          scale: 1,
          positionX: 0.5,
          positionY: 0.5,
        };
        addItem(clip);
        cursor += 5;
      }
    })();
  }, [pendingAssets, consumeMediaStudioAssets, addItem]);

  // -- Drag-and-drop import ---------------------------------------------------

  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        const filePath = (file as unknown as { path?: string }).path;
        if (!filePath) continue;

        try {
          const probe = await artistProbeMedia(filePath);
          const label = file.name;

          if (VIDEO_EXTENSIONS.includes(ext)) {
            addItem({
              id: crypto.randomUUID(),
              type: 'video',
              label,
              startTime: videoItems.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0),
              duration: probe.duration,
              filePath,
              trimStart: 0,
              trimEnd: 0,
              mediaDuration: probe.duration,
              width: probe.width,
              height: probe.height,
              transition: 'cut',
              transitionDuration: 0,
            });
          } else if (AUDIO_EXTENSIONS.includes(ext)) {
            addItem({
              id: crypto.randomUUID(),
              type: 'audio',
              label,
              startTime: audioItems.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0),
              duration: probe.duration,
              filePath,
              trimStart: 0,
              trimEnd: 0,
              mediaDuration: probe.duration,
              volume: 1,
            });
          } else if (IMAGE_EXTENSIONS.includes(ext)) {
            addItem({
              id: crypto.randomUUID(),
              type: 'image',
              label,
              startTime: imageItems.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0),
              duration: 5,
              filePath,
              width: probe.width,
              height: probe.height,
              scale: 1,
              positionX: 0.5,
              positionY: 0.5,
            });
          }
        } catch {
          // Silently skip unsupported files
        }
      }
    },
    [addItem, videoItems, audioItems, imageItems],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  // -- Import handlers --------------------------------------------------------

  const handleAddVideo = useCallback(async () => {
    const probe = await pickVideo();
    if (!probe) return;
    const fileName = probe.filePath.split(/[/\\]/).pop() ?? 'clip';
    const clip: VideoClip = {
      id: crypto.randomUUID(),
      type: 'video',
      label: fileName,
      startTime: videoItems.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0),
      duration: probe.duration,
      filePath: probe.filePath,
      trimStart: 0,
      trimEnd: 0,
      mediaDuration: probe.duration,
      width: probe.width,
      height: probe.height,
      transition: 'cut',
      transitionDuration: 0,
    };
    addItem(clip);
  }, [pickVideo, videoItems, addItem]);

  const handleAddAudio = useCallback(async () => {
    const probe = await pickAudio();
    if (!probe) return;
    const fileName = probe.filePath.split(/[/\\]/).pop() ?? 'audio';
    const clip: AudioClip = {
      id: crypto.randomUUID(),
      type: 'audio',
      label: fileName,
      startTime: audioItems.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0),
      duration: probe.duration,
      filePath: probe.filePath,
      trimStart: 0,
      trimEnd: 0,
      mediaDuration: probe.duration,
      volume: 1,
    };
    addItem(clip);
  }, [pickAudio, audioItems, addItem]);

  const handleAddText = useCallback(() => {
    const beat: TextItem = {
      id: crypto.randomUUID(),
      type: 'text',
      label: 'Beat',
      startTime: textItems.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0),
      duration: 3,
      text: '',
      fontSize: 48,
      color: '#ffffff',
      positionX: 0.5,
      positionY: 0.5,
    };
    addItem(beat);
  }, [textItems, addItem]);

  const handleAddImage = useCallback(async () => {
    const probe = await pickImage();
    if (!probe) return;
    const fileName = probe.filePath.split(/[/\\]/).pop() ?? 'image';
    const img: ImageItem = {
      id: crypto.randomUUID(),
      type: 'image',
      label: fileName,
      startTime: imageItems.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0),
      duration: 5,
      filePath: probe.filePath,
      width: probe.width,
      height: probe.height,
      scale: 1,
      positionX: 0.5,
      positionY: 0.5,
    };
    addItem(img);
  }, [pickImage, imageItems, addItem]);

  // -- FFmpeg gate ------------------------------------------------------------

  const ffmpegReady = ffmpegStatus?.found === true;

  // -- Render -----------------------------------------------------------------

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 relative ${dragOver ? 'ring-2 ring-rose-400/40 ring-inset' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-rose-500/10 backdrop-blur-[1px] flex flex-col items-center justify-center gap-3 pointer-events-none">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border-2 border-dashed border-rose-400/50 flex items-center justify-center">
            <Upload className="w-8 h-8 text-rose-400" />
          </div>
          <p className="typo-heading text-rose-400">{t.media_studio.import_media}</p>
        </div>
      )}

      {(!ffmpegReady || ffmpegChecking) && (
        <div className="px-4 md:px-6 xl:px-8 pt-4">
          <FfmpegStatusBanner
            status={ffmpegStatus}
            checking={ffmpegChecking}
            onRecheck={ffmpegRecheck}
          />
        </div>
      )}

      {ffmpegReady && composition.items.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
          <div className="w-20 h-20 rounded-3xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
            <Film className="w-10 h-10 text-rose-400" />
          </div>
          <div className="max-w-md">
            <h2 className="typo-section-title">{t.media_studio.empty_title}</h2>
            <p className="typo-body text-foreground mt-1">{t.media_studio.empty_hint}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <Button variant="accent" accentColor="rose" size="md" onClick={handleAddVideo}>
              <Video className="w-4 h-4" />
              {t.media_studio.add_video}
            </Button>
            <Button variant="accent" accentColor="blue" size="md" onClick={handleAddAudio}>
              <Music className="w-4 h-4" />
              {t.media_studio.add_audio}
            </Button>
            <Button variant="ghost" size="md" onClick={handleAddImage}>
              <ImagePlus className="w-4 h-4" />
              {t.media_studio.add_image}
            </Button>
            <Button variant="ghost" size="md" onClick={handleAddText}>
              <Type className="w-4 h-4" />
              {t.media_studio.add_text_beat}
            </Button>
          </div>
          <p className="text-md text-foreground">
            {t.media_studio.import_media} {t.plugins.artist_media_studio.drag_drop_hint}
          </p>
        </div>
      )}

      {ffmpegReady && composition.items.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex flex-1 min-h-0">
            <div className="w-[62%] p-4 flex items-start justify-center bg-background/40">
              <CompositionPreview
                engine={engine}
                playing={playing}
                videoItems={videoItems}
                audioItems={audioItems}
                textItems={textItems}
                imageItems={imageItems}
                totalDuration={totalDuration}
                compositionHeight={composition.height}
              />
            </div>
            <div className="w-[38%] border-l border-primary/10 bg-card/30 min-h-0 overflow-y-auto">
              <InspectorPanel
                selectedItem={selectedItem}
                composition={composition}
                engine={engine}
                onUpdate={updateItem}
                onUpdateComposition={updateComposition}
                onSplit={splitItemAt}
                onAddItem={addItem}
              />
            </div>
          </div>

          <div className="h-[260px] flex-shrink-0">
            <TimelinePanel
              engine={engine}
              textItems={textItems}
              imageItems={imageItems}
              videoItems={videoItems}
              audioItems={audioItems}
              totalDuration={totalDuration}
              selectedId={selectedItemId}
              onSelect={setSelectedItemId}
              onSeek={seek}
              onUpdate={updateItem}
              onAddText={handleAddText}
              onAddImage={handleAddImage}
              onAddVideo={handleAddVideo}
              onAddAudio={handleAddAudio}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
            />
          </div>

          <PlaybackControls
            engine={engine}
            totalDuration={totalDuration}
            playing={playing}
            looping={looping}
            onPlay={play}
            onPause={pause}
            onStop={stop}
            onSeek={seek}
            onToggleLoop={toggleLoop}
          />
          <ExportPanel composition={composition} />
        </div>
      )}
    </div>
  );
}
