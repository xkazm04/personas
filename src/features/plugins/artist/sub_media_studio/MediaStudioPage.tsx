import { useCallback, useState, type DragEvent } from 'react';
import { Film, Video, Music, ImagePlus, Type, Upload } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
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
    selectedItemId,
    setSelectedItemId,
    selectedItem,
    textItems,
    imageItems,
    videoItems,
    audioItems,
    totalDuration,
  } = useMediaStudio();

  const { currentTime, playing, looping, play, pause, stop, seek, toggleLoop } = useTimelinePlayback(totalDuration);
  const { pickVideo, pickAudio, pickImage } = useMediaFilePicker();

  useTimelineKeyboard({
    playing,
    play,
    pause,
    seek,
    currentTime,
    totalDuration,
    selectedItemId,
    removeItem,
    duplicateItem,
    deselectItem: () => setSelectedItemId(null),
  });

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
    <ContentBox>
      <ContentHeader
        icon={<Film className="w-5 h-5 text-rose-400" />}
        iconColor="red"
        title={t.media_studio.title}
        subtitle={t.media_studio.subtitle}
        actions={
          ffmpegReady ? (
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={handleAddText}>
                <Type className="w-3.5 h-3.5" />
                {t.media_studio.add_text_beat}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleAddImage}>
                <ImagePlus className="w-3.5 h-3.5" />
                {t.media_studio.add_image}
              </Button>
              <Button variant="accent" accentColor="rose" size="sm" onClick={handleAddVideo}>
                <Video className="w-3.5 h-3.5" />
                {t.media_studio.add_video}
              </Button>
              <Button variant="accent" accentColor="blue" size="sm" onClick={handleAddAudio}>
                <Music className="w-3.5 h-3.5" />
                {t.media_studio.add_audio}
              </Button>
            </div>
          ) : undefined
        }
      />

      <ContentBody noPadding>
        <div
          className={`flex flex-col h-full relative ${dragOver ? 'ring-2 ring-rose-400/40 ring-inset' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {/* Drag overlay */}
          {dragOver && (
            <div className="absolute inset-0 z-50 bg-rose-500/10 backdrop-blur-[1px] flex flex-col items-center justify-center gap-3 pointer-events-none">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border-2 border-dashed border-rose-400/50 flex items-center justify-center">
                <Upload className="w-8 h-8 text-rose-400" />
              </div>
              <p className="typo-heading text-rose-400">{t.media_studio.import_media}</p>
            </div>
          )}
          {/* FFmpeg banner */}
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
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <ImagePlus className="w-8 h-8 text-rose-400" />
              </div>
              <div>
                <h2 className="typo-heading text-foreground/90">{t.media_studio.empty_title}</h2>
                <p className="typo-body text-muted-foreground mt-1">{t.media_studio.empty_hint}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="accent" accentColor="rose" size="md" onClick={handleAddVideo}>
                  <Video className="w-4 h-4" />
                  {t.media_studio.add_video}
                </Button>
                <Button variant="accent" accentColor="blue" size="md" onClick={handleAddAudio}>
                  <Music className="w-4 h-4" />
                  {t.media_studio.add_audio}
                </Button>
              </div>
            </div>
          )}

          {ffmpegReady && composition.items.length > 0 && (
            <>
              {/* Preview + Inspector row */}
              <div className="flex flex-1 min-h-0">
                {/* Preview — 60% */}
                <div className="w-[60%] p-4 flex items-start">
                  <CompositionPreview
                    selectedItem={selectedItem}
                    currentTime={currentTime}
                    textItems={textItems}
                    imageItems={imageItems}
                  />
                </div>
                {/* Inspector — 40% */}
                <div className="w-[40%] border-l border-primary/10 bg-card/30">
                  <InspectorPanel
                    selectedItem={selectedItem}
                    composition={composition}
                    onUpdate={updateItem}
                    onUpdateComposition={updateComposition}
                  />
                </div>
              </div>

              {/* Timeline — fixed height */}
              <div className="h-[250px] flex-shrink-0">
                <TimelinePanel
                  textItems={textItems}
                  imageItems={imageItems}
                  videoItems={videoItems}
                  audioItems={audioItems}
                  totalDuration={totalDuration}
                  currentTime={currentTime}
                  selectedId={selectedItemId}
                  onSelect={setSelectedItemId}
                  onSeek={seek}
                  onUpdate={updateItem}
                  onAddText={handleAddText}
                  onAddImage={handleAddImage}
                  onAddVideo={handleAddVideo}
                  onAddAudio={handleAddAudio}
                />
              </div>

              {/* Footer: Playback + Export */}
              <PlaybackControls
                currentTime={currentTime}
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
            </>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
