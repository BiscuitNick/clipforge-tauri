import { useState, useCallback } from "react";

/**
 * Custom hook for managing Media Library state
 * Handles media items in the staging area (not yet added to timeline)
 */
export function useMediaLibrary() {
  const [mediaItems, setMediaItems] = useState([]);

  /**
   * Add imported media to the library
   * Converts VideoMetadata from backend to MediaItem format
   */
  const addMediaItems = useCallback((videoMetadataArray) => {
    const newMediaItems = videoMetadataArray.map((video) => ({
      id: `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      filename: video.filename,
      filepath: video.path,
      duration: video.duration,
      thumbnailPath: video.thumbnail_path || "",
      usedInTimeline: false,
      width: video.width,
      height: video.height,
      frameRate: video.frame_rate,
      fileSize: video.file_size,
    }));

    setMediaItems(prev => [...prev, ...newMediaItems]);
    return newMediaItems;
  }, []);

  /**
   * Remove a media item from the library
   */
  const removeMediaItem = useCallback((mediaId) => {
    setMediaItems(prev => prev.filter(item => item.id !== mediaId));
  }, []);

  /**
   * Mark a media item as used in timeline
   */
  const markAsUsed = useCallback((mediaId, isUsed = true) => {
    setMediaItems(prev => prev.map(item =>
      item.id === mediaId
        ? { ...item, usedInTimeline: isUsed }
        : item
    ));
  }, []);

  /**
   * Get a specific media item by ID
   */
  const getMediaItem = useCallback((mediaId) => {
    return mediaItems.find(item => item.id === mediaId);
  }, [mediaItems]);

  /**
   * Clear all media items
   */
  const clearMediaLibrary = useCallback(() => {
    setMediaItems([]);
  }, []);

  return {
    // State
    mediaItems,

    // Actions
    addMediaItems,
    removeMediaItem,
    markAsUsed,
    getMediaItem,
    clearMediaLibrary,
  };
}
