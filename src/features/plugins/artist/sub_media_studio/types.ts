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
  /**
   * Longer description of the beat — shown in the beat-edit modal and
   * surfaced on the timeline via the pin tooltip. `label` (from
   * TimelineItemBase) is the short word; `text` is the elaboration.
   *
   * Note: the type is named `TextItem` for save-file backward compatibility.
   * Semantically these are **beats** — milestones on the timeline, never
   * rendered into the preview frame or the exported video.
   */
  text: string;
}

export interface ImageItem extends TimelineItemBase {
  type: 'image';
  filePath: string;
  width: number | null;
  height: number | null;
  scale: number;
  positionX: number;
  positionY: number;
  fadeIn?: number;
  fadeOut?: number;
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
  /** Playback speed multiplier. 1 = normal, 2 = 2× speed, 0.5 = half. */
  speed?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Drop this clip's audio track on export. */
  stripAudio?: boolean;
}

export interface AudioClip extends TimelineItemBase {
  type: 'audio';
  filePath: string;
  trimStart: number;
  trimEnd: number;
  mediaDuration: number;
  /** 0–1 */
  volume: number;
  speed?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Apply EBU R128 loudness normalization (loudnorm) on export. */
  normalize?: boolean;
  /**
   * Integrated program loudness measured once via ffmpeg loudnorm dry run.
   * Used by the preview to compute a true linear gain so the in-browser
   * playback matches what the export will render.
   */
  measuredLufs?: number;
  /** Loudness range measurement (LU). Used by two-pass loudnorm on export. */
  measuredLra?: number;
  /** True peak measurement (dBTP). Used by two-pass loudnorm on export. */
  measuredTruePeak?: number;
  /** loudnorm threshold from the dry run. Used by two-pass loudnorm on export. */
  measuredThreshold?: number;
  /** `true` while the measurement is in flight. */
  measuringLoudness?: boolean;
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
