import { MediaItem, TimelineClip } from '../types';

/**
 * Helper functions for working with MediaItem and TimelineClip types
 * Demonstrates that TypeScript interfaces compile and can be imported
 */

/**
 * Create a new MediaItem from imported video metadata
 */
export function createMediaItem(
  id: string,
  filename: string,
  filepath: string,
  duration: number,
  thumbnailPath: string = '',
  width?: number,
  height?: number,
  frameRate?: number
): MediaItem {
  return {
    id,
    filename,
    filepath,
    duration,
    thumbnailPath,
    usedInTimeline: false,
    width,
    height,
    frameRate,
  };
}

/**
 * Create a new TimelineClip from a MediaItem
 */
export function createTimelineClip(
  mediaItem: MediaItem,
  position: number,
  inPoint: number = 0,
  outPoint?: number
): TimelineClip {
  return {
    id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    mediaId: mediaItem.id,
    position,
    inPoint,
    outPoint: outPoint ?? mediaItem.duration,
    videoPath: mediaItem.filepath,
    filename: mediaItem.filename,
    duration: mediaItem.duration,
    width: mediaItem.width,
    height: mediaItem.height,
    frameRate: mediaItem.frameRate,
  };
}

/**
 * Calculate the actual duration of a clip based on trim points
 */
export function getClipDuration(clip: TimelineClip): number {
  return clip.outPoint - clip.inPoint;
}

/**
 * Check if a position on the timeline would overlap with an existing clip
 */
export function hasOverlap(
  position: number,
  duration: number,
  existingClips: TimelineClip[]
): boolean {
  const newClipEnd = position + duration;

  return existingClips.some(clip => {
    const clipStart = clip.position;
    const clipEnd = clip.position + getClipDuration(clip);

    return (
      (position >= clipStart && position < clipEnd) ||
      (newClipEnd > clipStart && newClipEnd <= clipEnd) ||
      (position <= clipStart && newClipEnd >= clipEnd)
    );
  });
}

/**
 * Mark a MediaItem as used in timeline
 */
export function markMediaAsUsed(mediaItem: MediaItem): MediaItem {
  return {
    ...mediaItem,
    usedInTimeline: true,
  };
}
