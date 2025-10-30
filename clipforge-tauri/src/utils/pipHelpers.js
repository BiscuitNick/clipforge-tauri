import { invoke } from '@tauri-apps/api/core';

/**
 * Load PiP recording metadata from a JSON file
 * @param {string} metadataPath Path to the metadata JSON file
 * @returns {Promise<Object>} Parsed PiP metadata
 */
export async function loadPiPMetadata(metadataPath) {
  try {
    // Read file using Tauri file system
    const response = await fetch(`asset://localhost/${metadataPath}`);
    const metadata = await response.json();
    return metadata;
  } catch (err) {
    console.error('[PiPHelpers] Failed to load PiP metadata:', err);
    throw new Error(`Failed to load PiP metadata: ${err.message}`);
  }
}

/**
 * Check if a media item is a PiP recording
 * @param {Object} mediaItem Media item to check
 * @returns {boolean} True if media item is a PiP recording
 */
export function isPiPRecording(mediaItem) {
  return mediaItem.mediaType === 'pip' && Boolean(mediaItem.pipMetadataPath);
}

/**
 * Get FFmpeg command arguments for compositing PiP recording
 * @param {Object} metadata PiP recording metadata
 * @param {string} outputPath Output file path
 * @returns {Array<string>} FFmpeg command arguments
 */
export function getPiPCompositeFFmpegArgs(metadata, outputPath) {
  const { screenFilePath, webcamFilePath, pipConfig, screenDimensions } = metadata;

  // Calculate overlay position using the same calculation as frontend
  const coordinates = calculatePiPCoordinatesForFFmpeg(
    pipConfig,
    screenDimensions.width,
    screenDimensions.height
  );

  // FFmpeg command for PiP overlay:
  // 1. Input screen video
  // 2. Input webcam video
  // 3. Scale webcam to overlay size
  // 4. Overlay webcam on screen at calculated position
  return [
    '-i', screenFilePath,      // Input 0: Screen recording
    '-i', webcamFilePath,       // Input 1: Webcam recording
    '-filter_complex', [
      // Scale webcam to overlay size
      `[1:v]scale=${coordinates.width}:${coordinates.height}[webcam]`,
      // Overlay webcam on screen
      `[0:v][webcam]overlay=${coordinates.x}:${coordinates.y}[outv]`
    ].join(';'),
    '-map', '[outv]',           // Use composited video
    '-map', '0:a?',             // Use screen audio if available
    '-map', '1:a?',             // Mix in webcam audio if available
    '-c:v', 'libx264',          // H.264 video codec
    '-preset', 'medium',        // Encoding speed/quality balance
    '-crf', '23',               // Constant quality (lower = better, 18-28 recommended)
    '-c:a', 'aac',              // AAC audio codec
    '-b:a', '192k',             // Audio bitrate
    '-movflags', '+faststart',  // Enable progressive streaming
    '-y',                       // Overwrite output file
    outputPath
  ];
}

/**
 * Calculate PiP coordinates for FFmpeg overlay
 * Same logic as calculatePiPCoordinates but for FFmpeg
 */
function calculatePiPCoordinatesForFFmpeg(pipConfig, screenWidth, screenHeight) {
  const { position, size } = pipConfig;

  // Size percentages
  const sizeValues = {
    small: 0.15,
    medium: 0.25,
    large: 0.35,
  };

  const sizePercent = sizeValues[size] || 0.25;
  const EDGE_PADDING = 20;

  // Calculate overlay dimensions
  const overlayWidth = Math.floor(screenWidth * sizePercent);
  const overlayHeight = Math.floor(overlayWidth / (16 / 9)); // 16:9 aspect ratio

  // Calculate position
  let x, y;

  switch (position) {
    case 'topLeft':
      x = EDGE_PADDING;
      y = EDGE_PADDING;
      break;
    case 'topRight':
      x = screenWidth - overlayWidth - EDGE_PADDING;
      y = EDGE_PADDING;
      break;
    case 'bottomLeft':
      x = EDGE_PADDING;
      y = screenHeight - overlayHeight - EDGE_PADDING;
      break;
    case 'bottomRight':
      x = screenWidth - overlayWidth - EDGE_PADDING;
      y = screenHeight - overlayHeight - EDGE_PADDING;
      break;
    default:
      x = screenWidth - overlayWidth - EDGE_PADDING;
      y = screenHeight - overlayHeight - EDGE_PADDING;
  }

  return { x, y, width: overlayWidth, height: overlayHeight };
}

/**
 * Create a MediaItem from PiP recording metadata
 * @param {Object} metadata PiP recording metadata
 * @param {string} metadataPath Path to metadata file
 * @returns {Object} MediaItem object
 */
export function createMediaItemFromPiPMetadata(metadata, metadataPath) {
  const { id, screenFilePath, duration, screenDimensions } = metadata;

  return {
    id,
    filename: `PiP Recording ${new Date(metadata.startTime).toLocaleString()}`,
    filepath: screenFilePath, // Use screen recording as primary file
    duration,
    thumbnailPath: '', // TODO: Generate thumbnail from composite
    usedInTimeline: false,
    width: screenDimensions.width,
    height: screenDimensions.height,
    mediaType: 'pip',
    pipMetadataPath: metadataPath,
  };
}

/**
 * Validate PiP metadata structure
 * @param {Object} metadata Metadata to validate
 * @returns {boolean} True if metadata is valid
 */
export function validatePiPMetadata(metadata) {
  const requiredFields = [
    'id',
    'startTime',
    'duration',
    'screenFilePath',
    'webcamFilePath',
    'pipConfig',
    'screenDimensions',
    'webcamDimensions'
  ];

  for (const field of requiredFields) {
    if (!(field in metadata)) {
      console.error(`[PiPHelpers] Missing required field: ${field}`);
      return false;
    }
  }

  // Validate pipConfig structure
  if (!metadata.pipConfig.position || !metadata.pipConfig.size) {
    console.error('[PiPHelpers] Invalid pipConfig structure');
    return false;
  }

  return true;
}

export default {
  loadPiPMetadata,
  isPiPRecording,
  getPiPCompositeFFmpegArgs,
  createMediaItemFromPiPMetadata,
  validatePiPMetadata,
};
