import { MediaItem, TimelineClip } from './media';

/**
 * Application State Structure
 * Defines the core state management contracts
 */
export interface AppState {
  /** Media library - staging area for imported media */
  mediaItems: MediaItem[];

  /** Timeline clips - clips currently on the timeline */
  timelineClips: TimelineClip[];

  /** Currently selected clip ID (if any) */
  selectedClipId: string | null;

  /** Playhead position in seconds */
  playheadPosition: number;

  /** Timeline zoom level (pixels per second) */
  zoomLevel: number;

  /** Timeline horizontal pan offset in pixels */
  panOffset: number;

  /** Whether the timeline is currently being panned */
  isPanning: boolean;
}

/**
 * Initial/default state
 */
export const initialAppState: AppState = {
  mediaItems: [],
  timelineClips: [],
  selectedClipId: null,
  playheadPosition: 0,
  zoomLevel: 1,
  panOffset: 0,
  isPanning: false,
};
