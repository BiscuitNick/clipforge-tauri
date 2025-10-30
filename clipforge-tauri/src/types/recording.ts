// Recording-related types matching Rust backend types

export type SourceType = 'screen' | 'window';

export interface ScreenSource {
  id: string;
  name: string;
  source_type: SourceType;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
  scale_factor: number;
  thumbnail?: string; // base64 encoded PNG
  app_name?: string; // for windows
}

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopping' | 'error';

export type RecordingType = 'screen' | 'webcam' | 'screenandwebcam';

export interface RecordingConfig {
  width: number;
  height: number;
  frame_rate: number;
  video_bitrate: number;
  video_codec: string;
  audio_sample_rate: number;
  audio_channels: number;
  audio_bitrate: number;
  audio_codec: string;
  output_format: string;
}

export interface RecordingState {
  id: string;
  recording_type: RecordingType;
  status: RecordingStatus;
  start_time?: number;
  pause_time: number;
  paused_at?: number;
  duration: number;
  file_path?: string;
  config: RecordingConfig;
}

export interface RecordingOptions {
  recording_type: RecordingType;
  source_id: string;
  config?: RecordingConfig;
  include_audio: boolean;
}

// ============================================================================
// Picture-in-Picture (PiP) Configuration Types
// ============================================================================

/**
 * Position of the webcam overlay on the screen
 */
export type PiPPosition = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

/**
 * Size of the webcam overlay relative to screen dimensions
 */
export type PiPSize = 'small' | 'medium' | 'large';

/**
 * Size percentages for each PiP size option
 * These are percentages of the screen width/height
 */
export const PiPSizeValues: Record<PiPSize, number> = {
  small: 0.12,   // 12% of screen dimensions
  medium: 0.18,  // 18% of screen dimensions
  large: 0.24,   // 24% of screen dimensions
};

/**
 * Padding from screen edges in pixels
 */
export const PiP_EDGE_PADDING = 20;

/**
 * Configuration for Picture-in-Picture webcam overlay
 */
export interface PiPConfiguration {
  /** Position of the overlay on screen */
  position: PiPPosition;
  /** Size of the overlay */
  size: PiPSize;
  /** Selected camera device ID */
  cameraId?: string;
  /** Include audio from webcam */
  includeAudio: boolean;
  /** Selected audio device ID for webcam */
  audioDeviceId?: string;
}

/**
 * Calculated pixel coordinates for PiP overlay
 */
export interface PiPCoordinates {
  /** X position in pixels */
  x: number;
  /** Y position in pixels */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/**
 * Metadata for a PiP recording session
 * Links screen and webcam recordings with synchronization info
 */
export interface PiPRecordingMetadata {
  /** Unique ID for this recording session */
  id: string;
  /** Timestamp when recording started (milliseconds since epoch) */
  startTime: number;
  /** Duration of the recording in seconds */
  duration: number;
  /** Path to the screen recording file */
  screenFilePath: string;
  /** Path to the webcam recording file */
  webcamFilePath: string;
  /** PiP configuration used for this recording */
  pipConfig: PiPConfiguration;
  /** Screen dimensions at time of recording */
  screenDimensions: {
    width: number;
    height: number;
  };
  /** Webcam dimensions at time of recording */
  webcamDimensions: {
    width: number;
    height: number;
  };
}

/**
 * Default PiP configuration
 */
export const DefaultPiPConfiguration: PiPConfiguration = {
  position: 'bottomRight',
  size: 'medium',
  includeAudio: true,
};

/**
 * Calculate pixel coordinates for PiP overlay based on configuration
 * @param config PiP configuration
 * @param screenWidth Width of the screen in pixels
 * @param screenHeight Height of the screen in pixels
 * @param webcamAspectRatio Aspect ratio of the webcam (width/height)
 * @returns Pixel coordinates for the overlay
 */
export function calculatePiPCoordinates(
  config: PiPConfiguration,
  screenWidth: number,
  screenHeight: number,
  webcamAspectRatio: number = 16 / 9
): PiPCoordinates {
  // Calculate overlay dimensions based on size setting
  const sizePercent = PiPSizeValues[config.size];

  // Use the smaller dimension to maintain aspect ratio
  const overlayWidth = Math.floor(screenWidth * sizePercent);
  const overlayHeight = Math.floor(overlayWidth / webcamAspectRatio);

  // Calculate position based on selected corner
  let x: number;
  let y: number;

  switch (config.position) {
    case 'topLeft':
      x = PiP_EDGE_PADDING;
      y = PiP_EDGE_PADDING;
      break;
    case 'topRight':
      x = screenWidth - overlayWidth - PiP_EDGE_PADDING;
      y = PiP_EDGE_PADDING;
      break;
    case 'bottomLeft':
      x = PiP_EDGE_PADDING;
      y = screenHeight - overlayHeight - PiP_EDGE_PADDING;
      break;
    case 'bottomRight':
      x = screenWidth - overlayWidth - PiP_EDGE_PADDING;
      y = screenHeight - overlayHeight - PiP_EDGE_PADDING;
      break;
  }

  return {
    x,
    y,
    width: overlayWidth,
    height: overlayHeight,
  };
}

/**
 * Get CSS styles for positioning PiP overlay
 * @param coordinates Calculated PiP coordinates
 * @returns CSS style object for positioning
 */
export function getPiPOverlayStyles(coordinates: PiPCoordinates): React.CSSProperties {
  return {
    position: 'absolute',
    left: `${coordinates.x}px`,
    top: `${coordinates.y}px`,
    width: `${coordinates.width}px`,
    height: `${coordinates.height}px`,
  };
}

/**
 * Validate PiP configuration
 * @param config Configuration to validate
 * @returns Error message if invalid, null if valid
 */
export function validatePiPConfiguration(config: PiPConfiguration): string | null {
  if (!['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].includes(config.position)) {
    return `Invalid PiP position: ${config.position}`;
  }

  if (!['small', 'medium', 'large'].includes(config.size)) {
    return `Invalid PiP size: ${config.size}`;
  }

  return null;
}
