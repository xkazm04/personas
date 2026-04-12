// ---------------------------------------------------------------------------
// Media Studio — timeline & composition types (Phase 1)
// ---------------------------------------------------------------------------

/** Transition between clips. */
export type TransitionType = 'cut' | 'crossfade' | 'fade_to_black';

/** Semantic layer identifier. */
export type LayerType = 'video' | 'audio' | 'text' | 'image';

// -- Timeline items ---------------------------------------------------------

export interface TimelineItemBase {
  id: string;
  type: LayerType;
  startTime: number;   // seconds on the timeline
  duration: number;     // seconds
  /** Label shown in the lane. */
  label: string;
}

export interface TextItem extends TimelineItemBase {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  positionX: number;
  positionY: number;
}

export interface ImageItem extends TimelineItemBase {
  type: 'image';
  filePath: string;
  width: number | null;
  height: number | null;
  scale: number;
  positionX: number;
  positionY: number;
}

export interface VideoClip extends TimelineItemBase {
  type: 'video';
  filePath: string;
  /** Seconds trimmed from media start. */
  trimStart: number;
  /** Seconds trimmed from media end. */
  trimEnd: number;
  /** Original media duration (before trim). */
  mediaDuration: number;
  width: number | null;
  height: number | null;
  transition: TransitionType;
  transitionDuration: number;
}

export interface AudioClip extends TimelineItemBase {
  type: 'audio';
  filePath: string;
  trimStart: number;
  trimEnd: number;
  mediaDuration: number;
  /** 0–1 */
  volume: number;
}

export type TimelineItem = TextItem | ImageItem | VideoClip | AudioClip;

// -- Composition ------------------------------------------------------------

export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  items: TimelineItem[];
}

// -- Playback ---------------------------------------------------------------

export interface PlaybackState {
  currentTime: number;
  playing: boolean;
}

// -- Export ------------------------------------------------------------------

export type ExportStatus = 'idle' | 'exporting' | 'complete' | 'error' | 'cancelled';

export interface ExportState {
  status: ExportStatus;
  progress: number;       // 0–1
  jobId: string | null;
  outputPath: string | null;
  error: string | null;
}
