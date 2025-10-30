/**
 * Media Item - Represents a media file in the Media Library staging area
 * Source media that can be added to the timeline multiple times
 */
export interface MediaItem {
  /** Unique identifier for the media item */
  id: string;

  /** Original filename */
  filename: string;

  /** Full path to the media file */
  filepath: string;

  /** Duration of the media in seconds */
  duration: number;

  /** Path to the thumbnail image */
  thumbnailPath: string;

  /** Whether this media is currently used in the timeline */
  usedInTimeline: boolean;

  /** Optional: Video width in pixels */
  width?: number;

  /** Optional: Video height in pixels */
  height?: number;

  /** Optional: Frame rate */
  frameRate?: number;

  /** Optional: Type of media - 'standard' or 'pip' */
  mediaType?: 'standard' | 'pip';

  /** Optional: Path to PiP metadata file (for PiP recordings) */
  pipMetadataPath?: string;
}

/**
 * Timeline Clip - Represents a specific instance of media on the timeline
 * Multiple instances of the same MediaItem can exist with different trim settings
 */
export interface TimelineClip {
  /** Unique identifier for this timeline clip instance */
  id: string;

  /** Reference to the source MediaItem */
  mediaId: string;

  /** Absolute position on timeline in seconds */
  position: number;

  /** Trim start point (in-point) in seconds relative to source media */
  inPoint: number;

  /** Trim end point (out-point) in seconds relative to source media */
  outPoint: number;

  /** Optional: Reference to original filepath for convenience */
  videoPath?: string;

  /** Optional: Reference to original filename for convenience */
  filename?: string;

  /** Optional: Original media duration for convenience */
  duration?: number;

  /** Optional: Video dimensions */
  width?: number;
  height?: number;

  /** Optional: Frame rate */
  frameRate?: number;

  /** Optional: Type of media - 'standard' or 'pip' */
  mediaType?: 'standard' | 'pip';

  /** Optional: Path to PiP metadata file (for PiP recordings) */
  pipMetadataPath?: string;
}

/**
 * Legacy clip structure from MVP - for backward compatibility
 * Will be migrated to use TimelineClip structure
 */
export interface LegacyClip {
  id: string;
  videoPath: string;
  filename: string;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  startTime: number;
  trimStart: number;
  trimEnd: number;
}

// Re-export PiP types from recording module for convenience
export type { PiPRecordingMetadata, PiPConfiguration } from './recording';
